/** 固定 mixed 历史到七表追加的只读预检。三份原公共SQL原字节输出，不重跑新装initial。
 * 260历史须先完成原三DDL；部分追加/失应答只报告原态，不自动重试或补写Prisma账。
 */
import { createHash } from "node:crypto";
import { readMysqlHistory, type MysqlHistoryObservation, type MysqlHistoryRow } from "@rental-os/platform-core-host";
import { mysqlStructureFromMigrations } from "@rental-os/platform-core-host/mysql-structure";
import { readMysqlPhysicalData } from "@rental-os/platform-core-host/mysql-physical";
import type { CoreHostSqlTransaction } from "@rental-os/core-host/mysql";

const histories = [
  { commit: "b6f25ce9b694c54bc596379f351ff02c8972260c", count: 260,
    ledger: "2d4fa3ee0d0c4c690654b7f6ed9fd7395ebe045e3ca679e4fdd5e5e8246b7879",
    physical: "17af1d770d3d41152c1818d6fccfbda5601a6d456ce787ab3c9855a9743ca3f2" },
  { commit: "39fbfb5c55706de8b1df1c2239d4adfc2ae95667", count: 263,
    ledger: "cd33932fe3bc63088a980aebd1749ea002d02248803feb92797503827936c93f",
    physical: "5d0bd534036cccf2bc19f0cb977c28301b4beb3bc6cf816c82cbbc1d6b718369" }
] as const;
const repaired = "20261111220000_ai_failure_resource_sources";
const repairedSql = "3c9497cb22648d0c9c336208ab5ea4b209dd2b3f4d2253fe8fadddf83e5b9142";
const sha = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const digest = (value: unknown) => sha(JSON.stringify(value));
const widths: Record<string, number> = { table: 7, column: 10, index: 11, check: 5, "foreign-key": 12, trigger: 3, routine: 3, event: 3 };
const additions = [
  { name: "20261115010000_core_access", sha256: "ef03bb4bae3ff0337213cb1f87aa2ebeb8338faec016be05de645dfea54c2411" },
  { name: "20261115020000_core_bindings", sha256: "5666ecd0d42099cf0865e8d8116709d3f7a07c77d360972cbe5866f15fa1a8bb" },
  { name: "20261123000000_public_rate_limit", sha256: "817c3136e13aa079826469eaafd39c23d20f935d2906654b0b7ca625d056cb12" }
] as const;
const seven = new Set(["platform_core_access_locks", "platform_tenant_core_grants", "platform_member_core_assignments",
  "platform_core_management_operations", "platform_core_bindings", "platform_core_binding_operations", "platform_api_rate_buckets"]);
export class LegacyRentalBridgeError extends Error {
  constructor(readonly reason: string) { super(`旧库桥接拒绝：${reason}`); this.name = "LegacyRentalBridgeError"; }
}
function refuse(reason: string): never { throw new LegacyRentalBridgeError(reason); }
const timestamp = (value: unknown): value is string => typeof value === "string"
  && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}$/u.test(value) && Number.isFinite(Date.parse(value.slice(0, -3) + "Z"));
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);

/** 输入来自固定采集字段；所有未知/未完成账仍保留为拒绝，不能用数组截断过滤。 */
export function inspectLegacyRentalHistory(observation: MysqlHistoryObservation) {
  const p = observation.profile;
  if (p.length !== 6 || p[0] !== "mysql-history-1" || typeof p[1] !== "string" || !/^8\.4\.\d+(?:[-+][\w.+-]+)?$/u.test(p[1])
    || p[2] !== 0 || p[3] !== "utf8mb4_unicode_ci" || !["REPEATABLE-READ", "SERIALIZABLE", "READ-COMMITTED"].includes(String(p[4])) || p[5] !== 1)
    refuse("mysql_profile_changed");
  const ids = new Set<string>(), originals = new Map<string, MysqlHistoryRow>(), extra = new Map<string, MysqlHistoryRow>();
  let rollback: MysqlHistoryRow | undefined;
  for (const row of observation.receipts) {
    const [kind, id, name, checksum, started, finished, rolledBack, steps, logs] = row;
    if (row.length !== 9 || kind !== "receipt" || typeof id !== "string" || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(id)
      || ids.has(id) || typeof name !== "string" || !/^\d{14}_[a-zA-Z0-9_-]+$/u.test(name) || !hash(checksum)
      || !timestamp(started) || steps !== 0 && steps !== 1 || !(logs === null || hash(logs))
      || !(finished === null || timestamp(finished) && finished >= started)
      || !(rolledBack === null || timestamp(rolledBack) && rolledBack >= started) || finished !== null && rolledBack !== null)
      refuse("invalid_receipt");
    ids.add(id);
    if (rolledBack !== null) {
      if (rollback || name !== repaired || checksum !== repairedSql || steps !== 0 || logs === null) refuse("unrecognized_rollback");
      rollback = row; continue;
    }
    if (finished === null) refuse("unfinished_migration");
    const resolved = name === repaired && checksum === repairedSql && steps === 0;
    if (logs !== null && !(resolved && logs === sha("")) || steps === 0 && !resolved) refuse("invalid_success_receipt");
    const target = additions.some(item => item.name === name) ? extra : originals;
    if (target.has(name)) refuse("duplicate_receipt");
    target.set(name, row);
  }
  const recovered = originals.get(repaired);
  if (!rollback || !recovered || recovered[3] !== repairedSql || String(recovered[4]) < String(rollback[6])) refuse("unmatched_recovery");
  const ledger = digest([...originals.keys()].sort().map(name => ({ name, checksum: originals.get(name)![3] })));
  const history = histories.find(item => item.count === originals.size && item.ledger === ledger);
  if (!history) refuse("unknown_migration_history");
  const originalPhysical: string[] = [], newTables = new Set<string>();
  for (const row of observation.physical) {
    if (typeof row[0] !== "string" || row.length !== widths[row[0]]) refuse("unrecognized_observation");
    if (["table", "column", "index", "check", "foreign-key"].includes(String(row[0])) && seven.has(String(row[1]))) {
      if (row[0] === "table") { if (newTables.has(String(row[1]))) refuse("duplicate_table"); newTables.add(String(row[1])); }
    } else originalPhysical.push(JSON.stringify(row));
  }
  if (digest(originalPhysical.sort()) !== history.physical) refuse("physical_drift");
  const originalFinished = [...originals.values()].map(row => String(row[5])).sort().at(-1)!;
  let previous = originalFinished;
  for (const addition of additions) {
    const receipt = extra.get(addition.name);
    if (!receipt) continue;
    if (receipt[3] !== addition.sha256 || receipt[7] !== 1 || receipt[8] !== null || String(receipt[4]) < previous)
      refuse("invalid_addition_receipt");
    previous = String(receipt[5]);
  }
  if (history.count !== 263) {
    if (extra.size || newTables.size) refuse("additions_before_legacy_forward");
    return { status: "requires_original_three" as const, history, additions: [], original: observation.receipts };
  }
  if (extra.size === 0 && newTables.size === 0)
    return { status: "ready_for_seven_tables" as const, history, additions: [], original: observation.receipts };
  if (extra.size !== additions.length || newTables.size !== seven.size) refuse("partial_additions_require_reconciliation");
  return { status: "seven_tables_recorded" as const, history, additions: additions.map(item => ({ ...item })), original: observation.receipts };
}

export function createLegacyRentalPublicUpgrade(publicFiles: ReadonlyMap<string, Uint8Array>) {
  const files = new Map<string, Uint8Array>(), statements: string[] = [];
  for (const item of additions) {
    const file = `apps/platform-api/prisma/migrations/${item.name}/migration.sql`, bytes = publicFiles.get(file);
    if (!bytes || sha(bytes) !== item.sha256) refuse("public_sql_source_changed");
    files.set(`migrations/${item.name}/migration.sql`, Buffer.from(bytes));
    statements.push(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  }
  const expected = mysqlStructureFromMigrations(statements);
  if (expected.length !== seven.size || expected.some(table => !seven.has(table.name))) refuse("public_table_scope_changed");
  files.set("migrations/migration_lock.toml", Buffer.from('provider = "mysql"\n'));
  return {
    /** 只给原迁移文件；调用方须另获DDL批准。旧完整initial不进入此Map。 */
    files: () => new Map([...files].map(([file, bytes]) => [file, Buffer.from(bytes)])),
    async read(database: Pick<CoreHostSqlTransaction, "$queryRaw">) {
      const observation = await readMysqlHistory(database), result = inspectLegacyRentalHistory(observation);
      const scopes = await database.$queryRaw<Array<{ count: bigint | number }>>`SELECT COUNT(*) AS count FROM ai_legacy_b02_scopes`;
      if (scopes.length !== 1 || Number(scopes[0].count) !== 0) refuse("unsupported_b02_provenance");
      if (result.status === "seven_tables_recorded" && !await readMysqlPhysicalData(database, expected, "0.1.0"))
        refuse("public_additions_physical_drift");
      return result;
    }
  };
}
