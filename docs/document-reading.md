# 本地办公文档读取

本文描述当前实现；历史实测与尚未完成的验收统一见 [Tika 验证记录](tika-validation.md)。

## 能力与调用链

`document_read` 用于项目内 DOC、DOCX、XLS、XLSX 和 PDF 的文本与筛选后元数据，文件引用自动路由到该工具。PPTX、原生演示文稿和普通文本继续使用各自的读取工具。不提供页面或工作表视觉、准确页码、公式计算结果语义、OCR、嵌入附件递归、密码解密或复杂表格的无损结构。

```text
Agent document_read
  → DocumentReadService：项目路径校验、文件快照、队列与缓存
  → TikaClient：/detect 检测类型 → /rmeta/text 提取
  → TikaRuntime：内置 Java + Tika Server，动态 127.0.0.1 端口
  → 正文规范化、元数据白名单、分段返回
```

复用现有 Agent 通道，渲染进程不能直连 Tika。源文档只读，不把正文持久化到项目或用户目录。

## 工具契约

共享类型及错误码以 [document.ts](../src/shared/document.ts) 为准。

| 字段                                   | 含义                                   |
| -------------------------------------- | -------------------------------------- |
| 输入 `file`                            | 当前项目内的相对路径                   |
| 输入 `cursor`                          | 可选的不透明签名游标，继续读取同一快照 |
| 输入 `maxChars`                        | 默认 20,000，允许 1–50,000             |
| 输出 `file`、`mimeType`、`revision`    | 文件、检测类型、实际快照的 SHA-256     |
| 输出 `content`、`metadata`、`warnings` | 本段正文、筛选后元数据和读取限制       |
| 输出 `nextCursor`                      | 还有缓存正文时返回，与解析截断状态无关 |
| 输出 `extractionStatus`                | `complete`、`partial` 或 `empty`       |

每次请求重新读取并校验快照；文件变化返回 `file_changed`，缓存淘汰后续读返回 `cursor_expired`。游标绑定项目、文件、内容摘要、配置版本和偏移，不能跨文件或跨项目使用。分段优先保留段落边界，并避免拆开 Unicode 代理对。

`complete` 表示未识别到正文输出限制，不证明视觉或语义完整；`partial` 表示有正文且识别到输出限制；无正文时为 `empty`。禁用嵌入递归产生的限制标记不单独视为正文失败。无效 JSON、超大响应和解析错误仍按失败处理。

## 生命周期与资源限制

运行时首次读取时启动，合并并发启动，空闲 5 分钟后停止。就绪检查结合固定版本和本次启动身份；失败请求返回错误，后续读取可重新启动。解析串行执行，同一快照的并发请求合并；单个等待者取消不影响其他等待者，全部取消后中止底层请求并停止所属运行时。

| 项目                 | 当前配置                                                                 |
| -------------------- | ------------------------------------------------------------------------ |
| 输入文件             | DOC、DOCX、XLS、XLSX 或 PDF；非空，最多 30 MiB；后缀与检测 MIME 必须匹配 |
| 启动等待             | 30 秒                                                                    |
| 客户端请求超时       | `/detect` 与 `/rmeta/text` 各 90 秒；不构成整个读取流程的总时限          |
| Server 任务限制      | 总任务 90 秒，无进展 30 秒                                               |
| 解析并发 / 等待队列  | 1 / 最多 8 项                                                            |
| Java 堆              | launcher 256 MiB，解析 fork 512 MiB；不等于进程总内存                    |
| 提取正文 / HTTP 响应 | 200 万字符 / 16 MiB                                                      |
| 正文缓存             | 按正文 UTF-8 字节计费，最多 32 MiB；不等于服务总内存                     |

配置来源：[读取服务](../src/main/document/document-reader.ts)、[客户端](../src/main/document/tika-client.ts)、[运行时](../src/main/document/tika-runtime.ts)、[Tika 配置](../scripts/tika-p0/tika-config.json)。取消与超时的真实进程回收仍需慢样本和各目标平台验证，不能仅凭 HTTP 取消成功判定服务端解析已停止。

## 安全与诊断边界

- 主进程校验项目真实路径、普通文件、符号链接边界和读取期间替换，向 Tika 发送文件快照字节。
- 仅加载 Office、OOXML 和 PDF 解析器，限制嵌入递归、XML 深度、压缩展开和输出；关闭 CORS、Pipes 请求端点及每请求配置，不允许 Agent 指定服务地址、Java 参数或解析配置。
- Server 使用动态回环端口且不提供调用方认证。同一 OS 用户的本机原生进程被视为可信，不承诺共享主机或恶意本机进程隔离；随机端口与关闭 CORS 不是鉴权。
- Java 子进程只继承最小环境，应用密钥和代理配置不传入。退出时清理所属进程与临时目录，不按进程名终止其他 Java 实例。
- 日志仅保留脱敏标识、错误、耗时、大小和版本等诊断信息，不直接记录正文、元数据或原始 Tika stderr；目标机日志与诊断包仍需复核。

## 开发与打包

运行时固定为 Apache Tika Server Standard 4.0.0 和 Eclipse Temurin JRE 21.0.12.1+1，下载地址、摘要与签名信息以[版本清单](../scripts/tika-p0/runtime-manifest.json)为准。资源准备需要联网；解析本身不需要联网、系统 Java 或 Docker。

```bash
node scripts/tika-p0/prepare-runtime.mjs
node scripts/tika-p0/run-probe.mjs
SLIDEMIND_TIKA_INTEGRATION=1 pnpm exec vitest run src/main/document/tika-integration.test.ts
```

最后一条为 POSIX shell 写法；PowerShell 先设置 `$env:SLIDEMIND_TIKA_INTEGRATION='1'` 再运行 Vitest。真实集成测试仅在未设置开关时跳过，必须确认输出未跳过。样本说明见 [样本说明](tika-fixtures.md)。

打包使用 `pnpm package`、`pnpm package:mac` 或 `pnpm package:win`，链路为：

1. `scripts/tika-package/prepare.mjs` 复用固定下载、摘要与 Apache 发布签名校验，按目标架构准备资源。默认使用同版本 Temurin JDK 的 `jlink` 生成压缩且裁剪模块的 Java 运行时；保留字体、全部字符集和地区数据、所需加密提供程序及上游许可证。构建 JDK 与下载归档不进入安装包。
2. `after-pack.mjs` 通过 electron-builder `afterPack` 将对应架构运行时放到 ASAR 外的 `resources/tika-runtime/<platform>/`，保留 launcher 相邻依赖及许可证，校验链接运行时的模块清单与模块许可证。
3. `verify.mjs` 检查清单、路径和许可证，在本机架构执行 DOC、简单及复杂 DOCX、XLS、XLSX、PDF 六样本文本检查；交叉架构只检查结构，不视为运行验收。

`prepared-runtime.json` 的 `javaOptimization` 记录模式、原始/实际模块、裁剪前后 Java 字节数及构建选项。可通过 `--java-mode full|compressed|minimal` 选择完整原版、仅压缩或压缩并裁剪；默认 `minimal`。设置 `SLIDEMIND_JAVA_MODE=full` 后运行打包命令可回退至完整原版。实现、依赖分析、实测与限制见 [Java 运行时优化](java-runtime-optimization.md)。

真实集成测试支持 `SLIDEMIND_TIKA_RUNTIME_ROOT` 指定对照运行时根目录；显式启用测试但未准备运行时会报错，不再静默跳过。

支持的打包目标为 macOS arm64、macOS x64、Windows x64。运行时不自动在线下载或升级。升级时需同步版本清单、代码版本校验、协议测试及[第三方声明](THIRD_PARTY_NOTICES.md)，重新执行[验收矩阵](tika-validation.md#待完成验收)。
