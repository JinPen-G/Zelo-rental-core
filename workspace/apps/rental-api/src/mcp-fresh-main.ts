/** Fixed data-only boot for the standalone 23-migration development host. */
import { bootstrapFreshRentalMcp } from "./mcp-bootstrap";

void bootstrapFreshRentalMcp().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.name : "Error"}: Rental MCP 新装启动失败\n`);
  process.exitCode = 1;
});
