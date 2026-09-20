# 文档读取与导出

本地读取使用 Tika，Markdown 导出使用 Pandoc 或 Electron 打印，演示 PDF 使用 PPTist 渲染。运行时准备和验证命令见[开发指南](development.md)。

## 能力与调用链

`document_read` 用于项目内 DOC、DOCX、XLS、XLSX 和 PDF 的文本与筛选后元数据，文件引用自动路由到该工具。PPTX、原生演示文稿和普通文本继续使用各自的读取工具。不提供页面或工作表视觉、准确页码、公式计算结果语义、OCR、嵌入附件递归、密码解密或复杂表格的无损结构。

```text
Agent document_read
  → DocumentReadService：项目路径校验、文件快照、队列与缓存
  → TikaClient：/detect 检测类型 → /rmeta/text 提取
  → TikaRuntime：内置 Java + Tika Server，动态 127.0.0.1 端口
  → 正文规范化、元数据白名单、分段返回
```

复用现有 Agent 通道，渲染进程不能直连 Tika。读取服务不修改源文件，正文缓存保存在内存；返回给 Agent 的工具结果仍会随会话记录保存。

文件名通过 HTTP `Content-Disposition` 传入：`filename` 使用 ASCII 安全回退，`filename*` 使用 RFC 8187 的 UTF-8 百分号编码，支持中文、重音字符和 emoji。请求构造与网络传输分别处理，非法请求参数不包装成“无法连接 Tika 运行时”。

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

## 内置运行时

版本与下载校验以 [Tika / Java 清单](../scripts/tika-p0/runtime-manifest.json)和 [Pandoc 清单](../scripts/pandoc-p0/runtime-manifest.json)为准。安装包支持 macOS arm64、macOS x64、Windows x64，不在运行时自动下载或升级。

Java 默认由固定版本 JDK 的 jlink 压缩并裁剪模块，保留字体、字符集、地区数据、动态加密提供程序及许可证。支持 `minimal`（默认）、`compressed`（保留原模块，仅压缩）和 `full`（原版 JRE）三种模式；命令参数 `--java-mode` 优先于环境变量 `SLIDEMIND_JAVA_MODE`。修改模式后需重新准备和打包，不影响已安装应用。

模块清单在 [java-runtime.mjs](../scripts/tika-p0/java-runtime.mjs)。跨架构准备只验证结构；jdeps 静态分析无法发现所有反射和动态依赖。升级运行时需同步校验代码、协议测试及[第三方声明](THIRD_PARTY_NOTICES.md)，并在目标系统验证真实解析。

## 测试样本

样本位于 `scripts/tika-p0/fixtures/`，由仓库内源文件自行生成，不含用户或第三方文档内容。以下命令均从仓库根目录执行。

- `simple-content.docx`：中文、英文、混合 Unicode、标题、段落和列表。
- `simple-content.doc`：由 `simple-content.docx` 通过 LibreOffice 的 `MS Word 97` 导出器生成，是 OLE2 复合文档，不是改后缀文件。
- `complex-content.docx`：表格、分页、页眉、页脚和多语言字符。
- `simple-spreadsheet.csv`：Excel 样本的源数据。
- `simple-spreadsheet.xls` / `simple-spreadsheet.xlsx`：由 LibreOffice 从源 CSV 导出的真实 Excel 文件。
- `simple-content.pdf`：由 LibreOffice 从 `simple-content.docx` 导出的 PDF。
- `expectations.json`：自动探针必须找到的关键文本与已知限制。

生成 DOCX 需要 Python 3 和 `python-docx`：

```bash
python3 scripts/tika-p0/fixtures/generate.py
```

生成 DOC、Excel 和 PDF 需要 LibreOffice：

```bash
soffice --headless --convert-to 'doc:MS Word 97' \
  --outdir scripts/tika-p0/fixtures \
  scripts/tika-p0/fixtures/simple-content.docx
soffice --headless --convert-to xls \
  --outdir scripts/tika-p0/fixtures \
  scripts/tika-p0/fixtures/simple-spreadsheet.csv
soffice --headless --convert-to xlsx \
  --outdir scripts/tika-p0/fixtures \
  scripts/tika-p0/fixtures/simple-spreadsheet.csv
soffice --headless --convert-to pdf \
  --outdir scripts/tika-p0/fixtures \
  scripts/tika-p0/fixtures/simple-content.docx
```

## 导出与文件保存

Markdown 可将点击时的未保存内容快照导出为 Word 或 PDF，导出不改变源文件保存状态，转换期间可继续编辑。演示文稿导出 PPTX 或 PDF 前先保存 `.slides.json`；保存冲突、失败或取消会阻止导出。

界面导出由主进程校验调用方、项目句柄、源文件和目标，通过系统保存对话框选择路径。同目录临时文件完成后才提交；目标在转换期间变化时停止覆盖。项目内输出参与自动版本，项目外输出不进入项目历史。关闭窗口和退出应用会取消所属任务并清理资源。

## Markdown → Word

使用内置 Pandoc 3.11，执行 GFM → JSON AST → DOCX 两阶段转换。应用检查 AST，并将授权图片字节转换为内部 data URI；两阶段启用 Pandoc sandbox，使用任务私有目录、固定参数和白名单环境。该选项不等同于操作系统沙箱。

支持标题、正文、列表、GFM 表格、代码、HTTP(S)/邮件/文档内链接及项目内 PNG/JPEG。任务列表为静态标记；Mermaid 保留代码并提示未渲染。不支持协议的链接转为显示文本并提示。原始 HTML、远程/绝对/越界/符号链接图片、GIF/WebP、缺失或损坏资源会中止转换。

开发前运行 `node scripts/pandoc-package/prepare.mjs`，真实二进制集成测试使用 `pnpm test --integration`。打包应用携带目标架构 Pandoc、中文参考样式、许可证及对应源码归档，不依赖系统 Pandoc、Word 或网络。版本及完整性信息见 [运行时清单](../scripts/pandoc-p0/runtime-manifest.json)。

字体由目标系统提供，不捆绑字体。真实 Microsoft Word 中的中文、字体替换、宽表、跨页列表、代码和图片排版尚未完成 macOS/Windows 验收；DOCX 结构检查与 LibreOffice 渲染不能替代 Word 验收。

## Markdown → PDF

复用 Markdown 预览的 HTML 渲染和净化，在受限隐藏打印页等待字体与图片后，通过 Electron `printToPDF` 输出 A4 PDF。正文样式与预览共用，打印规则负责分页与宽内容处理；不使用 Pandoc PDF 引擎。

仅加载已授权的项目图片，支持 PNG/JPEG/GIF/WebP，加载失败则中止。正文最多 2 MiB、图片最多 100 个、图片总量最多 25 MiB。复杂长表格、字体替换及与预览逐页对照仍需视觉验收。

## 演示文稿 → PDF / PPTX

PDF 使用 PPTist 实际渲染的逐页截图，通过 PDFKit 合成，保留页面比例。当前支持 1–30 页，目标截图宽度 2560 像素，单页 PNG 最多 20 MiB、截图最多 1200 万像素；PDF 导出超时为 120 秒。限制以 [PDF 服务](../src/main/pdf-export/pdf-export-service.ts) 为准。

每页为栅格图像，文字不可复制或搜索；动画与视频使用静态画面。高复杂度文稿、图表、背景图、异常元素、视频帧及峰值内存尚未全面验收，不承诺 PDF/A 或 PDF/UA 合规。

PPTX 从 `.slides.json` 派生，支持基础文本、形状、图片和线条；外部 PPTX 仅可只读提取，不支持无损导入或原位编辑。导出成功不能证明 Office 字体、裁切、排版与兼容性通过。

## 已知限制与验证缺口

上述格式和资源限制是当前实现约束。以下属于尚需目标环境验证的项目，不能仅凭自动测试或探针认定通过：

- macOS arm64 / x64 与 Windows x64 的安装后运行、离线解析和导出、签名及安全软件行为。
- Tika 慢解析取消、超时后的进程回收、峰值资源、外部访问诱捕、异常压缩包及复杂办公文档。客户端取消不等于服务端解析已经停止。
- Microsoft Word / PowerPoint 中的字体替换、宽表、分页、图片裁切与实际排版；结构回读和 LibreOffice 渲染不能替代 Office 验收。
- PDF 复杂长表格、图表、背景图、视频静态帧与峰值内存，以及磁盘不足、应用退出等稳定性场景。

自动测试覆盖输入授权、转换、取消、目标冲突与界面快照；包内探针使用测试外壳或替代保存对话框，不能代替真实安装与用户交互验收。

客户端回归测试执行真实 Fetch 请求构造以检查请求头编码；Tika 集成测试对各格式样本分别使用 ASCII 和 Unicode 文件名验证真实解析。它们不依赖用户教材，也不代表已通过 Windows 11 安装包验收。
