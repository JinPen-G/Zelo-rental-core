/** Fixed v2 materials for the explicit new-install host. The v1 base is used
 * only for registration after the complete lock and its source are checked. */
import { isDeepStrictEqual } from "node:util";
import type { CoreDeploymentLock, CoreManifest } from "@rental-os/core-contracts";
import { CorePhasedMigrationLockSchema } from "@rental-os/core-contracts/deployment";
import { readPlatformDataCapabilityPackage } from "@rental-os/core-contracts/platform-data-package";
import { readPublicAiDataPackage, requirePublicAiDataPackage } from "@rental-os/ai-native-data/public-data-package";
import { createPublicPlatformDataPlan } from "@rental-os/platform-api/data-plan";
import { requireRentalDeploymentPackage } from "./deployment-package";
import { composeRentalPublicAiPrismaSchema, createFreshRentalAiDataObservation, createRentalAiMysqlPlans, readRentalAiDataExtension } from "./ai-data-extension";

type Observation = ReturnType<typeof createFreshRentalAiDataObservation>;

export class FreshRentalAiSelection {
  readonly #base: CoreDeploymentLock;
  readonly #dataPlan: ReturnType<typeof createRentalAiMysqlPlans>["publicAi"];
  readonly #dataRoot: string;
  readonly #data: NonNullable<CoreDeploymentLock["dataCapabilities"]>[number];
  readonly #observe: Observation;
  readonly #schema: string;

  get base() { return structuredClone(this.#base); }
  get schema() { return this.#schema; }

  constructor(input: { lock: unknown; publicAiDirectory: string; publicSchema: string;
    extension: { source: CoreManifest["source"]; files: ReadonlyMap<string, Uint8Array> } }) {
    const lock = CorePhasedMigrationLockSchema.parse(input.lock);
    if (lock.base.cores.length !== 1 || lock.base.cores[0].manifest.id !== "rental"
      || lock.base.dataCapabilities?.length !== 1 || lock.base.dataCapabilities[0].id !== "ai-native"
      || lock.postCapability.length !== 1) throw new Error("新装须选择单一 Rental 和公共 AI 数据包及后置扩展");
    const data = readPlatformDataCapabilityPackage(input.publicAiDirectory, lock.base.dataCapabilities[0]);
    const rental = requireRentalDeploymentPackage(lock.base.cores[0], lock.base.platform.versions);
    const { contribution } = readPublicAiDataPackage(data.files, data.release);
    const extension = readRentalAiDataExtension(input.extension.files);
    this.#observe = createFreshRentalAiDataObservation({ lock, platform: createPublicPlatformDataPlan(rental.dataPlan.publicForeignKeys),
      rental: rental.dataPlan, publicAiFiles: data.files, extension: input.extension });
    this.#dataPlan = createRentalAiMysqlPlans(contribution, extension).publicAi;
    this.#schema = composeRentalPublicAiPrismaSchema(input.publicSchema, contribution, rental.schema, extension);
    this.#base = lock.base;
    this.#data = data.release;
    this.#dataRoot = data.root;
  }

  select(lock: CoreDeploymentLock) {
    if (!isDeepStrictEqual(lock, this.#base)) throw new Error("新装运行登记与已核完整锁不同");
    return structuredClone(this.#base);
  }

  data() {
    const readDataPackages = () => [readPlatformDataCapabilityPackage(this.#dataRoot, this.#data)];
    return {
      dataPlan: this.#dataPlan,
      verifyDataPackage: () => { requirePublicAiDataPackage(this.#dataRoot, this.#data); },
      phasedData: this.#observe, readDataPackages
    };
  }
}
