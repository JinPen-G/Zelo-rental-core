# Rental 养护工单页面

本模块提供养护工单列表、看板、详情、历史、归还处置及原操作表单。页面通过公共 `CorePage` 声明主操作，表单通过 `useCoreForm` 共用确认与原生提交。HTTP、权限和经营空间来自宿主当前会话。前端入口的同伴依赖按原宿主版本声明为可选，领域总出口不会加载 React、后台或 MySQL 适配。

## 接入

从 `@rental-os/rental-core/admin/work-orders` 导入 `createRentalWorkOrdersAdminContribution`，传入发布清单的实现版本，以及返回 [RentalWorkOrderPageContext](<page-context.ts>) 的宿主 Hook。将结果与同版本清单交给公共 `registerCoreAdminPages`，菜单、标题和详情父级共同读取 [页面声明](<pages.ts>)。宿主只读取菜单/路由时从 `/admin/work-orders/pages` 导入，避免提前加载页面及看板；原营运菜单、路由和面包屑沿同一声明投影，兼容权限码与页面入口共用同一映射。

宿主 Hook 提供以下当前事实。

| 字段 | 来源与用途 |
| --- | --- |
| `api` | [createRentalWorkOrderApi](<client.ts>) 消费宿主唯一认证请求，保留 `/rental/v1` 方法与载荷 |
| `scopeKey`、`currentScopeKey` | 当前租户、成员、经营空间及权限快照，隔离查询与浏览器看板排序，并核对旧手势 |
| `operationScopeKey` | 从已验证会话生成的租户、经营空间和账号稳定键，用于刷新后的原操作定位；会话变化仍由 `currentScopeKey` 核验。缺失时独立养护创建不可用 |
| `permissions` | 当前维护、验收、订单读取及库存恢复权限，标准宿主同时核 Core 授权、成员分配和就绪 |
| `openOrder` | 由本宿主已登记订单页面生成的受控导航 |

页面标识为 `rental:work-orders` 与 `rental:work-order-detail`。标准登记生成 `/cores/rental/work-orders` 和带 `workOrderId` 的详情路径。详情引用列表作为父级，当前受权工单的 `workNo` 提供动态标题。列表及详情动作使用宿主同一语言目录，切换语言时保留原按钮文案。

列表页签、刷新和视图切换保留原 `viewBar` 与 `Space` 布局；刷新通过 `CorePageActions` 的正文插槽呈现，继续使用公共动作驱动。“新建工单”保持顶部主操作及原图标。详情“派工”和“取消工单”沿原 `tools` 插槽呈现，“开始处理”“提交验收”“验收”按原状态进入主操作区，返回列表使用正文起点的 `navigation` 插槽。

[原营运宿主薄适配](<https://github.com/JinPen-G/Nativark/blob/1999dd8bb0cb84f07a6ef16935853aa895835ba0/apps/admin/src/features/rental-core/MaintenanceWorkOrdersPage.tsx>)保留 `/rental/work-orders`、详情深链接和 `tab=history`。它读取原 `rental-core:maintenance:view/manage/review`、`rental-os:order:view` 与库存恢复权限，将原会话代次和路由对象交给公共页面边界。页面登记负责定位，实际使用权沿当前会话与服务端核验。

## 源码路线

| 入口 | 职责与直接消费者 |
| --- | --- |
| [index.tsx](<index.tsx>)、[pages.ts](<pages.ts>) | 受控组件贡献、菜单、双语页名和详情父级，供宿主注册 |
| [MaintenanceWorkOrdersPage.tsx](<MaintenanceWorkOrdersPage.tsx>) | 原列表、详情、归还处置及六类表单，供标准贡献和原宿主共同消费 |
| [WorkOrderBoard.tsx](<WorkOrderBoard.tsx>)、[看板策略](<workOrderBoardPolicy.ts>) | 将受权工单映射到公共看板，手势请求原派工、开始、提交、验收或取消动作 |
| [client.ts](<client.ts>) | 工单及关联库存处置的十二个原 HTTP 方法，原 [rentalCoreApi](<https://github.com/JinPen-G/Nativark/blob/1999dd8bb0cb84f07a6ef16935853aa895835ba0/apps/admin/src/api/rentalCore.ts>) 转接同一工厂 |
| [HTTP 入口](<../../src/http-core.controller.ts>) → [应用接点](<../../src/http-applications.ts>) → [原核心服务](<../../src/mysql-core-runtime.ts>) → [事实仓储](<../../src/mysql-core-facts.ts>) | 原 Guard/ALS 身份、租户/空间/地点与资料范围、工单状态和库存事务 |

公共 [UI 出口](<https://github.com/JinPen-G/Nativark/blob/1999dd8bb0cb84f07a6ef16935853aa895835ba0/packages/platform-admin/src/components/ui/index.ts>) 提供原列表、详情栈、表单、浮层及看板。[CorePage](<https://github.com/JinPen-G/Nativark/blob/1999dd8bb0cb84f07a6ef16935853aa895835ba0/packages/platform-admin/src/core/CorePage.tsx>)负责当前页操作，[useCoreForm](<https://github.com/JinPen-G/Nativark/blob/1999dd8bb0cb84f07a6ef16935853aa895835ba0/packages/platform-admin/src/core/useCoreForm.ts>)负责真实提交、等待、失败及草稿快照。看板素材与构建适配的来源见[公共看板说明](<https://github.com/JinPen-G/Nativark/blob/1999dd8bb0cb84f07a6ef16935853aa895835ba0/packages/platform-admin/src/components/kanban-board/SOURCE.md>)。

## 交互与验证

列表、看板、详情和历史沿原查询及刷新入口读取。查询传递原 React Query 取消信号。派工候选按当前地点读取，目录失败保留工单本身。确认与表单提交复用同一个 `useCoreForm.submit`，字段校验结束后再次核对原弹窗、目标和会话。成功沿原刷新与退出时序处理，失败保留输入。

新建表单支持归还处置或独立资产二选一。独立养护通过 `GET /rental/v1/work-order-assets` 获取当前资料范围内的最小资产投影，不授予完整资产资料读取权；`POST /rental/v1/work-orders` 提交 `assetId`、`operationId`、原工单类型及原因。独立创建在原幂等事务内核对资产、处理人、已有分配及未分配预约容量；普通养护不覆盖已有订单冲突。

从资产或排班进入时，列表用 `assetId` 定位同一资产的工单与归还处置；详情、历史及返回列表保留该定位。有创建权限的操作人员点击“新建工单”后，原表单切至独立养护并带入资产，仍须当前受权候选和可用状态核定；加载、失权或状态变化不允许提交，也不会自动改选其他资产或执行创建。工单详情的排班入口另核资产页面权限。查询参数、卡片和工单读取权均不代替创建权限，原操作号、未知结果恢复及服务端库存冲突检查保持。

[独立创建恢复](manual-creation.ts)在发送前将原操作号和资产标识写入浏览器存储，不保存原因、附件或凭据。关闭、刷新及重新登录后，同一租户/空间/账号仍可核对；会话、权限或范围变化后的旧请求不能清除引用或导航。Web Locks 保持多页面互斥，存储不可用、损坏、被占用或缺少该浏览器能力时，阻止新的独立创建，原归还处置流程不受影响。原键未核清前仅提供只读回查，关闭弹窗、超时和查无收据均不会换键重发，也不自动重放认证失败的创建请求。

`GET /rental/v1/work-order-creation-receipt?assetId=...` 携带原 `Idempotency-Key`，复用 `work_order.create_manual` 幂等账。需要当前 Core 准入与 `rental-core:maintenance:view`，并核原创建者、当前租户/空间及原工单地点/本人范围。返回 `RentalWorkOrderCreationReceipt`：`committed` 只含原操作号、资产与工单标识，工单后继状态从现有详情读取；`unknown` 表示尚无可确认收据，不证明未创建。权限撤回或事实不符时拒绝返回，浏览器继续保留原引用。该读口不新增停用后的善后权限或独立业务账。

独立来源沿原派工、开始、提交和验收流程。取消只结束工单，保留维护限制；验收通过后，仅在没有其他工单、归还隔离或有效分配，并且最新状态来源仍可追溯到已验收的独立工单时，解除这组工单施加的隔离。手工停用、检查与其他来源不会被覆盖。此入口暂用于立即开始、等待实际验收的养护；计划区间、延期与紧急停用另沿车辆管控合同扩展。

在依赖就绪的仓库根目录运行前端类型与已有定向冒烟。

```powershell
npx --no-install tsc -p packages/rental-core/admin/tsconfig.json
node --no-compilation-cache --test tests/admin-work-order-board.test.cjs
```

[既有冒烟](<https://github.com/JinPen-G/Nativark/blob/1999dd8bb0cb84f07a6ef16935853aa895835ba0/tests/admin-work-order-board.test.cjs>)覆盖原流转门槛、筛选后个人排序、旧宿主薄适配、弹窗退出与提交、重复提交、迟到校验，以及保留看板的实际键盘处理。浏览器、真实 HTTP/数据库与标准组合验收按实际环境核对；公共接入步骤见[Core接入手册](<https://github.com/JinPen-G/Nativark/blob/1999dd8bb0cb84f07a6ef16935853aa895835ba0/packages/core-contracts/README.md#%E4%BA%94%E6%AD%A5%E5%BF%AB%E9%80%9F%E6%8E%A5%E5%85%A5>)。
