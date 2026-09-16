# Markdown 导出 Word：Pandoc 接入方案

日期：2026-09-16。状态：P0 已开始实施；P1–P3 尚未开始。

## 1. 目标与决策

为项目内 `.md`、`.markdown` 文档提供离线导出 `.docx` 的能力，保留可编辑的标题、正文、列表和表格，并提供统一中文文档样式。

本方案以**随应用内置各平台 Pandoc 可执行文件**为基线，贴合此前关于内置方案的讨论。该选择仍属于待确认的实施提案，不代表已经批准安装包增量。先完成 P0 转换与体积验证，再决定是否进入正式接入。

不同时建设按需下载器。若体积实测不被接受，调整为按需安装将另行明确下载源、离线体验、校验、更新与失败恢复设计。

核心路线：Electron 主进程管理短生命周期 Pandoc 子进程；Pandoc 解析 Markdown 并生成 DOCX；应用负责项目授权、图片读取、保存交互、输出提交及诊断。

## 2. 当前项目依据

| 已有实现                                                                                                    | 对接方式                                                 |
| ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `src/renderer/src/components/document-editor.tsx` 使用 CodeMirror 编辑、`marked` 的 GFM 模式预览            | 导出当前编辑内容；通过样本检查 Pandoc GFM 与预览的差异   |
| `src/renderer/src/components/project-workspace.tsx` 管理文档内容、保存冲突和顶部操作栏                      | 在 Markdown 操作栏增加导出入口，维护独立导出状态         |
| `src/main/project/project-text-files.ts` 校验项目路径、符号链接、2 MiB 文本和 5 MiB 预览图片                | 复用受控资源读取规则，避免另建不一致的图片权限规则       |
| `src/main/presentation/ipc.ts` 使用主进程原生保存对话框                                                     | 借鉴目标路径选择方式，新增通道自行校验发送方             |
| `src/main/presentation/presentation-service.ts` 临时文件写入后替换，项目内输出进入 `ProjectMutationService` | Word 导出遵循相同提交及版本语义                          |
| `src/main/document/tika-runtime.ts` 区分开发态与安装态资源路径                                              | 借鉴运行时定位，不复用 Java 服务、回环端口和空闲常驻机制 |
| `scripts/tika-package/`、`electron-builder.yml`                                                             | 增加独立 Pandoc 准备与验证步骤；保留已有 Tika 打包       |
| `package.json`、`.github/workflows/build.yml`                                                               | 首版平台为 macOS arm64、macOS x64、Windows x64           |

当前没有 Markdown → Word 的业务实现。现有 Word 读取依赖 Tika，与新导出能力独立。

## 3. 产品行为与范围

### 用户流程

1. Markdown 标签页顶部出现“导出 Word”；TXT、图片、PPT 标签页不显示该入口。
2. 点击时捕获文档路径和当前内容快照，包含未保存修改；提示文字明确“导出当前编辑内容”。不自动保存或修改源文件 revision。
3. 主进程校验调用方、项目句柄、文档类型和大小，弹出保存对话框，默认桌面目录及同名 `.docx`，与当前 PPTX 入口一致。
4. 取消对话框即结束，不启动转换。选定目标后显示“导出中…”，禁用同一标签的重复导出。
5. 转换期间允许继续编辑；此次输出仍对应点击时快照。完成提示不将编辑器标记为已保存。
6. 成功显示文件位置及转换提示；失败显示可操作的原因。关闭窗口或退出应用时终止所属任务并清理临时文件。

存在磁盘冲突时仍可导出当前缓冲区，界面保留原有冲突提示，并明确这是本地编辑版本。源文件已删除或项目授权无效时拒绝导出，避免失去图片解析基准。图片按任务准备时读取，不承诺正文和多张图片是文件系统级一致快照。

### 首版内容支持

| 内容                                           | 首版行为                                                    |
| ---------------------------------------------- | ----------------------------------------------------------- |
| 标题、段落、粗体、斜体、删除线、引用、分隔线   | 转换为 Word 对应结构与样式                                  |
| 有序、无序、嵌套列表                           | 保留层级；起始编号纳入验收                                  |
| GFM 任务列表                                   | 保留完成状态为静态标记，不承诺 Word 交互控件                |
| GFM 表格                                       | 生成可编辑表格；长表格分页和宽度实际验收                    |
| 行内代码、围栏代码                             | 使用等宽样式；Mermaid 围栏作为代码保留并提示未渲染          |
| HTTP(S)、邮件和文档内锚点链接                  | 保留支持的链接；其他协议转为显示文本并提示，不访问链接      |
| 项目内 PNG、JPEG                               | 支持嵌入，单图上限沿用 5 MiB，并检查真实格式                |
| GIF、WebP                                      | 首版检测后明确提示不支持；P0 通过后可单独扩展为静态图片转换 |
| 远程、绝对路径、越界、符号链接、缺失或损坏图片 | 中止导出并指出资源问题，不静默丢图                          |
| 原始 HTML                                      | 首版检测后中止并说明不支持，避免正文或 HTML 图片被静默丢弃  |
| 数学公式、脚注、引用文献扩展                   | 不新增超出当前 GFM 预览的语法承诺；扩展能力另行验证         |

首版不加入 PDF、批量转换、自定义 Pandoc 参数、用户模板、Agent 导出工具或 PPT 制作工作流变更。

## 4. 转换架构与资源边界

```text
编辑器内容快照
  → 受限 preload / IPC
  → MarkdownWordExportService
      → Pandoc：GFM → JSON AST（沙箱）
      → 检查 AST 内容；读取并转换获准的本地图片引用
      → Pandoc：JSON AST → DOCX（沙箱 + 内置参考文档）
      → 临时输出检查
      → 目标目录临时文件 → 替换目标文件
      → 项目内修改事件与自动版本
```

采用两阶段转换，目的是对 Pandoc 实际识别的图片节点实施授权，避免用正则扫描 Markdown 漏掉引用式图片、转义和嵌套结构。标题、列表、表格等映射仍由 Pandoc 完成。

### 必须通过的 P0 技术门禁

Pandoc 官方说明 `--sandbox` 限制 reader/writer 的外部读取，也会影响 DOCX 图片和数据文件；它不是操作系统进程沙箱，不能仅凭开启参数就宣称完全隔离。

P0 验证候选固定版本是否同时支持：

- GFM → JSON 的沙箱解析，原始 HTML 可被识别并阻止；不执行任何过滤器。
- JSON → DOCX 在沙箱模式下读取内置 `reference.docx`。
- 主进程将验证过的图片字节改写为受控 data URI 后，沙箱 writer 能正确嵌入图片。
- 不含外部文件权限的内容能够转换；恶意路径及网络图片没有实际读取或请求。

data URI 路径已在 Pandoc 3.11、macOS arm64 的沙箱 writer 中验证通过，其他目标平台仍待实机复测；详见 [Pandoc P0 验证记录](pandoc-p0-validation.md)。若后续目标平台失败，暂停图片接入，重新评估显式媒体供给方式；不得悄悄移除沙箱或把整个项目目录交给 Pandoc。

### 主进程执行约束

- `spawn` 使用固定绝对二进制路径、参数数组、`shell: false`、隐藏 Windows 控制台；Markdown 和 AST 通过 stdin 传入。
- 固定 GFM reader、JSON reader 和 DOCX writer；禁止渲染端传入执行路径、命令参数、输出路径、过滤器、defaults 文件和模板路径。
- AST 元数据由应用控制；不从文档加载 bibliography、外部 include 或其他配置。拒绝原始 HTML 节点及意外原始输出节点；链接按协议规则处理。
- 仅允许应用创建的图片 data URI；用户输入的 data URI 不直接放行。检查图片格式和字节大小后再提供给 writer。
- 图片路径按源 Markdown 所在目录解析；可在项目内访问父目录资源，但最终真实路径必须留在授权项目内，并遵循现有符号链接与内部目录限制。
- 可将现有图片读取逻辑最小化提取为内部字节读取函数，原有预览接口保持兼容。不需要先转为预览 data URL 再解码。
- `cwd` 与数据目录指向任务私有目录，环境变量采用白名单，不继承 API Key 或任意 Pandoc 用户配置。不调用系统 PATH 中的其他 Pandoc。
- 初始建议限额：正文 2 MiB、图片总量 25 MiB、AST 64 MiB、DOCX 50 MiB、stderr 64 KiB、任务转换总时限 60 秒；这些是待 P0 校准的产品限制，不是性能测量结论。
- 每窗口最多一个转换任务，应用同时最多两个，超限返回忙碌状态；子进程关闭后再释放任务与清理目录。超限、超时、退出均不能留下继续运行的转换进程。
- 上述字节限制不等于操作系统内存配额；P0 测峰值内存并验证所选 Pandoc 的 RTS 堆限制支持情况，必要时加入固定堆上限。
- 日志仅记录操作 ID、版本、耗时、字节数、错误分类；不直接记录正文、AST、图片、原始 stderr 或用户绝对路径。

## 5. IPC 与模块划分

新增 `src/shared/document-export.ts`，定义专用接口，避免扩展 `document_read` 的职责。建议契约轮廓：

```ts
interface ExportMarkdownWordInput {
  path: string
  content: string
}

type ExportMarkdownWordResult =
  | { status: 'canceled' }
  | { status: 'exported'; outputPath: string; warnings: string[] }
  | { status: 'failed'; code: string; message: string }

interface DocumentExportApi {
  exportWord(
    projectHandle: string,
    input: ExportMarkdownWordInput,
  ): Promise<ExportMarkdownWordResult>
}
```

实现时 `code`、warning 应收敛为有限类型，覆盖运行时不可用、资源不支持、输入过大、忙碌、超时、转换失败、目标变化及输出写入失败。可恢复的业务失败返回判别联合；编程错误继续自然抛出，不包装成成功或空文档。

新增 IPC `document-export:word`，preload 暴露 `window.documentExport.exportWord`。主进程校验 sender 属于注册的应用窗口且请求来自其主框架、加载地址为应用允许的入口，然后解析项目句柄。不能只复制旧 handler 中对句柄的检查来替代调用方校验。

| 文件 / 目录                                                | 计划职责                                     |
| ---------------------------------------------------------- | -------------------------------------------- |
| `src/shared/document-export.ts`                            | 输入、结果、失败类型与边界校验               |
| `src/main/document-export/ipc.ts`                          | 调用方校验、原生保存对话框、生命周期绑定     |
| `src/main/document-export/markdown-word-export-service.ts` | 编排、图片授权、临时输出与提交               |
| `src/main/document-export/pandoc-runtime.ts`               | 运行时定位、子进程、超时和退出清理           |
| `src/main/document-export/pandoc-document.ts`              | 最小 AST 类型、资源遍历和内容支持策略        |
| `src/main/document-export/word-export-path.ts`             | DOCX 后缀与目标路径规则                      |
| `src/main/project/project-text-files.ts`                   | 必要时提取现有受控图片读取，保留原接口       |
| `src/preload/index.ts`、`src/renderer/src/env.d.ts`        | 类型化桥接                                   |
| `src/main/index.ts`                                        | 注册服务，退出时等待终止与清理               |
| `src/renderer/src/components/project-workspace.tsx`        | Markdown 导出入口、快照与状态提示            |
| `assets/document-export/reference.docx`                    | 待生成、验收的中文样式参考文件               |
| `scripts/pandoc-package/`                                  | 固定版本清单、下载准备、目标复制及安装态验证 |
| `scripts/after-pack.mjs`                                   | 顺序调用原 Tika hook 与新增 Pandoc hook      |

这里只建立导出功能边界，不重构其他 IPC、Tika、PPTX 或项目存储模块。

## 6. 输出提交与自动版本

1. 原生保存对话框选择目标，渲染端不能任意指定写入位置。规范化 `.docx` 后缀后若实际目标发生变化，必须对实际目标执行覆盖确认。
2. 检查真实父目录、普通文件、符号链接和内部目录限制；记录选定目标是否存在及其 revision。转换结束时再次校验目标，发现变化则停止，避免覆盖期间产生的新内容。
3. Pandoc 先写入任务私有目录，检查文件大小和 DOCX 基础结构；然后复制到目标目录内以排他方式创建的随机临时文件，最后在同文件系统替换目标。
4. 不直接让 Pandoc 写最终文件，不先删除旧文件。对 Windows 文件占用、权限不足、磁盘不足和替换失败保留旧目标并清理临时文件。
5. 输出在当前项目内时，通过 `ProjectMutationService.run` 完成最终提交，使用现有 `text-editor` 来源，触发文件树刷新和自动版本；外部输出不进入项目历史。
6. 不改动源 Markdown，也不把未保存正文伪装成已保存版本。输出完整性检查与真实 Word 视觉验收分开记录。

目标复核和 rename 之间仍不是跨进程 compare-and-swap；首版不承诺对恶意本机进程提供强隔离，这与现有桌面文件工作模式一致。

## 7. 内置运行时、体积与样式

### 打包

- 每个安装包仅携带对应架构的 Pandoc，不将三个平台二进制放在同一个包中。
- 固定经 P0 验证的版本，清单记录官方下载地址、SHA-256、平台、架构和资源相对路径；不使用运行时 latest 查询。
- 开发态建议目录为 `out/.pandoc-package-runtime/<platform>-<arch>/`，安装态为 `resources/pandoc-runtime/<platform>-<arch>/`，位于 ASAR 外。
- 准备脚本下载并校验发行物，防止解压路径越界；缓存放入 `out/`，二进制不提交到 Git。仅保留运行所需文件及许可证材料。
- 目前 `electron-builder.yml` 仅设置 Tika `afterPack`，改为小型组合 hook 顺序执行两个 hook，不覆盖原有 Tika 准备、复制和校验。
- 三个 package 命令加入 Pandoc prepare/verify；校验三平台文件类型、架构和清单。本机架构运行真实转换，跨架构静态校验不能算真实运行通过。
- 在相应平台实际安装、离线启动和转换。macOS 检查执行权限、嵌套可执行文件签名与公证；现有未签名构建不能代表已通过正式分发验收。
- 在 `docs/THIRD_PARTY_NOTICES.md` 记录 Pandoc，并随包携带适用的许可证及通知；正式分发前核对固定发行物的源代码提供义务，不只放一个上游链接便视为完成。

### 体积验证

P0 已完成三目标发行物下载、校验和最小运行时静态测量；安装包增量仍须在同一提交和相同构建设置下对比：

| 指标                                    | macOS arm64       | macOS x64         | Windows x64       |
| --------------------------------------- | ----------------- | ----------------- | ----------------- |
| Pandoc 所需运行文件总量                 | 190,187,089 bytes | 121,606,881 bytes | 233,654,249 bytes |
| 安装包压缩增量（分别记录 DMG/ZIP/NSIS） | 待测              | 待测              | 待测              |
| 安装后体积增量                          | 待测              | 待测              | 待测              |
| 文本 / 图表样本转换耗时与峰值内存       | 已测，见 P0 记录  | 待目标机          | 待目标机          |

安装包增量需包含 Pandoc、样式和通知文件，并与已有 Tika/Java 增量分开。用户尚未给出可接受体积阈值，P0 报告提交后据实决策，不自行假设“几十 MB 可以接受”。

### 中文样式

使用固定版本 Pandoc 的默认参考文档制作 `reference.docx`，维护正文、标题、引用、代码、表格、页边距和页码样式。参考文件不承担正文模板填充。首版建议 A4、2.54 cm 页边距、正文 11 pt，作为待视觉验收的初始值。

明确设置 East Asian 字体属性；字体缺失时 Word 会替换，不能承诺各机器分页相同。首版不捆绑字体。当前候选在隔离 LibreOffice 渲染中出现中文缺字，真实 Word 视觉门禁尚未通过，详见 P0 记录。参考文件生成步骤与样式决策记录在 `docs/`，并检查无个人作者信息、批注和修订残留。

## 8. 实施阶段与验收

### P0：可行性验证

选定一个候选版本，验证三目标发行物可用性；先完成本机沙箱、参考文档和受控图片实验。制作中文、嵌套列表、表格、代码、路径及恶意资源样本，形成体积和转换报告。记录实际运行平台，其余标为待验收。

通过条件：安全与图片链路成立、正文结构满足需求、运行时可分发、实测体积被接受。任何条件失败都先调整提案，不直接落地业务接入。

### P1：核心服务与 IPC

建立共享契约、主进程服务和受限桥接，覆盖运行时缺失、超时、资源授权、输出失败及生命周期。复用现有版本服务和图片边界。加入针对性测试。

### P2：界面与打包

接入 Markdown 顶部按钮、当前快照导出和提示；整合目标平台打包与样式文件，补充渲染端测试及截图。更新 README 的真实用户行为说明。

### P3：交付验收

- 单元/IPC：非法调用方、失效句柄、超大内容、绝对/越界/编码路径、符号链接、远程图片、假图片、HTML、重复任务、目标变更、已有文件保护、项目内外版本行为。
- 子进程：缺失二进制、错误版本、非零退出、输出超限、stdout/stderr 管道、超时、窗口关闭、退出清理、任务间隔离。
- 集成：使用固定真实 Pandoc 检查 DOCX 中标题、列表编号、表格、链接和媒体关系，不以 mock 替代转换验收。
- 界面：未保存快照、转换中继续编辑、取消选择、冲突状态、失败重试和成功提示；不能把导出当作保存。
- 格式和检查：运行节点与 Web 类型检查、`pnpm test`、`pnpm format:check`，以及新增打包脚本测试和安装态 verify。
- 视觉：在 macOS/Windows 的实际 Word 检查中文、字体替换、宽表、跨页列表、代码换行和图片缩放。LibreOffice 可作为补充，不能替代 Word 兼容性结论。
- 运行：三目标机器离线完成导出，不依赖系统 Pandoc、Word、Java 或网络来执行转换；Word 仅用于人工验收查看。

## 9. 主要风险、影响与回滚

| 风险                          | 处理与门禁                                       |
| ----------------------------- | ------------------------------------------------ |
| 安装包明显增长                | P0 给出同条件三平台差值，确认后才内置            |
| 沙箱无法嵌入图片或加载样式    | P0 强制验证，失败不移除安全边界                  |
| Pandoc GFM 与 marked 预览差异 | 固定语法配置，维护差异样本，不承诺网页像素级还原 |
| 中文字体及分页差异            | 内置样式，实际 Word 验收，记录依赖字体           |
| 路径越界或隐式外部读取        | 主进程资源授权、AST 检查、沙箱与请求监测样本     |
| 覆盖原文件、退出残留          | 私有转换目录、目标复核、同目录临时替换及终止清理 |
| 多运行时打包回归              | 组合 hook，保留 Tika 全链路验证                  |

不迁移任何项目数据，不修改 `.slides.json`、Agent Skill 或现有 Word 读取契约。实现按运行时、服务、界面三个逻辑变更组织；回滚可移除新增入口/桥接/服务和 Pandoc 打包步骤，恢复原 Tika hook。已导出的 DOCX 保留，不删除用户文件。

## 10. 资料与下一步

官方参考（查阅日期：2026-09-16）：

- [Pandoc 架构](https://pandoc.org/using-the-pandoc-api.html)
- [Pandoc 安装与发行物](https://pandoc.org/installing.html)
- [Pandoc 沙箱](https://pandoc.org/MANUAL.html#option--sandbox)
- [Pandoc 安全说明](https://pandoc.org/MANUAL.html#a-note-on-security)
- [Pandoc Word 参考文档](https://pandoc.org/MANUAL.html#option--reference-doc)
- [Zettlr 的 Pandoc 捆绑实践](https://github.com/Zettlr/Zettlr)

下一步建议评审本方案的内置分发方式、首版内容范围与当前编辑快照语义，然后执行 P0。此次仅产出方案，不下载运行时、不生成参考 DOCX、不变更业务代码或发布配置。
