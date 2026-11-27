/** 显式旧库管理HTTP只调用同宿主的准备/采用应用。路由准入沿公共Auth，提交点由原服务复验。
 * 每次单项应用后重新准备；失应答只读原operationId，不能换键重做。
 */
import { Body, Controller, HttpCode, HttpException, Inject, Module, Post, type DynamicModule } from "@nestjs/common";
import { z } from "zod";
import type { RegisteredCoreHttpAccess } from "@rental-os/platform-server";
import { getRequestIdentity } from "@rental-os/platform-server/request-identity";
import { hasEffectivePermission } from "@rental-os/platform-server/permission-match";
import { CoreAccessError } from "@rental-os/core-host";
import type { PlatformOpenApiDocument } from "@rental-os/core-contracts";
import { RentalLegacyAccessAdoptionError } from "@rental-os/rental-core/legacy-access-adoption";
import { RentalLegacyAccessPreparationError } from "@rental-os/rental-core/legacy-access-preparation";
import type { createRentalLegacyAccessManagement } from "./legacy-access-management";

type Application = ReturnType<typeof createRentalLegacyAccessManagement>;
const token = Symbol("rental.legacy.management");
const base = "platform/rental-legacy";
const id = z.string().min(1).max(200).refine(value => value === value.trim(), "标识不得包含首尾空白"), fingerprint = z.string().regex(/^[a-f0-9]{64}$/u);
const confirmation = z.object({ tenantId: id, sourceFingerprint: fingerprint, coreFingerprint: fingerprint }).strict();
const operation = z.object({ confirmed: confirmation, operationId: id, expectedRevision: z.number().int().nonnegative() }).strict();
const routes = {
  prepareTenant: { path: "tenant/prepare", saas: true, schema: z.object({ tenantId: id }).strict() },
  prepareMembers: { path: "members/prepare", saas: false, schema: z.object({}).strict() },
  grant: { path: "tenant/adopt", saas: true, schema: operation },
  assign: { path: "members/adopt", saas: false, schema: operation.extend({ userId: id }).strict() },
  bind: { path: "bindings/adopt", saas: false, schema: operation.extend({ workspaceId: id.optional() }).strict() },
  grantReceipt: { path: "tenant/operation", saas: true, schema: z.object({ tenantId: id, operationId: id }).strict() },
  memberReceipt: { path: "members/operation", saas: false, schema: z.object({ userId: id, operationId: id }).strict() },
  bindingReceipt: { path: "bindings/operation", saas: false, schema: z.object({ workspaceId: id.optional(), operationId: id }).strict() }
} as const;
const permission = (saas: boolean) => saas ? "system:tenant:manage" : "system:user:manage";

export function createRentalLegacyHttpAccess(application: Application | undefined, original: RegisteredCoreHttpAccess): RegisteredCoreHttpAccess {
  const policy = (method: string, path: string) => application && method.toUpperCase() === "POST"
    ? Object.values(routes).find(item => path === `/${base}/${item.path}`) : undefined;
  return {
    registered: (method, path, audience) => audience === "operator" && Boolean(policy(method, path)) || original.registered(method, path, audience),
    async authorize(method, path) {
      const route = policy(method, path);
      if (!route) return original.authorize(method, path);
      const actor = getRequestIdentity();
      if (!actor?.userId || actor.audience !== "operator" || !(route.saas
        ? actor.isSaasAdmin && hasEffectivePermission(actor.permissions ?? [], permission(true))
        : !actor.isSaasAdmin && (actor.isPlatformAdmin || actor.dataScope === "all" && hasEffectivePermission(actor.permissions ?? [], permission(false)))))
        throw new HttpException("缺少原存量Core管理权限", 403);
    }
  };
}
@Controller(base)
class RentalLegacyAccessController {
  constructor(@Inject(token) private readonly application: Application) {}
  @Post(routes.prepareTenant.path) @HttpCode(200)
  prepareTenant(@Body() value: unknown) { return this.respond(() => this.application.prepareTenantGrant(routes.prepareTenant.schema.parse(value).tenantId)); }
  @Post(routes.prepareMembers.path) @HttpCode(200)
  prepareMembers(@Body() value: unknown) { return this.respond(() => { routes.prepareMembers.schema.parse(value); return this.application.prepareMembersAndBindings(); }); }
  @Post(routes.grant.path) @HttpCode(200)
  grant(@Body() value: unknown) { return this.respond(() => this.application.grantTenant(routes.grant.schema.parse(value))); }
  @Post(routes.assign.path) @HttpCode(200)
  assign(@Body() value: unknown) { return this.respond(() => this.application.assignMember(routes.assign.schema.parse(value))); }
  @Post(routes.bind.path) @HttpCode(200)
  bind(@Body() value: unknown) { return this.respond(() => this.application.bindScope(routes.bind.schema.parse(value))); }
  @Post(routes.grantReceipt.path) @HttpCode(200)
  grantReceipt(@Body() value: unknown) { return this.respond(() => this.application.readTenantGrantOperation(routes.grantReceipt.schema.parse(value))); }
  @Post(routes.memberReceipt.path) @HttpCode(200)
  memberReceipt(@Body() value: unknown) { return this.respond(() => this.application.readMemberAssignmentOperation(routes.memberReceipt.schema.parse(value))); }
  @Post(routes.bindingReceipt.path) @HttpCode(200)
  bindingReceipt(@Body() value: unknown) { return this.respond(() => this.application.readBindingOperation(routes.bindingReceipt.schema.parse(value))); }
  private async respond<T>(work: () => Promise<T>): Promise<T> {
    try { return await work(); }
    catch (error) {
      if (error instanceof z.ZodError) throw new HttpException("输入不符合原存量管理合同", 400);
      if (error instanceof CoreAccessError || error instanceof RentalLegacyAccessAdoptionError || error instanceof RentalLegacyAccessPreparationError)
        throw new HttpException({ code: error.code, message: error.message }, error.code === "denied" ? 403
          : error.code === "core_unavailable" || error.code === "source_unavailable" ? 503 : error.code === "invalid_request" ? 400 : 409);
      throw error;
    }
  }
}
@Module({})
export class RentalLegacyAccessModule {
  static register(input: { imports: DynamicModule[]; inject: symbol[]; useFactory: (...values: any[]) => Application }): DynamicModule {
    return { module: RentalLegacyAccessModule, imports: input.imports, controllers: [RentalLegacyAccessController],
      providers: [{ provide: token, inject: input.inject, useFactory: input.useFactory }] };
  }
}

/** 同一路由表生成文档；身份角色说明不把SaaS权限分配到租户角色目录。 */
export function withRentalLegacyOpenApi(document: PlatformOpenApiDocument): PlatformOpenApiDocument {
  const result = structuredClone(document);
  const string = { type: "string", minLength: 1, maxLength: 200 };
  const confirmed = { type: "object", additionalProperties: false, required: ["tenantId", "sourceFingerprint", "coreFingerprint"],
    properties: { tenantId: string, sourceFingerprint: { type: "string", pattern: "^[a-f0-9]{64}$" }, coreFingerprint: { type: "string", pattern: "^[a-f0-9]{64}$" } } };
  for (const [name, route] of Object.entries(routes)) {
    const path = `/api/${base}/${route.path}`;
    if (result.paths[path]) throw new Error("存量管理文档与已有路由冲突");
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [field, validator] of Object.entries(route.schema.shape)) {
      properties[field] = field === "confirmed" ? confirmed : field === "expectedRevision" ? { type: "integer", minimum: 0 } : string;
      if (!validator.isOptional()) required.push(field);
    }
    result.paths[path] = { post: { operationId: `rentalLegacy${name}`, tags: ["Rental存量管理"],
      summary: `原存量Core管理 ${name}`, permissions: [permission(route.saas)], "x-requiredPermissions": [permission(route.saas)],
      "x-permissionAudience": route.saas ? "saas" : "tenant", security: [{ bearerAuth: [] }],
      requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties, required, additionalProperties: false } } } },
      responses: { "200": { description: "原准备结果或原单项收据；不自动执行下一项", content: { "application/json": {
        schema: { type: "object", required: ["data", "requestId"], properties: { data: { type: "object" }, requestId: { type: "string" } } }
      } } }, "400": { description: "输入不符合原合同" }, "401": { description: "原会话缺失或失效" }, "403": { description: "当前身份或管理权限拒绝" },
        "409": { description: "原指纹、修订或操作键冲突" }, "503": { description: "旧账或原业务来源尚未就绪" } } } };
  }
  return result;
}
