/** Initialize Rental starter categories only after the complete AI+MCP v2 gate. */
import { initializeFreshRental } from "./ai-fresh-initialize";
import { readFreshRentalMcpSelection } from "./mcp-bootstrap";

void initializeFreshRental(readFreshRentalMcpSelection).catch(() => {
  process.stderr.write("Rental 品类初始化未确认；请检查新装 AI/MCP 固定包、原账和 SaaS 主体。\n");
  process.exitCode = 1;
});
