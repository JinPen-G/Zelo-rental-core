/** 明确选择 mixed 263 原账。只读验证原账和新增七表，再逐所有者核当前物理合同。
 * 不投影伪造的新装appliedMigrations，不写旧账，不将准备状态作为业务可用；更新器继续禁用。
 */
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { CoreDeploymentLockSchema, CorePhysicalDataObservationSchema, type CoreDeploymentLock } from "@rental-os/core-contracts";
import { readCoreArchive } from "@rental-os/core-contracts/archive";
import type { CoreHistoricalDataSource, CoreHistoricalDataObservation } from "@rental-os/core-host";
import type { CoreMysqlDataPlan } from "@rental-os/core-host/mysql-deployment";
import type { CoreHostSqlTransaction } from "@rental-os/core-host/mysql";
import { createLegacyRentalPublicUpgrade, LegacyRentalBridgeError } from "./legacy-public-upgrade";

type Reader = Pick<CoreHostSqlTransaction, "$queryRaw">;
export class LegacyRentalDataSelection {
  readonly #base: CoreDeploymentLock;
  readonly #upgrade: ReturnType<typeof createLegacyRentalPublicUpgrade>;
  readonly #extra: readonly { owner: string; read(database: Reader): Promise<unknown> }[];
  /** 材料是正式底座归档原字节，完整摘要与锁一致；不接受可变的工作树文件Map冒充发行。 */
  constructor(input: { lock: CoreDeploymentLock; platformArchive: Uint8Array;
    additionalPhysical?: readonly { owner: string; read(database: Reader): Promise<unknown> }[] }) {
    this.#base = CoreDeploymentLockSchema.parse(input.lock);
    if (this.#base.cores.length !== 1 || this.#base.cores[0].manifest.id !== "rental"
      || this.#base.dataCapabilities?.some(item => item.id !== "ai-native"))
      throw new LegacyRentalBridgeError("unsupported_legacy_combination");
    const source = readCoreArchive(input.platformArchive, this.#base.platform.sha256);
    const metadataBytes = source.files.get("platform.source.json");
    if (!metadataBytes) throw new LegacyRentalBridgeError("missing_platform_source");
    const metadata = JSON.parse(Buffer.from(metadataBytes).toString("utf8"));
    if (metadata.format !== "nativark-platform-source-1" || !isDeepStrictEqual(metadata.source, this.#base.platform.source)
      || metadata.version !== this.#base.platform.versions.platform) throw new LegacyRentalBridgeError("platform_source_changed");
    this.#upgrade = createLegacyRentalPublicUpgrade(source.files);
    this.#extra = Object.freeze((input.additionalPhysical ?? []).map(item => Object.freeze({ owner: item.owner, read: item.read.bind(item) })));
    if (this.#base.dataCapabilities?.length && (this.#extra.length !== 1 || this.#extra[0].owner !== "rental-ai-extension"))
      throw new LegacyRentalBridgeError("missing_original_ai_extension_observer");
  }
  select(lock: CoreDeploymentLock) {
    if (!isDeepStrictEqual(lock, this.#base)) throw new LegacyRentalBridgeError("deployment_lock_changed");
    return structuredClone(this.#base);
  }
  get lockSha256() { return createHash("sha256").update(JSON.stringify(this.#base)).digest("hex"); }
  /** 可用于单独审批增量；不会执行或把材料登记成已应用。 */
  publicUpgrade() { return this.#upgrade; }
  observation(database: Reader, input: { platform: CoreMysqlDataPlan; rental: CoreMysqlDataPlan;
    capabilities: readonly { id: string; plan: CoreMysqlDataPlan }[] }): CoreHistoricalDataSource {
    const releases = this.#base.dataCapabilities ?? [];
    if (!isDeepStrictEqual(input.platform.data, this.#base.platform.data)
      || !isDeepStrictEqual(input.rental.data, this.#base.cores[0].manifest.data)
      || input.capabilities.length !== releases.length || new Set(input.capabilities.map(item => item.id)).size !== releases.length
      || releases.some(release => !isDeepStrictEqual(release.data, input.capabilities.find(item => item.id === release.id)?.plan.data)))
      throw new LegacyRentalBridgeError("data_owner_plan_changed");
    const plans = [{ owner: "platform", plan: input.platform }, { owner: "core:rental", plan: input.rental },
      ...input.capabilities.map(item => ({ owner: `capability:${item.id}`, plan: item.plan }))];
    return { read: async (): Promise<CoreHistoricalDataObservation> => {
      const original = await this.#upgrade.read(database);
      if (original.status !== "seven_tables_recorded") throw new LegacyRentalBridgeError(original.status);
      const owners: CoreHistoricalDataObservation["owners"][number][] = [];
      for (const { owner, plan } of plans) {
        const physical = CorePhysicalDataObservationSchema.safeParse(await plan.readPhysical(database));
        if (!physical.success || physical.data.version !== plan.data.version) throw new LegacyRentalBridgeError(`physical_contract:${owner}`);
        owners.push({ owner, contract: structuredClone(plan.data), physical: physical.data });
      }
      for (const extra of this.#extra) {
        const physical = CorePhysicalDataObservationSchema.safeParse(await extra.read(database));
        if (!physical.success || physical.data.version !== releases[0]?.data.version)
          throw new LegacyRentalBridgeError(`physical_contract:${extra.owner}`);
      }
      return { original: { sourceCommit: original.history.commit, ledgerSha256: original.history.ledger,
        successful: original.history.count, rolledBack: 1 }, additions: original.additions, owners };
    } };
  }
}
