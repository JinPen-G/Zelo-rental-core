"use strict";
/** Rental mapping, conversation and sales original-read integration.
 * Public OAuth/transport cases remain in Zelo; this selected combination keeps real business assertions. */
const assert = require("node:assert/strict");
const { test, after } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire, registerHooks, isBuiltin } = require("node:module");
const { pathToFileURL, fileURLToPath } = require("node:url");
const root = path.resolve(process.env.MCP_TEST_SOURCE_ROOT || path.join(__dirname, ".."));
const toolchainRoot = path.resolve(process.env.MCP_TEST_TOOLCHAIN_ROOT || root);
const dependencyDirectory = path.join(toolchainRoot, "node_modules");
const dependencyRequire = createRequire(path.join(dependencyDirectory, "typescript/package.json"));
// Resolve each third-party package from the chosen installation. A missing
// prerequisite cannot fall through to an ancestor or a private Harness checkout.
function resolveDependency(specifier) {
  if (isBuiltin(specifier)) return specifier;
  const packageName = specifier.split("/").slice(0, specifier.startsWith("@") ? 2 : 1).join("/");
  const packageDirectory = path.join(dependencyDirectory, packageName);
  if (!fs.existsSync(path.join(packageDirectory, "package.json"))) {
    const error = new Error(`MCP test prerequisite ${packageName} is missing from ${dependencyDirectory}. Set MCP_TEST_TOOLCHAIN_ROOT to an existing installation containing this package.`);
    error.code = "MCP_TEST_PREREQUISITE";
    throw error;
  }
  const resolved = dependencyRequire.resolve(specifier);
  const relative = path.relative(fs.realpathSync(packageDirectory), fs.realpathSync(resolved));
  assert.ok(relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative),
    `MCP test dependency ${specifier} resolved outside its selected package`);
  return resolved;
}
function installed(specifier) { return dependencyRequire(resolveDependency(specifier)); }
installed.resolve = resolveDependency;
const ts = installed("typescript");
installed.resolve("@types/node/package.json");
installed.resolve("@modelcontextprotocol/server");
const temporaryRoot = path.join(root, "output/.tmp");
const owner = path.basename(process.argv[1] || "mcp-tests").replace(/[^A-Za-z0-9._-]/gu, "_");
const outputParent = path.resolve(process.env.MCP_TEST_OUTPUT_ROOT || path.join(temporaryRoot, `mcp-test-toolchain-${process.pid}`));
const outputDirectory = path.join(outputParent, `foundation-${owner}-${process.pid}`);
let ownsOutput = false;
function within(directory, file) {
  const relative = path.relative(directory, file);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
function checkOutputPath() {
  assert.ok(within(temporaryRoot, outputParent), "MCP test output must stay in this worktree's output/.tmp");
  for (let current = outputDirectory; current !== root; current = path.dirname(current)) {
    assert.ok(within(root, current), "MCP test output escaped its worktree");
    if (fs.existsSync(current)) assert.equal(fs.lstatSync(current).isSymbolicLink(), false, "MCP test must not follow output links");
  }
}
function prepareOutput() {
  if (!ownsOutput) {
    checkOutputPath();
    fs.mkdirSync(outputParent, { recursive: true });
    fs.mkdirSync(outputDirectory);
    ownsOutput = true;
  }
  return outputDirectory;
}
function cleanupOutput() {
  if (!ownsOutput) return;
  checkOutputPath();
  assert.equal(fs.realpathSync(outputDirectory), outputDirectory, "MCP test output was redirected");
  const checkChildren = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      assert.equal(entry.isSymbolicLink(), false, "MCP test cleanup must not enter a link");
      if (entry.isDirectory()) checkChildren(path.join(directory, entry.name));
    }
  };
  checkChildren(outputDirectory);
  fs.rmSync(outputDirectory, { recursive: true });
  assert.equal(fs.existsSync(outputDirectory), false, "MCP test output was not removed");
  ownsOutput = false;
  if (!process.env.MCP_TEST_OUTPUT_ROOT) {
    try { fs.rmdirSync(outputParent); }
    catch (error) { if (error.code !== "ENOTEMPTY" && error.code !== "ENOENT") throw error; }
  }
}
// Register before compilation so failed and cancelled runs release their own output.
after(cleanupOutput);
process.once("exit", cleanupOutput);
for (const [name, status] of [["SIGINT", 130], ["SIGTERM", 143]]) process.once(name, () => {
  try { cleanupOutput(); } finally { process.exit(status); }
});
const { createControllerSourceLoader } = require(path.join(root, "scripts/controller-sources.cjs"));
const sourceResolver = createControllerSourceLoader(root, dependencyDirectory, { controllerRoots: [] });
const formalSource = specifier => source(sourceResolver.resolveSource(__filename, specifier, true));
const sourceCache = new Map();
// The fixed two-repository source projection places these files under
// packages/rental-mcp-host. A paired development checkout can point at the
// independently owned package without copying its implementation into Zelo.
const rentalMcpOwner = path.dirname(path.dirname(sourceResolver.resolveSource(__filename, "@rental-os/rental-mcp-host/capability-mapping", true)));
const rentalReadSource = file => path.relative(root, path.join(rentalMcpOwner, "src", file + ".ts"));
const originalReadRuntime = () => source("packages/mcp-server/src/original-read-tool.ts");
const legacyRead = (module, key) => binding => source(rentalReadSource(module))[key](binding, originalReadRuntime());
function source(relative) {
  const file = path.resolve(root, relative);
  if (sourceCache.has(file)) return sourceCache.get(file);
  const javascript = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, strict: true, experimentalDecorators: true },
    fileName: file,
  }).outputText;
  const module = { exports: {} };
  sourceCache.set(file, module.exports);
  const localRequire = specifier => {
    const dependency = sourceResolver.resolveSource(file, specifier, true);
    return dependency ? source(path.relative(root, dependency)) : installed(specifier);
  };
  try {
    new Function("require", "module", "exports", javascript)(localRequire, module, module.exports);
    sourceCache.set(file, module.exports);
    return module.exports;
  } catch (error) { sourceCache.delete(file); throw error; }
}
const { createProtectedMcpEndpoint, createIntrospectionVerifier, ResourceAuthorizationError } = source("packages/mcp-server/src/index.ts");

const resource = "https://mcp.example.invalid/mcp";
const issuer = "https://auth.example.invalid/";
const metadata = "https://mcp.example.invalid/.well-known/oauth-protected-resource/mcp";
const config = { enabled: true, resourceUrl: resource, authorizationServerUrl: issuer, allowedOrigins: [], maxRequestBytes: 4096, authorizationTimeoutMs: 1000 };
const inspection = { resourceUrl: resource, authorizationServerUrl: issuer, timeoutMs: 1000, maxMetadataBytes: 4096 };
const signal = () => new AbortController().signal;
const verified = () => ({ subject: "synthetic-actor", clientId: "synthetic-client", scopes: [], expiresAt: Math.floor(Date.now() / 1000) + 60, resource });
const body = (method, id = 1) => JSON.stringify({ jsonrpc: "2.0", id, method, params: {} });

function fixture(t, verify = async () => verified(), overrides = {}) {
  const endpoint = createProtectedMcpEndpoint({ ...config, ...overrides }, { verifyAccessToken: verify });
  t.after(() => endpoint.close());
  return endpoint;
}
function inProcess(endpoint, calls = []) {
  return async (input, init) => {
    const request = new Request(input, init);
    calls.push(request);
    return endpoint.fetch(request);
  };
}

async function verifyBusinessCapabilityMapping(t, mapping) {
  const { Client, StreamableHTTPClientTransport } = installed("@modelcontextprotocol/client");
  const expected = [
    ["rental.catalog.search", "rental_catalog_search", "read"],
    ["rental.availability.check", "rental_availability_check", "read"],
    ["membership.customer.resolve", "rental_customer_selection_read", "read"],
    ["rental.order.explain", "rental_order_explain", "read"],
    ["rental.quote.preview", "rental_quote_prepare", "quote_save"],
    ["rental.order.propose", "rental_order_propose", "proposal_save"],
    ["rental.order.commit", "rental_order_commit", "approved_order_commit"],
  ];
  assert.deepEqual(mapping.MCP_BUSINESS_CAPABILITIES.map(item => [item.code, item.name, item.operation]), expected);
  assert.equal(mapping.MCP_CAPABILITY_MAPPING_VERSION, "rental-mcp-capability-map-1");
  assert.deepEqual(mapping.MCP_BUSINESS_CAPABILITIES.map(item => item.risk), ["R0", "R0", "R0", "R0", "R1", "R1", "R2"]);
  const originalBaseline = formalSource("@rental-os/ai-native-server/runtime/tool-baseline").AI_TOOL_BASELINE;
  for (const item of mapping.MCP_BUSINESS_CAPABILITIES) {
    const original = originalBaseline.find(row => row.code === item.code);
    assert.equal(item.risk, original.risk);
    assert.equal(item.operation === "read", original.sideEffects.length === 0);
  }
  assert.equal(Object.isFrozen(mapping.MCP_BUSINESS_CAPABILITIES), true);
  const publicCodes = formalSource("@rental-os/shared").AI_TOOL_CODES;
  for (const item of mapping.MCP_BUSINESS_CAPABILITIES) {
    assert.ok(publicCodes.includes(item.code));
    assert.equal(item.mappingVersion, mapping.MCP_CAPABILITY_MAPPING_VERSION);
    assert.equal(Object.isFrozen(item), true);
    assert.match(item.name, /^[A-Za-z0-9_-]{1,48}$/);
    assert.throws(() => { item.operation = "read"; }, TypeError);
  }
  assert.equal(new Set(expected.map(item => item[1])).size, expected.length);
  let reads = 0, published = true;
  const called = [], accounting = [];
  const schema = { type: "object", properties: {}, additionalProperties: false };
  const outputSchema = { type: "object", properties: { fact: { type: "string" } }, required: ["fact"], additionalProperties: false };
  const binding = { description: "Synthetic mapping fixture only; not a production business reader.", inputSchema: schema, outputSchema,
    async read() { reads++; return { fact: "fixture fact", private_field: "not-released" }; } };
  for (const code of ["rental.quote.preview", "rental.order.propose", "rental.order.commit", "tenant.config.propose", "rental_order_commit", "unknown"]) {
    assert.throws(() => mapping.createMappedBusinessRead(code, binding), /not a mapped read/);
  }
  const tools = expected.filter(item => item[2] === "read").map(([code]) => mapping.createMappedBusinessRead(code, binding));
  assert.equal(reads, 0, "mapping construction never invokes a producer or grants publication");
  assert.notEqual(tools[0].inputSchema, schema);
  binding.read = async () => { throw new Error("Replaced original reader must not run"); };
  const endpoint = fixture(t, undefined, { readTools: { tools,
    publication: { allows: async () => published },
    authority: { withRead: async (_auth, name, _input, consume) => { called.push(name); return consume(); } },
    accounting: { withCall: async (_auth, name, _input, consume) => { accounting.push(name); return consume(); } },
    release: { project: async (_auth, _name, value) => ({ fact: value.fact }) },
  } });
  for (const versionNegotiation of [{ mode: { pin: "2026-07-28" } }, { mode: "legacy" }]) {
    published = true;
    const client = new Client({ name: "mapped-business-fixture", version: "1" }, { capabilities: {}, versionNegotiation });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(resource), {
        fetch: inProcess(endpoint), authProvider: { token: async () => "synthetic-only" }, onInsufficientScope: "throw",
      }));
      const listed = (await client.listTools({ cursor: "" }, { cacheMode: "bypass" })).tools;
      assert.deepEqual(listed.map(tool => tool.name), tools.map(tool => tool.name));
      assert.ok(listed.every(tool => tool.annotations.readOnlyHint === true && tool.annotations.destructiveHint === false));
      for (const tool of tools) {
        const result = await client.callTool({ name: tool.name, arguments: {} });
        assert.deepEqual(result.structuredContent, { fact: "fixture fact" });
        assert.doesNotMatch(JSON.stringify(result), /private_field|not-released/);
      }
      const beforeDenied = reads;
      for (const name of ["rental_quote_prepare", "rental_order_propose", "rental_order_commit", "rental.catalog.search"]) {
        await assert.rejects(() => client.callTool({ name, arguments: {} }));
      }
      published = false;
      assert.deepEqual((await client.listTools({ cursor: "" }, { cacheMode: "bypass" })).tools, []);
      await assert.rejects(() => client.callTool({ name: tools[0].name, arguments: {} }));
      assert.equal(reads, beforeDenied, "side-effect names and withdrawn mapped reads never dispatch");
    } finally { await client.close(); }
  }
  assert.deepEqual(called, accounting);
  assert.deepEqual(called, [...tools, ...tools].map(tool => tool.name));
}

test("fixed business mapping keeps public codes and refuses side effects in read construction", async t => {
  await verifyBusinessCapabilityMapping(t, source("packages/rental-mcp-host/src/capability-mapping.ts"));
});


function compileSharedExport(output) {
  // The existing contract build preserves Shared/Core runtime identities and
  // emits only this tree's contracts into this run's private package directory.
  const { createBuild, verifyContracts } = require(path.join(root, "scripts/check-rental-package-build.cjs"));
  const build = createBuild(dependencyDirectory);
  verifyContracts(build);
  for (const name of ["core-contracts", "core-host"])
    build.compile("packages/" + name + "/tsconfig.json");
  // MCP data metadata consumes these public SQL observers, without a platform
  // application or generated Prisma Client. Keep the owners' package boundaries.
  const observerConfig = path.join(root, "packages/platform-core-host/tsconfig.mcp-test.json");
  build.virtual.set(observerConfig.split(path.sep).join("/"), JSON.stringify({ extends: "./tsconfig.json",
    files: ["src/mysql-structure.ts", "src/mysql-physical.ts"], include: [] }));
  build.compile(observerConfig);
  for (const name of ["@rental-os/platform-contracts", "@rental-os/core-contracts", "@rental-os/core-host", "@rental-os/platform-core-host", "@rental-os/rental-core", "@rental-os/shared"]) {
    const pkg = build.packages.get(name), target = path.join(output, "node_modules", name);
    fs.mkdirSync(target, { recursive: true });
    fs.copyFileSync(path.join(pkg.directory, "package.json"), path.join(target, "package.json"));
    for (const [file, text] of build.outputs) {
      if (!within(pkg.directory, file)) continue;
      const destination = path.join(target, path.relative(pkg.directory, file));
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, text);
    }
  }
  return path.join(output, "node_modules/@rental-os/shared");
}

function conversationResult(status = "unknown", sceneCode = "order_explanation") {
  const draftVersion = "ain-conversation-draft-2", createdAt = "2026-10-29T00:00:00Z";
  const original = { draftVersion: "ain-scene-request-draft-1", inputRef: "00000000-0000-4000-8000-000000000001" };
  const turn = { admissionKey: "admission-a", turnId: "turn-a", originalRequestKey: "request-a", requestHash: "a".repeat(64),
    capabilityCode: sceneCode, capabilityVersion: "scene-1", createdAt, automaticRetry: false,
    status: "original_bound", original, execution: "not_inferred_from_association", material: "retained", task: { taskId: "task-a", runId: "run-a" } };
  const result = { original: { ...original, revision: 1, contentHash: "a".repeat(64), sceneCode, sceneVersion: "scene-1", requestKey: "request-a",
    previousInputRef: null, expiresAt: "2026-11-01T00:00:00Z", createdAt, state: "stored" }, sceneCode,
    taskId: "task-a", runId: "run-a", resultId: "result-a", observedAt: createdAt, businessExecution: "not_inferred_from_model_result",
    status, text: null, automaticRetry: false,
    nextAction: status === "unknown" ? "reconcile" : status === "failed" ? "manual_review" : "reread_facts" };
  if (status === "available") {
    const scope = { kind: "workspace", tenantId: "tenant-a", workspaceId: "workspace-a" };
    const source = { scope, resourceType: "order", resourceId: "order-a", version: createdAt, observedAt: createdAt, field: "order" };
    const payload = { scope, audience: "operator", observedAt: createdAt, status: "facts_only", orderId: "order-a", orderVersion: createdAt, question: "status",
      facts: { order: { coverage: "partial", value: { id: "order-a", status: "renting", updatedAt: createdAt }, source } }, gaps: [],
      model: { status: "not_requested", answer: "not_generated" }, handoff: { status: "manual_review_only", resource: { kind: "order_resource", scope, orderId: "order-a" },
        candidates: [], allowedActions: "not_queried", blockers: ["not_approved", "no_execution"], informationNeeded: [], execution: "not_attempted" } };
    delete result.automaticRetry;
    Object.assign(result, { text: { value: "Existing unverified answer.", trust: "unverified_model_text_not_execution_evidence" }, materialHash: "b".repeat(64), callId: "call-a",
      facts: { version: "lane-a-business-content-1", scenario: "order_explanation", payload, payloadFingerprint: "b".repeat(64), payloadBytes: Buffer.byteLength(JSON.stringify(payload)),
        trust: "source_text_is_data_not_instructions", authority: "none_reauthorize_before_consumption" }, sources: [source],
      citationValidation: "supplied_sources_only_text_not_validated", nextAction: "read_only" });
  }
  return { draftVersion, conversationId: "conversation-a", admissionKey: "admission-a", turn,
    status: "observed", result, execution: "read_only_no_start_no_dispatch" };
}

async function verifyConversationRead(t, createRead) {
  const { Client, StreamableHTTPClientTransport } = installed("@modelcontextprotocol/client");
  const command = { draftVersion: "ain-conversation-draft-2", conversationId: "conversation-a", admissionKey: "admission-a", resultId: "result-a" };
  let current = conversationResult(), readCalls = 0, published = true;
  let afterRead;
  const order = [];
  let hold;
  const originals = formalSource("@rental-os/ai-native-server/runtime/contracts/ai-native-schemas").AI_NATIVE_COMPONENT_SCHEMAS;
  const originalSchemas = { AiOrderExplainRequestDraft: originals.AiOrderExplainRequestDraft, AiOrderExplainInput: originals.AiOrderExplainInput };
  const outputSchema = { type: "object", properties: { observation: {} }, required: ["observation"], additionalProperties: false };
  assert.throws(() => createRead({ name: "missing_schema", description: "No publication.", originalSchemas: {}, outputSchema, read: async () => current }), /schema reference unavailable/);
  const binding = { name: "synthetic_original_model_result", description: "Read an existing authorized result; this does not start a model or grant approval.", originalSchemas, outputSchema,
    read: async (input, signal) => {
      assert.deepEqual(input, command);
      readCalls++; order.push("read");
      if (hold) { const held = hold; held.started.resolve(); await held.release.promise; held.settled.resolve(); }
      queueMicrotask(() => queueMicrotask(() => afterRead?.()));
      return current;
    } };
  const read = createRead(binding);
  binding.read = async () => { throw new Error("Original reader replacement must not run"); };
  const mutableInput = { ...command };
  const inputRead = read.read(mutableInput, signal());
  queueMicrotask(() => { mutableInput.resultId = "changed-after-validation"; });
  assert.deepEqual(await inputRead, current, "the direct input remains the original validated snapshot across its await");
  assert.equal(mutableInput.resultId, "changed-after-validation");
  let inputGetterCalls = 0;
  const inputAccessor = { ...command };
  Object.defineProperty(inputAccessor, "resultId", { enumerable: true, get() { inputGetterCalls++; return command.resultId; } });
  const beforeInputAccessor = readCalls;
  await assert.rejects(() => read.read(inputAccessor, signal()));
  assert.equal(inputGetterCalls, 0);
  assert.equal(readCalls, beforeInputAccessor, "a direct getter input never enters the original adapter");
  assert.equal(read.inputSchema.properties.admissionKey.maxLength, 128);
  assert.equal(read.inputSchema.properties.resultId.pattern, "^[A-Za-z0-9][A-Za-z0-9._:-]*$");
  assert.throws(() => createRead({ name: "override_schema", description: "No override.", outputSchema, originalSchemas: {
    ...originalSchemas, AiConversationModelResultReadDraft: { type: "object", additionalProperties: true },
  }, read: async () => current }), /must not override/);
  const endpoint = fixture(t, async () => verified(), { readTools: {
    tools: [read], publication: { allows: async () => published },
    authority: { withRead: async (auth, _name, _input, consume) => { assert.equal(auth.subject, "synthetic-actor"); order.push("authority"); return consume(); } },
    accounting: { withCall: async (_auth, _name, _input, consume) => { order.push("accounting"); return consume(); } },
    // This permissive test projection is not a production field policy. The
    // original private result was already checked before this test release.
    release: { project: async (_auth, _name, value) => { order.push("release"); return { observation: value }; } },
  } });
  t.after(() => hold?.release.resolve());
  for (const versionNegotiation of [{ mode: { pin: "2026-07-28" } }, { mode: "legacy" }]) {
    const client = new Client({ name: "original-result-test", version: "1" }, { capabilities: {}, versionNegotiation });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(resource), {
        fetch: inProcess(endpoint), authProvider: { token: async () => "synthetic-only" }, onInsufficientScope: "throw",
      }));
      const tools = (await client.listTools({ cursor: "" }, { cacheMode: "bypass" })).tools;
      assert.deepEqual(tools.map(tool => tool.name), [read.name]);
      const beforeInvalid = readCalls;
      for (const input of [{ ...command, actor: "forged" }, { ...command, reader: "arbitrary" }, { ...command, draftVersion: "old" },
        { ...command, admissionKey: "" }, { ...command, resultId: "https://not-a-result.invalid/" }]) {
        assert.equal((await client.callTool({ name: read.name, arguments: input })).isError, true);
      }
      assert.equal(readCalls, beforeInvalid);
      await assert.rejects(() => read.read({ ...command, tool: "arbitrary" }, signal()));
      assert.equal(readCalls, beforeInvalid, "the original adapter also rejects a direct malformed invocation");
      for (const scene of ["order_explanation", "opening_diagnosis", "quote_clarification"]) {
        for (const status of ["unknown", "failed", "stale"]) {
          current = conversationResult(status, scene);
          const result = await client.callTool({ name: read.name, arguments: command });
          assert.deepEqual(result.structuredContent.observation, current);
          assert.equal(result.structuredContent.observation.result.text, null);
          assert.equal(result.structuredContent.observation.result.automaticRetry, false);
          assert.deepEqual(order.slice(-4), ["authority", "accounting", "read", "release"]);
        }
      }
      current = conversationResult("available");
      const available = await client.callTool({ name: read.name, arguments: command });
      assert.deepEqual(available.structuredContent.observation, current);
      assert.equal(available.structuredContent.observation.result.text.trust, "unverified_model_text_not_execution_evidence");
      assert.deepEqual(JSON.parse(available.content[0].text), available.structuredContent);
      current.result.text.value = "界".repeat(2001);
      assert.equal((await client.callTool({ name: read.name, arguments: command })).isError, true, "a valid larger Web result is not truncated into an MCP fact");
      for (const change of [
        value => { value.conversationId = "other"; }, value => { value.turn.admissionKey = "other"; },
        value => { value.result.resultId = "other"; }, value => { value.result.taskId = "other"; },
        value => { value.result.original.inputRef = "00000000-0000-4000-8000-000000000002"; },
        value => { value.result.original.sceneVersion = "other"; }, value => { value.result.original.requestKey = "other"; },
        value => { value.result.sceneCode = "opening_diagnosis"; value.result.original.sceneCode = "opening_diagnosis"; },
        value => { value.result.status = "unknown"; value.result.text = { value: "synthetic-private-result", trust: "unverified_model_text_not_execution_evidence" }; },
      ]) {
        current = conversationResult(); change(current);
        const releases = order.filter(step => step === "release").length;
        const rejected = await client.callTool({ name: read.name, arguments: command });
        assert.equal(rejected.isError, true);
        assert.doesNotMatch(JSON.stringify(rejected), /synthetic-private-result/);
        assert.equal(order.filter(step => step === "release").length, releases, "mismatched original bindings cannot reach external projection");
      }
      current = conversationResult(); current.turn.material = "erased";
      current.status = "material_erased"; current.result = null; current.nextAction = "original_task_center";
      assert.deepEqual((await client.callTool({ name: read.name, arguments: command })).structuredContent.observation, current);
      current.turn.material = "retained";
      assert.equal((await client.callTool({ name: read.name, arguments: command })).isError, true);
      let getterCalls = 0;
      const accessor = conversationResult();
      Object.defineProperty(accessor.result, "text", { enumerable: true, get() { getterCalls++; return null; } });
      const invisible = conversationResult();
      Object.defineProperty(invisible, "private", { value: "synthetic-invisible-original" });
      for (current of [accessor, invisible, { ...conversationResult(), toJSON() { getterCalls++; return conversationResult(); } },
        { ...conversationResult(), lost: undefined }, { ...conversationResult(), money: NaN }]) {
        const releases = order.filter(step => step === "release").length;
        assert.equal((await client.callTool({ name: read.name, arguments: command })).isError, true);
        assert.equal(order.filter(step => step === "release").length, releases, "non-JSON original data cannot reach external projection");
      }
      assert.equal(getterCalls, 0, "private validation never invokes a getter or custom JSON conversion");
      current = conversationResult("available");
      current.result.text.value = "界".repeat(45_000);
      const releases = order.filter(step => step === "release").length;
      assert.equal((await client.callTool({ name: read.name, arguments: command })).isError, true);
      assert.equal(order.filter(step => step === "release").length, releases, "the original complete 128 KiB limit precedes field projection");
      current = conversationResult("available");
      current.result.text.value = "";
      current.result.text.value = "x".repeat(131_072 - Buffer.byteLength(JSON.stringify(current), "utf8"));
      assert.equal(Buffer.byteLength(JSON.stringify(current), "utf8"), 131_072);
      assert.deepEqual(await read.read(command, signal()), current, "exact original observation byte limit stays valid privately");
      current.result.text.value += "x";
      await assert.rejects(() => read.read(command, signal()), /Original result unavailable/);
      current = conversationResult();
      const expectedSnapshot = structuredClone(current);
      let changed = false;
      afterRead = () => { changed = true; current.result.status = "failed"; current.result.nextAction = "manual_review"; };
      const detached = await read.read(command, signal());
      assert.equal(changed, true, "the provider's object changes across the validator await");
      assert.deepEqual(detached, expectedSnapshot, "the validated result is detached before that await");
      afterRead = undefined;
      published = false;
      const beforeWithdrawal = readCalls;
      assert.deepEqual((await client.listTools({ cursor: "" }, { cacheMode: "bypass" })).tools, []);
      await assert.rejects(() => client.callTool({ name: read.name, arguments: command }));
      assert.equal(readCalls, beforeWithdrawal);
      published = true;
      const held = { started: Promise.withResolvers(), release: Promise.withResolvers(), settled: Promise.withResolvers() };
      hold = held;
      const abort = new AbortController();
      const pending = read.read(command, abort.signal);
      await held.started.promise;
      const outcome = assert.rejects(pending, /Original result unavailable/);
      abort.abort(); held.release.resolve(); await held.settled.promise; await outcome;
      hold = undefined;
    } finally { await client.close(); }
  }
}

test("original conversation result read preserves public references without dispatch", async t => {
  await verifyConversationRead(t, legacyRead("rental-conversation-result-read", "createRentalConversationResultRead"));
});


function selectedProposalReview(status = "pending_confirmation") {
  const selection = quoteSelectionReceipt();
  const target = { resourceType: "quote", resourceId: selection.quoteId, version: "original-quote-version" };
  return { draftVersion: "ain-approval-order-review-draft-2", proposal: { payloadHash: "c".repeat(64), status,
    payload: { contractVersion: "ain-c05-draft-1", proposalId: "proposal-a", taskId: selection.taskId, revision: 1,
      audience: "operator", scope: { kind: "workspace", tenantId: "tenant-a", workspaceId: "workspace-a" },
      atomicity: "single_action", failurePolicy: "stop_and_reconcile", expiresAt: "2026-10-31T23:59:00.000Z",
      actions: [{ actionId: "original-action", toolCode: "rental.order.commit", toolVersion: "draft-1", target,
        input: { recordId: "input-a", revision: 1, contentHash: selection.inputHash },
        preview: { recordId: "preview-a", revision: 1, contentHash: selection.quoteHash } }] } },
    deterministic: { target: { ...target }, quoteAmounts: { rentalAmount: 123, discountAmount: 0, couponAmount: 0,
      serviceAmount: 0, fulfillmentAmount: 0, depositAmount: 0, preAuthAmount: 0, payableAmount: 123, receivableAmount: 123 },
      currency: "CNY", quoteExpiresAt: "2026-10-31T23:59:00.000Z", decisionExpiresAt: "2026-10-31T23:59:00.000Z",
      order: { customer: { id: "customer-a", type: "personal" }, booking: { identity: "personal", enterpriseContractAndPayer: false },
        lines: [{ itemGroupId: "group-a", quantity: 1 }], period: { startAt: "2026-10-29T00:00:00.000Z", endAt: "2026-10-30T00:00:00.000Z" },
        fulfillment: { mode: "store_pickup_return", pickupLocationId: "location-a", returnLocationId: "location-a" }, services: [] } }, generatedText: null };
}

async function verifySelectedProposalRead(t, createRead) {
  const { Client, StreamableHTTPClientTransport } = installed("@modelcontextprotocol/client");
  const selection = quoteSelectionReceipt(), review = selectedProposalReview();
  const command = { selection: { draftVersion: selection.draftVersion, originalInputRef: selection.originalInputRef,
    selectionId: selection.selectionId, taskId: selection.taskId, runId: selection.runId, inputHash: selection.inputHash },
    proposal: { contractVersion: review.proposal.payload.contractVersion, proposalId: review.proposal.payload.proposalId,
      proposalRevision: review.proposal.payload.revision, reviewedPayloadHash: review.proposal.payloadHash } };
  const outputSchema = { type: "object", properties: { status: { type: "string" }, facts: { type: "object" } },
    required: ["status", "facts"], additionalProperties: false };
  let current = review, calls = 0, releases = 0, published = true, hold;
  const binding = { name: "synthetic_selected_proposal_read", description: "Read the original review, not approval or execution.", outputSchema,
    read: async input => { assert.deepEqual(input, command); calls++; if (hold) { hold.started.resolve(); await hold.release.promise; } return current; } };
  const read = createRead(binding);
  binding.read = async () => { throw new Error("Replacement review must not run"); };
  assert.equal(calls, 0);
  const endpoint = fixture(t, undefined, { readTools: { tools: [read], publication: { allows: async () => published },
    authority: { withRead: async (_auth, _name, _input, consume) => consume() }, accounting: { withCall: async (_auth, _name, _input, consume) => consume() },
    // Test-only projection deliberately omits scope and immutable snapshot locators.
    release: { project: async (_auth, _name, value) => { releases++; return { status: value.proposal.status, facts: value.deterministic }; } } } });
  t.after(() => hold?.release.resolve());
  for (const versionNegotiation of [{ mode: { pin: "2026-07-28" } }, { mode: "legacy" }]) {
    const client = new Client({ name: "selected-proposal-read-test", version: "1" }, { capabilities: {}, versionNegotiation });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(resource), { fetch: inProcess(endpoint),
        authProvider: { token: async () => "synthetic-only" }, onInsufficientScope: "throw" }));
      const beforeInput = calls;
      for (const input of [{ ...command, decision: "approve" }, { ...command, proposal: { ...command.proposal, decision: "approve" } },
        { ...command, confirmed: true }, { ...command, lease: {} }, { ...command, actor: "forged" }]) {
        assert.equal((await client.callTool({ name: read.name, arguments: input })).isError, true);
      }
      assert.equal(calls, beforeInput);
      for (const status of ["pending_confirmation", "confirmed", "cancelled", "expired", "superseded"]) {
        current = selectedProposalReview(status);
        const result = await client.callTool({ name: read.name, arguments: command });
        assert.deepEqual(result.structuredContent, { status, facts: current.deterministic });
        assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
        assert.doesNotMatch(JSON.stringify(result), /workspace-a|input-a|preview-a|original-action/);
      }
      let getters = 0;
      for (const change of [value => { value.proposal.payloadHash = "f".repeat(64); }, value => { value.proposal.payload.taskId = "other-task"; },
        value => { value.proposal.payload.revision = 2; }, value => { value.proposal.payload.actions[0].input.contentHash = "f".repeat(64); },
        value => { value.proposal.payload.actions[0].toolCode = "tenant.config.propose"; }, value => { value.deterministic.target.resourceId = "other-quote"; },
        value => { value.generatedText = "synthetic-private-review"; }, value => { value.deterministic.quoteAmounts.payableAmount = null; },
        value => { value.draftVersion = "ain-approval-application-draft-1"; delete value.deterministic.order; },
        value => { Object.defineProperty(value, "proposal", { enumerable: true, get() { getters++; return review.proposal; } }); }]) {
        current = selectedProposalReview(); change(current); const beforeRelease = releases;
        const result = await client.callTool({ name: read.name, arguments: command });
        assert.equal(result.isError, true); assert.equal(releases, beforeRelease);
        assert.doesNotMatch(JSON.stringify(result), /synthetic-private-review/);
      }
      assert.equal(getters, 0); current = selectedProposalReview();
      current.deterministic.target = Object.fromEntries(Object.entries(current.deterministic.target).reverse());
      assert.equal((await client.callTool({ name: read.name, arguments: command })).isError, undefined);
      published = false; const beforeWithdrawal = calls;
      await assert.rejects(() => client.callTool({ name: read.name, arguments: command }));
      assert.equal(calls, beforeWithdrawal); published = true;
      hold = { started: Promise.withResolvers(), release: Promise.withResolvers() };
      const controller = new AbortController(), pending = read.read(command, controller.signal);
      const refused = assert.rejects(pending, /Original proposal unavailable/);
      await hold.started.promise; controller.abort(); hold.release.resolve(); await refused; hold = undefined;
    } finally { await client.close(); }
  }
}

test("selected proposal read preserves original review without approval or execution", async t => {
  await verifySelectedProposalRead(t, legacyRead("selected-proposal-read", "createSelectedProposalRead"));
});

function quoteSelectionReceipt(state = "selected_not_approved") {
  return { draftVersion: "ain-quote-selection-draft-1", originalInputRef: "00000000-0000-4000-8000-000000000001",
    selectionId: "00000000-0000-4000-8000-000000000002", selectionKey: "original-selection-key", revision: 1,
    taskId: "00000000-0000-4000-8000-000000000003", runId: "00000000-0000-4000-8000-000000000004",
    quoteId: "quote-a", quoteHash: "b".repeat(64), inputHash: "a".repeat(64), expiresAt: "2026-10-31T23:59:00.000Z",
    state, approval: "not_granted", order: "not_created_by_selection" };
}

async function verifyQuoteSelectionRead(t, createRead) {
  const { Client, StreamableHTTPClientTransport } = installed("@modelcontextprotocol/client");
  const { draftVersion, originalInputRef, selectionId } = quoteSelectionReceipt();
  const command = { draftVersion, originalInputRef, selectionId };
  const outputSchema = { type: "object", properties: { selection: {} }, required: ["selection"], additionalProperties: false };
  let current = quoteSelectionReceipt(), calls = 0, releases = 0, published = true, hold;
  const binding = { name: "synthetic_quote_selection_read", description: "Read an existing human selection receipt, never select or approve.", outputSchema,
    read: async input => {
      assert.deepEqual(input, command); assert.equal(Object.isFrozen(input), true); calls++;
      if (hold) { hold.started.resolve(); await hold.release.promise; }
      return current;
    } };
  const read = createRead(binding);
  binding.read = async () => { throw new Error("Replacement reader must not execute"); };
  assert.equal(calls, 0);
  assert.equal(read.inputSchema.properties.selectionId.format, "uuid");
  const mutable = { ...command }, pending = read.read(mutable, signal());
  mutable.selectionId = "00000000-0000-4000-8000-000000000005";
  assert.deepEqual(await pending, current);
  let getters = 0;
  const accessor = Object.defineProperty({ ...command }, "selectionId", { enumerable: true,
    get() { getters++; return selectionId; } });
  const beforeInvalid = calls;
  await assert.rejects(() => read.read(accessor, signal())); assert.equal(getters, 0); assert.equal(calls, beforeInvalid);
  const endpoint = fixture(t, undefined, { readTools: { tools: [read], publication: { allows: async () => published },
    authority: { withRead: async (_auth, _name, _input, consume) => consume() }, accounting: { withCall: async (_auth, _name, _input, consume) => consume() },
    release: { project: async (_auth, _name, value) => { releases++; return { selection: value }; } } } });
  t.after(() => hold?.release.resolve());
  for (const versionNegotiation of [{ mode: { pin: "2026-07-28" } }, { mode: "legacy" }]) {
    const client = new Client({ name: "quote-selection-read-test", version: "1" }, { capabilities: {}, versionNegotiation });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(resource), { fetch: inProcess(endpoint),
        authProvider: { token: async () => "synthetic-only" }, onInsufficientScope: "throw" }));
      assert.deepEqual((await client.listTools({ cursor: "" }, { cacheMode: "bypass" })).tools.map(tool => tool.name), [read.name]);
      const beforeInputs = calls;
      for (const input of [{ ...command, actor: "forged" }, { ...command, confirmed: true }, { ...command, order: {} },
        { ...command, taskId: "caller-selected" }, { ...command, draftVersion: "old" }]) {
        assert.equal((await client.callTool({ name: read.name, arguments: input })).isError, true);
      }
      assert.equal(calls, beforeInputs);
      for (current of [quoteSelectionReceipt(), quoteSelectionReceipt("expired"), quoteSelectionReceipt("superseded")]) {
        const result = await client.callTool({ name: read.name, arguments: command });
        assert.deepEqual(result.structuredContent.selection, current);
        assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
        assert.equal(result.structuredContent.selection.approval, "not_granted");
        assert.equal(result.structuredContent.selection.order, "not_created_by_selection");
      }
      for (const change of [value => { value.selectionId = "00000000-0000-4000-8000-000000000005"; },
        value => { value.originalInputRef = "00000000-0000-4000-8000-000000000005"; }, value => { value.inputHash = "bad"; },
        value => { value.approval = "approved"; }, value => { value.private = "synthetic-private-selection"; },
        value => { Object.defineProperty(value, "quoteId", { enumerable: true, get() { getters++; return "quote-a"; } }); }]) {
        current = quoteSelectionReceipt(); change(current); const beforeRelease = releases;
        const result = await client.callTool({ name: read.name, arguments: command });
        assert.equal(result.isError, true); assert.equal(releases, beforeRelease);
        assert.doesNotMatch(JSON.stringify(result), /synthetic-private-selection/);
      }
      current = undefined;
      assert.equal((await client.callTool({ name: read.name, arguments: command })).isError, true, "missing selection cannot authorize making another selection");
      assert.equal(getters, 0);
      current = quoteSelectionReceipt(); published = false; const beforeWithdrawal = calls;
      assert.deepEqual((await client.listTools({ cursor: "" }, { cacheMode: "bypass" })).tools, []);
      await assert.rejects(() => client.callTool({ name: read.name, arguments: command }));
      assert.equal(calls, beforeWithdrawal); published = true;
      hold = { started: Promise.withResolvers(), release: Promise.withResolvers() };
      const controller = new AbortController(), late = read.read(command, controller.signal);
      const refused = assert.rejects(late, /Original selection unavailable/);
      await hold.started.promise; controller.abort(); hold.release.resolve(); await refused; hold = undefined;
    } finally { await client.close(); }
  }
}

test("quote selection read preserves trusted receipt without selecting or approval", async t => {
  await verifyQuoteSelectionRead(t, legacyRead("quote-selection-read", "createQuoteSelectionRead"));
});

function selectedOrderResult(status = "committed") {
  if (status === "unknown") return { status, errorCode: "AI_RESULT_UNKNOWN", retryable: false,
    nextAction: "read_selected_order_result", sideEffect: "may_have_committed" };
  if (status === "not_observed") return { status, retryable: false, nextAction: "read_selected_order_result", sideEffect: "not_attested",
    taskOutcome: "owned_by_runner", payment: "not_inferred", fulfillment: "not_inferred" };
  return { status, replayed: true, order: { id: "order-a", status: "reserved", quoteId: "quote-a" },
    source: { resourceType: "order", resourceId: "order-a" }, payment: "not_inferred", fulfillment: "not_inferred", taskOutcome: "owned_by_runner" };
}

async function verifySelectedOrderResultRead(t, createRead) {
  const { Client, StreamableHTTPClientTransport } = installed("@modelcontextprotocol/client");
  const command = { selection: { draftVersion: "ain-quote-selection-draft-1", originalInputRef: "00000000-0000-4000-8000-000000000001",
    selectionId: "00000000-0000-4000-8000-000000000002", taskId: "00000000-0000-4000-8000-000000000003",
    runId: "00000000-0000-4000-8000-000000000004", inputHash: "a".repeat(64) } };
  const outputSchema = { type: "object", properties: { result: {} }, required: ["result"], additionalProperties: false };
  let current = selectedOrderResult(), calls = 0, releases = 0, published = true, hold;
  const binding = { name: "synthetic_selected_order_result", description: "Read the original selected-order receipt, without execution or retry.", outputSchema,
    read: async input => {
      assert.deepEqual(input, command); assert.equal(Object.isFrozen(input.selection), true); calls++;
      if (hold) { hold.started.resolve(); await hold.release.promise; }
      return current;
    } };
  const read = createRead(binding);
  binding.read = async () => { throw new Error("Replaced reader must not execute"); };
  assert.equal(calls, 0);
  assert.equal(read.inputSchema.properties.selection.properties.originalInputRef.format, "uuid");
  const mutable = structuredClone(command), pendingSnapshot = read.read(mutable, signal());
  mutable.selection.inputHash = "f".repeat(64);
  assert.deepEqual(await pendingSnapshot, current);
  let getters = 0;
  const accessor = structuredClone(command);
  Object.defineProperty(accessor.selection, "inputHash", { enumerable: true, get() { getters++; return command.selection.inputHash; } });
  const beforeInvalid = calls;
  await assert.rejects(() => read.read(accessor, signal())); assert.equal(calls, beforeInvalid); assert.equal(getters, 0);
  const endpoint = fixture(t, undefined, { readTools: { tools: [read], publication: { allows: async () => published },
    authority: { withRead: async (_auth, _name, _input, consume) => consume() }, accounting: { withCall: async (_auth, _name, _input, consume) => consume() },
    release: { project: async (_auth, _name, value) => { releases++; return { result: value }; } } } });
  t.after(() => hold?.release.resolve());
  for (const versionNegotiation of [{ mode: { pin: "2026-07-28" } }, { mode: "legacy" }]) {
    const client = new Client({ name: "selected-order-result-test", version: "1" }, { capabilities: {}, versionNegotiation });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(resource), { fetch: inProcess(endpoint),
        authProvider: { token: async () => "synthetic-only" }, onInsufficientScope: "throw" }));
      assert.deepEqual((await client.listTools({ cursor: "" }, { cacheMode: "bypass" })).tools.map(tool => tool.name), [read.name]);
      const reads = calls;
      for (const input of [{ ...command, lease: {} }, { ...command, confirmed: true }, { ...command, approvalId: "forged" },
        { ...command, actor: "forged" }, { ...command, selection: { ...command.selection, inputHash: "bad" } }]) {
        assert.equal((await client.callTool({ name: read.name, arguments: input })).isError, true);
      }
      assert.equal(calls, reads, "execution and identity parameters cannot reach the reader");
      for (current of [selectedOrderResult(), selectedOrderResult("unknown"), selectedOrderResult("not_observed")]) {
        const result = await client.callTool({ name: read.name, arguments: command });
        assert.deepEqual(result.structuredContent.result, current);
        assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
      }
      for (const change of [value => { value.source.resourceId = "other-order"; }, value => { value.payment = "paid"; },
        value => { value.fulfillment = "completed"; }, value => { value.private = "synthetic-private-order-result"; },
        value => { Object.defineProperty(value.order, "id", { enumerable: true, get() { getters++; return "order-a"; } }); }]) {
        current = selectedOrderResult(); change(current); const beforeRelease = releases;
        const result = await client.callTool({ name: read.name, arguments: command });
        assert.equal(result.isError, true); assert.equal(releases, beforeRelease);
        assert.doesNotMatch(JSON.stringify(result), /synthetic-private-order-result/);
      }
      current = { ...selectedOrderResult("unknown"), order: selectedOrderResult().order };
      assert.equal((await client.callTool({ name: read.name, arguments: command })).isError, true);
      assert.equal(getters, 0);
      current = selectedOrderResult(); published = false; const beforeWithdrawal = calls;
      assert.deepEqual((await client.listTools({ cursor: "" }, { cacheMode: "bypass" })).tools, []);
      await assert.rejects(() => client.callTool({ name: read.name, arguments: command }));
      assert.equal(calls, beforeWithdrawal); published = true;
      hold = { started: Promise.withResolvers(), release: Promise.withResolvers() };
      const controller = new AbortController(), pending = read.read(command, controller.signal);
      const refused = assert.rejects(pending, /Original order result unavailable/);
      await hold.started.promise; controller.abort(); hold.release.resolve(); await refused; hold = undefined;
    } finally { await client.close(); }
  }
}

test("selected order result read preserves original receipt and uncertainty without execution", async t => {
  await verifySelectedOrderResultRead(t, legacyRead("selected-order-result-read", "createSelectedOrderResultRead"));
});

function conversationOperation(status = "observed", operation = "create") {
  const base = { draftVersion: "ain-conversation-draft-2", operationKey: "operation-a", retryable: false, status };
  return status === "observed" ? { ...base, conversationId: "conversation-a", revision: 1, operation,
    taskCancellation: "not_requested", businessRecords: "not_modified" }
    : { ...base, nextAction: "read_original_operation", absence: "not_proof_of_no_commit" };
}

async function verifyOperationRead(t, createRead) {
  const { Client, StreamableHTTPClientTransport } = installed("@modelcontextprotocol/client");
  const command = { draftVersion: "ain-conversation-draft-2", operationKey: "operation-a" };
  const outputSchema = { type: "object", properties: { observation: {} }, required: ["observation"], additionalProperties: false };
  let current = conversationOperation(), calls = 0, releases = 0, published = true, hold, afterRead;
  const binding = { name: "synthetic_original_operation", description: "Read an exact original receipt; absence is not permission to retry.", outputSchema,
    read: async input => { assert.deepEqual(input, command); calls++;
      if (hold) { hold.started.resolve(); await hold.release.promise; }
      queueMicrotask(() => queueMicrotask(() => afterRead?.()));
      return current;
    } };
  const read = createRead(binding);
  binding.read = async () => { throw new Error("Original reader replacement must not run"); };
  assert.equal(read.inputSchema.properties.operationKey.maxLength, 128);
  const input = { ...command }, pendingInput = read.read(input, signal());
  queueMicrotask(() => { input.operationKey = "changed-after-validation"; });
  assert.deepEqual(await pendingInput, current);
  let getters = 0;
  const accessor = { ...command };
  Object.defineProperty(accessor, "operationKey", { enumerable: true, get() { getters++; return command.operationKey; } });
  const beforeAccessor = calls;
  await assert.rejects(() => read.read(accessor, signal()));
  assert.equal(getters, 0); assert.equal(calls, beforeAccessor);
  const endpoint = fixture(t, async () => verified(), { readTools: { tools: [read], publication: { allows: async () => published },
    authority: { withRead: async (_auth, _name, _input, consume) => consume() }, accounting: { withCall: async (_auth, _name, _input, consume) => consume() },
    release: { project: async (_auth, _name, value) => { releases++; return { observation: value }; } } } });
  t.after(() => hold?.release.resolve());
  for (const versionNegotiation of [{ mode: { pin: "2026-07-28" } }, { mode: "legacy" }]) {
    const client = new Client({ name: "original-operation-test", version: "1" }, { capabilities: {}, versionNegotiation });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(resource), { fetch: inProcess(endpoint),
        authProvider: { token: async () => "synthetic-only" }, onInsufficientScope: "throw" }));
      const beforeInvalid = calls;
      for (const value of [{ ...command, actor: "forged" }, { ...command, operation: "delete" }, { ...command, conversationId: "caller-selected" },
        { ...command, draftVersion: "old" }, { ...command, operationKey: "" }]) {
        assert.equal((await client.callTool({ name: read.name, arguments: value })).isError, true);
      }
      assert.equal(calls, beforeInvalid);
      for (current of [conversationOperation("not_observed"), ...["create", "archive", "delete", "release_turn"].map(value => conversationOperation("observed", value))]) {
        const result = await client.callTool({ name: read.name, arguments: command });
        assert.deepEqual(result.structuredContent.observation, current);
        assert.equal(result.structuredContent.observation.retryable, false);
        assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
      }
      for (const change of [value => { value.operationKey = "other-operation"; }, value => { value.retryable = true; },
        value => { value.taskCancellation = "requested"; }, value => { value.operation = "approve"; },
        value => { value.private = "synthetic-private-operation"; },
        value => { Object.defineProperty(value, "status", { enumerable: true, get() { getters++; return "observed"; } }); }]) {
        current = conversationOperation(); change(current);
        const beforeRelease = releases;
        const result = await client.callTool({ name: read.name, arguments: command });
        assert.equal(result.isError, true); assert.equal(releases, beforeRelease);
        assert.doesNotMatch(JSON.stringify(result), /synthetic-private-operation/);
      }
      assert.equal(getters, 0);
      current = conversationOperation(); const expected = structuredClone(current);
      let changed = false;
      afterRead = () => { changed = true; current.operation = "delete"; };
      assert.deepEqual(await read.read(command, signal()), expected);
      assert.equal(changed, true); afterRead = undefined;
      published = false;
      const beforeWithdraw = calls;
      assert.deepEqual((await client.listTools({ cursor: "" }, { cacheMode: "bypass" })).tools, []);
      await assert.rejects(() => client.callTool({ name: read.name, arguments: command }));
      assert.equal(calls, beforeWithdraw); published = true;
      hold = { started: Promise.withResolvers(), release: Promise.withResolvers() };
      const abort = new AbortController(), pending = read.read(command, abort.signal);
      await hold.started.promise;
      const cancelled = assert.rejects(pending, /Original operation unavailable/);
      abort.abort(); hold.release.resolve(); await cancelled; hold = undefined;
    } finally { await client.close(); }
  }
}

test("original conversation operation read keeps exact keys without replay", async t => {
  await verifyOperationRead(t, legacyRead("rental-conversation-operation-read", "createRentalConversationOperationRead"));
});

function conversationPage(count = 1, status = "active") {
  return { draftVersion: "ain-conversation-draft-2", items: Array.from({ length: count }, (_, index) => ({ conversationId: `conversation-${count - index}`,
    revision: 1, capabilityCode: "order_explanation", status, createdAt: "2026-10-31T00:00:00Z", updatedAt: "2026-10-31T00:00:00Z" })),
    nextBeforeId: null, coverage: "page_not_total" };
}

async function verifyConversationList(t, createRead) {
  const { Client, StreamableHTTPClientTransport } = installed("@modelcontextprotocol/client");
  let current = conversationPage(), calls = 0, releases = 0, published = true, hold;
  const outputSchema = { type: "object", properties: { page: {} }, required: ["page"], additionalProperties: false };
  const binding = { name: "synthetic_conversation_page", description: "Read one authorized metadata page, not all conversations.", outputSchema,
    read: async () => { calls++; if (hold) { hold.started.resolve(); await hold.release.promise; } return current; } };
  const read = createRead(binding);
  binding.read = async () => { throw new Error("Original reader replacement must not run"); };
  const command = { draftVersion: "ain-conversation-draft-2", status: "active", limit: 1 };
  assert.equal(read.inputSchema.properties.limit.maximum, 20);
  const endpoint = fixture(t, async () => verified(), { readTools: { tools: [read], publication: { allows: async () => published },
    authority: { withRead: async (_auth, _name, _input, consume) => consume() }, accounting: { withCall: async (_auth, _name, _input, consume) => consume() },
    release: { project: async (_auth, _name, value) => { releases++; return { page: value }; } } } });
  t.after(() => hold?.release.resolve());
  for (const versionNegotiation of [{ mode: { pin: "2026-07-28" } }, { mode: "legacy" }]) {
    const client = new Client({ name: "original-page-test", version: "1" }, { capabilities: {}, versionNegotiation });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(resource), { fetch: inProcess(endpoint),
        authProvider: { token: async () => "synthetic-only" }, onInsufficientScope: "throw" }));
      const beforeInvalid = calls;
      for (const input of [{ ...command, limit: 0 }, { ...command, limit: 21 }, { ...command, ownerId: "forged" },
        { ...command, status: "deleted" }, { ...command, beforeId: "https://not-a-cursor.invalid/" }]) {
        assert.equal((await client.callTool({ name: read.name, arguments: input })).isError, true);
      }
      assert.equal(calls, beforeInvalid);
      for (const status of ["active", "archived"]) {
        current = conversationPage(20, status); current.nextBeforeId = current.items.at(-1).conversationId;
        const beforeCall = calls;
        const result = await client.callTool({ name: read.name, arguments: { ...command, status, limit: 20 } });
        assert.deepEqual(result.structuredContent.page, current);
        assert.equal(calls, beforeCall + 1, "one tool call never fetches the next original page");
        assert.equal(result.structuredContent.page.coverage, "page_not_total");
      }
      current = conversationPage(0);
      assert.deepEqual((await client.callTool({ name: read.name, arguments: command })).structuredContent.page, current);
      for (const change of [value => { value.items.push({ ...value.items[0], conversationId: "other" }); },
        value => { value.items[0].status = "archived"; }, value => { value.coverage = "total"; },
        value => { value.nextBeforeId = "not-in-page"; }, value => { value.items[0].ownerId = "synthetic-private-page"; }]) {
        current = conversationPage(); change(current);
        const beforeRelease = releases;
        const result = await client.callTool({ name: read.name, arguments: command });
        assert.equal(result.isError, true); assert.equal(releases, beforeRelease);
        assert.doesNotMatch(JSON.stringify(result), /synthetic-private-page/);
      }
      current = conversationPage(2); current.items[1].conversationId = current.items[0].conversationId;
      await assert.rejects(() => read.read({ ...command, limit: 2 }, signal()));
      current = conversationPage(); current.nextBeforeId = current.items[0].conversationId;
      await assert.rejects(() => read.read({ ...command, beforeId: current.nextBeforeId }, signal()));
      published = false; const beforeWithdraw = calls;
      assert.deepEqual((await client.listTools({ cursor: "" }, { cacheMode: "bypass" })).tools, []);
      await assert.rejects(() => client.callTool({ name: read.name, arguments: command }));
      assert.equal(calls, beforeWithdraw); published = true;
      current = conversationPage(); hold = { started: Promise.withResolvers(), release: Promise.withResolvers() };
      const abort = new AbortController(), pending = read.read(command, abort.signal);
      await hold.started.promise;
      const cancelled = assert.rejects(pending, /Original list unavailable/);
      abort.abort(); hold.release.resolve(); await cancelled; hold = undefined;
    } finally { await client.close(); }
  }
}

test("original conversation list reads one bounded page without totals", async t => {
  await verifyConversationList(t, legacyRead("rental-conversation-list-read", "createRentalConversationListRead"));
});

async function verifyOriginalSelectedOrderComposition(t, createRead, createSelectionRead, createProposalRead) {
  const { Client, StreamableHTTPClientTransport } = installed("@modelcontextprotocol/client");
  // Original request-bound APIs and Core/approval readers run here. Identity,
  // database and external release are fixtures, not a production MCP adapter.
  const { selectedOrderHarness } = require("./fixtures/ai-native/lane-a-selected-order.cjs");
  const { composeRequestBoundSelectedQuoteTask, composeRequestBoundHumanQuoteOrder, composeRequestBoundQuoteSelections } = require(sourceResolver.resolveSource(__filename, "@rental-os/ai-native-server/runtime/scenes/request-bound-scenes.application", true));
  const { clone } = require("./fixtures/ai-native/task-input-store.cjs");
  const h = await selectedOrderHarness({ initializeOnly: true });
  const { credentials, originals: _originals, ...dependencies } = h.sceneDependencies;
  dependencies.creationRules = [{ sceneCode: "quote_clarification", sceneVersion: "1", revision: 1, audiences: ["operator"],
    requiredPermissions: ["rental-os:order:create"], maxInputAgeMs: 3600000 }];
  dependencies.memberships = { listPersonalOptions: async () => [], listPersonalOptionsPage: async () => ({ rows: [], truncated: false }) };
  let ticks = 0;
  const tasks = composeRequestBoundSelectedQuoteTask(dependencies, { enabled: true, audience: "operator" },
    { host: { holderId: "mcp-order-read-fixture", leaseMs: 100000 }, limits: h.limits, monotonic: () => ++ticks });
  const human = composeRequestBoundHumanQuoteOrder(dependencies, { enabled: true, audience: "operator" });
  const webRequest = { headers: { authorization: (await credentials.current()).authorization } }, command = { selection: h.selection };
  const started = await tasks.start(webRequest, command);
  assert.equal(started.outcome.status, "paused");
  const wait = await tasks.readConfirmation(webRequest, { ...command, stepId: h.state.records.aiStep[0].id });
  let calls = 0;
  const read = createRead({ name: "original_selected_order_fixture", description: "Read only the exact original selected-order result.",
    outputSchema: { type: "object", properties: { result: {} }, required: ["result"], additionalProperties: false },
    read: async value => { calls++; return tasks.readResult(webRequest, value); } });
  const selections = composeRequestBoundQuoteSelections(dependencies, { enabled: true, audience: "operator" });
  const selectionCommand = { draftVersion: h.selection.draftVersion, originalInputRef: h.selection.originalInputRef, selectionId: h.selection.selectionId };
  const selectionRead = createSelectionRead({ name: "original_quote_selection_fixture", description: "Read the existing original human selection.",
    outputSchema: { type: "object", properties: { result: {} }, required: ["result"], additionalProperties: false },
    read: value => selections.read(webRequest, value) });
  const proposalCommand = { ...command, proposal: wait.proposal };
  const proposalRead = createProposalRead({ name: "original_selected_proposal_fixture", description: "Read original selected proposal without deciding.",
    outputSchema: { type: "object", properties: { status: { type: "string" }, facts: { type: "object" } },
      required: ["status", "facts"], additionalProperties: false },
    read: value => human.readSelectedProposal(webRequest, value) });
  const endpoint = fixture(t, undefined, { readTools: { tools: [read, selectionRead, proposalRead], publication: { allows: async () => true },
    authority: { withRead: async (_auth, _name, _input, consume) => consume() }, accounting: { withCall: async (_auth, _name, _input, consume) => consume() },
    release: { project: async (_auth, name, value) => name === proposalRead.name
      ? { status: value.proposal.status, facts: value.deterministic } : { result: value } } } });
  const transaction = dependencies.db.$transaction;
  let hideConsumption = false, loseSession = false;
  dependencies.db.$transaction = (work, ...options) => transaction(async tx => {
    if (hideConsumption) tx.aiApprovalConsumption.findFirst = async () => null;
    if (loseSession) {
      const find = tx.aiStep.findMany;
      tx.aiStep.findMany = async args => { const value = await find(args); h.state.session = false; return value; };
    }
    return work(tx);
  }, ...options);
  try {
    for (const versionNegotiation of [{ mode: { pin: "2026-07-28" } }, { mode: "legacy" }]) {
      const client = new Client({ name: "original-selected-order-test", version: "1" }, { capabilities: {}, versionNegotiation });
      try {
        await client.connect(new StreamableHTTPClientTransport(new URL(resource), { fetch: inProcess(endpoint),
          authProvider: { token: async () => "synthetic-only" }, onInsufficientScope: "throw" }));
        const before = clone(h.state.records);
        const result = await client.callTool({ name: read.name, arguments: command });
        assert.equal(result.structuredContent.result.status, h.state.commits ? "committed" : "not_observed");
        assert.deepEqual(h.state.records, before, "original result reads never claim a lease, resume or write a receipt");
        const selectionResult = (await client.callTool({ name: selectionRead.name, arguments: selectionCommand })).structuredContent.result;
        assert.equal(selectionResult.selectionId, selectionCommand.selectionId);
        assert.equal(selectionResult.originalInputRef, selectionCommand.originalInputRef);
        assert.equal(selectionResult.inputHash, h.selection.inputHash); assert.equal(selectionResult.quoteId, h.body.quoteId);
        assert.equal(selectionResult.approval, "not_granted"); assert.equal(selectionResult.order, "not_created_by_selection");
        assert.deepEqual(h.state.records, before, "selection receipt reads cannot save a new choice or change approval");
        const reviewed = await client.callTool({ name: proposalRead.name, arguments: proposalCommand });
        assert.equal(reviewed.structuredContent.status, h.state.commits ? "confirmed" : "pending_confirmation");
        assert.equal(reviewed.structuredContent.facts.quoteAmounts.payableAmount, h.state.records.quote[0].payableAmount);
        assert.equal(reviewed.structuredContent.facts.currency, h.state.records.quote[0].currency);
        assert.doesNotMatch(JSON.stringify(reviewed), /customerName|contactPhone|workspace-a|ownerId/);
        assert.deepEqual(h.state.records, before, "review reads cannot decide a proposal or execute Core");
        for (const proposal of [{ ...wait.proposal, proposalRevision: wait.proposal.proposalRevision + 1 },
          { ...wait.proposal, reviewedPayloadHash: "f".repeat(64) }]) {
          assert.equal((await client.callTool({ name: proposalRead.name, arguments: { ...command, proposal } })).isError, true);
        }
        if (!h.state.commits) {
          await human.decideSelectedProposal(webRequest, { ...command, proposal: { ...wait.proposal, decision: "approve" } });
          h.state.ackLost = true;
          const executed = await tasks.continueConfirmation(webRequest, { ...command, checkpointRef: wait.checkpointRef });
          assert.equal(executed.outcome.status, "unknown"); assert.equal(h.state.commits, 1);
          h.state.ackLost = false;
        }
        const committedState = clone(h.state.records);
        const committed = (await client.callTool({ name: read.name, arguments: command })).structuredContent.result;
        assert.equal(committed.status, "committed"); assert.equal(committed.order.id, h.state.records.rentalOrder[0].id);
        assert.equal(committed.order.quoteId, h.body.quoteId); assert.equal(committed.source.resourceId, committed.order.id);
        assert.equal(committed.payment, "not_inferred"); assert.equal(committed.fulfillment, "not_inferred");
        hideConsumption = true;
        const unresolved = (await client.callTool({ name: read.name, arguments: command })).structuredContent.result;
        assert.deepEqual(unresolved, selectedOrderResult("unknown")); hideConsumption = false;
        for (const change of [value => { value.selection.inputHash = "f".repeat(64); }, value => { value.selection.runId = "00000000-0000-4000-8000-000000000009"; },
          value => { value.selection.selectionId = "00000000-0000-4000-8000-000000000009"; }]) {
          const changed = structuredClone(command); change(changed);
          assert.equal((await client.callTool({ name: read.name, arguments: changed })).isError, true);
        }
        const workspace = h.state.workspace;
        h.state.workspace = "different-workspace";
        try { assert.equal((await client.callTool({ name: read.name, arguments: command })).isError, true); }
        finally { h.state.workspace = workspace; }
        h.state.workspace = "different-workspace";
        try {
          assert.equal((await client.callTool({ name: selectionRead.name, arguments: selectionCommand })).isError, true);
          assert.equal((await client.callTool({ name: proposalRead.name, arguments: proposalCommand })).isError, true);
        } finally { h.state.workspace = workspace; }
        const userId = h.state.user.id;
        h.state.user.id = "different-operator";
        try {
          assert.equal((await client.callTool({ name: read.name, arguments: command })).isError, true);
          assert.equal((await client.callTool({ name: selectionRead.name, arguments: selectionCommand })).isError, true);
          assert.equal((await client.callTool({ name: proposalRead.name, arguments: proposalCommand })).isError, true);
        } finally { h.state.user.id = userId; }
        loseSession = true;
        try { assert.equal((await client.callTool({ name: read.name, arguments: command })).isError, true); }
        finally { loseSession = false; h.state.session = true; }
        for (const state of ["expired", "superseded"]) {
          const stored = h.state.records.aiTaskQuoteSelection[0], expiry = stored.expiresAt, supersededAt = stored.supersededAt;
          if (state === "expired") stored.expiresAt = new Date(0); else stored.supersededAt = new Date();
          try {
            const observed = (await client.callTool({ name: selectionRead.name, arguments: selectionCommand })).structuredContent.result;
            assert.equal(observed.state, state); assert.equal(observed.approval, "not_granted");
          } finally { Object.assign(h.state.records.aiTaskQuoteSelection[0], { expiresAt: expiry, supersededAt }); }
        }
        const selectionLookup = dependencies.db.aiTaskQuoteSelection.findFirst;
        dependencies.db.aiTaskQuoteSelection.findFirst = async args => {
          const row = await selectionLookup(args); h.state.session = false; return row;
        };
        try { assert.equal((await client.callTool({ name: selectionRead.name, arguments: selectionCommand })).isError, true); }
        finally { dependencies.db.aiTaskQuoteSelection.findFirst = selectionLookup; h.state.session = true; }
        const proposalLookup = dependencies.db.aiProposalVersion.findFirst;
        dependencies.db.aiProposalVersion.findFirst = async args => {
          const row = await proposalLookup(args); h.state.session = false; return row;
        };
        try { assert.equal((await client.callTool({ name: proposalRead.name, arguments: proposalCommand })).isError, true); }
        finally { dependencies.db.aiProposalVersion.findFirst = proposalLookup; h.state.session = true; }
        const storedHash = h.state.records.aiTaskQuoteSelection[0].inputHash;
        h.state.records.aiTaskQuoteSelection[0].inputHash = "f".repeat(64);
        try { assert.equal((await client.callTool({ name: selectionRead.name, arguments: selectionCommand })).isError, true); }
        finally { h.state.records.aiTaskQuoteSelection[0].inputHash = storedHash; }
        for (const changed of [{ ...selectionCommand, selectionId: "00000000-0000-4000-8000-000000000009" },
          { ...selectionCommand, originalInputRef: "00000000-0000-4000-8000-000000000009" }]) {
          assert.equal((await client.callTool({ name: selectionRead.name, arguments: changed })).isError, true);
        }
        assert.deepEqual(h.state.records, committedState, "mismatched inputs and read-after authorization loss cannot recover or rewrite the original order");
        assert.equal(h.state.commits, 1);
      } finally { await client.close(); }
    }
    assert.ok(calls > 0);
  } finally { dependencies.db.$transaction = transaction; hideConsumption = false; loseSession = false; h.state.session = true; }
}

async function verifyOriginalConversationComposition(t, createRead, createRecoveryRead, createOperationRead, createListRead, createOrderRead, createSelectionRead, createProposalRead, stagedShared) {
  const { Client, StreamableHTTPClientTransport } = installed("@modelcontextprotocol/client");
  // Only the existing fixture's shared resolver is replaced; production APIs
  // still import the public package, backed here by this run's private artifact.
  const resolver = path.join(path.dirname(stagedShared), "fixture-shared.cjs");
  fs.writeFileSync(resolver, 'module.exports = require("@rental-os/shared");\n');
  const sharedFile = path.join(stagedShared, "dist/index.js");
  const sourceUrl = pathToFileURL(root + path.sep).href;
  const hooks = registerHooks({ resolve(specifier, context, next) {
    if (specifier === "@rental-os/shared") return { url: pathToFileURL(sharedFile).href, shortCircuit: true };
    if (context.parentURL?.includes("/tests/fixtures/ai-native/") && specifier === "./local-shared.cjs") {
      return { url: pathToFileURL(resolver).href, shortCircuit: true };
    }
    if (context.parentURL?.startsWith(sourceUrl) && !specifier.startsWith(".") && !path.isAbsolute(specifier) && !URL.canParse(specifier) && !isBuiltin(specifier)) {
      const dependency = sourceResolver.resolveSource(fileURLToPath(context.parentURL), specifier, true);
      return { url: pathToFileURL(dependency || installed.resolve(specifier)).href, shortCircuit: true };
    }
    return next(specifier, context);
  } });
  const extensions = new Map(Object.getOwnPropertyNames(require.extensions).map(name => [name, Object.getOwnPropertyDescriptor(require.extensions, name)]));
  let runtime;
  const restore = () => {
    runtime?.enabled(false); hooks.deregister();
    for (const name of Object.getOwnPropertyNames(require.extensions)) if (!extensions.has(name)) delete require.extensions[name];
    for (const [name, descriptor] of extensions) Object.defineProperty(require.extensions, name, descriptor);
  };
  t.after(restore);
  try {
    runtime = installed("ts-node").register({ transpileOnly: true, compiler: installed.resolve("typescript"),
      compilerOptions: { module: "Node16", moduleResolution: "Node16", target: "ES2022", experimentalDecorators: true, emitDecoratorMetadata: true, esModuleInterop: true } });
    const { setup } = require("./fixtures/ai-native/lane-a-original-request.cjs");
    const { composeAiConversationRequests } = require(sourceResolver.resolveSource(__filename, "@rental-os/ai-native-server/runtime/conversation.application", true));
    const { composeRequestBoundOriginalTaskRecoveryReaders, composeRequestBoundOriginalScenes } = require(sourceResolver.resolveSource(__filename, "@rental-os/ai-native-server/runtime/scenes/request-bound-scenes.application", true));
    const { requestFingerprint } = require(sourceResolver.resolveSource(__filename, "@rental-os/rental-core/mysql-idempotency", true));
    const shared = require(sharedFile);
    const h = await setup({ aiConversation: [], aiConversationTurn: [], aiConversationOperation: [], aiTaskResultArtifact: [] });
    const { credentials, ...dependencies } = h.dependencies;
    const webRequest = { headers: { authorization: (await credentials.current()).authorization } };
    let bodyReads = 0, duringRead;
    const recovery = composeRequestBoundOriginalTaskRecoveryReaders(dependencies, { enabled: true, audience: "operator" },
      { policy: { sceneCode: "order_explanation", routeScene: "chat", maxOutputTokens: 64 } });
    const observations = { readModelResult: async (request, command) => {
      bodyReads++;
      const result = await recovery.readModelResult(request, command);
      await duringRead?.();
      return result;
    } };
    const app = composeAiConversationRequests(dependencies, true, observations);
    const draftVersion = shared.AI_CONVERSATION_DRAFT_VERSION;
    const created = await app.consume(webRequest, "create", { draftVersion, operationKey: "mcp-consumer-create", capabilityCode: "order_explanation" });
    const reference = { draftVersion, conversationId: created.conversationId };
    const admitted = await app.consume(webRequest, "admit", { ...reference, expectedRevision: 1, admissionKey: "mcp-consumer-turn",
      request: { sceneCode: "order_explanation", input: { orderId: "order-a", question: "status" } } });
    const task = await h.app.requests.createTask(admitted.result.original);
    const taskRow = h.state.aiTask.find(row => row.id === task.taskId);
    h.state.aiTaskActionPolicy.push({ scopeId: taskRow.scopeId, taskId: task.taskId, operation: "read_step_terminal", revision: 1,
      requiredPermissions: ["rental-os:order:view"], expiresAt: new Date("2027-01-01T00:00:00Z") });
    const payload = { incomplete: true }, stepFingerprint = "c".repeat(64);
    h.state.aiTaskActionPolicy.push({ scopeId: taskRow.scopeId, taskId: task.taskId, operation: "read_metadata", revision: 1,
      requiredPermissions: ["rental-os:order:view"], expiresAt: new Date("2027-01-01T00:00:00Z") });
    h.state.aiStep.push({ id: "original-model-step", scopeId: taskRow.scopeId, taskId: task.taskId, runId: task.runId,
      actionId: "original-model-action", requestFingerprint: stepFingerprint, resultRef: "original-result-candidate", revision: 1, status: "UNKNOWN", effect: "POSSIBLE" });
    h.state.aiTaskResultArtifact.push({ id: "original-result-candidate", scopeId: taskRow.scopeId, taskId: task.taskId,
      runId: task.runId, stepId: "original-model-step", actionId: "original-model-action", stepFingerprint, outcome: "UNKNOWN",
      errorCode: null, payload, contentHash: requestFingerprint(payload), outputBytes: BigInt(Buffer.byteLength(JSON.stringify(payload))),
      activeMs: 0n, completeMeasurement: false, createdAt: h.dependencies.clock() });
    const command = { ...reference, admissionKey: admitted.admissionKey, resultId: "original-result-candidate" };
    const originals = formalSource("@rental-os/ai-native-server/runtime/contracts/ai-native-schemas").AI_NATIVE_COMPONENT_SCHEMAS;
    const read = createRead({ name: "original_conversation_fixture", description: "Read the existing original conversation result.",
      originalSchemas: { AiOrderExplainRequestDraft: originals.AiOrderExplainRequestDraft, AiOrderExplainInput: originals.AiOrderExplainInput },
      outputSchema: { type: "object", properties: { observation: {} }, required: ["observation"], additionalProperties: false },
      // The Web identity is test-only. Production needs a fixed MCP-to-original
      // identity adapter; this test must not imply MCP bearer passthrough.
      read: (value, signal) => app.consume(webRequest, "modelResult", value, signal) });
    const originalScenes = composeRequestBoundOriginalScenes(dependencies, { enabled: true, audience: "operator" });
    const recoveryRead = createRecoveryRead({ name: "original_task_recovery_fixture", description: "Read original task and step observations without recovery execution.",
      outputSchema: { type: "object", properties: { observation: {} }, required: ["observation"], additionalProperties: false },
      read: (value, signal) => originalScenes.readRecovery(webRequest, value, signal) });
    const operationRead = createOperationRead({ name: "original_operation_fixture", description: "Read the exact original conversation operation receipt.",
      outputSchema: { type: "object", properties: { observation: {} }, required: ["observation"], additionalProperties: false },
      read: (value, signal) => app.consume(webRequest, "operation", value, signal) });
    const listRead = createListRead({ name: "original_conversation_list_fixture", description: "Read one authorized original conversation metadata page.",
      outputSchema: { type: "object", properties: { observation: {} }, required: ["observation"], additionalProperties: false },
      read: (value, signal) => app.consume(webRequest, "list", value, signal) });
    const endpoint = fixture(t, async () => verified(), { readTools: { tools: [read, recoveryRead, operationRead, listRead],
      publication: { allows: async () => true }, authority: { withRead: async (_auth, _name, _value, consume) => consume() },
      accounting: { withCall: async (_auth, _name, _value, consume) => consume() },
      release: { project: async (_auth, _name, value) => ({ observation: value }) } } });
    const { clone } = require("./fixtures/ai-native/task-input-store.cjs");
    const before = clone(h.state);
    const recoveryCommand = admitted.result.original;
    const operationCommand = { draftVersion, operationKey: "mcp-consumer-create" };
    for (const versionNegotiation of [{ mode: { pin: "2026-07-28" } }, { mode: "legacy" }]) {
      const client = new Client({ name: "original-composition-consumer", version: "1" }, { capabilities: {}, versionNegotiation });
      try {
        await client.connect(new StreamableHTTPClientTransport(new URL(resource), { fetch: inProcess(endpoint),
          authProvider: { token: async () => "synthetic-only" }, onInsufficientScope: "throw" }));
        const page = await client.callTool({ name: listRead.name, arguments: { draftVersion, status: "active", limit: 1 } });
        assert.equal(page.structuredContent.observation.coverage, "page_not_total");
        assert.equal(page.structuredContent.observation.items[0].conversationId, created.conversationId);
        assert.equal(page.structuredContent.observation.nextBeforeId, null);
        assert.deepEqual(h.state, before, "original metadata list never mutates conversation or task state");
        const receipt = await client.callTool({ name: operationRead.name, arguments: operationCommand });
        assert.equal(receipt.structuredContent.observation.operationKey, operationCommand.operationKey);
        assert.equal(receipt.structuredContent.observation.conversationId, created.conversationId);
        assert.equal(receipt.structuredContent.observation.operation, "create");
        assert.equal(receipt.structuredContent.observation.taskCancellation, "not_requested");
        const missing = await client.callTool({ name: operationRead.name, arguments: { ...operationCommand, operationKey: "not-observed-key" } });
        assert.equal(missing.structuredContent.observation.status, "not_observed");
        assert.equal(missing.structuredContent.observation.absence, "not_proof_of_no_commit");
        assert.equal(missing.structuredContent.observation.retryable, false);
        assert.deepEqual(h.state, before, "receipt observation does not recreate a missing operation");
        const result = await client.callTool({ name: read.name, arguments: command });
        assert.equal(result.structuredContent.observation.result.status, "unknown");
        assert.equal(result.structuredContent.observation.result.text, null);
        assert.equal(result.structuredContent.observation.turn.original.inputRef, admitted.result.original.inputRef);
        assert.deepEqual(h.state, before, "original conversation result reads make no persistent mutation, task or model run");
        const recovered = await client.callTool({ name: recoveryRead.name, arguments: recoveryCommand });
        assert.equal(recovered.structuredContent.observation.task.taskId, task.taskId);
        assert.equal(recovered.structuredContent.observation.task.execution, "not_inferred_from_metadata");
        assert.equal(recovered.structuredContent.observation.steps[0].status, "unknown");
        assert.equal(recovered.structuredContent.observation.steps[0].effect, "possible");
        assert.equal(recovered.structuredContent.observation.steps[0].nextAction, "reconcile_original_action");
        assert.equal(recovered.structuredContent.observation.automaticExecution, false);
        assert.deepEqual(h.state, before);
        const originalTaskHash = h.state.aiTask[0].inputHash;
        h.state.aiTask[0].inputHash = "d".repeat(64);
        assert.equal((await client.callTool({ name: recoveryRead.name, arguments: recoveryCommand })).isError, true);
        h.state.aiTask[0].inputHash = originalTaskHash;
        const savedTask = h.state.aiTask.splice(0, 1)[0];
        const absent = await client.callTool({ name: recoveryRead.name, arguments: recoveryCommand });
        assert.deepEqual(absent.structuredContent.observation.task, { state: "not_observed", retryable: false });
        h.state.aiTask.push(savedTask);
        assert.deepEqual(h.state, before);
        const beforeRead = h.control.beforeRead;
        h.control.beforeRead = async (name, args) => {
          await beforeRead?.(name, args);
          if (name === "aiStep") h.b.h.identity.session = false;
        };
        try {
          assert.equal((await client.callTool({ name: recoveryRead.name, arguments: recoveryCommand })).isError, true,
            "the original recovery reader rechecks identity after reading steps");
        } finally { h.b.h.identity.session = true; h.control.beforeRead = beforeRead; }
        const beforeListRead = h.control.beforeRead;
        h.control.beforeRead = async (name, args) => {
          await beforeListRead?.(name, args);
          if (name === "aiConversation") h.b.h.identity.session = false;
        };
        try {
          assert.equal((await client.callTool({ name: listRead.name, arguments: { draftVersion, status: "active", limit: 1 } })).isError, true,
            "the original list reader checks current identity after page lookup");
        } finally { h.b.h.identity.session = true; h.control.beforeRead = beforeListRead; }
        const originalPayload = h.state.aiTaskResultArtifact[0].payload;
        h.state.aiTaskResultArtifact[0].payload = { incomplete: false };
        assert.equal((await client.callTool({ name: read.name, arguments: command })).isError, true, "the original artifact hash is revalidated, not accepted by schema alone");
        h.state.aiTaskResultArtifact[0].payload = originalPayload;
        const originalRunId = h.state.aiTaskResultArtifact[0].runId;
        h.state.aiTaskResultArtifact[0].runId = "unbound-run";
        assert.equal((await client.callTool({ name: read.name, arguments: command })).isError, true, "an artifact cannot select another run");
        h.state.aiTaskResultArtifact[0].runId = originalRunId;
        const beforeReceiptRead = h.control.beforeRead;
        h.control.beforeRead = async (name, args) => {
          await beforeReceiptRead?.(name, args);
          if (name === "aiConversationOperation") h.b.h.identity.session = false;
        };
        try {
          assert.equal((await client.callTool({ name: operationRead.name, arguments: operationCommand })).isError, true,
            "the original operation reader rechecks identity after receipt lookup");
        } finally { h.b.h.identity.session = true; h.control.beforeRead = beforeReceiptRead; }
        const callsAfterInvalid = bodyReads;
        const actor = h.b.h.identity.user.id;
        h.b.h.identity.user.id = "other-operator";
        assert.equal((await client.callTool({ name: read.name, arguments: command })).isError, true);
        assert.equal((await client.callTool({ name: recoveryRead.name, arguments: recoveryCommand })).isError, true);
        assert.equal((await client.callTool({ name: operationRead.name, arguments: operationCommand })).isError, true);
        h.b.h.identity.user.id = actor;
        assert.equal(bodyReads, callsAfterInvalid, "the original owner authority rejects before body lookup");
        const workspace = h.b.h.identity.workspace;
        h.b.h.identity.workspace = "other-workspace";
        assert.equal((await client.callTool({ name: read.name, arguments: command })).isError, true);
        assert.equal((await client.callTool({ name: recoveryRead.name, arguments: recoveryCommand })).isError, true);
        assert.equal((await client.callTool({ name: operationRead.name, arguments: operationCommand })).isError, true);
        h.b.h.identity.workspace = workspace;
        assert.equal(bodyReads, callsAfterInvalid);
        duringRead = async () => { h.b.h.identity.session = false; };
        assert.equal((await client.callTool({ name: read.name, arguments: command })).isError, true);
        h.b.h.identity.session = true; duringRead = undefined;
        assert.deepEqual(h.state, before, "read-after-body identity loss cannot write or recover an operation");
      } finally { await client.close(); }
    }
    assert.equal(h.state.aiStep.length, 1, "only the explicitly seeded existing artifact step remains");
    assert.equal(h.state.aiRun.length, 1, "only the explicit fixture setup task has a metadata run");
    await verifyOriginalSelectedOrderComposition(t, createOrderRead, createSelectionRead, createProposalRead);
  } finally { restore(); }
}

test("compiled Rental MCP adapters retain original business reads through public package exports", async t => {
  const packageRoot = path.join(root, "packages/mcp-server");
  const output = prepareOutput();
  const stagedShared = compileSharedExport(output);
  const publicResultTypes = path.join(output, "node_modules/@rental-os/platform-contracts/dist/ai-original-result.d.ts");
  const staged = path.join(output, "node_modules/@rental-os/mcp-server");
  fs.mkdirSync(staged, { recursive: true });
  fs.copyFileSync(path.join(packageRoot, "package.json"), path.join(staged, "package.json"));
  const parsed = ts.readConfigFile(path.join(packageRoot, "tsconfig.json"), ts.sys.readFile);
  assert.equal(parsed.error, undefined);
  const configured = ts.parseJsonConfigFileContent(parsed.config, ts.sys, packageRoot);
  const serverTypes = path.join(path.dirname(installed.resolve("@modelcontextprotocol/server")), "index.d.mts");
  const typeRoots = [path.join(dependencyDirectory, "@types")];
  const publicPaths = Object.fromEntries(["core-contracts", "core-host", "platform-core-host"].flatMap(name => {
    const directory = path.join(output, "node_modules/@rental-os", name), manifest = JSON.parse(fs.readFileSync(path.join(directory, "package.json"), "utf8"));
    return Object.entries(manifest.exports).filter(([key, value]) => !key.includes("*") && typeof value === "object" && value.types)
      .map(([key, value]) => ["@rental-os/" + name + (key === "." ? "" : key.slice(1)), [path.join(directory, value.types)]]);
  }));
  const program = ts.createProgram(configured.fileNames, {
    ...configured.options, outDir: path.join(staged, "dist"), typeRoots,
    paths: { ...publicPaths, "@modelcontextprotocol/server": [serverTypes], "@rental-os/shared": [path.join(stagedShared, "dist/index.d.ts")],
      "@rental-os/platform-contracts/ai-original-result": [publicResultTypes],
      "@rental-os/platform-contracts/ai-work-center": [path.join(path.dirname(publicResultTypes), "ai-work-center.d.ts")],
      zod: [path.join(path.dirname(installed.resolve("zod/package.json")), "index.d.cts")] },
  });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(diagnostics.length, 0, diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, "\n")).join("\n"));
  const emitted = program.emit();
  assert.equal(emitted.emitSkipped, false);
  assert.equal(emitted.diagnostics.length, 0);
  // Compile the Rental mapping in its own package; its MCP port resolves only
  // the emitted public declarations, preserving the CJS/ESM package boundary.
  const rentalRoot = rentalMcpOwner, stagedRental = path.join(output, "node_modules/@rental-os/rental-mcp-host");
  fs.mkdirSync(stagedRental, { recursive: true });
  fs.copyFileSync(path.join(rentalRoot, "package.json"), path.join(stagedRental, "package.json"));
  const mappingProgram = ts.createProgram(["capability-mapping", "rental-conversation-result-read", "rental-conversation-list-read",
    "rental-conversation-operation-read", "quote-selection-read", "selected-proposal-read", "selected-order-result-read"]
    .map(file => path.join(rentalRoot, "src", file + ".ts")), {
    ...program.getCompilerOptions(), rootDir: path.join(rentalRoot, "src"), outDir: path.join(stagedRental, "dist"),
    paths: { ...program.getCompilerOptions().paths, "@rental-os/mcp-server": [path.join(staged, "dist/index.d.ts")],
      "@rental-os/mcp-server/original-read-tool": [path.join(staged, "dist/original-read-tool.d.ts")],
      "@rental-os/platform-contracts/ai-gateway": [path.join(path.dirname(publicResultTypes), "ai-gateway.d.ts")] },
  });
  const mappingDiagnostics = ts.getPreEmitDiagnostics(mappingProgram);
  assert.equal(mappingDiagnostics.length, 0, mappingDiagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, "\n")).join("\n"));
  const mappingEmitted = mappingProgram.emit();
  assert.equal(mappingEmitted.emitSkipped, false); assert.equal(mappingEmitted.diagnostics.length, 0);
  const consumer = path.join(output, "consumer.mts");
  fs.writeFileSync(consumer, [
    'import { createProtectedMcpEndpoint, ResourceAuthorizationError } from "@rental-os/mcp-server";',
    'import * as businessMapping from "@rental-os/rental-mcp-host/capability-mapping";',
    'export { businessMapping };',
    'import { createPublicClientAuthorization } from "@rental-os/mcp-server/public-client-authorization";',
    'export { createPublicClientAuthorization };',
    'import { createPublicClientAuthorizationEndpoint } from "@rental-os/mcp-server/public-client-authorization-endpoint";',
    'export { createPublicClientAuthorizationEndpoint };',
    'import * as oauthTokens from "@rental-os/mcp-server/oauth-token-endpoint";',
    'export { oauthTokens };',
    'import * as persistentTokens from "@rental-os/mcp-server/persistent-oauth-tokens";',
    'export { persistentTokens };',
    'import * as persistentAuthorization from "@rental-os/mcp-server/persistent-oauth-authorization";',
    'export { persistentAuthorization };',
    'import { createRentalMcpService } from "@rental-os/mcp-server/service";',
    'export { createRentalMcpService };',
    'import { assertAuthorizationCodeBinding } from "@rental-os/mcp-server/authorization-code-binding";',
    'export { assertAuthorizationCodeBinding };',
    'import { createAuthorizationServerMetadata } from "@rental-os/mcp-server/authorization-server-metadata";',
    'export { createAuthorizationServerMetadata };',
    'import type { McpBusinessReadCode } from "@rental-os/rental-mcp-host/capability-mapping";',
    'const readCode: McpBusinessReadCode = "rental.catalog.search";',
    'void readCode;',
    'import * as originalRuntime from "@rental-os/mcp-server/original-read-tool";',
    'import { createWorkCenterOriginalRead } from "@rental-os/mcp-server/work-center-read";',
    'export { createWorkCenterOriginalRead };',
    'import { createRentalConversationResultRead } from "@rental-os/rental-mcp-host/rental-conversation-result-read";',
    'import type { RentalConversationResultReadBinding } from "@rental-os/rental-mcp-host/rental-conversation-result-read";',
    'export const resultRead = (binding: RentalConversationResultReadBinding) => createRentalConversationResultRead(binding, originalRuntime);',
    'import { createOriginalTaskRecoveryRead } from "@rental-os/mcp-server/original-task-recovery-read";',
    'import type { OriginalTaskRecoveryReadBinding } from "@rental-os/mcp-server/original-task-recovery-read";',
    'export const recoveryRead = (binding: OriginalTaskRecoveryReadBinding) => createOriginalTaskRecoveryRead(binding);',
    'import { createSelectedOrderResultRead } from "@rental-os/rental-mcp-host/selected-order-result-read";',
    'import type { SelectedOrderResultReadBinding } from "@rental-os/rental-mcp-host/selected-order-result-read";',
    'export const selectedOrderRead = (binding: SelectedOrderResultReadBinding) => createSelectedOrderResultRead(binding, originalRuntime);',
    'import { createQuoteSelectionRead } from "@rental-os/rental-mcp-host/quote-selection-read";',
    'import type { QuoteSelectionReadBinding } from "@rental-os/rental-mcp-host/quote-selection-read";',
    'export const selectionRead = (binding: QuoteSelectionReadBinding) => createQuoteSelectionRead(binding, originalRuntime);',
    'import { createSelectedProposalRead } from "@rental-os/rental-mcp-host/selected-proposal-read";',
    'import type { SelectedProposalReadBinding } from "@rental-os/rental-mcp-host/selected-proposal-read";',
    'export const proposalRead = (binding: SelectedProposalReadBinding) => createSelectedProposalRead(binding, originalRuntime);',
    'import { createRentalConversationOperationRead } from "@rental-os/rental-mcp-host/rental-conversation-operation-read";',
    'import type { ConversationOperationReadBinding } from "@rental-os/rental-mcp-host/rental-conversation-operation-read";',
    'export const operationRead = (binding: ConversationOperationReadBinding) => createRentalConversationOperationRead(binding, originalRuntime);',
    'import { createRentalConversationListRead } from "@rental-os/rental-mcp-host/rental-conversation-list-read";',
    'import type { ConversationListReadBinding } from "@rental-os/rental-mcp-host/rental-conversation-list-read";',
    'export const listRead = (binding: ConversationListReadBinding) => createRentalConversationListRead(binding, originalRuntime);',
    'import type { ProtectedMcpConfig, ResourceTokenVerifier, VerifiedResourceToken, McpInstructionsProvider, McpPromptsProvider, McpResources, McpResourceDescriptor } from "@rental-os/mcp-server";',
    'export const resourceUri = (descriptor: McpResourceDescriptor): string => descriptor.uri;',
    'export function resourceEndpoint(configuration: ProtectedMcpConfig, resources: McpResources, verifier: ResourceTokenVerifier) { return createProtectedMcpEndpoint({ ...configuration, resources }, verifier); }',
    'export function create(configuration: ProtectedMcpConfig, verifier: ResourceTokenVerifier) { return createProtectedMcpEndpoint(configuration, verifier); }',
    'export const invalid = new ResourceAuthorizationError("invalid");',
    'export const subjectOf = (identity: VerifiedResourceToken): string => identity.subject;',
    'export const guidance: McpInstructionsProvider = { read: async authorization => { void authorization.subject; return undefined; } };',
    'export const prompts: McpPromptsProvider = { list: async authorization => { void authorization.subject; return [{ name: "synthetic_artifact_prompt", version: "reviewed-artifact-v1", description: "Use the released facts." }]; }, read: async () => ({ version: "reviewed-artifact-v1", text: "Keep missing facts distinct." }) };',
    '',
  ].join("\n"));
  const consumerProgram = ts.createProgram([consumer], {
    strict: true, skipLibCheck: true, declaration: true, target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
    types: ["node"], typeRoots, rootDir: output, outDir: path.join(output, "consumer-build"),
    paths: { "@modelcontextprotocol/server": [serverTypes], "@rental-os/shared": [path.join(stagedShared, "dist/index.d.ts")],
      zod: [path.join(path.dirname(installed.resolve("zod/package.json")), "index.d.cts")] },
  });
  const consumerDiagnostics = ts.getPreEmitDiagnostics(consumerProgram);
  assert.equal(consumerDiagnostics.length, 0, consumerDiagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, "\n")).join("\n"));
  assert.equal(consumerProgram.emit().emitSkipped, false);
  const stagedUrl = pathToFileURL(staged + path.sep).href;
  // Only this artifact's external SDK import is redirected to the existing
  // installation. Relative imports still resolve its own emitted files.
  const hooks = registerHooks({ resolve(specifier, context, next) {
    if (context.parentURL?.startsWith(stagedUrl) && specifier === "@modelcontextprotocol/server") {
      return { url: pathToFileURL(installed.resolve(specifier)).href, shortCircuit: true };
    }
    if (context.parentURL?.startsWith(pathToFileURL(output + path.sep).href) && specifier === "zod") {
      return { url: pathToFileURL(installed.resolve("zod")).href, shortCircuit: true };
    }
    return next(specifier, context);
  } });
  t.after(() => hooks.deregister());
  const compiled = await import(pathToFileURL(path.join(output, "consumer-build/consumer.mjs")).href);
  assert.equal(compiled.invalid.kind, "invalid");
  assert.equal(compiled.subjectOf(verified()), "synthetic-actor");
  await verifyBusinessCapabilityMapping(t, compiled.businessMapping);
  await verifyConversationRead(t, compiled.resultRead);
  await verifySelectedOrderResultRead(t, compiled.selectedOrderRead);
  await verifyQuoteSelectionRead(t, compiled.selectionRead);
  await verifySelectedProposalRead(t, compiled.proposalRead);
  await verifyOperationRead(t, compiled.operationRead);
  await verifyConversationList(t, compiled.listRead);
  await verifyOriginalConversationComposition(t, compiled.resultRead, compiled.recoveryRead, compiled.operationRead, compiled.listRead, compiled.selectedOrderRead, compiled.selectionRead, compiled.proposalRead, stagedShared);

});

// The existing offline preload remains active. These tests do not patch fetch,
// open a port, start Harness or install either new package.
