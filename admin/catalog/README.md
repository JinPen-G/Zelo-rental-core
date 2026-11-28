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

待分配预约及订单条带详情在原订单可读时，取得同一快照的订单状态及履约方式，复用原 `orderQuickActions` 与 UIArc 行操作。按当前原权限定位确认、资源分配、交付、归还和续租入口；承运寄送不凭排班摘要开放续租，仍从原详情核寄送里程碑。当前状态随条带及详情显示，受限来源不返回这些订单字段。

快捷入口经注册订单路由携带原 `action` 提示，不自动选择车辆、打开提交或执行写入。订单页重新读取原状态、办理锁、候选及分配修订；续租/延期沿原试算、报价确认、补款和库存生效流程，不直接写时间。状态或权限变化沿原不可用提示处理。缺少订单摘要的兼容响应只保留原详情入口，不能推定动作可办。

筛选、列表、抽屉和动作使用公共 UIArc 适配。时间轴为 Rental 专属资源条带投影；公共出口目前没有可复用的只读 Gantt 组件，本地重建 Pro 项目甘特也没有只读合同，因此没有复制私有镜像或把项目拖拽接成订单写入。页面不宣称使用官方 Pro 原始 TSX；正式浏览器主题、窄屏及交互验收需授权宿主。

## 验证入口

类型检查消费 Rental 后台与原宿主入口。现有列表交互、导航术语和后台结构断言定位同一业务正文，原路由边界继续留在旧宿主。浏览器、真实 HTTP、对象存储与完整标准 Core 装配分别验收。[类型配置](<../tsconfig.json>) · [列表交互](<https://github.com/JinPen-G/Nativark/blob/1999dd8bb0cb84f07a6ef16935853aa895835ba0/tests/admin-list-interactions.test.cjs>) · [导航术语](<https://github.com/JinPen-G/Nativark/blob/1999dd8bb0cb84f07a6ef16935853aa895835ba0/tests/admin-navigation-terminology.test.cjs>) · [后台检查器](<https://github.com/JinPen-G/Nativark/blob/1999dd8bb0cb84f07a6ef16935853aa895835ba0/scripts/validate-react-admin.cjs>)
