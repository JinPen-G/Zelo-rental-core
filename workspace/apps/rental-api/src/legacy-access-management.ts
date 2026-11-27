/** 受控宿主的存量管理入口。准备读取复用当前ALS/会话/角色锁；采用操作原样交原服务。
 * 不接收管理员身份、不借prepared授权、不自动批量授权；HTTP或受信管理工具须沿原Auth进入。
 */
import { CoreAccessError } from "@rental-os/core-host";
import { PlatformPrincipalAuthority } from "@rental-os/platform-server/principal";
import { hasEffectivePermission } from "@rental-os/platform-server/permission-match";
import type { SystemUserRow } from "@rental-os/platform-contracts";
import { readRentalLegacyAccessPreparation, RentalLegacyAccessPreparationError, type RentalLegacyAccessPreparationDatabase,
  type RentalLegacyAccessPrepared } from "@rental-os/rental-core/legacy-access-preparation";
import { createRentalLegacyAccessAdoption, type RentalLegacyAccessAdoption, type RentalLegacyAccessAdoptionInput } from "@rental-os/rental-core/legacy-access-adoption";
import type { RentalDatabaseTransaction } from "./database";

export interface RentalLegacyAccessManagement extends RentalLegacyAccessAdoption {
  prepareTenantGrant(tenantId: string): Promise<RentalLegacyAccessPrepared>;
  prepareMembersAndBindings(): Promise<RentalLegacyAccessPrepared>;
}
export function createRentalLegacyAccessManagement(input: RentalLegacyAccessAdoptionInput & {
  database: RentalLegacyAccessAdoptionInput["database"] & RentalLegacyAccessPreparationDatabase;
  requireData(transaction: RentalDatabaseTransaction, tenantId: string): Promise<void>;
}): RentalLegacyAccessManagement {
  const principals = new PlatformPrincipalAuthority(input.authentication);
  const adoption = createRentalLegacyAccessAdoption(input);
  const permitted = (user: SystemUserRow, saas: boolean) => saas
    ? user.isSaasAdmin === true && hasEffectivePermission(user.permissions, "system:tenant:manage")
    : user.isSaasAdmin !== true && (user.isPlatformAdmin === true
      || user.dataScope === "all" && hasEffectivePermission(user.permissions, "system:user:manage"));
  const prepare = async (saas: boolean, tenantId: string) => {
    if (typeof tenantId !== "string" || !tenantId.trim() || tenantId !== tenantId.trim() || tenantId.length > 200)
      throw new RentalLegacyAccessPreparationError("invalid_request", "须指定原租户");
    const actor = principals.current();
    if (!saas && actor.tenantId !== tenantId) throw new CoreAccessError("denied", "存量成员准备只能读取当前租户");
    return input.database.$transaction(async transaction => {
      const lease = await principals.lock(transaction, actor, tenantId, undefined, false);
      if (!permitted(lease.user, saas)) throw new CoreAccessError("denied", "缺少原Core管理权限");
      await input.requireData(transaction, tenantId);
      const result = await readRentalLegacyAccessPreparation(transaction, input.authentication, tenantId);
      if (!permitted(await lease.revalidate(), saas)) throw new CoreAccessError("denied", "存量准备期间管理权限变化");
      return result;
    }, { isolationLevel: "RepeatableRead" });
  };
  return Object.freeze({
    prepareTenantGrant: (tenantId: string) => prepare(true, tenantId),
    prepareMembersAndBindings: () => prepare(false, principals.current().tenantId),
    grantTenant: adoption.grantTenant,
    assignMember: adoption.assignMember,
    bindScope: adoption.bindScope,
    readTenantGrantOperation: adoption.readTenantGrantOperation,
    readMemberAssignmentOperation: adoption.readMemberAssignmentOperation,
    readBindingOperation: adoption.readBindingOperation
  });
}
