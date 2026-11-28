# Rental 独立 API

普通入口使用同一所选 Prisma Client 连接 Zelo 公共能力与 Rental 业务。授权、订单、库存、原收据和后台所用接口仍走原处理器。新装 AI 是显式选择；普通入口不会加载 AI 或 MCP。

先按照[双仓准备步骤](https://github.com/JinPen-G/Zelo-rental-core#源码开发工作区)从固定版本准备 `host` 或 `full`，在解包后的组合根目录安装锁定依赖并执行 `npm run check:types`。构建前按[宿主开发说明](https://github.com/JinPen-G/Zelo/blob/6c41063f8be4d3ac02d4857c87ec2712a5aa6755/apps/rental-api/README.md)分别准备公共与所选 Rental Client，明确设置 `RENTAL_PRISMA_CLIENT` 后执行 `npm run build`；不要使用默认 Prisma Client。构建无需启动服务。部署和运行 `npm run start -w @rental-os/rental-api` 还须准备固定 Core 包、部署锁、数据库和原迁移账。

## 固定双仓普通开发运行包

从已按锁准备编译依赖的 Zelo Git 根目录运行以下命令。两个 SHA 都使用完整提交；归档路径须为尚不存在的绝对路径。`6c41063f8be4d3ac02d4857c87ec2712a5aa6755` 是已包含该工具的 Zelo 示例提交。

```sh
node scripts/package-rental-host.cjs --development --repo <Zelo目录> --repository https://github.com/JinPen-G/Nativark --commit <Zelo完整SHA> --core-repo <Rental目录> --core-commit <Rental完整SHA> --output <新归档绝对路径.tgz>
```

解包后按归档 README 安装原锁依赖、生成两份所选 Client、验证运行包和迁移。只对为本次启动准备的空 MySQL 库应用归档内 `apps/rental-api/prisma-deployment` 的迁移；该开发入口不接管旧库。设置该库的 `DATABASE_URL` 与本机 `AUTH_TOKEN_SECRET`，按归档步骤初始化。`RENTAL_AI_MODE=disabled`、`RENTAL_DEPLOYMENT_LOCK` 指向随包锁的绝对路径，启动 `node apps/rental-api/dist/main.js` 后检查 `/api/health`。API 和后台须使用同一个包与锁。开发归档不满足正式版本 Tag 或服务器更新资格。

## 新装 Rental 与公共 AI

在包含 v2 构建工具的固定 Zelo 检出，执行上面的命令，在 `--development` 后追加 `--fresh-ai`。用同一组 Git SHA 和 `--fresh-ai --profile host` 准备后台源码。API 运行包保存两个来源、编译证明、公共 AI 数据包和四阶段原 SQL。当前开发数据 `0.1.4` 的完整链为公共 14、Rental 5、公共 AI 1、Rental 扩展 1，共 21 条；旧发行仍保留自己的 18 条固定链。

使用专用空库，按包内说明生成两份 Client、应用完整锁声明的迁移并初始化 SaaS。设置 `RENTAL_AI_MODE=enabled`，`RENTAL_DEPLOYMENT_LOCK` 指向完整 v2 锁，`RENTAL_PUBLIC_AI_DATA_PACKAGE_DIR` 指向同包的 `public-ai-data`。先执行 [品类初始化](src/ai-fresh-initialize.ts)，再运行 [新装入口](src/ai-fresh-main.ts)。后台使用同一部署锁、数据包及已核标准 Rental 包，执行 `build:fresh`。旧库继续使用原 SQL、原锁与原账，不能直接重跑新装材料。

AI 后置扩展按锁内 Rental 数据版本选择前置：旧 `0.1.0/0.1.1` 保持原范围，`0.1.4` 使用独立的 `>=0.1.4 <0.1.5` 声明；其他版本拒绝。准备、运行选择及数据观察使用同一版本，仍核完整迁移摘要与实际物理计划，不改旧 SQL、来源或已发行锁。

当前新装扩展为 [20261127000000](prisma/ai-extension/20261127000000-initial.sql)。它只修正 MySQL 对中间 `CHECK` 布尔类型的要求，末态约束与原方案相同；前版 [原 SQL](prisma/ai-extension/20261126000000-initial.sql) 及其 [来源](prisma/ai-extension/provenance.json)保留，不作为可执行的新装文件。

## 显式选装 MCP（仅新装开发）

在同一打包命令上使用 `--development --fresh-ai --mcp`。配套源码也要使用同一组 SHA 和 `--fresh-ai --mcp --profile host`。只对 `utf8mb4_unicode_ci` 的专用空库应用 **14 公共 → 5 Rental → 1 公共 AI → 5 MCP → 1 Rental 扩展**，以本次完整锁为准。沿包内步骤设置 `RENTAL_MCP_DATA_PACKAGE_DIR`，指向实际随包的 `packages/mcp-server` 绝对目录；再用 `dist-mcp/mcp-fresh-initialize.js` 初始化，启动 `dist-mcp/mcp-fresh-main.js`。AI-only、普通库、旧混合库及旧发行的 23 条 MCP 链不能换锁直接采用这条新链。

该开发启动叶只核验 MCP 原账与物理结构，默认不挂 MCP HTTP。需对外接入时，第一方源码显式调用 [bootstrapFreshRentalMcp(sources)](src/mcp-bootstrap.ts)。`SelectedRentalMcpSources` 由原权威供给：AS 当前元数据，目录真实发布、输出字段投影和分类计量，及需启用的原验证来源。可选报价只在取得原对象 Guard、同事务历史读者、原键目标和外发策略后登记。Web 登录、通用目录与数据库表存在本身都不会开放这些能力。[同实例装配](src/mcp-host.ts)

- [启动](src/main.ts) → [宿主装配](src/app.module.ts) → [同实例应用](src/assembly.ts)与[所选数据访问](src/database.ts)
- [实际 HTTP 策略](src/http-policy.ts)、[兼容路径和 OpenAPI](src/openapi.ts)
- [部署材料准备](src/prepare-deployment.ts)只产出待部署材料，不连接、迁移或改写原账；[公开包工厂接点](src/package.ts)复用领域包的实际文档与构建材料。

旧组合和已发布版本继续使用各自固定来源。本目录不是独立安装目录，构建和运行命令统一在准备后的组合中执行。

## 旧 mixed 库的显式过渡

旧库不使用任何新装执行目录。受控宿主从正式 `@rental-os/rental-api/app-module` 或 `/ai-app-module` 导出的 [LegacyRentalDataSelection](src/legacy-data-selection.ts) 选择旧账模式，传入完整固定部署锁和底座源码归档原字节；归档SHA须等于该锁。所选Core仍由原安装包读取器核清单、来源和摘要。普通、新装与MCP默认入口不改变；旧库模式当前只支持单Rental及可选AI，MCP必须另有旧账/结构映射，不能借空库链启用。

[七表预检](src/legacy-public-upgrade.ts)读取完整原Prisma账和物理目录。260成功＋1指定恢复回滚只返回 `requires_original_three`，须先另获批准执行原三份历史增量；到263成功＋1原回滚且七表不存在才返回 `ready_for_seven_tables`。`selection.publicUpgrade().files()`给出原公共Core访问、绑定、限流三份SQL及MySQL锁文件；它们只有七表CREATE，不包含完整public initial。追加后必须有三条原名/原摘要成功账并通过七表字段/索引/CHECK检查；部分DDL、缺账、未完成账或摘要变化均拒绝继续。该方法不执行SQL、不写或resolve原账。

运行通过 `RentalAppModule.register({lock,aiMode:"disabled",legacy:selection})`；已选AI时沿原 `createRentalAiHostModule({lock,fresh:materials,legacy:selection,...})`，其中 `fresh`只提供已核新版本材料和物理计划，运行时明确使用legacy原账读取器，不能调用新装initialize。AI还须由同一正式数据/扩展材料的 `createRentalAiMysqlPlans`供给 `additionalPhysical:[{owner:"rental-ai-extension",read:plans.extension.readPhysical}]`。每次准入检查旧完整账、追加账及公共/Rental/所选AI/扩展实际物理合同，保留旧表与原账；不生成新装appliedMigrations。物理合同不等价时报告具体owner并停止，不能把七表完成视为整个组合已可运行。

[可信管理应用](src/legacy-access-management.ts)由[同一宿主](src/assembly.ts)构造，[管理HTTP](src/legacy-access-http.ts)仅在显式旧库模块挂载。所有路由为POST，根前缀 `/api/platform/rental-legacy/`，文档来自同一登记表。当前operator签名、原会话及租户管理权限必须有效：

| 操作 | 路径 | 原身份与输入 |
| --- | --- | --- |
| 准备租户授权 | tenant/prepare | SaaS与system:tenant:manage；tenantId |
| 准备成员/绑定 | members/prepare | 当前租户管理员或all范围且system:user:manage；空对象 |
| 补缺租户授权 | tenant/adopt | 同SaaS；confirmed、operationId、expectedRevision |
| 补缺成员分配 | members/adopt | 同租户管理；加userId |
| 建立原范围绑定 | bindings/adopt | 同租户管理；可选原workspaceId |
| 读原授权收据 | tenant/operation | 同SaaS；tenantId、原operationId |
| 读原成员收据 | members/operation | 同租户管理；userId、原operationId |
| 读原绑定收据 | bindings/operation | 同租户管理；可选workspaceId、原operationId |

`confirmed`由最近一次准备结果取 `tenantId/sourceFingerprint/coreFingerprint`。按租户授权→重新准备→逐成员分配→重新准备→逐范围绑定处理；每次调用均使用原expectedRevision和独立稳定operationId。原disabled/revoked记录保留，原角色、组织、地点和空间数据不重建，现有行业initializer不运行。失应答只查原operationId；不存在收据不证明可换键重做。

上线审批须固定双SHA/包摘要/完整锁、当次一致备份及恢复证明，再依次批准原三DDL、七表追加、只读桥接观察、单项授权映射及同锁API/Web切换。本工具不授权这些线上动作。旧镜像回退必须先核它能读取升级后的库且停止所有新旧写方；不删除新表或新收据来伪装回退，数据库恢复另走经验证的备份恢复。未完成的原unknown继续按原键调查，不因切换重发。
