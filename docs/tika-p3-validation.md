# Tika P3 安装包交付验证

日期：2026-09-15

状态：打包资源准备、按架构注入、许可证保留和安装包目录冒烟检查已实现；macOS arm64 未签名安装包与内置运行时解析冒烟已通过。macOS x64、Windows x64 的真实安装与行为矩阵仍须在对应目标环境执行。

## 固定交付链路

`scripts/tika-package/prepare.mjs` 根据目标平台调用 P0 的固定版本下载与校验流程，输出到 Git 忽略的 `out/.tika-package-runtime/<platform>/`。本机架构执行 Java 和 Tika；交叉准备只允许解压和结构准备，不能标记为执行已验证。

`scripts/tika-package/after-pack.mjs` 由 electron-builder 的 `afterPack` 钩子调用。它只向当前应用目录复制对应平台的 `runtime/`、相对路径清单和固定 Tika 配置，不复制下载归档，也不把其他架构运行时装入安装包。

`scripts/tika-package/verify.mjs` 在构建完成后从 `out/release/` 回查运行时，验证：

- 清单版本、平台和相对路径；
- Java 与 Tika 主文件存在且路径不能逃逸运行时目录；
- Tika `LICENSE`、`NOTICE` 和 Temurin `NOTICE`、`legal/` 完整存在；
- 当前主机架构上的 Java 可执行，Tika launcher 能正常启动，并用安装包内 Java、Tika 和配置解析固定中文 DOCX 样本。

构建命令：

```bash
pnpm package:mac
pnpm package:win
```

两个命令均依次执行项目校验、运行时准备、安装包构建和打包后验证。CI 使用相同命令，避免本地与发布构建出现两套装配逻辑。

## 仍需目标机验证

以下项目不能由源码单元测试或当前 macOS arm64 主机替代，完成前不得将 P3 标记为全部通过：

| 平台 | 必测项 |
|---|---|
| macOS arm64 | 从 DMG 安装；无系统 Java且断网读取；退出/重启；空格与中文项目路径；端口竞争；签名、公证及 Gatekeeper |
| macOS x64 | 从 DMG 安装；无系统 Java且断网读取；退出/重启；空格与中文项目路径；端口竞争；签名、公证及 Gatekeeper |
| Windows x64 | 从 NSIS 安装到默认及自定义含空格/中文路径；无系统 Java且断网读取；退出/重启；端口竞争；Defender/SmartScreen；代码签名 |

每个平台应使用 `scripts/tika-p0/fixtures/simple-content.doc`、`simple-content.docx` 和 `complex-content.docx` 验证 Agent 的 `document_read`，并检查应用日志与导出的诊断包不含正文、元数据、原始 Tika stderr 或本机绝对文档路径。

## 2026-09-15 macOS arm64 本地结果

- 固定资源准备通过 Tika PGP/SHA-512、Temurin SHA-256、Java `-version` 和 Tika launcher 检查。
- electron-builder 成功生成未签名 DMG 与 ZIP；应用资源中仅存在 `darwin-arm64` 运行时，没有携带下载归档或其他架构。
- 打包后检查使用安装包内 Temurin、Tika 和配置启动服务，并成功提取 `simple-content.docx` 的中文标题及结束标记。
- 应用目录约 906 MiB，DMG 与 ZIP 均约 384 MiB；其中未压缩 Tika + JRE 运行时为 222,498,163 bytes。尚无不含 Tika 版本的同构基线，不能把安装包增量等同于整个运行时大小。
- 自动签名尝试因本机钥匙串存在两个同名 Apple Development 身份而失败；按仓库默认配置关闭自动签名后构建通过。Developer ID 签名、公证、DMG 安装和 Gatekeeper 行为仍未验证。

## 验收记录格式

记录安装包文件名与 SHA-256、操作系统版本、CPU 架构、是否存在系统 Java、网络状态、样本结果、进程树回收结果、安装包体积和安装后体积。失败时只保存脱敏日志和错误类别，不纳入私密文档。
