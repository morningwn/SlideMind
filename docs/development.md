# 开发与验证

环境和常用命令见 [README](../README.md#环境要求)，工程约束见 [AGENTS.md](../AGENTS.md)。命令以 [package.json](../package.json) 为准。

## 代码结构

| 目录                          | 职责                                                                      |
| ----------------------------- | ------------------------------------------------------------------------- |
| `src/main/`                   | Electron 生命周期、Agent、项目与版本存储、文档读取和导出、诊断及 IPC 校验 |
| `src/preload/`、`src/shared/` | 最小桥接接口与跨进程类型                                                  |
| `src/renderer/src/`           | React 工作区、文档编辑与预览                                              |
| `src/renderer/pptist-*`       | 独立 Vue/PPTist 入口与受限消息桥                                          |
| `skills/`                     | 随应用打包的只读制作流程与专项 Skill                                      |
| `scripts/`                    | 运行时准备、打包校验、集成探针与测试样本                                  |

渲染进程保持沙箱、`contextIsolation` 和禁用 Node 集成；主进程校验调用方、项目句柄与不可信输入。新增跨进程能力先定义共享契约，再暴露最小接口。

## 类型检查与测试

```bash
pnpm exec tsc --noEmit -p tsconfig.node.json
pnpm exec tsc --noEmit -p tsconfig.web.json
node scripts/typecheck-pptist.cjs
pnpm test
pnpm format:check
```

PPTist 检查使用与构建相同的 `@` 别名。Vue 检查工具通过 `typescript-vue` 使用 TypeScript 5.9，其余检查使用项目的 TypeScript 7。
`pnpm test` 依次运行 Vitest、Agent 独立进程隔离测试、渲染端 TypeScript 检查和 Electron 渲染测试；真实运行时与在线服务测试通过同一入口的参数启用，见下文。

## 渲染层集成验证

测试使用临时 Electron 用户目录和仅监听本机的 Vite 服务，运行真实 React 工作区、CodeMirror 与 Vue/PPTist iframe。项目 IPC 与 Agent API 使用测试替身，不读写真实项目或调用模型。

覆盖文档编辑、保存与重开、revision 冲突、外部变更、生成中切换会话、会话元数据持久化和事件订阅清理；画布检查文字与图片加载结果。截图仍需人工检查，测试不代表真实 IPC/磁盘端到端验收或 Office 兼容性通过。

单独重跑渲染测试前先完成渲染端类型检查：

```bash
pnpm exec tsc --noEmit -p tsconfig.web.json
node scripts/test-renderer.mjs
```

测试会打开可见 Electron 窗口，需要桌面显示环境；Linux CI 使用 `xvfb-run -a pnpm test`。失败返回非零退出码，进程具有 180 秒外部看门狗。

同步性能结果用于同机比较，不设置跨机器绝对门槛。截图和测量输出到 `.local/renderer-tests/`，不提交历史报告。

## 构建产物

| 路径                                         | 内容                                                     |
| -------------------------------------------- | -------------------------------------------------------- |
| `out/main/`、`out/preload/`、`out/renderer/` | Electron Vite 生产构建                                   |
| `out/.pptist-typecheck-*/`                   | PPTist 类型检查临时目录                                  |
| `out/.tika-p0-runtime/`                      | Tika 开发运行时                                          |
| `out/.tika-package-runtime/`                 | 按架构准备的打包运行时                                   |
| `out/release/`                               | 安装包与 Electron Builder 中间产物                       |
| `.local/renderer-tests/`                     | `results.json`、`pptist.png`，可捕获时另存 `failure.png` |

以上目录被 Git 忽略。仅检查生产构建可运行 `pnpm exec electron-vite build`；生成安装包使用 README 中的 `pnpm package*` 命令，它们还会执行类型检查、单元测试和 Tika / Pandoc 静态资源校验。

打包依赖按运行方式划分：前端库与已明确由 Vite 内联的主进程库放在 `devDependencies`，需要在运行时通过 Node 加载的库保留在 `dependencies`。主进程和渲染端构建分别生成 `licenses.md`，随构建产物分发被内联依赖的许可证。新增动态加载依赖时需检查这一边界，不能仅凭开发环境运行成功判断包内可用。

Electron 仅分发英文（美式、英式）和中文（简体、繁体）语言资源，macOS 同时匹配下划线形式的 locale 名称。Agent 的 esbuild 运行依赖保留，按目标平台和架构排除其他 esbuild 二进制。内置字体、Tika 和 Pandoc 继续完整离线分发。

## CI 与发布

[PR 工作流](../.github/workflows/check.yml) 在 Linux、macOS 和 Windows 上安装锁定依赖、检查主进程/渲染进程/PPTist 类型并运行测试。[tag 工作流](../.github/workflows/build.yml) 分别在 macOS 和 Windows 构建安装包，再上传到 GitHub Release。

macOS 打包脚本和 CI 通过 `CSC_IDENTITY_AUTO_DISCOVERY=false` 关闭自动签名发现；本地 `pnpm package` 未显式设置该变量。正式分发需要 Apple Developer ID、公证凭据和 Windows 代码签名证书，仓库不保存证书或密钥。Tika 内嵌 Java 的签名、目标机安装与安全软件验收见[文档验证缺口](document-reading.md#已知限制与验证缺口)。

## 可选集成测试

```bash
pnpm test --unit                   # 仅单元测试，不启动 Electron
pnpm test --packaged               # 显式运行本机安装包的运行时与 Agent 检查
pnpm test --integration            # 基础测试 + Tika / Pandoc + 生产构建 PDF 导出
pnpm test --live-web               # 基础测试 + 真实 Exa 搜索与网页提取
pnpm test --integration --live-web # 运行以上全部测试
```

`--integration` 仅支持 macOS 与 Windows，先准备本机 Java / Tika / Pandoc，再强制启用真实二进制测试；缺少运行时或准备失败会报错，不静默跳过。首次准备需要联网并下载较大资源。PDF 测试会构建应用，通过真实 preload/IPC 导出合成样本，结果写入 `.local/pdf-p3/build/`；测试外壳和替代保存对话框不能代表安装后的完整交互验收。

`--live-web` 请求真实公共服务，受网络与服务限流影响，不需要模型 Key。默认 `pnpm test` 不主动下载运行时，不启用 Tika 和在线 Web 测试；本机已准备 Pandoc 时会自动运行其集成测试。CI 的 Linux、macOS 和 Windows 检查继续运行默认测试。

打包调用 `pnpm test --unit`，排除真实运行时和在线服务测试，不运行 Agent 隔离、Electron 渲染或安装包执行探针。类型检查、构建、运行时准备以及 `afterPack` 的文件、摘要和许可证静态校验继续保留；不启动 SlideMind 应用。运行时准备仍可能执行 Java / Pandoc 版本检查和 Java 构建工具。

`pnpm test --packaged` 单独执行本机已生成安装包的 Tika、Pandoc 与 Agent 检查，需要先完成打包，可能启动运行时和 Electron 进程；不能与其他测试参数组合。`--unit` 同样必须单独使用，确保打包不会意外启用集成测试。手动[桌面验收工作流](../.github/workflows/agent-acceptance.yml)在打包后显式执行包内检查，不发布产物。

运行时可单独通过 `node scripts/tika-p0/prepare-runtime.mjs` 与 `node scripts/pandoc-package/prepare.mjs` 准备。Java 完整模式回退使用 `SLIDEMIND_JAVA_MODE=full` 后重新准备与打包。`scripts/*-p0/` 的清单、样本及早期诊断探针继续保留，但不作为常规回归测试入口。所有生成资源与探针报告均不提交。
