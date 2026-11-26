/** Bind selected MCP ingress to the one Rental Auth, Guard, Core and database.
 * Release and traffic decisions are supplied by reviewed owners, not by the lock. */
import {
  assertOriginalMcpWorkspaceIntegrationManagement, createOriginalMcpWorkspaceManagementAuthority,
  createSelectedRentalMcpHost, OriginalMcpOperationLogService,
  type SelectedRentalMcpExports, type SelectedRentalMcpSources
} from "@rental-os/rental-mcp-host";
import type { RentalAiHostAssembly } from "./ai-assembly";
import type { RentalDatabaseClient } from "./database";

export type { SelectedRentalMcpSources } from "@rental-os/rental-mcp-host";

/** 正式ESM子出口组成同一原工厂；根包只提供受保护端点，不能充当OAuth工厂集合。 */
async function runtime(): Promise<SelectedRentalMcpExports> {
  const [service, router, consent, review, grant, admission, governance, subject, store, clients,
    admissions, authority, use, grantAdmission, consentReview, webConsent, consentAuthority, policies,
    traffic, protocolTraffic, accounting, input, goals, bindings, goalIntents, goalAdoptions, goalControl,
    clientReview, noticeReview, grantManagement, subjectStore, tokens, conversation, recovery, quote, proposal, order] = await Promise.all([
    import("@rental-os/mcp-server/service"), import("@rental-os/mcp-server/host-router"),
    import("@rental-os/mcp-server/consent-control-plane"), import("@rental-os/mcp-server/review-control-plane"),
    import("@rental-os/mcp-server/grant-control-plane"), import("@rental-os/mcp-server/admission-control-plane"),
    import("@rental-os/mcp-server/reviewed-governance-control-plane"), import("@rental-os/mcp-server/subject-control-plane"),
    import("@rental-os/mcp-server/prisma-oauth-store"), import("@rental-os/mcp-server/prisma-public-client-registry"),
    import("@rental-os/mcp-server/prisma-oauth-admission-store"), import("@rental-os/mcp-server/prisma-oauth-grant-authority"),
    import("@rental-os/mcp-server/prisma-oauth-grant-use"), import("@rental-os/mcp-server/prisma-oauth-grant-admission"),
    import("@rental-os/mcp-server/prisma-oauth-consent-review"), import("@rental-os/mcp-server/prisma-oauth-web-consent"),
    import("@rental-os/mcp-server/prisma-oauth-consent-authority"), import("@rental-os/mcp-server/prisma-oauth-consent-policy-store"),
    import("@rental-os/mcp-server/original-traffic-meter"), import("@rental-os/mcp-server/protocol-traffic"),
    import("@rental-os/mcp-server/prisma-mcp-read-accounting"), import("@rental-os/mcp-server/persistent-read-accounting"),
    import("@rental-os/mcp-server/prisma-mcp-catalog-goals"), import("@rental-os/mcp-server/prisma-mcp-read-bindings"),
    import("@rental-os/mcp-server/prisma-mcp-catalog-goal-intents"), import("@rental-os/mcp-server/prisma-mcp-catalog-goal-adoptions"),
    import("@rental-os/mcp-server/catalog-goal-control-plane"), import("@rental-os/mcp-server/prisma-public-client-review"),
    import("@rental-os/mcp-server/prisma-oauth-notice-review"), import("@rental-os/mcp-server/prisma-oauth-grant-management"),
    import("@rental-os/mcp-server/prisma-oauth-subject-store"), import("@rental-os/mcp-server/persistent-oauth-tokens"),
    import("@rental-os/mcp-server/conversation-result-read"), import("@rental-os/mcp-server/original-task-recovery-read"),
    import("@rental-os/mcp-server/quote-selection-read"), import("@rental-os/mcp-server/selected-proposal-read"),
    import("@rental-os/mcp-server/selected-order-result-read")
  ]);
  return { ...service, ...router, ...consent, ...review, ...grant, ...admission, ...governance, ...subject,
    ...store, ...clients, ...admissions, ...authority, ...use, ...grantAdmission, ...consentReview, ...webConsent,
    ...consentAuthority, ...policies, ...traffic, ...protocolTraffic, ...accounting, ...input, ...goals,
    ...bindings, ...goalIntents, ...goalAdoptions, ...goalControl, ...clientReview, ...noticeReview,
    ...grantManagement, ...subjectStore, ...tokens, ...conversation, ...recovery, ...quote, ...proposal, ...order,
    ...(await import("@rental-os/rental-mcp-host/capability-mapping")) };
}

export async function createFreshRentalMcpHost(host: RentalAiHostAssembly, database: RentalDatabaseClient,
  sources: SelectedRentalMcpSources) {
  if (!host.ai || !host.aiAccess || !Object.is(host.rental.database, database))
    throw new Error("MCP 选装缺少同实例 AI、Native 或数据准入");
  const { configuration, auth, authSource: users, primary } = host.rental;
  const platform = createOriginalMcpWorkspaceManagementAuthority({
    useMysqlDataSource: () => (configuration.get<string>("PLATFORM_DATA_SOURCE") ?? "mysql").toLowerCase() === "mysql",
    repository: {
      findUserById: (id, transaction) => users.findUserById(id, transaction),
      assertTrustedWorkspaceIntegrationManagement: (binding, transaction) =>
        assertOriginalMcpWorkspaceIntegrationManagement({
          assertTenantPermissionInTransaction: (native, tenantId, userId, permission) =>
            users.assertTenantManagementPermission(tenantId, userId, permission, native),
          resolveTrustedWorkspacePrincipal: (who, native) => users.resolveTrustedWorkspacePrincipal(who, native)
        }, binding, transaction)
    }
  });
  return createSelectedRentalMcpHost(await runtime(), { database, auth, users, platform, guard: host.guard,
    rentalCore: primary.core, logs: new OriginalMcpOperationLogService(database), term: host.coreReadSources.term,
    catalogue: host.catalogue, catalogueForTransaction: host.coreReadSources.catalogueForTransaction }, sources);
}
