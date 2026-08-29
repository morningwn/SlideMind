# SlideMind

SlideMind 是一个面向 macOS 与 Windows 的 Electron 桌面应用工程。当前包含安全的主进程边界、项目启动台、双平台安装包配置和持续集成构建。

## 环境要求

- Node.js 22.19 或更高版本
- pnpm 11.15.1

## 本地开发

```bash
pnpm install
pnpm dev
```

## 验证与构建

```bash
pnpm check         # TypeScript + 单元测试
pnpm build         # 生产构建
pnpm package:mac   # macOS DMG/ZIP，Intel + Apple Silicon
pnpm package:win   # Windows NSIS 安装包，x64
```

构建产物写入 `release-dist/`。

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
- 当前服务商为 DeepSeek，可选择 DeepSeek V4 Flash 或 DeepSeek V4 Pro。
- 模型配置入口位于启动台右上角，不会阻塞项目选择；后续可从这里再次进入。
- API Key 通过 Electron 系统安全存储加密，并写入应用的 `userData/agent-config.json`。渲染进程只能读取非敏感配置状态，无法读取已保存的 Key。
- preload 已暴露受限的 `window.agent.prompt(input)` 接口，供后续编辑器功能调用基础 agent。

## 项目启动台

- 首页展示本机最近打开的项目，并支持按项目名称或路径搜索。
- “选择项目”会打开系统文件夹选择器；选择成功后进入项目工作区。
- 最近项目按打开时间排序，去重后保存在应用的 `userData/recent-projects.json`。
- preload 只暴露类型化的项目列表、选择、打开与移除记录接口，渲染进程不直接访问文件系统。

## 安全边界

- 渲染进程启用沙箱和 `contextIsolation`。
- 渲染进程不直接访问 Node.js。
- preload 只暴露冻结的运行时信息和经过校验的 agent IPC 方法。
- 新窗口和外部导航只允许交给系统浏览器打开 HTTP(S) 地址。

## 签名与发布

本地和 CI 默认生成未签名安装包。正式分发前需要配置 Apple Developer ID、公证凭据以及 Windows 代码签名证书。仓库不会保存证书或密钥。
