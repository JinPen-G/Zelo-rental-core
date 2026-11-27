/** 构建核对与 API 同一固定部署锁和 Rental 标准包，向浏览器提供已核定清单。 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, isAbsolute, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import {
  CoreDeploymentLockSchema,
  checkCoreCombination,
  checkPlatformDataCapabilities,
  coreDeploymentHostVersions,
  isCoreVersionSupported,
} from "@rental-os/core-contracts";
import { requireCorePackagePin } from "@rental-os/core-contracts/install";
import { CorePhasedMigrationLockSchema, corePostCapabilityPrismaMigrationName,
  platformCapabilityPrismaMigrationName } from "@rental-os/core-contracts/deployment";
import { readPlatformDataCapabilityPackage } from "@rental-os/core-contracts/platform-data-package";
import { rentalHostLegacyApiRoutes } from "@rental-os/rental-api/openapi";
import { platformAdminVite } from "@rental-os/platform-admin/vite";
import { apiProxyTarget, loadViteEnvironment, publicEnvironmentDefinitions } from "../../config/environment.cjs";

export default defineConfig(({ mode }) => {
  const offline = mode === "ai-offline" || mode === "rental-fresh-ai-offline";
  const env = loadViteEnvironment(mode, fileURLToPath(new URL(".", import.meta.url)), loadEnv,
    { offline });
  if (!process.env.CORE_DEPLOYMENT_LOCK) throw new Error("Rental 后台构建须提供与 API 相同的 CORE_DEPLOYMENT_LOCK");
  const path = process.env.CORE_DEPLOYMENT_LOCK;
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  // The existing offline batch selects the exact lock format; v2 never falls back to v1.
  const freshAi = mode === "rental-fresh-ai" || mode === "rental-fresh-ai-offline"
    || offline && typeof value === "object" && value !== null && "lockVersion" in value && value.lockVersion === 2;
  const phased = freshAi ? CorePhasedMigrationLockSchema.parse(value) : undefined;
  const lock = phased?.base ?? CoreDeploymentLockSchema.parse(value);
  if (lock.cores.length !== 1 || lock.cores[0].manifest.id !== "rental")
    throw new Error("Rental 后台只装配所选 Rental Core");
  const host = coreDeploymentHostVersions(lock);
  const issues = [
    ...checkPlatformDataCapabilities(lock),
    ...checkCoreCombination(lock.cores.map(pin => pin.manifest), host).issues,
  ];
  if (issues.length) {
    throw new Error(issues.map(issue => `${issue.field} ${issue.message}`).join("\n"));
  }
  const require = createRequire(import.meta.url);
  const root = resolve(dirname(require.resolve("@rental-os/rental-core")), "..");
  const { manifest } = requireCorePackagePin(root, lock.cores[0], host, rentalHostLegacyApiRoutes());
  if (phased) {
    const [extension] = phased.postCapability, capabilities = lock.dataCapabilities ?? [];
    const ai = capabilities.find(capability => capability.id === "ai-native");
    const mcp = capabilities.find(capability => capability.id === "mcp");
    if (phased.postCapability.length !== 1 || extension.coreId !== "rental" || !ai
      || capabilities.length !== (mcp ? 2 : 1) || new Set(capabilities.map(capability => capability.id)).size !== capabilities.length
      || extension.prerequisites.capability.id !== ai.id)
      throw new Error("新装后台须选择与 API 相同的完整 v2 数据组合");
    // Data-package selection does not enable an MCP HTTP endpoint or grant business access.
    for (const capability of capabilities) {
      if (!isDeepStrictEqual(capability.source, lock.platform.source))
        throw new Error("新装后台数据能力须来自与 API 相同的固定底座");
      const directory = capability.id === "ai-native" ? process.env.RENTAL_PUBLIC_AI_DATA_PACKAGE_DIR
        : process.env.RENTAL_MCP_DATA_PACKAGE_DIR;
      if (!directory || !isAbsolute(directory)) throw new Error(`新装后台须核同一固定 ${capability.id} 数据包绝对目录`);
      readPlatformDataCapabilityPackage(directory, capability);
      for (const migration of capability.data.migrations) {
        const sql = readFileSync(resolve(dirname(path), "migrations",
          platformCapabilityPrismaMigrationName(capability.id, migration.id), "migration.sql"));
        if (createHash("sha256").update(sql).digest("hex") !== migration.sha256)
          throw new Error(`新装后台 ${capability.id} 迁移与 API 锁内的原数据包不同`);
      }
    }
    const { core, capability } = extension.prerequisites;
    if (!isDeepStrictEqual(extension.migration.source, manifest.source)
      || !isCoreVersionSupported(manifest.data.version, core.version)
      || !manifest.data.migrations.some(migration => migration.id === core.migration.id && migration.sha256 === core.migration.sha256)
      || !isCoreVersionSupported(ai.version, capability.version)
      || !ai.data.migrations.some(migration => migration.id === capability.migration.id && migration.sha256 === capability.migration.sha256))
      throw new Error("新装后台原 Rental 后置扩展的来源或数据前置不同");
    const sql = readFileSync(resolve(dirname(path), "migrations",
      corePostCapabilityPrismaMigrationName(extension.coreId, extension.migration.id), "migration.sql"));
    if (createHash("sha256").update(sql).digest("hex") !== extension.migration.sha256)
      throw new Error("新装后台锁内的原 Rental 扩展与实际迁移材料不同");
  }
  const platform = platformAdminVite();
  const virtual = "\0selected-rental-manifest";
  return {
    envDir: false,
    publicDir: platform.publicDir,
    envPrefix: [],
    define: publicEnvironmentDefinitions("admin", env),
    plugins: [
      ...platform.plugins,
      {
        name: "selected-rental-manifest",
        resolveId: (source: string) => source === "virtual:core-manifest" ? virtual : undefined,
        load: (id: string) => id === virtual ? `export default ${JSON.stringify(manifest)};` : undefined,
      },
      tailwindcss(),
      react(),
    ],
    css: { postcss: { plugins: platform.postcss } },
    resolve: { alias: platform.alias, extensions: platform.extensions },
    server: {
      port: Number(process.env.PORT ?? 5178),
      proxy: { "/api": { target: apiProxyTarget(env), changeOrigin: true } },
    },
  };
});
