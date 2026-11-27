"use strict";

/** Compile fixed dual-repository development sources with the selected workspace's locked dependencies. */
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const api = "apps/example-multi-core-api";
const admin = "apps/example-multi-core-admin";
const tickets = "packages/example-tickets-core";
const tools = ["prepare-rental-workspace", "rental-build-snapshot", "check-rental-package-build",
  "verify-rental-distribution", "rental-build-memory", "build-selected-prisma",
  "rental-host-lock", "ops/release-composition", "ops/release-facts"];

function git(repo, ...args) {
  return execFileSync("git", ["--no-replace-objects", "--no-lazy-fetch", "-C", repo, ...args],
    { encoding: "utf8", timeout: 15000, windowsHide: true });
}

async function checkDevelopment([zeloDir, zeloCommit, rentalDir, rentalCommit, ...extra]) {
  const fixedCommit = /^[a-f0-9]{40}$/u;
  const full = extra[0] === "--full" && extra.length === 2 && Boolean(extra[1]);
  assert(zeloDir && rentalDir && fixedCommit.test(zeloCommit) && fixedCommit.test(rentalCommit) && (!extra.length || full),
    "用法：release-rental-development.cjs <Zelo目录> <完整SHA> <Rental目录> <完整SHA> [--full <已安装投影目录>]");
  const profile = full ? "full" : "multi-core";
  const repo = fs.realpathSync(zeloDir);
  const coreRepo = fs.realpathSync(rentalDir);
  assert.notEqual(repo, coreRepo, "须提供两个独立仓库");
  assert.equal(git(repo, "rev-parse", "HEAD").trim(), zeloCommit);
  assert.equal(git(coreRepo, "cat-file", "-t", rentalCommit).trim(), "commit");
  for (const name of tools) {
    const file = `scripts/${name}.cjs`;
    assert.equal(fs.readFileSync(path.join(repo, file), "utf8").replace(/\r\n/gu, "\n"),
      git(repo, "show", `${zeloCommit}:${file}`), `固定 Zelo 构建工具字节不一致：${file}`);
  }
  const tool = name => require(path.join(repo, "scripts", `${name}.cjs`));
  const { sha256 } = tool("ops/release-composition");
  const zeloDependencies = path.join(repo, "node_modules");
  const prepare = tool("prepare-rental-workspace");
  const contracts = prepare.compileFixedPlatformContracts(repo, zeloCommit, zeloDependencies, true);
  const contract = name => contracts.load(contracts.exported(`@rental-os/core-contracts/${name}`, true));
  const archiveApi = contract("archive");
  const workspace = await prepare.createRentalDevelopmentWorkspace({ repo, repository: "https://github.com/JinPen-G/Zelo",
    commit: zeloCommit, coreRepo, coreCommit: rentalCommit, mode: "development", profile },
    contract("platform-source"));
  const archive = archiveApi.createCoreArchive(workspace.files);
  const { files } = archiveApi.readCoreArchive(archive.bytes, archive.sha256);
  const sourceFile = files.get("development.workspace.json");
  const source = JSON.parse(sourceFile);
  assert.equal(source.mode, "development");
  assert.equal(source.profile, profile);
  assert.equal(source.host, full ? "rental" : "example-multi-core");
  assert.deepEqual(source.coreIds, full ? ["rental"] : ["rental", "example-tickets"]);
  assert.equal(source.ai, false);
  assert.equal(source.mcp, false);
  assert.equal(source.deployment.state, "not-prepared");
  assert.equal(source.platform.source.commit, zeloCommit);
  assert.equal(source.core.source.commit, rentalCommit);

  const lock = files.get("package-lock.json");
  assert.equal(sha256(lock), source.npmLocks.projected.sha256);
  const apiDirectory = full ? "apps/rental-api" : api;
  const webDirectory = full ? "apps/rental-admin" : admin;
  const entryFiles = full ? [`${apiDirectory}/src/main.ts`]
    : [`${apiDirectory}/src/main.ts`, `${webDirectory}/src/main.tsx`, `${webDirectory}/vite.config.ts`];
  const entries = entryFiles.map(file => {
    const entry = source.files.find(item => item.path === file);
    assert.equal(entry?.origin?.commit, rentalCommit, `宿主须来自独立 Rental：${file}`);
    assert.equal(entry.origin.repository, source.core.source.repository);
    assert.equal(entry.sha256, sha256(files.get(file)));
    return { file, sha256: entry.sha256 };
  });

  const absolute = file => path.join(repo, file).split(path.sep).join("/");
  const snapshot = tool("rental-build-snapshot").snapshotFromFiles(zeloCommit,
    new Map([...files].map(([file, bytes]) => [absolute(file), bytes])));
  const { createBuild, verifyContracts } = tool("check-rental-package-build");
  const distribution = tool("verify-rental-distribution");
  const deps = full ? fullDependencies(extra[1], files, repo, coreRepo) : zeloDependencies;
  const build = createBuild(deps, { snapshot, quiet: true });
  assert.equal(build.ts.version, JSON.parse(lock).packages["node_modules/typescript"]?.version);
  verifyContracts(build);
  distribution.verifyServer(build);
  for (const directory of ["apps/platform-api", "packages/ai-native-data", "apps/rental-api"]) {
    build.compile(`${directory}/tsconfig.json`);
  }
  const rentalClient = build.selectedClients.get(absolute("apps/rental-api"));
  assert(rentalClient, "开发编译须使用同一个所选 Rental Client");
  if (!full) {
    build.compile(`${tickets}/tsconfig.json`);
    build.selectedClients.set(absolute(apiDirectory), rentalClient);
    build.compile(`${apiDirectory}/tsconfig.json`);
  }
  build.selectedClients.set(absolute(webDirectory), rentalClient);
  build.compile(`${webDirectory}/tsconfig.json`);
  if (full) {
    distribution.verifyNative(build);
    build.selectedClients.set(absolute("apps/enterprise-portal"), rentalClient);
    for (const app of ["tenant-website", "enterprise-portal", "miniprogram", "staff-miniprogram"]) {
      build.compile(`apps/${app}/tsconfig.json`);
    }
  }
  const apiEntry = build.outputs.get(absolute(`${apiDirectory}/dist/main.js`));
  assert(apiEntry?.length, "开发 API 须实际生成启动入口");
  const workspaceReport = { files: files.size, bytes: archive.bytes.length, archiveSha256: archive.sha256,
    sourceSha256: sha256(sourceFile), npmLockSha256: sha256(lock) };
  const developmentReport = {
    mode: source.mode, profile: source.profile, platform: source.platform.source, rental: source.core.source,
    projects: build.stages, deployment: source.deployment.state, releaseApproved: false,
    serverUpdateEligible: false, databaseChecked: false,
  };
  if (full) {
    const { digestFiles } = tool("ops/release-facts");
    const emitted = [...build.outputs].filter(([file]) => /\.(?:js|cjs|json|d\.ts)$/u.test(file))
      .map(([file, text]) => ({ path: path.relative(repo, file), bytes: Buffer.byteLength(text), contents: Buffer.from(text) }));
    const { fileCount, totalBytes, digest } = digestFiles(emitted);
    return {
      format: "rental-development-build-1", ...developmentReport,
      selection: { host: source.host, ai: false, mcp: false },
      workspace: { ...workspaceReport, apiSourceSha256: entries[0].sha256 },
      dependencyInput: "full-projection",
      toolchain: { node: process.versions.node, typescript: build.ts.version, prisma: "5.22.0" },
      compiled: { files: fileCount, bytes: totalBytes, sha256: digest, apiEntrySha256: sha256(apiEntry) },
    };
  }
  return {
    format: "rental-multi-core-development-build-1", ...developmentReport, host: source.host,
    coreIds: source.coreIds, entries, workspace: workspaceReport,
    apiEntrySha256: sha256(apiEntry), webBundle: "not-run",
  };
}

function fullDependencies(directory, files, repo, coreRepo) {
  const projected = fs.realpathSync(directory);
  assert(projected !== repo && projected !== coreRepo, "full 编译依赖须位于独立投影目录");
  for (const file of ["development.workspace.json", "package.json", "package-lock.json"]) {
    const actual = path.join(projected, file);
    assert(fs.lstatSync(actual).isFile() && fs.readFileSync(actual).equals(files.get(file)),
      `full 依赖投影与固定双仓原字节不一致：${file}`);
  }
  const deps = path.join(projected, "node_modules");
  assert(fs.lstatSync(deps).isDirectory(), "须先从 full 投影锁安装编译依赖");
  return deps;
}

checkDevelopment(process.argv.slice(2)).then(report => process.stdout.write(`${JSON.stringify(report)}\n`)).catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
