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
`pnpm test` 依次运行 Vitest、渲染端 TypeScript 检查和 Electron 渲染测试；真实 Tika 集成测试需[单独启用](document-reading.md#开发与打包)。

## 渲染层集成验证

测试使用临时 Electron 用户目录和仅监听本机的 Vite 服务，运行真实 React 工作区、CodeMirror 与 Vue/PPTist iframe。项目 IPC 与 Agent API 使用测试替身，不读写真实项目或调用模型。

覆盖文档编辑、保存与重开、revision 冲突、外部变更、生成中切换会话、会话元数据持久化和事件订阅清理；画布检查文字与图片加载结果。截图仍需人工检查，测试不代表真实 IPC/磁盘端到端验收或 Office 兼容性通过。

单独重跑渲染测试前先完成渲染端类型检查：

```bash
pnpm exec tsc --noEmit -p tsconfig.web.json
node scripts/test-renderer.mjs
```

测试会打开可见 Electron 窗口，需要桌面显示环境；Linux CI 使用 `xvfb-run -a pnpm test`。失败返回非零退出码，进程具有 180 秒外部看门狗。

同步基准覆盖 10、50、200 页与三种图片配置，每组预热一次、采样 20 次，测量编辑帧回调、宿主消息延迟及快照耗时。同步包含 120 ms 防抖，快照探针在消息同步后运行；用于同机比较，不设置跨机器绝对门槛。历史数据及指标限制见[性能记录](p2-validation-2026-09-14.md)。

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

## CI 与发布

[PR 工作流](../.github/workflows/check.yml) 在 Ubuntu 上安装锁定依赖、检查主进程/渲染进程/PPTist 类型并运行测试。[tag 工作流](../.github/workflows/build.yml) 分别在 macOS 和 Windows 构建安装包，再上传到 GitHub Release。

macOS 打包脚本和 CI 通过 `CSC_IDENTITY_AUTO_DISCOVERY=false` 关闭自动签名发现；本地 `pnpm package` 未显式设置该变量。正式分发需要 Apple Developer ID、公证凭据和 Windows 代码签名证书，仓库不保存证书或密钥。Tika 内嵌 Java 的签名、目标机安装与安全软件验收见[待验证矩阵](tika-validation.md#待完成验收)。
