/** Explicit MCP ingress participant for a selected Rental application. It uses
 * the existing OAuth core and caller's Native catalogue, and owns no listener,
 * data migration, policy producer, business action or AI accounting. */
import type { CoreDeployedCatalogue } from '@rental-os/core-host';
import type { CoreHostSqlTransaction } from '@rental-os/core-host/mysql';
import { createOriginalMcpHost, type OriginalMcpHostConfig, type OriginalMcpHostExports } from './original-mcp-host';
import { createOriginalMcpCoreAccess } from './original-mcp-core-access';
import { createOriginalMcpCatalogReadTools, type OriginalMcpCatalogReadPolicy,
  type OriginalMcpCatalogReadToolsExports } from './original-mcp-catalog-read-tools';
import type { OriginalMcpResultReadOwner, OriginalMcpResultReadPolicy, OriginalMcpResultReadToolsExports } from './original-mcp-result-read-tools';

type Original = Parameters<typeof createOriginalMcpHost>[5];
type Catalog = Parameters<typeof createOriginalMcpCatalogReadTools>;
type Core = Parameters<typeof createOriginalMcpCoreAccess>[0];
type Catalogue = Pick<CoreDeployedCatalogue, 'availability' | 'requireDataCapabilityAvailable'>;
export type SelectedRentalMcpExports = OriginalMcpHostExports & OriginalMcpCatalogReadToolsExports & OriginalMcpResultReadToolsExports;
export interface SelectedRentalMcpApplication {
  database: Original['database'];
  auth: Parameters<typeof createOriginalMcpHost>[2];
  guard: Catalog[4];
  rentalCore: Catalog[5];
  platform: Parameters<typeof createOriginalMcpHost>[3];
  logs: Parameters<typeof createOriginalMcpHost>[4] & Catalog[6];
  users: Core['users'];
  term: Core['term'];
  catalogue: Pick<CoreDeployedCatalogue, 'requireDataCapabilityAvailable'>;
  catalogueForTransaction(reader: Pick<CoreHostSqlTransaction, '$queryRaw'>): Catalogue;
}
export interface SelectedRentalMcpSources extends Pick<Original, 'metadata' | 'verification' | 'reviewVerification' | 'protocolTraffic' | 'receiptTraffic'> {
  config: OriginalMcpHostConfig;
  catalog: OriginalMcpCatalogReadPolicy;
  catalogGoalVerification?: NonNullable<Original['catalogGoal']>['verification'];
  /** Optional exact original quote receipt. The original owner supplies the
   * receipt guard, reader, goal locator/audit, publication and field policy. */
  quoteReceipt?: { owner: OriginalMcpResultReadOwner<'quoteReceipt'>; traffic: OriginalMcpResultReadPolicy['traffic'] };
  /** Only registered original sales sources. Each retains its own current
   * custody and already-persisted goal; a quote receipt grants none of them. */
  sales?: { operations: Pick<OriginalMcpResultReadPolicy['operations'], 'quoteSelection' | 'selectedProposal' | 'selectedOrderResult'>;
    traffic: OriginalMcpResultReadPolicy['traffic'] };
}

export async function createSelectedRentalMcpHost(mcp: SelectedRentalMcpExports,
  app: SelectedRentalMcpApplication, sources: SelectedRentalMcpSources) {
  if (sources?.config?.core?.service?.enabled !== true || typeof sources.metadata?.read !== 'function'
    || typeof sources.catalog?.publication?.allows !== 'function' || typeof sources.catalog?.release?.project !== 'function'
    || typeof sources.catalog?.traffic?.current !== 'function' || typeof app?.catalogueForTransaction !== 'function'
    || typeof app.catalogue?.requireDataCapabilityAvailable !== 'function')
    throw new Error('Selected Rental MCP requires original AS, publication, field policy and the locked data catalogue');
  const { config, catalog, quoteReceipt, sales } = sources;
  if (quoteReceipt !== undefined && (!quoteReceipt?.owner || typeof quoteReceipt.traffic?.current !== 'function'))
    throw new Error('Selected Rental MCP requires the original quote receipt owner and traffic policy');
  if (sales !== undefined && (typeof sales?.traffic?.current !== 'function' || !sales.operations
    || Reflect.ownKeys(sales.operations).some(key => key !== 'quoteSelection' && key !== 'selectedProposal' && key !== 'selectedOrderResult')))
    throw new Error('Selected Rental MCP requires registered original sales owners and traffic policy');
  // No OAuth/HTTP ingress is constructed while the selected capability is
  // unavailable. The same checks run again under each original read Native.
  const catalogueForTransaction = app.catalogueForTransaction.bind(app);
  const requireData = async (catalogue: SelectedRentalMcpApplication['catalogue']) => {
    await catalogue.requireDataCapabilityAvailable('mcp');
    await catalogue.requireDataCapabilityAvailable('ai-native');
  };
  await requireData(app.catalogue);
  const coreAccess = createOriginalMcpCoreAccess({ users: app.users, term: app.term,
    deploymentForTransaction(reader) {
      const catalogue = catalogueForTransaction(reader);
      return { requireRegistered: id => catalogue.availability.requireRegistered(id),
        async requireAvailable(id, tenantId) {
          await requireData(catalogue);
          await catalogue.availability.requireAvailable(id, tenantId);
        } };
    }
  });
  const service = config.core.service;
  const pins = { enabled: service.enabled, resourceUrl: service.resource.resourceUrl, allowedScopes: service.tokens.allowedScopes };
  const results = quoteReceipt === undefined && sales === undefined ? undefined : await import('./original-mcp-result-read-tools.js');
  const runtime = sales === undefined ? mcp : { ...mcp, ...await import('@rental-os/mcp-server/original-read-tool') };
  return createOriginalMcpHost(mcp, config, app.auth, app.platform, app.logs, {
    database: app.database, coreAccess, metadata: sources.metadata,
    verification: sources.verification, reviewVerification: sources.reviewVerification,
    protocolTraffic: sources.protocolTraffic, receiptTraffic: sources.receiptTraffic,
    ...(sources.catalogGoalVerification ? { catalogGoal: { guard: app.guard, verification: sources.catalogGoalVerification } } : {}),
    createReadTools(current) {
      let directory = createOriginalMcpCatalogReadTools(mcp, pins, current, app.auth, app.guard, app.rentalCore, app.logs, catalog);
      if (results && quoteReceipt) directory = results.combineOriginalMcpReadTools(directory,
        results.createOriginalMcpResultReadTools(runtime, pins, current, app.auth, { operations: { quoteReceipt: quoteReceipt.owner }, traffic: quoteReceipt.traffic }));
      if (results && sales) directory = results.combineOriginalMcpReadTools(directory,
        results.createOriginalMcpResultReadTools(runtime, pins, current, app.auth, sales));
      return directory;
    }
  });
}
