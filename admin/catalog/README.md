# Rental 商品与资产后台

商品目录、实物资产、状态历史和数量库存共用包内页面与客户端。品类字段、套装组成、库存模式、单位和原状态载荷沿原实现，数量余额和处置限制读取服务端事实。[页面贡献](<index.tsx>) · [页面声明](<pages.ts>) · [请求工厂](<client.ts>)

## 宿主接入

宿主用 createRentalCatalogPageContext 供给当前 AdminRuntime、唯一图片读取方法、包含租户与经营空间的 scopeKey，以及当前身份读取函数，再将上下文交给 createRentalCatalogAdminContribution。图片方法使用宿主现有鉴权传输，返回原 Blob，并接收查询取消信号。上下文在 JSON 和图片请求前后复验同一页面身份。[上下文](<page-context.ts>) · [原宿主上下文](<https://github.com/JinPen-G/Nativark/blob/1999dd8bb0cb84f07a6ef16935853aa895835ba0/apps/admin/src/features/catalog/legacy-catalog-context.ts>) · [原鉴权图片读取](<https://github.com/JinPen-G/Nativark/blob/1999dd8bb0cb84f07a6ef16935853aa895835ba0/apps/admin/src/api/rentalCore.ts>)

商品页使用 catalog/view 和 catalog/manage，资产与库存页使用 asset/view 和 asset/manage。原宿主继续使用 rental-core:catalog:view、rental-core:catalog:manage、rental-core:asset:view 和 rental-core:asset:manage，兼容地址为 /rental/item-groups 与 /rental/assets。宿主将两页和已有业务页面合并为同一 Rental 贡献，菜单顺序从原养护分组声明投影。[旧路由适配](<https://github.com/JinPen-G/Nativark/blob/1999dd8bb0cb84f07a6ef16935853aa895835ba0/apps/admin/src/features/catalog/legacy-catalog-page.tsx>) · [统一 Rental 贡献](<../index.tsx>)

原管理后台的目录薄适配将主页面以及价格、订单和地点等附属标准权限通过唯一原权限映射交给当前 Auth 检查，目录和资产资源共用同一检查入口。范围变化、跨 Core 和未登记权限继续拒绝，权限码映射本身沿正式目录维护。[原权限映射](<../../src/permissions.ts>) · [旧宿主权限复验](<https://github.com/JinPen-G/Nativark/blob/1999dd8bb0cb84f07a6ef16935853aa895835ba0/apps/admin/src/features/catalog/legacy-catalog-page.tsx>)

当前品类的商品、资产、定价与履约导航术语由同一纯模块组合，页面标题消费其结果。[导航术语](<navigation-terminology.ts>)

## 编辑与读取

三个表单复用现有编辑驱动，保存按钮与回车共用本次打开代次的校验及真实请求 Promise。型号先保存原对象，再逐张上传待选照片，已返回的型号 ID 和已完成照片留在当前代次，照片失败时保留输入与剩余文件。库存作业继续使用每次打开生成的原 idempotencyKey，保存载荷保留作业类型、数量、盘点零值、地点、批次与原因。[型号页面](<CatalogPage.tsx>) · [资产页面](<AssetWorkspacePage.tsx>) · [库存作业](<StockOperationsPanel.tsx>) · [编辑驱动](<../orders/useOrderEditor.ts>)

型号列表以型号、经营资料和品类查询处理加载与错误。定价归属是附属读取，由当前已验证 Core 页面宿主核对 price/manage、order/view 或 order/create，请求前后复验权限与页面身份。表格、卡片及其预览分别呈现读取受限、未能读取或正在读取，只有成功取得分组数组后才显示真实归属或未加入分组。刷新重读必需资料及当前有权的分组，附属失败保留在归属展示中，编辑草稿沿原代次保留，创建与编辑仍要求原必需品类事实。[型号查询与刷新](<CatalogPage.tsx>) · [卡片归属](<catalogCards.tsx>) · [页面宿主](<https://github.com/JinPen-G/Nativark/blob/1999dd8bb0cb84f07a6ef16935853aa895835ba0/packages/platform-admin/src/core/useCoreSession.ts>) · [原服务端权限](<../../src/http-auth.ts>)

资产与库存主列表独立读取本页业务记录、经营资料和品类。附属型号目录沿 catalog/view、catalog/manage、order/view 或 order/create，地点目录沿 station/view，通过同一当前宿主核对后才请求，手动刷新与请求完成也复验权限和身份。主记录已经投影的型号与地点名称继续显示，缺失引用名称、图片或单位资料时明确呈现读取受限、等待或未获取，失败时撤下旧附属缓存。刷新恢复当前有权的附属资料，资产编辑及库存作业仍要求原管理权限、完整必需查询和原表单校验，原打开代次及幂等键保留。[资产与库存查询](<AssetWorkspacePage.tsx>) · [卡片引用](<assetCards.tsx>) · [库存保存与流水](<StockOperationsPanel.tsx>)

图片、资产状态历史和库存流水查询传递取消信号，缓存键绑定当前会话与经营空间。照片组件将对象 URL 绑定生成它的查询身份和原字节，身份或字节切换的首帧撤下旧图，并在替换和卸载时释放。订单等旧消费者通过同一照片薄适配接入当前宿主。[照片组件](<ItemGroupPhoto.tsx>) · [旧照片入口](<https://github.com/JinPen-G/Nativark/blob/1999dd8bb0cb84f07a6ef16935853aa895835ba0/apps/admin/src/features/catalog/ItemGroupPhoto.tsx>)

[资产详情](AssetDetailPage.tsx)登记为 `asset-detail`（`/assets/:assetId`），父级和原权限沿资产页。通过原受权资产列表定位当前对象，使用原状态历史及另经 `maintenance:view` 核定的工单读取；没有授予新业务权限或新服务端路由。当前对象不存在、读失败或范围变化时撤下旧详情，未获养护权限不请求或展示其缓存。查询及刷新在原请求工厂之外复验当前页面存续和权限，历史显示原记录时间及其偏移，不套浏览器时区；状态历史沿服务端最近200条上限，缺记录不解释为过去没有限制。

详情沿公共 `RecordDetailLayout`、`RecordFacts`、Tabs和Table组织当前状态、状态历史与养护记录；原资产列表/卡片、甘特抽屉及工单详情互相定位同一资产。导航目标由当前注册表解析，卡片先退出预览再进入详情。库存限制常显，工单完成或计划结束均不在页面推导恢复可租，处理和验收进入原养护页面；详情本身没有写入。真实浏览器主题、键盘、窄屏和原业务HTTP仍需分别验收。

## 列表与来源

页面、卡片和列表预检从 `@rental-os/platform-admin/ui` 使用原图标、`ADMIN_TABLE_COLUMN_WIDTH`、卡片事实组件与 `ListPreflightError`。设置分区从 `/forms` 使用同一 `SettingsWorkspace`，字段、动作插槽和样式由原实现供给。[UI 出口](<https://github.com/JinPen-G/Nativark/blob/1999dd8bb0cb84f07a6ef16935853aa895835ba0/packages/platform-admin/src/components/ui/index.ts>) · [表单出口](<https://github.com/JinPen-G/Nativark/blob/1999dd8bb0cb84f07a6ef16935853aa895835ba0/packages/platform-admin/src/forms.ts>)

导出字段、只新增导入、已存在编码检查、批量状态及修订预检沿原逻辑。批量保存前重新读取资料和当前管理权限，原重复冲突由同一错误判断处理。[列表能力](<listCapabilities.ts>) · [旧列表能力入口](<https://github.com/JinPen-G/Nativark/blob/1999dd8bb0cb84f07a6ef16935853aa895835ba0/apps/admin/src/features/listCapabilities.ts>)

型号、资产和数量库存卡片保留原浏览、只读预览、关闭后命令与图片切换。按钮消费公共原生 UIArc 出口，样式与固定图片来源保留同一字节版本及许可说明。[型号卡片](<catalogCards.tsx>) · [资产与库存卡片](<assetCards.tsx>) · [图片来源](<archive/product-listing/SOURCE.md>)

原媒体及来源入口供既有导读沿原路径读取。导读转向本模块后可移除这两处薄转接。[原媒体入口](<https://github.com/JinPen-G/Nativark/blob/1999dd8bb0cb84f07a6ef16935853aa895835ba0/apps/admin/src/features/catalog/CatalogCardMedia.tsx>) · [原来源入口](<https://github.com/JinPen-G/Nativark/blob/1999dd8bb0cb84f07a6ef16935853aa895835ba0/apps/admin/src/features/catalog/archive/product-listing/SOURCE.md>)

## 资产排班

[排班页面](AssetSchedulePage.tsx)由同一目录贡献登记为 `asset-schedule`（`/asset-schedule`），沿原 `asset:view` 权限及当前会话请求工厂读取 `GET /rental/v1/asset-schedule`。查询接受带时区偏移的 `startAt/endAt`（半开区间、最多93天）、`locationId/itemGroupId/assetId/keyword/status/page`，返回经营空间时区、50行资产页、完整范围容量和待分配预约。库存资产最多2000条、每种关联事实最多10000条；超限明确拒绝，不显示部分事实为可用。公开类型从 `@rental-os/rental-core` 导出。[合同](../../src/asset-schedule.ts) · [原事实读取](../../src/mysql-asset-schedule.ts)

资产列表和卡片可进入所选资产的排班或养护工单，排班抽屉也可打开同一资产的养护列表。目标从当前注册表解析，点击时重新核当前范围和目标页面权限；卡片先完成原预览退出。两页的 `assetId` 查询参数仅定位对象，读取继续沿各自原 API 和服务端范围，资产筛选不缩小排班的完整型号/地点容量。清除资产筛选可返回全部受权资产。

日/周/月的日界沿 Core 营业时区函数；容量沿原同时占用峰值及历史缓冲计算，未分配预约计入容量，逾期已履约预占保持无确定结束。资产状态筛选、编号搜索与分页只影响车辆行，不缩小容量分母。当前维护/停用等限制的起止时间没有可靠历史时明确未定；工单条带表示原生命周期，不把计划时间或取消工单当成库存释放证据。页面观察的是读取时的当前库存事实，不是任意过去日期的完整历史回放，也不代替提交时的事务复核。

资产归属、资产状态、预占、分配与可读来源在同一 `RepeatableRead` 只读事务中取得，避免并发归还/养护提交时把不同提交时点的行拼成空闲。查询和来源权限在等待前固定，事务内及返回后仍复验原身份与地点范围；现有HTTP准入和响应前复验继续生效。快照一致不表示可以按旧页面直接配车，正式提交仍由原订单命令重核当前事实。

资产行的 `overlaps` 返回同时分配到该资产的有效预占重叠时段及数量。计算共用原库存的半开区间事件、历史缓冲和逾期未释放口径，每条预占只计一次，查询边界外的区间被裁剪；首尾相接不产生重叠。每页重叠分段同样限10000条，超限拒绝。甘特行、列表及详情显示文字提示和具体时段，不额外暴露受限订单标识；没有重叠提示不代表车辆可租。可读工单以原 `workOrderType` 区分清洁、维修等处理过程。

订单/工单来源编号分别核原 `order:view` / `maintenance:view` 以及原对象地点/本人范围；没有来源权限只返回容量所需占用，不返回客户信息。点击已授权来源通过注册导航进入原订单或工单，分配、改配和计价改期仍由原流程确认。每个条带是可聚焦按钮，并提供列表和详情作为键盘/窄屏入口；失败撤下旧数据，不解释为空闲。

人工管控条带合并关联工单的展示，负责人只从同一快照内、同一资产的受权原工单投影；工单已验收但管控尚未解除时仍可显示。没有原工单读取权限或对象不在范围内时不返回负责人，也不为无工单管控推定负责人。该条带的“管控详情”进入原管控页面，工单条带继续进入原工单。

排班页面在自动查询、刷新和重试的请求前后核当前资产读取权、会话及页面存续；撤权立即撤下排班、筛选资料和详情。订单/工单读取权参加缓存区分，变化期间返回的旧投影不进入当前结果。原页面卸载、范围变化或快照已更新后，旧导航及续租回调失效；这些前端检查不替代服务端的对象范围与业务授权。

待分配预约及订单条带详情在原订单可读时，取得同一快照的订单状态及履约方式，复用原 `orderQuickActions` 与 UIArc 行操作。按当前原权限定位确认、资源分配、交付、归还和续租入口；承运寄送不凭排班摘要开放续租，仍从原详情核寄送里程碑。当前状态随条带及详情显示，受限来源不返回这些订单字段。

快捷入口经注册订单路由携带原 `action` 提示，不自动选择车辆、打开提交或执行写入。订单页重新读取原状态、办理锁、候选及分配修订；续租/延期沿原试算、报价确认、补款和库存生效流程，不直接写时间。状态或权限变化沿原不可用提示处理。缺少订单摘要的兼容响应只保留原详情入口，不能推定动作可办。

可续租订单在真实归还末端位于视窗内、且与原订单有效结束时间一致时提供[末端拖动](ScheduleExtensionHandle.tsx)。拖动只显示带文字的虚线建议，原排班保持原事实；Esc、指针取消、页面卸载或重新读取使手势失效。条带详情和待分配区域的“准备续租时间”使用同一[分钟数表单](ScheduleExtensionPreparation.tsx)，可用键盘和触屏操作；营业时区显示保持一致，建议按真实经过分钟计算，夏令时不按本地日期猜算。续租作用于整张订单，不能当成单辆资产改期。无结束时间、截断条带和缺结束依据的兼容响应仍可进入原订单办理。

经确认的建议通过当前运行实例内的一次性引用和注册订单路由传递；URL仅含引用，不携带身份、时间或授权字段。刷新后不恢复建议。原订单重新核状态、履约方式及有效结束时间，用户显式采用后才预填原续租表单；不同订单、范围变化或旧建议不能覆盖表单，报价、付款和库存仍由原服务执行。承运寄送继续在原详情核真实寄送里程碑，不从排班推断可续租。订单结束时间仅从同事务的受权订单读取，受限来源不返回该字段。

筛选、列表、抽屉和动作使用公共 UIArc 适配。时间轴为 Rental 专属资源条带投影；公共出口目前没有可复用的只读 Gantt 组件，本地重建 Pro 项目甘特也没有只读合同，因此没有复制私有镜像或把项目拖拽接成订单写入。页面不宣称使用官方 Pro 原始 TSX；正式浏览器主题、窄屏及交互验收需授权宿主。

## 人工管控中心

[管控页面](AssetControlsPage.tsx)登记为 `asset-controls`（`/asset-controls`），资产详情、排班条带和菜单可定位同一资产/管控。使用公共UIArc表格、筛选、日期选择、抽屉、确认和原表单驱动；没有引入本地重建Pro源码或新日历库。时间按服务端返回的经营空间时区输入和显示，非存在的夏令时当地时刻拒绝提交。

新建、紧急停租、延期、取消未来管控和解除分别调用原命令。管控类型可配置阻租、工单与验收要求，每张管控冻结创建时的规则；须验收的类型必须关联原工单。计划结束不自动释放，延期不改旧履历，同车多条限制在库存中按区间并集合并为一次占用。原工单继续承担派工、处理、附件和验收；工单完成后仍从本条管控解除，其他限制及订单保留。[合同](../../src/asset-controls.ts) · [原事务仓储](../../src/mysql-asset-controls.ts)

管控详情显示最近200条原操作履历，包括原因、操作者标识、修订与时间。使用公共Table的展开行核对原操作号、变更前后区间、状态及冻结的恢复条件；未记录的历史明确显示缺失，不从当前管控或当前类型补齐，也不把当前人员姓名当成历史姓名。展开只展示已受权读取的原履历，不执行写入。

普通命令在原资产锁内核原分配和预约峰值。冲突只投影当前有权读取的订单编号、标识与状态，进入原订单处理。紧急停租必须显式拥有 `rental-core:asset:control:emergency` 并确认原因；管理员标志或通配权限不能替代此码。不自动取消订单、退款或调车。页面读权由 `page.asset-controls/view` 映射原资产、养护或管控权限；写入另核 `asset.control/manage|configure|emergency`。[唯一权限映射](../../src/permissions.ts)

HTTP公开读口为 `asset-control-types`、`asset-control-options`、`asset-control-assignees`、`asset-controls` 及管控的 `history/conflicts`，均位于 `/rental/v1`。写口使用 `operationId/expectedRevision/reason`；`GET asset-control-operations/:operationId?action=...&targetId=...` 读取本人原账，targetId在创建时是资产、类型保存时是code、其他动作是管控ID。收据确认原修订，当前状态另读；unknown不代表可以重发。原Core停用准入未放宽。[HTTP合同](../../src/http-openapi-asset-controls.ts) · [原账适配](../../src/asset-control-application.ts)

宿主通过 `operationScopeKey` 提供已验证的租户/空间/账号稳定引用，查询代次继续使用 `scopeKey/currentScopeKey`。[恢复驱动](asset-control-operation.ts)在发送前保存原键、动作、目标和修订，不保存原因或凭据；Web Locks隔离多页面。未知结果、损坏引用、浏览器存储或协调能力不可用时阻止新命令。可解释的业务拒绝先回滚本命令保存点，再把 `rejected` 结论提交到原幂等账；只有 `committed/rejected` 原收据或已确认拒绝响应才清除引用。查无收据、关闭、刷新、认证失败或提交不明不会自动重做，历史拒绝不重复返回原时点的订单字段。

迁移和真实环境前置见[数据说明](../../prisma/README.md#人工管控开发数据)。本页面已有类型及离线验证，浏览器主题、语言、键盘、窄屏与真实HTTP/MySQL并发须在授权宿主另验。

## 验证入口

类型检查消费 Rental 后台与原宿主入口。现有列表交互、导航术语和后台结构断言定位同一业务正文，原路由边界继续留在旧宿主。浏览器、真实 HTTP、对象存储与完整标准 Core 装配分别验收。[类型配置](<../tsconfig.json>) · [列表交互](<https://github.com/JinPen-G/Nativark/blob/1999dd8bb0cb84f07a6ef16935853aa895835ba0/tests/admin-list-interactions.test.cjs>) · [导航术语](<https://github.com/JinPen-G/Nativark/blob/1999dd8bb0cb84f07a6ef16935853aa895835ba0/tests/admin-navigation-terminology.test.cjs>) · [后台检查器](<https://github.com/JinPen-G/Nativark/blob/1999dd8bb0cb84f07a6ef16935853aa895835ba0/scripts/validate-react-admin.cjs>)

管控的未来开始与计划结束沿Rental后台共用[营业时点转换](../business-date.ts)和公共DatePicker确认入口。新输入遇夏令时重复/不存在时点保留输入并拒绝提交，不按浏览器时区猜选；编辑期间营业时区变化也须重新核对。计划结束仍只是计划，不自动解除管控。
