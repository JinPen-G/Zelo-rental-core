# Rental AI 事务适配

本包只在选择 Rental 且显式启用 AI 时进入组合。它使用 Zelo 公共 SDK 的批准持久层、事务参加者及平台保留 HTTP 出口。批准、Task、结果及保留账继续使用原表与原键。订单与订单幂等收据由 Rental Core 查询，原 Core 事务持有业务和批准消费锁。

[平台保留适配](src/platform-retention.ts)承接已登记的三个原平台维护路由，复用所选宿主的 SaaS Guard 和签名会话。[同事务参加者](src/platform-management-transaction.ts)从原 Core 围栏及同一 Native 的账号仓储复核当前身份和权限。提交前撤权回滚，提交状态不明时从原删除收据核对。正文保护维持原存储身份、摘要和时间，已保护的正文可按原游标重看。

| 独立源码 | 原 Zelo 兼容来源（ai-native-server/src/runtime 下） |
| --- | --- |
| approval-binding.ts | proposal-binding-draft.ts |
| proposal-repository.ts | ai-proposal-repository.ts |
| approval-repository.ts | ai-approval-repository.ts |
| approval-consumption.ts | prisma-approval-consumption.repository.ts |
| task-events.ts | ai-task-event.repository.ts |
| task-transactions.ts | task-transaction-authority.ts |
| task-deployment-admission.ts | rental-adapters/task-deployment-admission.ts |
| platform-management-transaction.ts | rental-adapters/platform-management-transaction.ts |
| platform-retention.ts | privacy/platform-retention.service.ts |
| approval-tool-codes.ts | 原 Shared C05 已发布动作词汇，保持字面量，不用于运行时注册 |

[Rental 公共保留入口](../../apps/rental-api/src/ai-public-retention-main.ts)由[专用编译配置](../../apps/rental-api/tsconfig.public-retention.json)选入，沿原 18 条新装数据锁启动。它把此包的请求工厂交给原平台保留处理器，继续复用原三个路由、权限、部署检查和原事务。其余 AI 操作仍由宿主已选的兼容 Runtime 提供。普通组合和原 18／23 条入口继续使用各自原模块。

选装组合需要同时固定两份同名发行：宿主继续解析兼容 `@rental-os/ai-native-server@0.1.0`，本包解析从同一固定 Zelo 源码单独构建的公共 `@rental-os/ai-native-server@0.2.1`。构建应将公共版限定为本包的依赖，并共用同一实际 `platform-server`、Rental Core 和所选 Prisma Client。双仓工具登记后，选装产物入口为 `apps/rental-api/dist-ai-public-retention/ai-public-retention-main.js`。

部署选择仍用原 `holdAiTaskDeploymentAdmission`：新工作核实际 Core accepting；已有 Task 控制不获得新工作许可。此包只迁出上述参加者。原完整场景和知识对象授权的宿主还沿旧组合。独立构建由宿主使用原 selected Prisma Client，公共包从它自己的公共 Client 编译后交正式声明。不要将 `tsconfig.json` 的源码别名指向 Zelo 旧混合包。
