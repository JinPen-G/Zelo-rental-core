# Rental AI 事务适配

本包只在选择 Rental 且显式启用 AI 时进入组合。它使用 Zelo 公共 SDK 正式出口 `runtime/public-approval-persistence` 和 `runtime/public-rental-adapter-ports`。批准、Task、结果和保留账继续使用原表与原键。订单与订单幂等收据由 Rental Core 查询，原 Core 事务持有业务和批准消费锁。

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

部署选择仍用原 `holdAiTaskDeploymentAdmission`：新工作核实际 Core accepting；已有 Task 控制不获得新工作许可。此包只迁出上述参加者。原完整场景和知识对象授权的宿主还沿旧组合。独立构建由宿主使用原 selected Prisma Client，公共包从它自己的公共 Client 编译后交正式声明。不要将 `tsconfig.json` 的源码别名指向 Zelo 旧混合包。
