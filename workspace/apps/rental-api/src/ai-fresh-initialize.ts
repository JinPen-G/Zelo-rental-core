/** Explicit first-install Rental setup, after the complete v2 data gate. */
import { isAbsolute } from "node:path";
import { readCorePackageOrdinaryFile } from "@rental-os/platform-core-host/core-package-preflight";
import { initializeRentalCategories } from "@rental-os/rental-core/initialize-categories";
import { readFreshRentalAiSelection } from "./ai-fresh-main";
import { RentalDatabaseClient } from "./database";

export async function initializeFreshRental(select = readFreshRentalAiSelection) {
  const lockFile = process.env.RENTAL_DEPLOYMENT_LOCK ?? "";
  const dataDirectory = process.env.RENTAL_PUBLIC_AI_DATA_PACKAGE_DIR ?? "";
  if (!isAbsolute(lockFile) || !isAbsolute(dataDirectory) || !process.env.DATABASE_URL?.trim())
    throw new Error("须先配置新装库、完整 v2 锁和公共 AI 数据包的绝对路径");
  const lock = JSON.parse((await readCorePackageOrdinaryFile(lockFile, 8 * 1024 * 1024)).toString("utf8"));
  const selected = await select(lock, dataDirectory);
  const database = new RentalDatabaseClient();
  try {
    const result = await database.$transaction(async transaction => {
      await selected.data().phasedData(transaction);
      const admin = await transaction.user.findUnique({ where: { id: "user_saas_admin" },
        select: { id: true, tenantId: true, isSaasAdmin: true, isActive: true, tenant: { select: { code: true, status: true } } } });
      if (!admin?.isSaasAdmin || !admin.isActive || admin.tenant.code !== "platform" || admin.tenant.status !== "ACTIVE")
        throw new Error("须先通过正常入口初始化当前 SaaS 主体");
      const now = new Date(), initialized = await initializeRentalCategories(transaction, { actorId: admin.id, now });
      const added = initialized.categories.filter(category => !category.existed).map(category => category.code);
      if (added.length) await transaction.operationLog.create({ data: { userId: admin.id, tenantId: admin.tenantId,
        action: "rental.categories.initialized", detail: { operator: "deployment", categories: added } } });
      return initialized;
    }, { isolationLevel: "Serializable" });
    console.log(JSON.stringify(result));
  } finally { await database.$disconnect(); }
}

if (require.main === module) void initializeFreshRental().catch(() => {
  process.stderr.write("Rental 品类初始化未确认；请检查新装 v2 固定包、原账和 SaaS 主体。\n");
  process.exitCode = 1;
});
