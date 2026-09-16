# Markdown 与演示文稿导出 PDF 方案

日期：2026-09-16。状态：P1 核心服务与 P2 界面、固定依赖已实现；P3 跨平台与安装态验收待测。P0 结果见 [验证记录](pdf-p0-validation.md)。

## 1. 目标与决策

为项目内 Markdown 和 SlideMind 原生 `.slides.json` 提供离线 PDF 导出。首要目标是导出结果与应用内看到的内容和样式一致。首版不要求 PDF 文字可复制、可检索或可编辑。

- **Markdown**：复用当前 `marked` + DOMPurify 预览的解析和正文样式，以专用打印页面经 Electron `webContents.printToPDF()` 输出。连续滚动预览与分页纸张不可能逐像素相同；一致性指标题、正文、表格、代码、图片、颜色和顺序一致，分页由固定打印规则决定。
- **演示文稿**：直接复用 PPTist 实际幻灯片渲染器，逐页截取 PNG，再按原始宽高比嵌入 PDF；一张幻灯片对应一页。首版保留栅格页面，不为可选文字另建一套排版器。
- 两条链路共用保存对话框、输出路径校验、临时文件提交、项目内自动版本和诊断约定；渲染逻辑分别维护。

范围是应用内 Markdown 与原生 `.slides.json`。外部 DOC/DOCX/PPTX 的原位保真转换、PDF/A、PDF/UA、批量导出、讲者备注、动画逐帧导出和加密不在首版范围。外部 `.pptx` 当前只支持只读内容提取，不能借本功能暗示可无损导入。

## 2. 当前实现依据

| 现状                                                                                                                                 | 对接结论                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `src/renderer/src/components/document-editor.tsx` 用 `marked` 的 GFM 模式和 DOMPurify 生成预览；项目图片通过 `readPreviewAsset` 读取 | 提取共用的 Markdown 渲染规则，避免 PDF 与预览分别解析；导出必须等待所有获准图片成功加载                       |
| `src/renderer/src/styles.css` 已有 `.markdown-preview` 样式，没有打印样式                                                            | 使用同一正文样式，并新增明确的 A4 分页规则                                                                    |
| `src/main/document-export/` 已处理 Markdown 快照、图片授权、目标路径、任务取消和项目内版本                                           | 复用任务与提交语义；Word 图片读取仅支持 PNG/JPEG，而预览还支持 GIF/WebP，PDF 需共用路径授权但单独明确格式策略 |
| `src/main/presentation/presentation-renderer.ts` 已通过隐藏且沙箱化的窗口加载 PPTist，逐页等待字体/图片后 `capturePage`              | 作为 PPT PDF 的唯一页面图像来源；需把“全部 PNG 放入数组”改为逐页消费                                          |
| `src/renderer/src/components/project-workspace.tsx` 的 Markdown Word 导出使用未保存内容快照；PPTX 导出先保存再读盘                   | PDF 分别沿用这两种已存在的操作语义，界面明示                                                                  |
| `src/main/presentation/presentation-exporter.ts` 仅把基础文本、形状、图片和线条转换为 PPTX                                           | 不以“PPTX → Office/LibreOffice → PDF”作为原生演示文稿 PDF 路径                                                |

## 3. 用户行为与输出契约

1. Markdown 操作栏新增“导出 PDF”，与“导出 Word”并列。点击时冻结当前内容和源路径；允许随后继续编辑，不保存源文件或改变脏状态。存在磁盘冲突时，仍可导出本地编辑快照，并保留冲突提示。
2. 演示文稿操作栏新增“导出 PDF”，与现有“导出 PPTX”并列。先调用现有保存流程；保存冲突、失败或取消时不启动 PDF 导出。成功后读取刚保存的原生演示文稿，保证与 PPTX 导出的源版本语义一致。
3. 主进程验证调用方、项目句柄和源文件类型，弹出系统保存对话框。取消后不创建输出；选定目标后校正 `.pdf` 后缀，并对校正后的真实目标执行覆盖检查。
4. 导出过程中禁用同一源标签的重复导出；完成显示输出路径，失败显示明确原因。窗口关闭和应用退出要停止渲染、关闭隐藏窗口并清理临时文件。
5. 项目内 PDF 进入项目变更与自动版本；项目外 PDF 不进入项目历史。已有目标在导出期间发生变化时停止覆盖。

共享契约应明确来源和结果，例如 `exportMarkdownPdf(projectHandle, { path, content })` 与 `exportPresentationPdf(projectHandle, { path })`。不要用未验证的任意 `format` 字符串扩展现有 IPC。新能力仍经过 `src/shared/` → preload → 主进程，并校验发送方主框架和项目授权。

## 4. Markdown 转换链路

```text
编辑器内容快照
  → 受限 IPC 与项目资源授权
  → 与预览共用的 marked + DOMPurify 渲染
  → 独立的本地打印页面：正文样式 + @media print / @page
  → 等待字体和全部图片完成；资源失败则中止
  → Electron printToPDF（A4、背景色、固定边距）
  → PDF 结构及大小检查 → 临时文件提交
```

打印页面不包含编辑器、工具栏或预览容器的滚动条。正文样式以 `.markdown-preview` 为单一来源；打印规则仅覆盖纸张尺寸、页边距、分页与宽内容处理。标题避免单独落在页尾；表格行和图片尽量避免切断。过宽表格、长代码块和长链接必须有确定策略并纳入样本验收，不能因屏幕预览使用 `overflow: auto` 而在 PDF 中裁切正文。

图片继续按源 Markdown 所在目录解析，只允许项目授权内的有效资源。预览支持 PNG、JPEG、GIF、WebP；PDF 应先验证这四种格式在 Chromium 打印中的表现。静态 PDF 中的 GIF 必须选定可复现的帧，不能依赖打印瞬间的动画状态；无法稳定实现时应明确报错，而非静默丢图。打印页面仅接收已校验的图片字节或受控 data URL；不允许浏览器自行解析任意 `file:`、远程 URL 或项目外路径。HTML 净化规则、禁止主动内容、受限窗口配置和资源请求拦截应与当前安全设置一致。完成输出前检查 `document.fonts.ready`、所有图片的加载结果与超时，不能把缺图的 PDF 当作成功。

输出是 PDF 的页面排版，不以 Word 的 `reference.docx` 为样式来源。现有 Pandoc 继续服务 Word 导出；不直接执行 `pandoc -o file.pdf`，因为 PDF 生成需额外引擎，且 Pandoc 的 `--sandbox` 不约束 PDF 生成阶段的外部程序。

## 5. 演示文稿转换链路

```text
保存并读取最新 .slides.json
  → 验证原生演示文稿与页数
  → PPTist 隐藏渲染窗口加载完整演示文稿
  → 每页等待字体、图片和稳定帧 → capturePage 截取实际画布
  → 将当前页 PNG 按 viewportRatio 写入 PDF 页面
  → 释放当前页像素缓存，继续下一页
  → PDF 结构及大小检查 → 临时文件提交
```

保持 `src/main/presentation/presentation-renderer.ts` 的现有渲染来源、裁切区域、安全设置与页面顺序。可增加受控渲染尺寸及逐页消费接口，但不复制一套 PPTist 元素到 PDF 指令。PDF 页面无留白、无默认页眉页脚，宽高比严格取 `viewportRatio`；页面背景由 PPTist 实际渲染结果决定。动画与视频按当前渲染的静态帧处理，并在界面说明。

当前宽度 1280 px。若把 13.333 英寸宽的幻灯片填满 PDF，相当于约 96 dpi；放大和打印可能不够清晰。P0 用同一组幻灯片比较 1280、1920、2560 px 的视觉清晰度、耗时、峰值内存及 PDF 字节数，再定默认值。现有窗口高度上限为 960 px；提高宽度时必须同步提高高度并保持幻灯片比例，否则会裁切页面。不能仅通过提高 PDF 的页面尺寸改善原始截图分辨率。

PDF 合成候选为 PDFKit：官方支持从 Buffer 嵌入 PNG，且 `PDFDocument` 可通过 Node 流写入临时文件。先做本机集成样本，核对其在目标 Electron/Node 版本、Windows/macOS 打包及中文文件路径下的行为，再加入固定依赖与许可证记录。逐页消费与流式输出不等于内存恒定；仍需测量 PNG 解码和 PDFKit 内部缓存。若测量显示不可接受，再比较逐页临时图片、分批合成或其他 PDF 组件，不先引入有损 JPEG 压缩。

现有 `renderPresentationSlides()` 返回全部页的 PNG 数组，若直接用于长演示文稿会持续持有每页 Buffer。实施时应增加逐页回调或异步迭代，并让窗口只加载一次演示文稿；写入成功后释放该页引用。当前图片等待逻辑在图片报错或等待 3 秒后仍可能继续截图；PDF 导出必须识别加载失败与超时并中止，不能产生缺图的成功结果。失败、超时、取消时需关闭窗口、终止 PDF 流并删除未完成文件。

## 6. 文件、安全与资源边界

- 两类导出都由主进程决定真实目标，不接受渲染进程传入任意最终路径。校验后缀、真实父目录、已有文件类型、符号链接、项目内部目录和项目句柄；沿用 Word/PPTX 导出已有的目标复核、同目录临时文件与项目内自动版本机制。
- 对源内容、图片、单页像素、总页数、输出字节、同时任务数和超时设明确上限。具体数值由 P0 样本测量校准，不能直接把现有 500 页源文件上限视为可一次导出 500 页的性能保证。
- 导出日志只记录操作 ID、来源类型、页数/字节数、耗时和错误分类，不记录 Markdown 正文、图片、完整路径或渲染页面内容。
- PDF 以 `%PDF-` 开头、可由标准解析器打开、页数正确、页面尺寸及比例正确，才通过结构预检；结构检查不能替代视觉验收。
- PDF 内嵌幻灯片图片将无法复制或检索页面文字，这是已接受的首版产品限制。屏幕阅读器、PDF/UA 与 PDF/A 合规性不得因文件可打开而宣称通过。

## 7. 实施步骤与验收门禁

### P0：真实样本验证

1. Markdown：基于当前预览制作中文、标题层级、嵌套列表、长表、长代码、PNG/JPEG/GIF/WebP、缺失图片和跨页样本；输出 A4 PDF，并在 macOS/Windows 查看。确定动画静态帧、宽内容与分页规则。
2. PPT：使用相同 `.slides.json`，按 1280/1920/2560 px 渲染，比较编辑画布、原始 PNG 与从 PDF 还原的每页图像；记录字体、裁切、背景、叠放顺序、透明度、图表、图片和异常元素。对 1 页、典型页数及长演示文稿记录耗时、峰值内存和文件大小。
3. 验证 PDFKit 流写入、任务取消、已有文件保护与安装态离线运行。P0 仅在本机完成时，应把其他目标平台标为待验证。

### P1：核心服务

定义共享类型与受限 preload API；实现 Markdown 打印服务、PPT 逐页 PDF 服务、统一 PDF 输出提交和生命周期清理。针对 IPC 边界、资源授权、页数、目标变化、超时和取消补充测试。

### P2：界面与打包

增加两个 PDF 按钮和导出状态；Markdown 显示“当前编辑内容快照”，PPT 沿用“先保存再导出”。固定 PDFKit 依赖并更新第三方声明。完整构建不得额外下载浏览器或依赖系统 Word/LibreOffice。

### P3：交付验收

- 结构：PDF 能被解析，页数正确；PPT 每页比例与 `viewportRatio` 一致，页面无意外空白/裁切；Markdown 图片完整且正文顺序正确。
- 视觉：与应用预览/演示画面并排审查，尤其检查中文字体、表格、代码、背景图、透明层和长页分页。发现差异要记录严重级别；不能只用结构检查通过代替视觉通过。
- 稳定性：取消、关闭窗口、退出应用、输出目标被修改、磁盘空间不足、图片损坏与长演示文稿均不留下半成品或后台窗口。
- 平台：macOS arm64、macOS x64、Windows x64 的安装包离线导出；记录软件版本、系统、样本哈希、PDF 哈希、耗时、文件大小和截图。开发态通过不等于安装态通过。
- 项目检查：相关单元和渲染测试、Node/Web/Vue 类型检查、`pnpm test`、`pnpm format:check`；最终审查 diff 与第三方声明。

## 8. 影响与回滚

预计修改共享契约、preload、主进程导出服务、Markdown 预览共用模块、PPT 渲染器接口、工作区操作栏、测试、README 和第三方声明。不改 `.slides.json` 格式、PPTist 数据结构、Word 导出结果或外部 Office 文件读取契约。

若某条链路的真实视觉验收失败，只撤回该 PDF 入口及对应服务，不影响另一种格式或已有 DOCX/PPTX 导出。已成功生成的用户 PDF 保留；回滚不自动删除用户文件。

## 9. 参考资料

- [Electron `webContents.printToPDF` 官方文档](https://www.electronjs.org/docs/latest/api/web-contents)
- [Electron 安全建议](https://www.electronjs.org/docs/latest/tutorial/security)
- [PPTist 上游关于 PDF 打印差异的说明](https://github.com/pipipi-pikachu/PPTist/blob/master/doc/Q%26A.md)
- [Slidev 导出说明](https://sli.dev/guide/exporting.html)
- [Zettlr HTML/Chromium PDF 导出说明](https://zettlr.com/post/zettlr-200-released)
- [PDFKit 流与页面官方文档](https://pdfkit.org/docs/getting_started.html)
- [PDFKit PNG 图片官方文档](https://pdfkit.org/docs/images.html)
- [Pandoc PDF 与沙箱说明](https://pandoc.org/MANUAL.html)
