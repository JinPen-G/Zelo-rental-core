# Zelo Rental Core · 项目规则

本仓库维护 Rental 的领域、宿主、业务适配和端侧源码。公共平台、Core 接入合同、通用 AI Native 和通用 MCP 在 [Zelo](https://github.com/JinPen-G/Zelo) 维护。开始改动前读取 [README](README.md)、[接入指南](CORE_GUIDE.md) 与直接消费者，核对本地分支、工作区、暂存区和实际远端，保护并行成果。同一业务规则、权限、迁移和原收据保留原权威。

## PR 与发布

- 按 Zelo 的 [Pull Request 与合并](https://github.com/JinPen-G/Zelo/blob/main/AGENTS.md#pr-workflow) 和 [版本发布、部署与回退](https://github.com/JinPen-G/Zelo/blob/main/AGENTS.md#release-workflow) 执行。常规从最新 `main` 开任务分支，使用本仓 [PR 模板](.github/pull_request_template.md)。提交、PR 标题和正文、发布说明使用中文。未经授权不得直接写主线、发布或部署；不因日常 PR 主动派独立 QA。
- 普通改动核 [独立构建 CI](.github/workflows/development-ci.yml)；公共合同、宿主和迁移变更写明所用 Zelo 与 Rental 完整 SHA、同版依赖和部署锁，复验直接消费者、原迁移账和恢复。缺必要来源时明确阻塞，禁止临时从另一个业务源码副本补齐。
- 正式发版使用固定 Tag 和 [发行归档流程](.github/workflows/release-assets.yml)。保持包清单的稳定发行来源，公开仓库更名不改历史 Tag、资产、迁移或现行安装锁。默认分支的 `core.manifest.json` 只采用对应正式资产的原验证字节；它不是发版前的预告。存量数据库不得直接采用新装 SQL，服务器切换另走固定镜像和迁移审批。
- 只提交所属源码、测试、许可和必要的公开接入说明；内部 `docs/`、Logo 原稿、参考镜像、凭据、生成物和临时验证材料留在本地。工作树同步只快进或按 PR 合并，禁止强推、覆盖他人未提交成果和重写公开历史。
