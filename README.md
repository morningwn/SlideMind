# SlideMind

SlideMind 是一个面向 macOS 与 Windows 的演示文稿创作桌面工作区。应用将项目文件、Markdown 编辑、PPTist 可编辑演示、AI 制作流程、自动版本历史与本地诊断整合在同一个 Electron 应用中。

## 环境要求

- Node.js 22.19 或更高版本
- pnpm 11.15.1

## 本地开发

```bash
pnpm install --frozen-lockfile
pnpm dev
```

## 验证与构建

```bash
pnpm test          # 单元测试 + Electron 渲染端测试
pnpm format        # 使用 Prettier 格式化仓库
pnpm format:check  # 检查仓库格式
pnpm package       # 当前平台安装包
pnpm package:mac   # macOS DMG/ZIP，Intel + Apple Silicon
pnpm package:win   # Windows NSIS 安装包，x64
```

所有构建、检查与打包产物统一写入 `out/`：Electron Vite 生产构建位于
`out/main/`、`out/preload/` 和 `out/renderer/`，PPTist 类型检查临时目录位于
`out/.pptist-typecheck-*/`，Tika 开发运行时与打包暂存分别位于
`out/.tika-p0-runtime/` 和 `out/.tika-package-runtime/`，平台安装包及 Electron Builder
中间产物位于 `out/release/`。

### 自动验证

Pull Request 自动执行锁文件安装、TypeScript 检查及 `pnpm test`；tag 发布继续由打包工作流处理。
PPTist 入口、Vue 组件及其依赖源码由 CI 和打包命令调用 `scripts/typecheck-pptist.cjs` 检查，使用与构建相同的 `@` 别名。
Vue 检查工具依赖 JavaScript 编译器 API，因此通过 `typescript-vue` 固定使用 TypeScript 5.9；其余检查继续使用项目的 TypeScript 7。

### 工作区交互与 PPTist 渲染验证

`pnpm test` 在 Vitest 单元测试后，使用临时 Electron 用户目录和仅监听本机的 Vite 服务运行真实 React 工作区、CodeMirror 和 Vue/PPTist iframe。渲染端测试替换项目 IPC 与 Agent API，不读写真实项目或调用模型；覆盖文档编辑保存重开、保存 revision 冲突、外部变更通知、生成中切换会话，以及会话元数据持久化和事件订阅清理。

渲染检查断言画布文字和图片加载结果，并将截图与测量数据写入被 Git 忽略的 `.local/renderer-tests/`。失败返回非零退出码。截图仍需人工检查；这些测试不代表真实 IPC/磁盘端到端验收，也不代表 PowerPoint/Office 兼容性通过。

同步基准在真实 PPTist store 上测量 10、50、200 页，以及无图片、每页 64 × 64 和 128 × 128 PNG 图片的组合。每组预热一次、采样 20 次，分别记录 Vue 更新至下一帧回调、消息到达宿主的延迟，以及原有/优化后 JSON 快照耗时。序列化探针在消息同步完成后运行；同步延迟包含现有的 120 ms 防抖。性能数据用于同机比较，不设置跨机器绝对耗时门槛。运行需要可用的桌面显示环境，首次启动需要编译 PPTist 依赖。

当前会话元数据自动保存与 Agent 流式/活动/待办订阅分别由 `use-conversation-persistence`、`use-agent-events` 管理。PPTist 快照序列化跳过 Vue 代理的依赖收集，加载比较直接使用序列化结果；跨框架消息格式和完整文稿 revision 事务保持原有契约。

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
- preload 通过受限、类型化接口提供模型配置、Skill 列表、对话调用、停止、用量、任务清单和活动流；Agent 的文件访问与项目修改仍由主进程边界校验。
- 应用内置 PPT 制作总控 Skill，并按阶段调度演示策略、页面文案、视觉设计、数据表达、流程图、模板和成稿审查 Skill；开发态从 `skills/` 加载，打包后作为只读资源注入 Pi Agent。
- Pi Agent 固定集成 `pi-continue`、`pi-free`、`pi-cache-optimizer` 与 `pi-web-access`。这些扩展不引入原生模块；Web 能力按白名单启用。
- Agent 可通过 `document_read` 分段读取项目内 `.doc` / `.docx` 的正文和筛选后元数据；文件引用会自动路由到该工具，不会交给通用文本读取器处理。读取结果不提供页面视觉还原、准确页码、OCR、嵌入附件递归提取或复杂表格的无损结构。
- 文档正文由固定版本的本地 Apache Tika 与 Java 运行时解析，不会把文件发送给远程解析服务。源码开发需先运行 `node scripts/tika-p0/prepare-runtime.mjs` 准备被 Git 忽略的本机运行时；安装包内置三平台运行时仍属于 P3 交付范围。
- 插件配置位于应用 `userData/pi-agent/`；首次启动会写入无浏览器弹窗、禁止读取浏览器 Cookie 的 Web 安全默认值，并关闭依赖 `git`、`gh`、`curl`、`yt-dlp` 或 `ffmpeg` 的能力。`pi-free` 上游仍使用用户的 `~/.pi/free.json` 保存其提供商配置。
- 当前项目仍可通过 `.pi/skills/` 增加或覆盖同名 Skill，用户级 Skill 位于应用 `userData/pi-agent/skills/`。

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

- 每个项目的会话记录保存在项目目录下的 `.slideMind/conversations.json`。
- 打开项目时会自动加载已有会话；首次使用时会创建初始会话和存储目录。
- 会话记录包含对话标题、当前选择的对话及用户与 Agent 消息，可在应用重启后继续上下文。
- 文件采用版本化 JSON 格式和原子替换写入；格式损坏时停止自动保存，避免覆盖原记录。

## 文档编辑

- 项目文件树支持双击或按 Enter 打开 Markdown 与 TXT 文件。
- Markdown 默认使用左侧源码、右侧预览的分栏工作台，也可切换为仅编辑或仅预览。
- 文档以标签页打开，支持 `Cmd/Ctrl + S` 保存、未保存状态提示和关闭保护。
- 文件读写通过项目句柄和受限 IPC 完成；渲染进程不会直接获得文件系统访问能力。
- 文本编辑限制为 2 MiB 的 UTF-8 文件，并保留 UTF-8 BOM 与原始换行风格。
- 保存采用内容版本校验；文件被其他程序修改时停止写入并提示重新载入。

## 演示文稿编辑

- 演示文稿编辑器基于 [PPTist](https://github.com/pipipi-pikachu/PPTist)，使用独立 Vue 入口嵌入 React 工作区。
- 编辑器实例在输入过程中保持常驻，PPTist 状态通过受限消息桥同步；只有显式保存才写入项目文件。
- `.slides.json` 使用 SlideMind v2 的 PPTist 数据格式，不兼容早期的 v1 快照。
- 支持通过 `Cmd/Ctrl + S` 保存，并可由主进程导出基础文本、形状、图片和线条为 PPTX。

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
- preload 只暴露冻结的运行时信息和经过校验的 agent IPC 方法。
- 新窗口和外部导航只允许交给系统浏览器打开 HTTP(S) 地址。

## 本地 Word 文档读取

- Agent 可读取项目内的 `.doc` 和 `.docx` 正文及可提取元数据；不承诺页面视觉、准确页码、OCR、嵌入附件或复杂表格语义完整还原。
- 安装包按目标架构携带固定版本的 Apache Tika Server 4.0.0 与 Eclipse Temurin JRE 21.0.12.1+1。文档解析本身无需系统 Java、Docker 或网络连接；在线模型仍需要网络。
- Tika 仅监听动态分配的 `127.0.0.1` 回环端口，空闲后退出。当前安全边界不面向不可信本机进程或多用户共享主机提供隔离保证。
- 打包前会校验固定下载摘要与 Apache 发布签名，打包后会检查运行时布局和许可证资源，并在本机架构执行 Java/Tika 冒烟验证。

## 签名与发布

本地和 CI 默认生成未签名安装包。正式分发前需要配置 Apple Developer ID、公证凭据以及 Windows 代码签名证书。仓库不会保存证书或密钥。

## 许可证

SlideMind 采用 GNU Affero General Public License v3.0（AGPL-3.0-only）。第三方组件信息见 `THIRD_PARTY_NOTICES.md`。
