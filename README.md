# SlideMind

SlideMind 是一个面向 macOS 与 Windows 的 Electron 桌面应用工程。当前包含安全的主进程边界、React 启动页、双平台安装包配置和持续集成构建。

## 环境要求

- Node.js 22.12 或更高版本
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
├── preload/    # 受限、只读的渲染层桥接接口
└── renderer/   # React + Vite 用户界面
```

## 安全边界

- 渲染进程启用沙箱和 `contextIsolation`。
- 渲染进程不直接访问 Node.js。
- preload 只暴露冻结的运行时信息。
- 新窗口和外部导航只允许交给系统浏览器打开 HTTP(S) 地址。

## 签名与发布

本地和 CI 默认生成未签名安装包。正式分发前需要配置 Apple Developer ID、公证凭据以及 Windows 代码签名证书。仓库不会保存证书或密钥。
