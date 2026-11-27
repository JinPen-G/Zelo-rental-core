# Rental 与工单双 Core API

本宿主在同一公共底座、数据库和租户中装配 Rental 与 `example-tickets`，提供普通启动入口，供[双 Core 后台](../example-multi-core-admin/README.md)消费。Rental 原装配负责公共身份、Core 管理、完整租赁服务图及生命周期，工单通过静态接点提供原业务服务和八条 HTTP。每个 Core 分别核租户授权、成员分配、业务权限及原绑定。[Rental 宿主](../rental-api/README.md) · [工单 Core](https://github.com/JinPen-G/Zelo/blob/5a5df9bbbfd7a574f10d4906b305d0da279b939a/packages/example-tickets-core/README.md)

## 源码入口

- [普通启动入口](src/main.ts)调用[启动组合](src/bootstrap.ts)，复用 Rental 的配置、可信请求身份、员工路由、Guard 作用域、响应和退出排空。
- [应用组合](src/assembly.ts)仅选择固定锁中的 Rental 与工单，调用原 `composeRentalApplication`。工单沿[固定包适配](src/tickets-core.ts)提供正式 server 出口、原迁移名和 SQL 物理观察，取得同一个数据库、Rental 认证源、公共审计与订阅策略。
- [普通 Nest 根模块](src/app.module.ts)沿 `RENTAL_HOST_ASSEMBLY` 注入工单原绑定，公共目录及两 Core 的 OpenAPI 由原组合入口生成。
- 工单 Controller → 服务 → SQL 事务与仓储沿[工单模块说明](https://github.com/JinPen-G/Zelo/blob/5a5df9bbbfd7a574f10d4906b305d0da279b939a/packages/example-tickets-core/README.md)读取。Rental HTTP、业务与历史恢复沿[Rental 源码路线](https://github.com/JinPen-G/Zelo-rental-core/blob/990697b4d430fed38a6a086205848b21a585b4ac/README.md)读取。

## 固定组合与数据准备

部署锁须且仅须包含 Rental 与 `example-tickets` 两个固定发行包。包摘要、完整清单、正式 server 出口、数据计划和 HTTP 贡献由原宿主校验。缺材料或兼容冲突使组合拒绝，物理观察缺失保持 unavailable。

普通构建使用固定部署材料的所选 schema 与同版 Client 声明。工单沿原 raw SQL 迁移及物理 reader 访问自己的三张表。迁移准备复用原 Rental 部署材料入口，实际构建、迁移、注册及授权分别办理。[所选 schema 与固定材料](../rental-api/README.md)

普通启动入口显式选择 `RENTAL_AI_MODE=disabled`。启动沿 Rental 原进程配置，`RENTAL_DEPLOYMENT_LOCK` 指向双 Core 固定锁的绝对路径。数据库、认证、端口和 CORS 的要求见[原启动配置](../rental-api/src/bootstrap.ts)。普通工单通过原授权入口运行。

## 构建与启动

先按 Rental 宿主说明准备所选 schema、Client 和两 Core 的固定包。先用[双仓开发入口](https://github.com/JinPen-G/Zelo-rental-core/blob/main/README.md#rental-与工单双-core-示例)生成 `multi-core` 工作区。在解包后的组合根目录，将编译链指向已生成的同一 Rental Client。

```powershell
$env:RENTAL_PRISMA_CLIENT = (Resolve-Path 'apps/rental-api/generated/client/index.d.ts').Path
npm run build:example-multi-core-api
```

原 prebuild 依次消费 Rental 与工单的正式构建链。配置好上一节的进程变量和双 Core 部署锁后，用本宿主的启动入口运行。

```powershell
npm run start -w @rental-os/example-multi-core-api
```

## 历史 AI 与原断言

旧双 Core AI 使用其原数据协议。需复查时使用[完整历史提交 `46db0945…`](https://github.com/JinPen-G/Zelo/tree/46db0945dee92ac916f7265e95948943fc8b641d)，按该版本的宿主说明运行。当前组合只支持普通开发；不把新装 AI 或 MCP 数据链用到旧双 Core。原双 Core 与宿主回归见[历史验证入口](https://github.com/JinPen-G/Zelo-rental-core/blob/main/README.md#原宿主和四端测试)。

## 授权与恢复

先注册固定组合，再由 SaaS 管理员授权租户，由租户管理员为成员分别分配 Core。成员的业务角色和 Rental 经营空间仍沿各 Core 的原范围判断。同租户持有两 Core 不授予跨 Core 业务读取。

停用一个 Core 时，另一 Core 继续按当前条件运行。停用和重新授权保留原数据、配置、绑定及操作收据。原工单收据通过当前主体与对象权限只读核对，unknown 沿原操作恢复。租户统一订阅期限仍由公共策略提供。

## 验证入口

所选类型检查复用[内存类型入口](https://github.com/JinPen-G/Zelo/blob/5a5df9bbbfd7a574f10d4906b305d0da279b939a/scripts/check-selected-prisma-types.cjs)，普通入口采用 `rental` 模式。定向冒烟沿原固定包、公共身份与 SQL 夹具核同图装配、双授权、成员分配、停用和原收据，发布包与根装配沿同一原宿主验证。验证层级分别记录，实际 HTTP、数据库、冷安装和部署仍按对应环境验收。
