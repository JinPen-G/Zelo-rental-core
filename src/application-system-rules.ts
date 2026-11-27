/** 原租户七分区设置的兼容读写；字段、分区合并和历史生效版本沿原实现。
 * 只在所选 Rental 请求及原租户事务执行，不开放 SaaS 管理、AI 配置或凭据，不改变领域规则执行器。 */
import { BadRequestException, ForbiddenException } from "@nestjs/common";
import type { Prisma, PrismaClient } from "@prisma/client";
import { sqltag as sql } from "@prisma/client/runtime/library";
import { getRequestIdentity } from "@rental-os/platform-server/request-identity";
import { normalizeSecurityBaseline } from "@rental-os/platform-server/security";
import { hasRentalBusinessTenantFence, lockRentalBusinessTenant, assertRentalBusinessTenantAccessAfterLock } from "./mysql-business-fence";
import { createRentalBootstrapSystemRules } from "./tenant-bootstrap-defaults";
import { assertNoLegacyAiCredentials, closedLegacyAiSettings } from "./legacy-system-ai";
import type { SystemRulesConfig, SaveSystemRuleSectionRequest } from "./tenant-bootstrap-contracts";

export class RentalSystemRulesApplication {
  constructor(private readonly database: Pick<PrismaClient, "$transaction">) {}

  getSystemRules() {
    return this.run(async (tx, tenantId) => {
      const row = await this.read(tx, tenantId);
      return publicRules((row?.content as unknown as SystemRulesConfig | undefined) ?? createRentalBootstrapSystemRules());
    });
  }

  saveSystemRuleSection(input: SaveSystemRuleSectionRequest) {
    const sectionKey = input.sectionKey.trim();
    if (!["memberRegister", "memberPoints", "fleetMaintenance", "fleetCleaning", "calendarFixed", "calendarSpecial", "push"].includes(sectionKey))
      throw new BadRequestException("系统参数分区不存在");
    assertNoLegacyAiCredentials(input.config);
    return this.run(async (tx, tenantId) => {
      const row = await this.read(tx, tenantId);
      const next = copyRules((row?.content as unknown as SystemRulesConfig | undefined) ?? createRentalBootstrapSystemRules());
      const incoming = structuredClone(input.config);
      switch (sectionKey) {
        case "memberRegister": case "memberPoints": next.member = incoming.member; break;
        case "fleetMaintenance": next.fleet.maintenance = incoming.fleet.maintenance; break;
        case "fleetCleaning": next.fleet.cleaning = incoming.fleet.cleaning; break;
        case "calendarFixed": next.calendar.weekly = incoming.calendar.weekly; break;
        case "calendarSpecial": next.calendar.specialDates = incoming.calendar.specialDates; break;
        case "push": next.push = incoming.push; break;
      }
      // Fresh AI seeds omit the retired display block. Validate that absence as closed,
      // but do not add it back to storage or replace existing historical AI evidence.
      validateSystemRulesConfig({ ...next, aiModel: next.aiModel ?? closedLegacyAiSettings() });
      const content = { ...next, updatedAt: new Date().toISOString(), updatedBy: input.operator || "营运端" };
      const versionNo = row?.versionNo ?? 1;
      await tx.systemParameterSet.upsert({
        where: { tenantId_module_versionNo: { tenantId, module: "system-rules", versionNo } },
        update: { content: content as unknown as Prisma.InputJsonValue, operator: input.operator },
        create: { tenantId, module: "system-rules", versionNo, status: "EFFECTIVE",
          content: content as unknown as Prisma.InputJsonValue, operator: input.operator }
      });
      await tx.operationLog.create({ data: { tenantId, userId: getRequestIdentity()!.userId,
        action: "system-rules.update", detail: { sectionKey, operator: input.operator, versionNo } } });
      return publicRules(content);
    }, true);
  }

  private read(tx: Prisma.TransactionClient, tenantId: string) {
    return tx.systemParameterSet.findFirst({ where: { tenantId, module: "system-rules", status: "EFFECTIVE" },
      orderBy: { versionNo: "desc" } });
  }

  private async run<T>(consume: (tx: Prisma.TransactionClient, tenantId: string) => Promise<T>, write = false): Promise<T> {
    const source = getRequestIdentity();
    const checkIdentity = () => {
      if (!source?.tenantId || !source.userId || source.audience !== "operator" || source.isSaasAdmin
        || !source.accessSession || getRequestIdentity() !== source || !hasRentalBusinessTenantFence()
        || !(source.isPlatformAdmin || source.permissions?.some(code => code === "*" || code === "system:params:manage")))
        throw new ForbiddenException("原租户系统参数权限或请求范围不可用");
    };
    checkIdentity();
    const tenantId = source!.tenantId!;
    return this.database.$transaction(async tx => {
      // Serialize section merges before taking the Core/member fence; never upgrade an acquired shared parent lock.
      if (write) await tx.$queryRaw(sql`SELECT id FROM Tenant WHERE id = ${tenantId} FOR UPDATE`);
      await lockRentalBusinessTenant(tx, tenantId);
      checkIdentity();
      const result = await consume(tx, tenantId);
      await assertRentalBusinessTenantAccessAfterLock(tx, tenantId);
      checkIdentity();
      return result;
    }, { isolationLevel: "ReadCommitted" });
  }
}

function copyRules(config: SystemRulesConfig): SystemRulesConfig {
  const cloned = JSON.parse(JSON.stringify(config)) as SystemRulesConfig;
  cloned.security = normalizeSecurityBaseline(cloned.security);
  return cloned;
}
function publicRules(config: SystemRulesConfig): SystemRulesConfig {
  const cloned = copyRules(config);
  cloned.aiModel = closedLegacyAiSettings();
  return cloned;
}

function validateSystemRulesConfig(config: SystemRulesConfig) {
    const security = normalizeSecurityBaseline(config.security);
    const numbers = [
      config.member.welcomeGift.amount,
      config.member.welcomeGift.validity,
      config.member.referralGift.amount,
      config.member.referralGift.validity,
      config.fleet.maintenance.thresholdMileage,
      config.fleet.maintenance.thresholdMonths,
      config.fleet.maintenance.advanceKm,
      config.fleet.maintenance.advanceDays,
      config.fleet.cleaning.thresholdCount,
      config.fleet.cleaning.thresholdDays,
      config.fleet.cleaning.advanceCount,
      config.fleet.cleaning.advanceDays,
      security.loginRateLimit.maxFailures,
      security.loginRateLimit.windowMinutes,
      security.loginRateLimit.lockMinutes,
      security.passwordPolicy.minLength,
      security.passwordPolicy.expireDays
    ];
    if (numbers.some((value) => !Number.isFinite(value) || value < 0)) {
      throw new BadRequestException("系统参数中的数字配置不能为负数");
    }
    if (
      config.calendar.specialDates.some(
        (item) => !item.name.trim() || !item.range[0] || !item.range[1]
      )
    ) {
      throw new BadRequestException("特殊日期必须填写日期范围和备注说明");
    }
    if (
      config.push.list.some(
        (item) =>
          !item.title.trim() ||
          !item.content.trim() ||
          !item.trigger.trim() ||
          item.channels.length === 0
      )
    ) {
      throw new BadRequestException("推送规则必须填写标题、内容、触发时机和至少一个渠道");
    }
    if (
      config.aiModel.enabled &&
      (!config.aiModel.modelName.trim() ||
        (config.aiModel.provider === "OPENAI_COMPATIBLE" &&
          !config.aiModel.baseUrl?.trim()))
    ) {
      throw new BadRequestException("启用 AI 模型时必须填写模型名称，兼容模式还必须填写 Base URL");
    }
  }
