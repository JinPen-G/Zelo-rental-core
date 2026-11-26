/** Prepare the MCP participant for the host's complete fresh v2 selection.
 * The enclosing host owns the ordered ledger check, physical observation and startup. */
import { isAbsolute } from 'node:path';
import { CorePhasedMigrationLockSchema } from '@rental-os/core-contracts/deployment';

export async function readFreshRentalMcpData(lock: unknown, input: { directory: string; tableCollation: string }) {
  const { base, postCapability } = CorePhasedMigrationLockSchema.parse(lock);
  const releases = base.dataCapabilities ?? [], mcp = releases.find(release => release.id === 'mcp');
  if (base.cores.length !== 1 || base.cores[0].manifest.id !== 'rental' || postCapability.length !== 1
    || postCapability[0].coreId !== 'rental' || postCapability[0].prerequisites.capability.id !== 'ai-native'
    || releases.length !== 2 || !releases.some(release => release.id === 'ai-native') || !mcp
    || typeof input?.directory !== 'string' || !isAbsolute(input.directory))
    throw new Error('Selected Rental MCP requires the full fresh AI/MCP lock and fixed MCP package directory');
  const { directory, tableCollation } = input;
  const [{ requireMcpDataPackage }, { createMcpMysqlDataPlan }] = await Promise.all([
    import('@rental-os/mcp-server/data-capability'), import('@rental-os/mcp-server/mysql-data')
  ]);
  const readDataPackage = () => requireMcpDataPackage(directory, mcp);
  const { files, release } = readDataPackage();
  // A fresh selection uses canonical names only. A legacy mapping requires a
  // separate verified owner-controlled bridge, not a value supplied here.
  const plan = createMcpMysqlDataPlan({ files, release, tableCollation });
  return Object.freeze({ plan: Object.freeze({ ...plan, capabilityId: 'mcp' as const }), readDataPackage });
}
