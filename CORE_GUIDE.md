<!-- 仓库阅读版，源码入口链接对应公开仓库。随包指南使用发行包内的运行入口。 -->

# Rental Core · Core 接入指南

Core `rental`，当前发行 [0.1.15](https://github.com/JinPen-G/Zelo-rental-core/releases/tag/v0.1.15)，生成器合同 `0.1.1`。固定包的宿主步骤见[独立 API 导读](workspace/apps/rental-api/README.md)。

下文通用示例引用[编写时的固定底座接入手册](https://github.com/JinPen-G/Zelo/blob/3fee227517a2b20e18a426e853f18cdf37cb63ff/packages/core-contracts/README.md)。本次发行 Core 来自[固定提交](https://github.com/JinPen-G/Zelo-rental-core/commit/7e20d6ef0b206e16a9162f4a2a6e88c13cbc0497)；随附的 `CORE_GUIDE.md` 以正式包为准。

## 当前可执行入口

在已准备依赖的底座源码根目录构建合同包，然后检查解包目录。检查只读取文件和合同，不代表授权或业务已运行。

```sh
npm run build -w @rental-os/core-contracts
node packages/core-contracts/dist/capabilities.js --query CorePage --json
node packages/core-contracts/dist/check.js <Core目录> --host <宿主版本JSON> --json
node packages/core-contracts/dist/plan-update.js <当前锁JSON> <升级请求JSON> <数据观察JSON> --json
```

按下面五步准备、装配和授权。包检查、数据库部署与实际业务验证分别进行；本指南不承诺未经验证的运行结果。

## 五步快速接入

准备 Node.js 22 LTS、npm 锁定依赖和独立 MySQL 开发库，环境配置见[根 README](<https://github.com/JinPen-G/Zelo/blob/3fee227517a2b20e18a426e853f18cdf37cb63ff/README.md#%E6%9C%AC%E5%9C%B0%E8%BF%90%E8%A1%8C>)。默认无Core的[API宿主](<https://github.com/JinPen-G/Zelo/blob/3fee227517a2b20e18a426e853f18cdf37cb63ff/apps/platform-api/README.md>)和[后台宿主](<https://github.com/JinPen-G/Zelo/blob/3fee227517a2b20e18a426e853f18cdf37cb63ff/apps/platform-admin/README.md>)提供公共框架。先[取得固定工单示例](<https://github.com/JinPen-G/Zelo/blob/3fee227517a2b20e18a426e853f18cdf37cb63ff/packages/core-contracts/README.md#%E5%8F%96%E5%BE%97%E5%9B%BA%E5%AE%9A%E5%B7%A5%E5%8D%95%E7%A4%BA%E4%BE%8B>)，再按下面五步开发，运行前置沿各宿主说明准备。

1. **从最小Core确定业务和标识。** 以工单包为参考，在自己的Core中实现实体、状态、校验和存储。维护[业务合同](<https://github.com/JinPen-G/Zelo/blob/3fee227517a2b20e18a426e853f18cdf37cb63ff/packages/example-tickets-core/src/contracts.ts>)、[清单](<https://github.com/JinPen-G/Zelo/blob/3fee227517a2b20e18a426e853f18cdf37cb63ff/packages/example-tickets-core/src/manifest.ts>)及[独立迁移](<https://github.com/JinPen-G/Zelo/blob/3fee227517a2b20e18a426e853f18cdf37cb63ff/packages/example-tickets-core/migrations/001-tickets.sql>)，更换Core ID、名称、版本和业务字段。Core自行选择租户或自己的容器范围；会员、库存、金额等领域规则由业务决定。清单使用本文的唯一schema，固定声明来源、兼容范围、权限、入口和数据版本。
2. **提供同源服务与API。** 参考[服务](<https://github.com/JinPen-G/Zelo/blob/3fee227517a2b20e18a426e853f18cdf37cb63ff/packages/example-tickets-core/src/service.ts>)、[HTTP合同](<https://github.com/JinPen-G/Zelo/blob/3fee227517a2b20e18a426e853f18cdf37cb63ff/packages/example-tickets-core/src/http.ts>)、[服务端贡献](<https://github.com/JinPen-G/Zelo/blob/3fee227517a2b20e18a426e853f18cdf37cb63ff/packages/example-tickets-core/src/server.ts>)和[Nest适配](<https://github.com/JinPen-G/Zelo/blob/3fee227517a2b20e18a426e853f18cdf37cb63ff/packages/example-tickets-core/src/nest.ts>)。复用公共当前身份、Core授权与成员范围，业务再校验角色、对象及提交条件；OpenAPI从同一请求/响应schema生成。Core可以省略AI贡献，普通业务仍按原权限工作。
3. **声明页面和本页主按钮。** 参考[工单四页](<https://github.com/JinPen-G/Zelo/blob/3fee227517a2b20e18a426e853f18cdf37cb63ff/packages/example-tickets-core/admin/index.tsx>)，从 `@rental-os/platform-admin/core` 使用 `CorePage`、`useCoreForm`、`CoreList` 和 `useCoreRequest`。声明路由、父级、权限和页面动作，复用框架侧栏、面包屑、主按钮、表单反馈及缓存隔离。页面通过已注册映射导航，避免自行复制外壳或请求客户端。宿主接入见[工单Web的三处装配](<https://github.com/JinPen-G/Zelo/blob/3fee227517a2b20e18a426e853f18cdf37cb63ff/apps/example-tickets-admin/README.md#%E6%8E%A5%E5%85%A5%E5%8F%AA%E7%9C%8B%E8%BF%99%E4%B8%89%E5%A4%84>)。
4. **构建并检查固定标准包。** 包含 `core.manifest.json`、实际入口、同版本 `openapi.json`、生成的 `CORE_GUIDE.md`、README、LICENSE及所声明迁移。先提交自己的源码，再按[工单打包说明](<https://github.com/JinPen-G/Zelo/blob/3fee227517a2b20e18a426e853f18cdf37cb63ff/packages/example-tickets-core/README.md>)构建并生成一个新包；用下面的共用检查核清单、路径、入口和兼容。安装准备和更新预检分别见本文后面的说明，未知结果沿原包或操作读取。
5. **只在宿主装配，然后授权使用。** 参考[工单API装配](<https://github.com/JinPen-G/Zelo/blob/3fee227517a2b20e18a426e853f18cdf37cb63ff/apps/example-tickets-api/src/assembly.ts>)和[Web入口](<https://github.com/JinPen-G/Zelo/blob/3fee227517a2b20e18a426e853f18cdf37cb63ff/apps/example-tickets-admin/src/main.tsx>)，将受控Core贡献交给公共宿主，两端使用同一标准包和部署锁。按[服务端步骤](<https://github.com/JinPen-G/Zelo/blob/3fee227517a2b20e18a426e853f18cdf37cb63ff/apps/example-tickets-api/README.md>)准备迁移、初始化公共账号并登记精确权限。首次部署由SaaS管理员先读取 `deployment-admission/read`；仅确认尚无记录时，以唯一 `operationId` 和 `expectedRevision: 0` 登记已核定的 `accepting`，再读当前修订及原操作收据。已有状态或未知应答按[正式部署准入步骤](<https://github.com/JinPen-G/Zelo/blob/3fee227517a2b20e18a426e853f18cdf37cb63ff/apps/example-tickets-api/README.md>)核对，不自动覆盖或重发；同源入口见下方[管理HTTP合同](<https://github.com/JinPen-G/Zelo/blob/3fee227517a2b20e18a426e853f18cdf37cb63ff/packages/core-contracts/README.md#core-%E7%AE%A1%E7%90%86-http-%E5%90%88%E5%90%8C>)。随后SaaS管理员授权租户，租户管理员分配成员及业务角色，再完成Core绑定与业务设置。部署准入、包、租户授权、成员分配和业务就绪分别成立。

```sh
npm run build -w @rental-os/core-contracts
node packages/core-contracts/dist/check.js <已解包Core目录> --host <宿主版本JSON> --json
node packages/core-contracts/dist/capabilities.js --query CorePage --json
```

验证至少覆盖业务正常操作、未授权/跨租户拒绝、同请求键读取原结果、单Core停用与重开，以及不选该Core时公共登录和设置可用。服务端事务、授权与原收据负责正确性，界面防重不能替代它们。底座和Core各自发布新版本，使用同一版本锁预检；数据迁移保留原文，升级不重置用户配置或授权。

## 交给开发Agent的任务模板

将下面的文本和目标业务要求一起交给Agent。无需提供维护者的内部开发文档。

```text
请在这个仓库开发一个业务Core。
先读 packages/core-contracts/README.md 的五步快速接入，
若工单目录尚未取得，先按同手册“取得固定工单示例”准备。
再按需要查看 packages/example-tickets-core 和两个工单宿主的真实入口。
Core ID、业务范围、字段、动作与角色按我提供的业务要求定义。
复用正式平台合同、身份、存储协调、后台外壳、表单、列表和请求工具。
页面路由与主按钮用正式贡献声明，只修改Core及明确的宿主装配配置。
请求/响应和OpenAPI使用同一schema，权限、对象、事务与幂等在服务端校验。
AI工具可选，不提供时不要扫描API或数据库自行补工具。
同步源码职责和Core README，生成标准包、CORE_GUIDE.md与API资料。
每个完整切片只做必要类型检查和一次相关冒烟，不新增大量测试脚本。
交付包版本/摘要、实际修改入口、验证结果和未验条件。
安装、迁移、服务启动与真实业务连接按我明确授权的环境执行。
```

## 本 Core 的必需与可选入口

源码入口为[服务端贡献](src/server.ts)、[后台贡献](admin/index.tsx)和[HTTP 文档生成](src/http-openapi.ts)。发行包中的对应路径为 `dist/server.js`、`admin/index.tsx`、`dist/http-openapi-portable.json`，在解包后的同版本目录读取。本包没有AI贡献，Agent不能查询或操作其业务。

对象范围为本Core的 rental-workspace 容器，并明确支持独立租户绑定。业务字段、状态与操作说明见[本包README](README.md)；许可见[LICENSE](LICENSE)。

安装、部署注册、租户授权、成员分配和业务就绪分别成立。停用保留数据与原收据；重开复用绑定、核对当前权限，不能重放未知原操作。
