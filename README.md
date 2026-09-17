# SlideMind

SlideMind 是一个面向 macOS 与 Windows 的演示文稿创作桌面工作区。应用将项目文件、Markdown 编辑、PPTist 可编辑演示、AI 制作流程、自动版本历史与本地诊断整合在同一个 Electron 应用中。

## 环境要求

- Node.js 22.19 或更高版本
- pnpm 11.15.1

## 本地开发

```bash
pnpm install --frozen-lockfile
pnpm tika:prepare       # 首次读取 Word/Excel/PDF 前准备本机运行时
pnpm pandoc:prepare     # 首次导出 Word 前准备本机运行时
pnpm dev
```

Tika 和 Pandoc 运行时体积较大，仅使用对应功能时需要准备，因此 `pnpm dev` 不会自动下载。

## 验证与构建

```bash
pnpm test          # 单元测试 + Electron 渲染端测试
pnpm format        # 使用 Prettier 格式化仓库
pnpm format:check  # 检查仓库格式
pnpm package       # 当前平台安装包
pnpm package:mac   # macOS DMG/ZIP，Intel + Apple Silicon
pnpm package:win   # Windows NSIS 安装包，x64
```

生产构建和安装包输出到 `out/`，渲染测试截图与测量结果输出到 `.local/renderer-tests/`；均不提交仓库。
`pnpm test` 需要桌面显示环境，Linux 无显示环境可使用 `xvfb-run -a pnpm test`。

PR 自动运行 TypeScript、PPTist/Vue 类型检查和测试；推送 tag 后构建并发布安装包。
macOS 打包脚本和 CI 默认关闭签名自动发现；其他本地打包命令受本机签名环境影响。正式分发需另行配置签名与公证。

## 文档导航

- [开发与验证](docs/development.md)：检查命令、构建、测试与发布。
- [Agent 与工具](docs/agent.md)：配置隔离、文件权限、Web 工具与限制。
- [本地办公文档读取](docs/document-reading.md)：Tika 契约、Java 运行时与测试样本。
- [文档导出](docs/document-export.md)：Word、PDF、PPTX 的当前能力与验证边界。
- [仓库指南](AGENTS.md)与[第三方声明](docs/THIRD_PARTY_NOTICES.md)。

## 工程结构

```text
src/
├── main/       # Electron 主进程与窗口生命周期
├── preload/    # 受限的渲染层桥接接口
├── renderer/   # React + Vite 用户界面
└── shared/     # 主进程与渲染层共享的 IPC 类型
```

## Agent 与模型配置

- 基础 agent 由 `@earendil-works/pi-agent-core` 驱动，在 Electron 主进程中按需创建。
- 当前服务商为 DeepSeek，默认使用支持图片理解的 DeepSeek V4.1 Flash（`deepseek-flash`），也可选择 DeepSeek V4 Pro；两者均支持关闭、轻量、深入和极致思考。旧 Flash 配置会自动映射到新模型，无需重新填写 API Key。
- 应用启动时会先检查模型配置；首次使用必须选择受支持的 DeepSeek 模型并保存 API Key，完成后才能进入项目启动台。后续可从启动台右上角再次打开设置。
- API Key 通过 Electron 系统安全存储加密，并写入应用的 `userData/agent-config.json`。渲染进程只能读取非敏感配置状态，无法读取已保存的 Key。
- 保存模型或 Key 后，正在运行的请求继续使用原配置，后续请求开始执行时应用新配置并恢复原会话历史；各会话的内存凭据相互隔离。
- preload 通过受限、类型化接口提供模型配置、Skill 列表、对话调用、停止、用量、任务清单和活动流；Agent 的文件访问与项目修改仍由主进程边界校验。
- 工作清单由应用内置 `todo` 工具管理，支持 `replace`、`add`、`update`、`list`；清单随会话分支恢复，旧会话的任务快照可只读显示。
- 应用内置 PPT 制作总控 Skill，并按阶段调度演示策略、页面文案、视觉设计、数据表达、流程图、模板和成稿审查 Skill；开发态从 `skills/` 加载，打包后作为只读资源注入 Pi Agent。
- Pi Agent 使用应用内的缓存前缀整理逻辑和 Web 工具，并使用 Pi 原生压缩。DeepSeek 模型由应用注册；Web 固定使用 Exa 公共搜索，不读取本机搜索凭据、旧配置或浏览器 Cookie。公共接口可能限流，失败不会自动改用付费服务。缓存 token 用量、压缩事件与历史会话重新加载的结构性信号记录在本地诊断日志中，不自动上传。
- Web 工具保留 `web_search`、`source_check`、`fetch_content`、`get_search_content`。支持域名/发布日期过滤、公开网页/文本/PDF 正文及分页字面量查找；`source_check` 组织证据，不判断论断真假。缓存按项目和会话分支授权，单会话最多 32 项/16 MiB，读取有效期一小时；过期、旧插件结果或已清理内容须重新获取。禁止代理、登录、脚本执行、音视频、OCR、raw/answer 和模糊查找。详细契约见 [Agent 与工具](docs/agent.md#web-工具)。
- 权限由应用内置固定策略管理，未知工具、Shell 和通用 MCP 不注册。文件操作限当前项目及明确列出的只读内置 Skill，拒绝目录越界、符号链接、硬链接、凭据文件和受保护目录；演示文稿图片与导出路径也进入同一检查。
- Pi 使用独立的内存设置和凭据存储，仅注册 DeepSeek 并显式加载内置 Skill 与工具；固定版本补丁关闭 SDK 的环境凭据、请求参数和包路径回退；不自动读取项目/用户扩展、Skill、权限文件或 AGENTS.md/SYSTEM.md/APPEND_SYSTEM.md。旧配置和会话不删除。
- `grep`、`find`、`ls` 使用应用内有界遍历，不查找或下载系统命令；不读取 `.gitignore`。正则与 glob 在可终止 Worker 中匹配。限制见 [文件搜索](docs/agent.md#文件搜索)。

## 设置与本地诊断

- 设置页按“AI 与模型”和“数据与诊断”分组；首次模型配置期间只开放完成启动所需的模型设置。
- 应用以 JSONL 记录主进程、渲染界面和导出任务的脱敏日志，并在本机滚动保留最多 5 个 5 MiB 日志文件。
- 设置页可以打开日志目录与本机崩溃报告目录、清除历史日志，或导出包含应用版本、运行时信息和脱敏日志的 `.json.gz` 诊断包。
- 原生崩溃报告仅保存在本机，不会自动上传，也不会加入诊断包。

## 项目启动台

- 应用使用自定义标题栏展示图标与当前项目，并保留 macOS、Windows 的原生窗口控制按钮。
- 标题栏中的项目名称支持在最近项目间切换，也可以选择其他项目目录。
- 首页展示本机最近打开的项目，并支持按项目名称或路径搜索。
- “选择项目”会打开系统文件夹选择器；选择成功后进入项目工作区。
- 最近项目按打开时间排序，去重后保存在应用的 `userData/recent-projects.json`。
- preload 只暴露类型化的项目列表、选择、打开与移除记录接口，渲染进程不直接访问文件系统。

## 项目会话

- 会话标题、标识和当前选择保存在项目的 `.slideMind/conversations.json`；消息由 Pi JSONL 会话文件保存在 `.slideMind/convs/`。
- 打开项目时会自动加载已有会话；首次使用时会创建初始会话和存储目录。
- 打开会话时从 Pi 会话文件加载消息，应用重启后可继续上下文。
- 会话元数据采用版本化 JSON 和原子替换写入；格式损坏时停止自动保存，避免覆盖原记录。

## 文档编辑

- 项目文件树支持双击或按 Enter 打开 Markdown 与 TXT 文件。
- Markdown 默认使用左侧源码、右侧预览的分栏工作台，也可切换为仅编辑或仅预览。
- 文档以标签页打开，支持 `Cmd/Ctrl + S` 保存、未保存状态提示和关闭保护。
- 文件读写通过项目句柄和受限 IPC 完成；渲染进程不会直接获得文件系统访问能力。
- 文本编辑限制为 2 MiB 的 UTF-8 文件，并保留 UTF-8 BOM 与原始换行风格。
- 保存采用内容版本校验；文件被其他程序修改时停止写入并提示重新载入。
- Markdown 操作栏可将当前编辑内容快照导出为 `.docx`；导出不要求先保存，也不会改变源文件的保存状态。转换期间仍可继续编辑，生成结果对应点击导出时的内容。
- Markdown 操作栏也可将点击时的编辑内容快照导出为 A4 PDF，使用预览的正文样式和固定分页规则；项目内图片加载失败时导出会中止。
- Word 导出支持标题、正文、列表、GFM 表格、代码和项目内 PNG/JPEG 图片；远程、越界、符号链接及不支持格式的图片会中止导出，Mermaid 和被移除的不支持链接会在完成后提示。
- 打包应用按目标架构内置固定版本 Pandoc、中文参考样式、许可证通知和对应源码归档；运行转换不依赖系统 Pandoc、Word 或网络。
- 本地开发首次使用 Word 导出前运行 `pnpm pandoc:prepare`，运行时写入 Git 忽略的 `out/.pandoc-package-runtime/`。

## 演示文稿编辑

- 演示文稿编辑器基于 [PPTist](https://github.com/pipipi-pikachu/PPTist)，使用独立 Vue 入口嵌入 React 工作区。
- 编辑器实例在输入过程中保持常驻，PPTist 状态通过受限消息桥同步；只有显式保存才写入项目文件。
- `.slides.json` 使用 SlideMind v2 的 PPTist 数据格式，不兼容早期的 v1 快照。
- 支持通过 `Cmd/Ctrl + S` 保存，并可由主进程导出基础文本、形状、图片和线条为 PPTX。外部 `.pptx` 仅支持只读内容提取，不支持无损导入或原位编辑。
- 可先保存原生演示文稿，再通过 PPTist 实际渲染画面逐页导出 PDF；每页为栅格图像，动画和视频使用静态画面，PDF 文字不可复制或检索。

## PPT 制作工作流

- 完整演示任务按“任务与证据 → Markdown 大纲 → 逐页文案 → 视觉与模板设计 → 可编辑草稿 → 质量审查 → 可选 PPTX 导出”推进，不会因为请求了大纲或审查而自动扩大交付范围。
- 工作流支持连续模式和审阅模式：完整交付请求默认在安全门禁内连续推进；用户要求逐阶段确认或存在关键选择时，每个阶段完成后等待审阅。
- 每个任务在项目内使用一个稳定的主题产物目录，并通过 `workflow-status.md` 记录执行模式、阶段状态、产物路径、假设、待确认项和下游失效状态。大纲、逐页文案、设计规范、`.slides.json`、质量报告、素材与按需导出的 `.pptx` 均归入该目录。
- Agent 写入可编辑演示前必须读取最新 revision，并以一次原子事务替换完整页面集合；写入后会再次回读结构，避免外部修改冲突或部分覆盖。
- 质量阶段结合确定性预检与真实 PPTist 渲染：预检检查占位符、越界、潜在文字溢出、重叠、遮挡、字号和图片体积；视觉模型可分批渲染页面，检查层次、对比、留白、分组、阅读顺序和跨页一致性。
- 自动检查不能证明 PowerPoint 中的字体替换、最终文字溢出、图片裁切或 Office 兼容性。只有质量门禁通过且用户要求 PPTX 时才执行导出，剩余人工确认项会保留在交付说明中。

## 自动版本与外部修改

- 文本、演示文稿、导出文件以及 Agent 的 `write` / `edit` 在应用内成功写入后，会合并为自动版本。
- 版本存储使用内嵌的 `isomorphic-git`，仓库位于项目的 `.slideMind/history.git`；不会调用系统 Git，也不会修改用户自己的 `.git`、分支或暂存区。
- 工作区右上角的“版本历史”或 `Cmd/Ctrl + Shift + H` 可打开版本时间线，查看文件差异，并将选中文件恢复为历史状态。
- 恢复前会校验当前文件版本；确认恢复未保存文件时会明确提示，恢复操作仍通过应用内修改通道并参与后续自动版本记录。
- `.git`、`.slideMind`、`node_modules`、构建产物和临时文件不会进入自动版本。
- 外部变化监听只覆盖项目根目录、文件树中已展开的目录和已打开文件所在目录，不会递归监听整个项目。
- 外部程序修改已打开且无本地改动的文件时自动重新载入；存在未保存内容时只标记冲突，不覆盖编辑内容。
- 外部变化只用于刷新界面，不会自动写入 SlideMind 版本历史；窗口重新获得焦点时会再次校验可见目录和已打开文件。

## 安全边界

- 渲染进程启用沙箱和 `contextIsolation`。
- 渲染进程不直接访问 Node.js。
- preload 仅暴露受限、类型化的运行时、Agent、项目、文件、演示文稿、版本和诊断接口；主进程校验调用方与不可信输入。
- 新窗口和外部导航只允许交给系统浏览器打开 HTTP(S) 地址。

## 本地办公文档读取

Agent 通过 `document_read` 分段读取项目内 `.doc`、`.docx`、`.xls`、`.xlsx` 和 `.pdf` 文本及筛选后的元数据，文件引用自动路由到该工具。读取不保留页面或工作表视觉、准确页码、公式计算结果语义、OCR、嵌入附件或全部复杂表格结构。

打包链路按目标架构携带固定版本的 Tika 与经 jlink 压缩、裁剪的 Java 运行时，可回退完整 JRE，详见 [Java 构建约束](docs/document-reading.md#java-构建约束)。解析无需系统 Java、Docker 或网络；在线模型仍需联网。开发前需显式[准备本机运行时](docs/document-reading.md#开发与打包)。Tika 只监听动态回环端口，空闲后退出；不提供面向不可信本机进程或共享主机的隔离保证。

macOS arm64 已有未签名安装包及内置运行时冒烟记录，各平台真实安装、离线、安全软件及签名验收仍未完成，详见[当前验证边界](docs/document-reading.md#当前验证边界)。

## 许可证

SlideMind 采用 [GNU Affero General Public License v3.0](LICENSE)（AGPL-3.0-only）。第三方组件信息见[第三方声明](docs/THIRD_PARTY_NOTICES.md)。
