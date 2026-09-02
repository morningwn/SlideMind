# 仓库指南

## 项目结构与模块组织

SlideMind 是基于 Electron、React、Vue 和 TypeScript 的桌面应用。各进程职责必须保持清晰：

- `src/main/`：Electron 生命周期与窗口；`agent/`、`logging/`、`presentation/`、`project/`、`version-control/` 分别承载 Agent、诊断、演示文稿、项目存储和自动版本服务及其 IPC。
- `src/preload/`：向渲染进程暴露受限且类型安全的桥接接口。
- `src/renderer/src/`：React 应用、工作区组件、样式与浏览器端工具。
- `src/renderer/pptist-*`：嵌入 React 工作区的独立 Vue/PPTist 编辑器入口与主题；两端只通过受限消息桥同步状态。
- `src/shared/`：主进程与渲染进程共享的类型定义。
- `skills/`：打包进应用的 PPT 制作总控及策略、文案、视觉、数据、流程图、模板和质量审查 Skill；`SKILL.md` 引用的规则放在对应 `references/`。
- `assets/`：应用图标；`.github/workflows/`：持续集成配置。

单元测试与实现文件放在同一目录，命名为 `*.test.ts`。不得提交 `out/`、`release-dist/`、`coverage/` 等生成目录。

## 构建、测试与开发命令

使用 Node.js 22.19 或更高版本，以及 `package.json` 固定的 pnpm 版本。

- `pnpm install --frozen-lockfile`：严格按照锁文件安装依赖。
- `pnpm dev`：启动支持 Vite 热更新的 Electron 开发环境。
- `pnpm typecheck`：检查主进程、预加载脚本和渲染进程的 TypeScript 类型。
- `pnpm test`：单次运行 Vitest 测试套件。
- `pnpm check`：依次执行类型检查与测试；提交 PR 前必须运行。
- `pnpm build`：完成校验并将生产构建写入 `out/`。
- `pnpm package:mac` / `pnpm package:win`：在 `release-dist/` 生成平台安装包。

## 编码风格与命名约定

遵循现有 TypeScript 风格：两空格缩进、单引号、不写分号，多行结构按需保留尾逗号。保持严格类型，避免 `any`，并在 IPC 边界校验输入。React 组件和类型使用 `PascalCase`，函数与变量使用 `camelCase`，文件名使用短横线命名，例如 `config-store.ts`。项目尚未配置格式化器或 lint 工具，应以相邻代码为准，并通过 `pnpm typecheck` 校验。

## Agent 与演示文稿约束

- Agent、桌面、项目和演示文稿的跨进程契约统一定义在 `src/shared/`；新增能力必须先明确共享类型，再通过 preload 暴露最小接口，并在主进程校验调用方、项目句柄和所有不可信输入。
- `.slides.json` 使用 SlideMind v2 的 PPTist 数据格式。结构化修改必须遵循“读取最新 revision → 一次写入完整页面集合 → 再次回读”的事务流程；发生 revision 冲突时重新读取并合并，不能复用旧 revision。
- 外部 `.pptx` 只支持只读内容提取，不能承诺无损导入或原位编辑。PPTX 是从 `.slides.json` 派生的交付物，不得把导出成功等同于真实视觉或 Office 兼容性通过。
- 完整 PPT 制作由 `skills/ppt-production-workflow/` 编排，并以 `workflow-status.md`、统一主题产物目录和连续/审阅模式维护阶段状态。专项 Skill 只负责自己的阶段，不得复制总控状态机或扩大用户要求的交付层级。
- 质量验收必须区分确定性结构预检与真实 PPTist 渲染审查：`slides_review` 的通过不代表语义、视觉或兼容性完全通过；修改相关工具或规则时必须同步审查门禁、Skill reference 和测试。
- 变更内置 Skill 的名称、路径、依赖或生产契约时，同步更新 `src/main/agent/bundled-skills.test.ts`、相关 Skill/reference 以及 README 中的用户可见行为说明。

## 测试指南

项目使用 Vitest。验证逻辑、共享工具及 IPC 边界行为应补充针对性测试；Agent 工具、revision 冲突、演示文稿转换、质量预检、日志脱敏及 Skill 打包契约属于重点覆盖范围。测试套件以导出单元命名，测试用例描述可观察行为。项目未设置强制覆盖率阈值，但新增行为和缺陷修复仍应配套测试。本地提交前运行 `pnpm check`。

## 提交与拉取请求指南

近期提交采用简短、祈使式英文主题，例如 `add Pi agent and model setup flow`。每个提交只包含一个逻辑变更。PR 应说明目的与风险、列出验证命令、关联相关 Issue；渲染界面变更需附截图或录屏。涉及 preload API、IPC 契约、打包流程或安全边界的变化必须明确标注。

## 安全与配置

不得提交 API Key、证书、`.env` 文件、本地数据库、日志或崩溃转储。必须保留 `contextIsolation`、渲染进程沙箱及禁用 Node 集成等安全设置。API Key 必须继续通过 Electron 系统安全存储保护；渲染进程不得读取明文凭证。新增原生能力只能通过范围最小、类型明确且包含输入校验的 preload 与 IPC 接口暴露。诊断输出必须脱敏，崩溃报告不得自动上传或混入诊断包。
