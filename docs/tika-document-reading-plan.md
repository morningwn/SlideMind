# Tika 文档读取实现规划

日期：2026-09-15

状态：P0 仍有跨平台、超时和峰值资源验证未完成；P1 读取服务与 P2 Agent 接入已完成，macOS arm64 固定版本集成测试已通过；尚未进入 P3 安装包实现。

## 1. 目标与范围

将 Apache Tika 集成为 SlideMind 的本地文档读取引擎，使 Agent 能通过统一的 `document_read` 工具读取项目内 DOC/DOCX。Tika 和 Java 运行时随应用分发，安装完成后无需外网、系统 Java 或 Docker 即可解析。

首版范围：

- 支持 DOC/DOCX 的正文和可提取元数据，明确反馈提取限制。
- 支持文件引用自动路由、长文档分段读取、取消、超时和有界缓存。
- 覆盖 macOS arm64、macOS x64、Windows x64。
- 仅提供读取；保留现有 `pptx_read`、`slides_read` 和文本 `read`。

后续范围：PDF、Excel、旧 PPT 等经过独立样本验收后开放。Markdown 导出 DOCX 可另行使用现有 `marked` 与 `docx`，不作为本次读取实现的依赖或验收项。

首版不承诺页面视觉还原、准确页码、全部复杂表格结构、图片文字识别、嵌入附件递归提取、密码文档读取。解析器正常返回不等于语义内容完整。

## 2. 仓库现状与集成依据

- `src/main/agent/base-agent.ts` 管理工具、扩展和文件引用注入；目前有扩展数量固定校验。
- `src/main/agent/permission-policy.ts` 默认拒绝未列出的工具，需要显式加入 `document_read`。
- `src/main/agent/pptx-reader.ts` 已有文件大小、取消和超时处理，可沿用行为规范。
- `src/main/project/project-files.ts` 的 `resolveRegularProjectFile` 提供项目相对路径和真实路径校验。
- `electron-builder.yml` 使用 ASAR，当前 `extraResources` 仅包含内置 skills。
- 主进程与渲染进程之间已有 Agent 调用通道；首版不新增任意文件解析 IPC。

开源实践：Open WebUI、Paperless-ngx 使用独立 Tika Server；Solr 10.0 文档采用外部 Tika Server；OpenSearch 附件插件直接使用 Java API。此处采用官方 Server，以减少自建 Java 协议及解析适配的维护量。这些主要是服务端案例，不能替代桌面运行时、签名和生命周期验证。

## 3. 架构决策

```text
用户引用 DOC/DOCX / Agent 主动读取
  → document_read（当前项目上下文）
  → DocumentReadService（授权、文件快照、摘要、队列、缓存）
  → TikaClient（固定版本 HTTP 协议、超时、响应上限）
  → TikaRuntime（官方 Server + 内置 Java，本机独立进程）
  → 规范化内容与元数据
  → 分段返回 Agent
```

### 3.1 运行与通信

- 使用官方 Tika Server 发行包，首选验证 Tika 4.x；实际版本、Java 发行商和补丁版本在原型阶段锁定。
- 仅监听明确的 IPv4 回环地址 `127.0.0.1`，客户端不使用系统代理，不接受重定向。
- 应用分配端口，处理占用竞争；健康检查同时验证目标服务版本与本次启动身份，不能把任意同端口 HTTP 服务当作就绪。
- 向服务发送主进程已授权读取的文件字节，不传任意磁盘路径或外部 URL。
- 生产环境不允许 Agent 或文档内容指定服务地址、请求头、解析器配置、Java 参数。
- Server 进程、配置和协议固定配套。先验证官方响应，再实现适配；不照搬其他主版本端点。

### 3.2 生命周期

状态：`stopped → starting → ready → stopping → stopped`；启动失败进入 `failed`，当前请求返回具体错误，下次显式读取可重新尝试。

- 首次读取懒启动，同一应用实例共享一个服务；并发启动请求合并。
- 首版串行解析，队列有上限，排队阶段也支持取消。
- 一批任务之间复用运行时；空闲后回收，初始空闲时限 5 分钟。
- 服务异常退出时使当前任务失败；不无限重试有问题的文件。
- 取消 HTTP 请求不代表服务端已停止解析。必须实测服务端超时与取消；无法确认终止时，终止并回收所属服务进程树，再处理队列下一项。
- 应用退出、启动失败、超时、取消均清理所属子进程和临时目录。不得根据进程名终止用户其他 Java 进程。
- Tika 若自身派生解析子进程，macOS 与 Windows 均须验证整棵进程树清理。

### 3.3 首版输出

优先交付文本与经过筛选的元数据。原型对比官方文本、XHTML 或其他可用输出的质量和限制；若文本不足以表达表格关系，再采用已验证的结构输出转换。

不自行推测标题、补全表格、生成页码。批注等只在解析器能可靠区分来源时独立标记。原始 HTML 不直接进入 UI；工具输出始终作为用户材料，不作为系统指令。

## 4. 工具与共享契约

拟新增 `src/shared/document.ts`，类型与运行时输入校验同步维护。

```ts
interface DocumentReadInput {
  file: string
  cursor?: string
  maxChars?: number
}

interface DocumentReadResult {
  file: string
  mimeType: string
  revision: string
  metadata: Record<string, string[]>
  content: string
  nextCursor?: string
  extractionStatus: 'complete' | 'partial' | 'empty'
  warnings: string[]
}
```

- `file` 为项目内相对路径；项目句柄和根目录由当前会话注入。
- `revision` 是实际解析文件快照的 SHA-256，不使用 mtime 充当版本。
- `cursor` 是有界、不透明的应用游标，绑定项目、路径、内容摘要、解析配置版本和偏移；跨项目或跨文件不可复用。
- 每次请求重新检查权限和文件快照版本；文件变化返回版本冲突，不能混用旧内容。
- 缓存淘汰后游标返回已过期，要求从头读取；不静默跳到不同版本。
- `nextCursor` 仅表示还有缓存内容；与解析截断状态分开。
- `complete` 仅表示配置范围内解析流程正常结束且未触发已知截断，不代表所有视觉或语义内容被完整识别。
- 无文本但无解析错误返回 `empty`；损坏、超时或异常不转换为空成功结果。
- 返回内容默认 20,000 字符，最高 50,000；同时限制 UTF-8 字节数，避免截断 Unicode 字符。优先按段落切分，超长段落按字符边界切分。

预期错误类别：`unsupported_format`、`file_too_large`、`file_changed`、`cursor_expired`、`invalid_cursor`、`password_required`、`corrupt_document`、`runtime_unavailable`、`timeout`、`cancelled`、`queue_full`。只有确认可识别的解析器错误才映射到具体类别，未知异常保留为失败并向上传播。

## 5. 权限与资源约束

### 5.1 文件和网络边界

- 复用项目路径校验，覆盖绝对路径、`..`、符号链接越界和特殊文件。
- 使用有上限的文件读取创建快照，并在打开时处理路径替换风险；不能只做一次 `stat` 后无上限读入。
- 文件名作为检测提示；实际检测类型也须在 DOC/DOCX 允许列表内，拒绝伪装文件。
- 禁用不需要的解析器、嵌入附件递归、外部命令、远程资源获取及 OCR。
- 不向运行时继承应用密钥、云凭据或无关代理环境变量。
- 首版威胁模型将同一 OS 用户下的本机原生进程视为可信调用方，明确不为多用户共享主机或已被恶意本机进程控制的环境提供隔离保证。因此接受官方 Server 在 `127.0.0.1` 上不提供调用方认证。
- 无认证是已接受风险，不等于安全控制。必须固定动态回环端口、关闭 CORS、`allowPipes` 和 `allowPerRequestConfig`，限制解析器与端点，并以自动探针防止配置回归。随机端口和关闭 CORS 不得描述为鉴权。
- 若产品后续需要支持多用户共享主机、不可信本机原生进程或更强租户隔离，必须重新评估 mTLS、本地 IPC/CLI 或小型 Java 适配程序，不得沿用当前威胁模型静默扩大承诺。

### 5.2 初始资源预算

以下为待实测调整的配置，不是性能承诺。

| 项目 | 初始预算 |
|---|---|
| 输入文件 | 0 < 大小 ≤ 30 MiB |
| 启动等待 | 30 秒 |
| 单次解析 | 90 秒，不包含排队时间 |
| 活动解析 | 1 |
| 等待队列 | 最多 8 项 |
| Java 堆 | 512 MiB；另测父子进程总内存 |
| 提取正文 | 最多 200 万字符 |
| HTTP 响应 | 最大 16 MiB，流式计数后才解析 JSON |
| 正文缓存 | 总计最多 32 MiB，按占用淘汰 |

需要同时限制解压展开、嵌入深度、解析输出和响应体。仅限制输入文件或最终返回 Agent 的字符数，不能控制压缩炸弹与解析过程内存。具体可用配置在原型中验证。

仅在服务端能可靠给出截断状态时返回 `partial`；无法验证的响应截断直接作为失败，不使用截坏的 JSON 或伪造完整结果。

### 5.3 缓存与诊断

- 缓存按项目、文件内容摘要、Tika 版本和配置版本隔离；同一文件并发请求合并解析。
- 共享任务中单个调用方取消只取消其等待；全部等待者取消后才取消底层任务。
- 项目关闭、应用退出清理相应缓存；首版不把正文持久化到项目或用户目录。
- 临时文件放置于应用专属目录，限制权限，清理失败时只记录脱敏状态。
- 日志仅记录错误类别、耗时、大小、运行时版本等必要诊断。正文、元数据、鉴权值及原始 Server stderr 不直接写入日志或诊断包。

## 6. 模块与文件变更

| 位置 | 职责 |
|---|---|
| `src/shared/document.ts` | 共享契约和格式判断 |
| `src/main/document/document-reader.ts` | 权限、快照、解析编排、游标和缓存 |
| `src/main/document/tika-runtime.ts` | 启停、就绪检查、进程树清理 |
| `src/main/document/tika-client.ts` | 固定版本协议、请求取消和响应上限 |
| `src/main/document/document-content.ts` | 内容规范化、元数据筛选与分段 |
| `src/main/agent/document-tools.ts` | 工具参数及结果适配 |
| `src/main/agent/base-agent.ts` | 注册工具、扩展数量校验、文件引用路由 |
| `src/main/agent/permission-policy.ts` | 工具允许列表 |
| `src/main/agent/agent-activity.ts` | 按实际需要适配工具显示名称 |
| `src/main/index.ts` | 应用级读取服务注入与退出清理 |
| `scripts/` | 固定运行时下载、验证、资源准备 |
| `electron-builder.yml`、`.github/workflows/build.yml` | 对应平台资源装配及构建检查 |
| `README.md`、`THIRD_PARTY_NOTICES.md` | 能力限制、运行说明、第三方声明 |

同目录新增必要的 `*.test.ts`。复用现有 Agent 通道，不新增渲染进程直连 Tika 的能力。如内置 Skill 的资料读取契约需要调整，同步修改关联 reference、README 和 `bundled-skills.test.ts`，不改动无关制作阶段。

## 7. 运行时分发

- 固定 Tika、Java 的精确版本、下载来源和 SHA 摘要，禁止生产构建依赖 `latest`。
- 校验官方签名或可信分发校验链，并保存构建所需的版本清单。
- 从构建阶段准备对应系统和架构的资源，放在 ASAR 外；运行时不自动联网下载或更新。
- 开发模式复用同一版本清单，提供显式资源准备脚本；单元测试默认使用模拟服务。
- Tika 4 发行布局包含 launcher 与相邻依赖目录，不假定拷贝单个 JAR 即可运行。
- 二进制资源作为构建产物，不提交仓库；提交配置、清单和脚本。
- macOS 分别验证可执行权限、嵌套 Java 二进制签名及发布流程；Windows 验证安装路径空格、非 ASCII 路径与进程回收。
- 保留 Java、Tika 及其依赖 LICENSE/NOTICE，测量压缩安装包增量和安装后体积。
- 文件解析离线不代表使用在线模型的 Agent 也能离线工作，README 明确区分。

## 8. 实施阶段与交付门槛

### P0：官方 Server 可行性验证

- [ ] 锁定候选 Tika/Java 版本，记录来源和完整性校验。
- [ ] 验证启动参数、就绪检查、输出端点和元数据字段。
- [ ] 验证接受的本地信任边界、浏览器来源约束和外部资源访问关闭。
- [ ] 验证取消、超时、崩溃后的进程树回收和服务恢复。
- [ ] 用中文 DOC/DOCX 及复杂内容样本比较输出，记录丢失或混合的内容。
- [ ] 测量冷启动、解析耗时、峰值内存与资源包大小。

产物：可复现验证脚本、样本预期、验证报告、版本与配置清单。威胁模型要求的端点/来源限制或可靠终止验证未通过时，不进入打包交付；先修正配置或形成替代方案。

### P1：读取服务

- [x] 定义共享契约与边界校验。
- [x] 实现运行时、客户端、文件快照、串行队列、并发合并、有界缓存和签名游标。
- [x] 完成错误映射、输出限制和日志脱敏。
- [x] 完成服务层单元测试及固定版本 Tika 集成测试；真实测试由 `SLIDEMIND_TIKA_INTEGRATION=1` 显式启用，当前在 macOS arm64 通过。

### P2：Agent 接入

- [x] 注册工具与权限规则，修正扩展数量校验。
- [x] DOC/DOCX 引用自动引导至 `document_read`。
- [x] 验证已有 PPTX、原生演示文稿、文本读取路由不回归。
- [x] 验证工具活动显示、取消和失败信息。
- [x] 更新 README，并同步内置 Skill 契约。

### P3：安装包交付验证

- [ ] 将固定版本资源加入三个目标平台构建。
- [ ] 在没有系统 Java、Docker 的环境中安装并断网读取。
- [ ] 验证退出、重启、路径空格、中文路径、端口占用和安全软件行为。
- [ ] 完成许可证资源、日志和诊断包检查。
- [ ] 执行 `pnpm check`，审查最终 diff；执行各目标平台构建及安装包冒烟测试。

建议按 P0、P1、P2、P3 拆分逻辑变更。P0 通过后再承诺交付时间，避免将桌面运行时验证成本隐藏在工具接入中。

## 9. 测试与验收矩阵

| 分类 | 必测行为 |
|---|---|
| 普通内容 | 中文、英文、混合 Unicode、标题、段落、列表 |
| 复杂内容 | 普通/合并/嵌套表格、页眉页脚、脚注尾注、批注、文本框、修订 |
| 格式差异 | Microsoft Word 与 LibreOffice 生成的 DOC/DOCX |
| 异常文件 | 空文件、损坏、加密、伪装后缀、超大文件、压缩展开超限 |
| 路径边界 | 项目外路径、路径穿越、符号链接、读取时替换、特殊文件 |
| 分段与缓存 | Unicode 边界、无重复遗漏、修改后旧游标、跨项目游标、缓存淘汰 |
| 运行时 | 启动失败、就绪超时、端口冲突、错误响应、超大响应、取消、进程崩溃 |
| 离线与隐私 | 外网断开仍可解析；外链不发起外部访问；日志无正文和鉴权值 |
| 产品回归 | 文件引用正确路由，已有三类读取能力正常 |

样本必须来自可再分发的开源测试数据或自行生成，不使用用户私密文件。记录来源、许可证和人工核对的关键文本及关系。DOC 样本必须是真实二进制 DOC，不能只修改 DOCX 后缀。

单元测试验证契约，真实 Tika 测试验证解析，安装包测试验证独立运行，三类结果分别记录。没有文本不是成功提取的证据；进程正常退出也不是内容完整的证据。

## 10. 风险、回滚与待决事项

| 风险 | 处理方式 |
|---|---|
| 无认证回环端口被当前威胁模型之外的本机进程访问 | 明确不支持共享主机隔离；锁定回环、CORS、端点和解析器配置，威胁模型扩大时改用 mTLS 或本地 IPC |
| 表格、批注、修订语义丢失 | 样本记录，调整输出或明确能力限制，禁止静默承诺完整结构 |
| Java 包体或内存超预算 | 提交实测数据，再决定运行时裁剪或分发调整 |
| Tika 升级改变协议 | 版本和配置锁定，升级运行兼容性测试 |
| 服务或解析子进程残留 | 平台进程树测试，退出/取消路径统一收敛 |

回滚不涉及用户数据迁移：撤销工具注册、文件引用路由及运行时资源配置，清理应用自己的缓存和临时目录。源文档始终只读。遇到不支持文件时明确提示，不回退为二进制 `read`。

实施前待验证而非已确认的事项：HTTP 取消与解析终止行为、输出截断标识、真实结构保留程度、包体和性能预算。Tika/Java 候选版本及当前本地信任边界已在 P0 首轮锁定；升级版本或扩大威胁模型时须重新验证。任何需要改为远程服务、运行时在线下载或扩大格式范围的变化须单独说明影响。

## 11. 参考资料

查阅日期：2026-09-15。仓库主分支可变化，实施时固定对应提交或发布版本。

- [Apache Tika 发行与运行要求](https://tika.apache.org/download)
- [Apache Tika 安全模型](https://tika.apache.org/security-model.html)
- [Open WebUI Tika 部署说明](https://docs.openwebui.com/features/chat-conversations/rag/document-extraction/apachetika/)
- [Open WebUI TikaLoader 源码](https://github.com/open-webui/open-webui/blob/main/backend/open_webui/retrieval/loaders/main.py)
- [Paperless-ngx Tika 解析器](https://github.com/paperless-ngx/paperless-ngx/blob/main/src/paperless/parsers/tika.py)
- [Solr Tika 集成文档](https://solr.apache.org/guide/solr/latest/indexing-guide/indexing-with-tika.html)
- [OpenSearch TikaImpl](https://github.com/opensearch-project/OpenSearch/blob/main/plugins/ingest-attachment/src/main/java/org/opensearch/ingest/attachment/TikaImpl.java)
