/** Explicit fresh host using the public SDK for platform retention only.
 * The normal fresh and MCP entries never load this source or its SDK. */
import { createRentalPlatformRetentionRequests } from "@rental-os/rental-ai-adapters";
import { bootstrapFreshRentalAi } from "./ai-fresh-main";

export function bootstrapFreshRentalPublicRetention() {
  return bootstrapFreshRentalAi(createRentalPlatformRetentionRequests);
}

if (require.main === module) void bootstrapFreshRentalPublicRetention().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.name : "Error"}: Rental 公共平台保留启动失败\n`);
  process.exitCode = 1;
});
