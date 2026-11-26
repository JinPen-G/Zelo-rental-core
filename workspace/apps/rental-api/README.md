# Rental 独立 API

这是 Rental 的普通业务宿主，使用同一所选 Prisma Client 连接 Zelo 公共能力与 Rental 业务。授权、订单、库存、原收据和后台所用接口仍走原处理器。宿主不启用 AI/MCP；兼容的 AI 数据读取代码仅用于明确的准备和检查，不能据此认定已装配 AI。

先按照[双仓准备步骤](https://github.com/JinPen-G/Zelo-rental-core#源码开发工作区)从固定版本准备 `host` 或 `full`，在解包后的组合根目录安装锁定依赖并执行 `npm run check:types`。构建前按[原宿主开发说明](https://github.com/JinPen-G/Zelo/blob/ee15ae5f1441836977ea1085fdce17f3e011efb3/apps/rental-api/README.md)分别准备公共与所选 Rental Client，明确设置 `RENTAL_PRISMA_CLIENT` 后执行 `npm run build`；不要使用默认 Prisma Client。构建无需启动服务。部署和运行 `npm run start -w @rental-os/rental-api` 还须准备固定 Core 包、部署锁、数据库和原迁移账。

- [启动](src/main.ts) → [宿主装配](src/app.module.ts) → [同实例应用](src/assembly.ts)与[所选数据访问](src/database.ts)
- [实际 HTTP 策略](src/http-policy.ts)、[兼容路径和 OpenAPI](src/openapi.ts)
- [部署材料准备](src/prepare-deployment.ts)只产出待部署材料，不连接、迁移或改写原账；[公开包工厂接点](src/package.ts)复用领域包的实际文档与构建材料。

旧组合和已发布版本继续使用各自固定来源。本目录不是独立安装目录，构建和运行命令统一在准备后的组合中执行。
