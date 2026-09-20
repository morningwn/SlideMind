# SlideMind

SlideMind 是面向 macOS 与 Windows 的 Electron 桌面文案工作区，集成项目文件、Markdown 编辑、AI 对话、PPTist 演示编辑、文档导出与自动版本历史。

## 环境要求

Node.js 22.19 或更高版本，pnpm 11.15.1。CI 使用 Node.js 24；最低 Node.js 版本仍需单独验收。

```bash
pnpm install --frozen-lockfile
node scripts/tika-p0/prepare-runtime.mjs       # 使用 Word / Excel / PDF 文本读取前准备
node scripts/pandoc-package/prepare.mjs     # 使用 Word 导出前准备
pnpm dev
```

运行时准备需要联网，`pnpm dev` 不自动下载。安装包内置 Tika、Java 和 Pandoc，本地解析与导出无需系统 Java、Word 或 Pandoc；在线模型与 Web 搜索需要联网。

## 当前功能

| 功能         | 当前行为                                                                    |
| ------------ | --------------------------------------------------------------------------- |
| 项目与会话   | 打开本地目录、搜索最近项目、切换会话，重启后恢复消息                        |
| 文本编辑     | Markdown / TXT 标签页、源码与预览、保存保护；支持不超过 2 MiB 的 UTF-8 文件 |
| AI 助手      | DeepSeek 模型、流式对话、停止、任务清单、项目文件工具与公开 Web 搜索        |
| 办公文档读取 | 提取 DOC、DOCX、XLS、XLSX、PDF 文本；PPTX 只读提取                          |
| 演示制作     | 内置分阶段制作 Skill，编辑 SlideMind v2 `.slides.json`，导出 PPTX 或 PDF    |
| 文档导出     | Markdown 当前内容快照导出 Word 或 A4 PDF，不要求先保存                      |
| 自动版本     | 应用内写入合并为版本，可查看差异、恢复文件；外部修改只刷新界面              |
| 本地诊断     | 脱敏滚动日志、诊断包与本机崩溃报告；不自动上传                              |

首次启动需保存受支持的 DeepSeek 模型与 API Key，之后可在启动台设置中修改。应用当前默认模型为 DeepSeek V4.1 Flash（`deepseek-flash`，支持图片），也提供 DeepSeek V4 Pro。密钥通过 Electron 系统安全存储加密，渲染进程无法读取已保存的明文密钥；配置变更在后续请求生效。

普通写作任务不会自动进入 PPT 流程。复杂任务由内置 `task-workflow` 维护 `task-status.md`；完整演示由 `ppt-production-workflow` 按证据、大纲、逐页文案、设计、草稿、质量审查和按需导出推进，在主题目录维护 `workflow-status.md` 与产物。完整交付默认连续推进，用户要求逐阶段确认时使用审阅模式。

## 数据与保存

- 项目会话索引保存在 `.slideMind/conversations.json`，消息保存在 `.slideMind/convs/`；索引损坏时停止自动保存。
- 自动版本保存在 `.slideMind/history.git`，使用内嵌 Git 实现，不操作用户的 `.git`、分支或暂存区。版本历史可通过 `Cmd/Ctrl + Shift + H` 打开。
- 文本与演示通过 `Cmd/Ctrl + S` 显式保存；保存时检查版本冲突。外部修改遇到未保存内容时只提示冲突，不覆盖编辑内容。
- 外部监听覆盖项目根、已展开目录和已打开文件所在目录，不递归监听整个项目；窗口重新聚焦时再次校验。
- 模型配置和最近项目位于 Electron `userData`；日志最多保留 5 个 5 MiB 文件，原生崩溃报告不加入诊断包。

## 限制与待验证项

- `.slides.json` 仅支持 SlideMind v2，不兼容旧 v1；外部 PPTX 不支持无损导入或原位编辑，PPTX 导出仅覆盖基础文本、形状、图片和线条。
- 演示 PDF 目前限 1–30 页，每页为栅格图，文字不可搜索或复制。办公文档读取不提供 OCR 或原始版式还原。
- 结构预检、PPTist 渲染和 Office 兼容性是不同层级的检查；导出成功不代表真实 Word / PowerPoint 排版通过。
- Agent 无 Shell 或通用 MCP，文件操作受固定项目权限限制。该权限层不是操作系统沙箱，不保证抵御恶意本机进程并发修改文件树。
- Web 使用 Exa 公共搜索，可能限流且没有付费回退；缓存有单会话限制，但没有跨会话全局容量上限。
- 仓库包含自动测试和包内探针，但不能据此认定所有目标平台已完成真实安装、离线使用、签名、安全软件或 Office 视觉验收。具体边界见专题文档。

## 文档与开发

- [开发与验证](docs/development.md)：代码结构、测试、运行时准备、打包与发布。
- [Agent 与工具](docs/agent.md)：模型隔离、文件权限、搜索与安全边界。
- [文档读取与导出](docs/document-reading.md)：格式支持、资源限制与兼容性边界。
- [仓库协作规则](AGENTS.md)。

```bash
pnpm test          # 单元测试、Agent 隔离与 Electron 渲染测试
pnpm test --unit   # 仅单元测试，打包使用此模式
pnpm test --integration # 增加 Tika / Pandoc 与 PDF 导出集成测试
pnpm format:check
pnpm package       # 当前平台安装包
pnpm package:mac   # macOS Intel + Apple Silicon，DMG / ZIP
pnpm package:win   # Windows x64，NSIS
```

默认测试需要桌面显示环境，Linux 无显示环境使用 `xvfb-run -a pnpm test`。打包只执行单元测试，不启动应用。构建与安装包输出到 `out/`，测试产物写入 `.local/`，均不提交。macOS 打包脚本与 CI 默认关闭签名自动发现，正式分发仍需配置签名与公证。

## 许可证

项目采用 [AGPL-3.0-only](LICENSE)，第三方组件及内置运行时许可见[第三方声明](docs/THIRD_PARTY_NOTICES.md)。
