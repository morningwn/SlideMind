# 开发与验证

环境和常用命令见 [README](../README.md#环境要求)，工程约束见 [AGENTS.md](../AGENTS.md)。命令以 [package.json](../package.json) 为准。

## 类型检查与测试

```bash
pnpm exec tsc --noEmit -p tsconfig.node.json
pnpm exec tsc --noEmit -p tsconfig.web.json
node scripts/typecheck-pptist.cjs
pnpm test
pnpm format:check
```

PPTist 检查使用与构建相同的 `@` 别名。Vue 检查工具通过 `typescript-vue` 使用 TypeScript 5.9，其余检查使用项目的 TypeScript 7。
`pnpm test` 依次运行 Vitest、Agent 独立进程隔离测试、渲染端 TypeScript 检查和 Electron 渲染测试；真实 Tika 集成测试需[单独启用](document-reading.md#开发与打包)。

## 渲染层集成验证

测试使用临时 Electron 用户目录和仅监听本机的 Vite 服务，运行真实 React 工作区、CodeMirror 与 Vue/PPTist iframe。项目 IPC 与 Agent API 使用测试替身，不读写真实项目或调用模型。

覆盖文档编辑、保存与重开、revision 冲突、外部变更、生成中切换会话、会话元数据持久化和事件订阅清理；画布检查文字与图片加载结果。截图仍需人工检查，测试不代表真实 IPC/磁盘端到端验收或 Office 兼容性通过。

单独重跑渲染测试前先完成渲染端类型检查：

```bash
pnpm exec tsc --noEmit -p tsconfig.web.json
node scripts/test-renderer.mjs
```

测试会打开可见 Electron 窗口，需要桌面显示环境；Linux CI 使用 `xvfb-run -a pnpm test`。失败返回非零退出码，进程具有 180 秒外部看门狗。

同步基准覆盖 10、50、200 页与三种图片配置，每组预热一次、采样 20 次，测量编辑帧回调、宿主消息延迟及快照耗时。同步包含 120 ms 防抖，快照探针在消息同步后运行；用于同机比较，不设置跨机器绝对门槛。结果写入 `.local/renderer-tests/`，不作为跨机器性能承诺。

## 构建产物

| 路径                                         | 内容                                                     |
| -------------------------------------------- | -------------------------------------------------------- |
| `out/main/`、`out/preload/`、`out/renderer/` | Electron Vite 生产构建                                   |
| `out/.pptist-typecheck-*/`                   | PPTist 类型检查临时目录                                  |
| `out/.tika-p0-runtime/`                      | Tika 开发运行时                                          |
| `out/.tika-package-runtime/`                 | 按架构准备的打包运行时                                   |
| `out/release/`                               | 安装包与 Electron Builder 中间产物                       |
| `.local/renderer-tests/`                     | `results.json`、`pptist.png`，可捕获时另存 `failure.png` |

以上目录被 Git 忽略。仅检查生产构建可运行 `pnpm exec electron-vite build`；生成安装包使用 README 中的 `pnpm package*` 命令，它们还会执行类型检查、测试和 Tika 资源校验。

打包依赖按运行方式划分：前端库与已明确由 Vite 内联的主进程库放在 `devDependencies`，需要在运行时通过 Node 加载的库保留在 `dependencies`。主进程和渲染端构建分别生成 `licenses.md`，随构建产物分发被内联依赖的许可证。新增动态加载依赖时需检查这一边界，不能仅凭开发环境运行成功判断包内可用。

Electron 仅分发英文（美式、英式）和中文（简体、繁体）语言资源，macOS 同时匹配下划线形式的 locale 名称。Agent 的 esbuild 运行依赖保留，按目标平台和架构排除其他 esbuild 二进制。内置字体、Tika 和 Pandoc 继续完整离线分发。

## CI 与发布

[PR 工作流](../.github/workflows/check.yml) 在 Linux、macOS 和 Windows 上安装锁定依赖、检查主进程/渲染进程/PPTist 类型并运行测试。[tag 工作流](../.github/workflows/build.yml) 分别在 macOS 和 Windows 构建安装包，再上传到 GitHub Release。

macOS 打包脚本和 CI 通过 `CSC_IDENTITY_AUTO_DISCOVERY=false` 关闭自动签名发现；本地 `pnpm package` 未显式设置该变量。正式分发需要 Apple Developer ID、公证凭据和 Windows 代码签名证书，仓库不保存证书或密钥。Tika 内嵌 Java 的签名、目标机安装与安全软件验收见[文档读取限制](document-reading.md#当前验证边界)。

## 专项检查

```bash
pnpm test:agent-isolation
pnpm pandoc:prepare
pnpm pandoc:test
pnpm exec electron-vite build
node scripts/pdf-p3/run-local.mjs
```

Agent 隔离测试使用独立进程与模拟响应，不调用付费模型。`node scripts/agent-isolation/verify-package.mjs` 检查本机安装包内依赖与 Skill，在 Electron Node 模式执行，不代表完整安装后 UI 验收。手动 [桌面验收工作流](../.github/workflows/agent-acceptance.yml) 运行原生平台打包检查，不发布产物。

PDF 探针通过真实 preload/IPC 导出合成样本，输出到 `.local/pdf-p3/build/`；`--asar` 检查包内应用，输出到 `.local/pdf-p3/asar/`。它使用测试 Electron 外壳与替代保存对话框，不代表真实安装与对话框交互通过。重复执行覆盖对应目录的同名测试产物。

Tika 准备与真实集成测试见 [读取指南](document-reading.md#开发与打包)。`scripts/*-p0/` 仍包含运行时准备、清单、样本和探针，被开发或打包流程引用，不是可直接删除的临时目录。Pandoc 运行时位于 `out/.pandoc-package-runtime/`，所有生成资源与探针报告均不提交。
