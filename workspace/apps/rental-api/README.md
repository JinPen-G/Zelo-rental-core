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

在包含 v2 构建工具的固定 Zelo 检出，执行上面的命令，在 `--development` 后追加 `--fresh-ai`。用同一组 Git SHA 和 `--fresh-ai --profile host` 准备后台源码。API 运行包保存两个来源、编译证明、公共 AI 数据包和四阶段原 SQL：公共 14、Rental 2、公共 AI 1、Rental 扩展 1。

使用专用空库，按包内说明生成两份 Client、应用锁定的 18 条迁移并初始化 SaaS。设置 `RENTAL_AI_MODE=enabled`，`RENTAL_DEPLOYMENT_LOCK` 指向完整 v2 锁，`RENTAL_PUBLIC_AI_DATA_PACKAGE_DIR` 指向同包的 `public-ai-data`。先执行 [品类初始化](src/ai-fresh-initialize.ts)，再运行 [新装入口](src/ai-fresh-main.ts)。后台使用同一部署锁、数据包及已核标准 Rental 包，执行 `build:fresh`。旧库继续使用原 SQL、原锁与原账，不能直接重跑新装材料；本模式暂不提供就地升级或 MCP。

当前新装扩展为 [20261127000000](prisma/ai-extension/20261127000000-initial.sql)。它只修正 MySQL 对中间 `CHECK` 布尔类型的要求，末态约束与原方案相同；前版 [原 SQL](prisma/ai-extension/20261126000000-initial.sql) 及其 [来源](prisma/ai-extension/provenance.json)保留，不作为可执行的新装文件。

- [启动](src/main.ts) → [宿主装配](src/app.module.ts) → [同实例应用](src/assembly.ts)与[所选数据访问](src/database.ts)
- [实际 HTTP 策略](src/http-policy.ts)、[兼容路径和 OpenAPI](src/openapi.ts)
- [部署材料准备](src/prepare-deployment.ts)只产出待部署材料，不连接、迁移或改写原账；[公开包工厂接点](src/package.ts)复用领域包的实际文档与构建材料。

旧组合和已发布版本继续使用各自固定来源。本目录不是独立安装目录，构建和运行命令统一在准备后的组合中执行。
