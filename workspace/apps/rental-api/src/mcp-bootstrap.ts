/** Fresh MCP selection shares the actual v2 lock, Rental lifecycle and Native catalogue.
 * Without first-party owners it starts only Rental/AI; no MCP endpoint is mounted. */
import { dirname, isAbsolute, resolve } from "node:path";
import { readFreshRentalMcpData } from "@rental-os/rental-mcp-host";
import { createRentalAiHostModule, RENTAL_HOST_ASSEMBLY, type RentalAiHostAssembly } from "./ai-app.module";
import { readFreshRentalAiSelection } from "./ai-fresh-main";
import { bootstrapFreshRentalComposition } from "./bootstrap";
import { createRentalMcpHttpContribution } from "./mcp-composition";
import { createFreshRentalMcpHost, type SelectedRentalMcpSources } from "./mcp-host";
import { RentalDatabaseClient } from "./database";

/** MCP original SQL inherits the fresh deployment database's collation. */
const tableCollation = "utf8mb4_unicode_ci";

export async function readFreshRentalMcpSelection(lock: unknown, publicAiDirectory: string) {
  const directory = process.env.RENTAL_MCP_DATA_PACKAGE_DIR ?? "";
  if (!isAbsolute(directory)) throw new Error("新装 MCP 须配置固定完整数据包目录的绝对路径");
  const mcp = await readFreshRentalMcpData(lock, { directory, tableCollation });
  if (resolve(mcp.readDataPackage().root) !== dirname(require.resolve("@rental-os/mcp-server/data-contribution.json")))
    throw new Error("新装 MCP 数据包与实际运行工作区不同");
  return readFreshRentalAiSelection(lock, publicAiDirectory, mcp);
}

/** A first-party entry can opt in with original AS, catalog and traffic owners.
 * There is no environment-configured source module or Web identity fallback. */
export function bootstrapFreshRentalMcp(sources?: SelectedRentalMcpSources) {
  return bootstrapFreshRentalComposition(async lock => {
    const publicAiDirectory = process.env.RENTAL_PUBLIC_AI_DATA_PACKAGE_DIR ?? "";
    if (!isAbsolute(publicAiDirectory)) throw new Error("新装须配置固定公共 AI 数据包目录的绝对路径");
    const fresh = await readFreshRentalMcpSelection(lock, publicAiDirectory);
    const base = fresh.base;
    return { base, register: () => createRentalAiHostModule({ lock: base, fresh }) };
  }, sources === undefined ? undefined : { async createIngress(application) {
    const host = application.get<RentalAiHostAssembly>(RENTAL_HOST_ASSEMBLY);
    const database = application.get(RentalDatabaseClient);
    const ingress = await createRentalMcpHttpContribution(host, {
      createOriginalHost: current => createFreshRentalMcpHost(current, database, sources)
    });
    if (!ingress) throw new Error("未取得所选 MCP 原 HTTP 入口");
    return ingress;
  } });
}
