# 仓库指南

## 项目结构与模块组织

SlideMind 是基于 Electron、React 和 TypeScript 的桌面应用。各进程职责必须保持清晰：

- `src/main/`：Electron 生命周期、窗口、Agent 服务与 IPC 处理器。
- `src/preload/`：向渲染进程暴露受限且类型安全的桥接接口。
- `src/renderer/src/`：React 界面、样式与浏览器端工具。
- `src/shared/`：主进程与渲染进程共享的类型定义。
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

## 测试指南

项目使用 Vitest。验证逻辑、共享工具及 IPC 边界行为应补充针对性测试。测试套件以导出单元命名，测试用例描述可观察行为。项目未设置强制覆盖率阈值，但新增行为和缺陷修复仍应配套测试。本地提交前运行 `pnpm check`。

## 提交与拉取请求指南

近期提交采用简短、祈使式英文主题，例如 `add Pi agent and model setup flow`。每个提交只包含一个逻辑变更。PR 应说明目的与风险、列出验证命令、关联相关 Issue；渲染界面变更需附截图或录屏。涉及 preload API、IPC 契约、打包流程或安全边界的变化必须明确标注。

## 安全与配置

不得提交 API Key、证书、`.env` 文件或本地数据库。必须保留 `contextIsolation`、渲染进程沙箱及禁用 Node 集成等安全设置。新增原生能力只能通过范围最小、类型明确且包含输入校验的 preload 与 IPC 接口暴露。
