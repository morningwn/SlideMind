# Agent 与工具

Agent 在主进程按会话运行，由应用显式注入 DeepSeek 模型、内存凭据、工具与只读内置 Skill。模型设置与用户行为见 [README](../README.md#agent-与模型配置)。

## 配置隔离

| 阶段                 | 入口                                                                                          | 应用控制与验证                                                                           |
| -------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 模块导入             | Pi config.js 的 PI_PACKAGE_DIR 和包元数据                                                     | 补丁取消环境路径覆盖，只定位已安装包；独立进程在首次导入前监测文件访问                   |
| 模型初始化           | ModelRuntime 默认服务商目录、auth.json、models.json、models-store.json                        | 每会话内存凭据与模型存储；modelsPath 为 null；仅传入 DeepSeek provider                   |
| 模型注册、认证刷新   | 全部内置服务商的环境变量与登录文件发现                                                        | 补丁支持注入 providers/authContext；应用上下文不提供环境变量与外部文件，关闭网络目录刷新 |
| 请求编码             | Pi AI 的 PI_CACHE_RETENTION 等环境回退                                                        | 补丁仅接受显式 scoped env；默认缓存参数不受进程环境影响                                  |
| 请求发送             | OpenAI SDK 的 OPENAI_API_KEY、ADMIN_KEY、BASE_URL、ORG_ID、PROJECT_ID、CUSTOM_HEADERS、LOG 等 | 固定版本补丁关闭 SDK 环境读取；DeepSeek Key、URL 继续显式传入；测试检查真实编码后的请求  |
| 会话创建             | settings.json 与项目设置合并                                                                  | 每次创建使用 SettingsManager.inMemory；压缩启用、分析与安装遥测关闭                      |
| 资源创建、reload     | 扩展、Skill、AGENTS.md、SYSTEM.md、APPEND_SYSTEM.md、提示词、主题                             | 受控 ResourceLoader，只接收内部工厂与指定内置 Skill；禁止默认扫描与扩展发现              |
| 工具执行             | 文件读写与搜索、文档、PPT、模板、Todo、Web                                                    | 固定权限在 execute 边界执行；路径与网络负向测试分别位于对应模块                          |
| 设置保存、下一次执行 | userData/agent-config.json                                                                    | 系统安全存储解密；请求执行时加载快照；变化时使用原会话文件重建，不中断当前请求           |
| 运行状态             | 项目 .slideMind/convs、userData 下 web-cache                                                  | 属于明确指定的运行数据，不作为配置来源；保留旧会话与分支快照                             |
| 延迟解析             | Readability/linkedom、Tika、Pandoc、PPTist                                                    | 使用固定服务及显式运行时路径；无浏览器登录资料或服务商凭据自动导入                       |

Pi SDK、Pi AI 和 OpenAI SDK 的补丁均在 `patches/`，由 pnpm 自动应用；不在应用运行时拦截 fs、不改写 HOME、不修改进程环境。测试子进程使用临时 HOME 和虚构凭据，这是隔离夹具，不是生产实现。

## 权限与文件访问

模型只能调用应用明确注册的 21 个工具；文件操作限制在当前项目允许文件和显式提供的只读内置 Skill。未知工具、Shell、PowerShell、MCP 默认拒绝。权限不接受项目或用户策略文件覆盖，也不提供运行时永久授权。

本实现约束应用接管的模型工具调用，不是操作系统沙箱。主进程和内置代码仍拥有进程权限；逐段路径检查无法保证抵御本机其他进程并发替换目录。若未来运行不可信扩展或要求抵御恶意并发文件树修改，必须另行设计进程或系统隔离。

`FilePolicy` 在会话创建时保存规范化的项目根和只读根，仅信任显式根路径的别名。相对路径以项目根解析；绝对路径仍须在授权根内。逐段 lstat，拒绝符号链接、断链、硬链接普通文件、非目录父项、越界和受保护路径；新建文件检查所有已存在父项。文件读取使用 O_NOFOLLOW 打开、检查文件描述符并限制读取字节数。写入继续经过项目版本记录服务，并在写操作处复查权限。

| 工具                                      | 输入与执行边界                                                                                     |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------- |
| read                                      | 路径策略 → 受限读取操作 → Pi 文本截断/图片结果；普通读取最大 20 MiB。                              |
| write、edit                               | 路径策略 → 受控 mkdir/read/write → 现有 ProjectMutationService，保留版本与变更事件。               |
| grep、find、ls                            | 缺省项目根；应用自行有界遍历，每项重查策略，不调用或下载 rg/fd。                                   |
| document_read、pptx_read                  | file 先经固定策略，随后保留文档服务的项目路径、格式与解析限制。                                    |
| slides_create、slides_write               | 主文件写权限；slides_write 每个本地图片 source 另验读权限；随后保留 revision、图片读取与存储校验。 |
| slides_read、slides_render、slides_review | 主文件读权限；沿用演示服务和隔离渲染请求限制。                                                     |
| slides_export                             | 主文件读权限与显式/默认输出写权限；随后保留现有导出校验。                                          |
| download_asset                            | 输出路径写权限；网络地址与字节限制由已有安全下载服务负责。图片预览仅使用该服务生成的内部临时文件。 |
| Web 四工具                                | 只授予既有内置工具，网络、重定向、正文与缓存授权由 Web 安全实现负责，见下文 Web 工具。             |
| todo、template_query                      | 仅会话清单和内置模板，保留各自参数校验，不授予通用文件访问。                                       |

读写与搜索拒绝 `.git`、`.slidemind`、`node_modules`、`out`、`coverage`、`release-dist`、`.ssh`、`.aws`、`.gnupg` 目录；写入额外拒绝 `.pi`。凭据清单包括 `.env`、`.env.*`、auth.json、credentials.json、application_default_credentials.json、常见 SSH 私钥名、.npmrc、.netrc，以及 pem/key/p12/pfx 文件。清单不能识别所有敏感业务资料。

只读 Skill 根对写入的拒绝优先于项目授权，即使 Skill 位于项目内也不可写。项目普通文档仍可按权限显式读取；禁止外部配置自动加载并不等于禁止阅读所有 `.pi` 文件。

## 文件搜索

不读取 `.gitignore`，普通隐藏文件同样受固定策略管理；这一差异已写入工具说明。支持 grep 正则、literal、大小写、glob 与上下文，find 使用 Node glob。最多扫描 10000 个目录项、深度 64、单文件 2 MiB、总文本 16 MiB；默认结果上限 grep 100、find 1000、ls 500，输出最多 50 KiB，截断明确提示。

正则和 glob 在可终止 Worker 执行，匹配预算 1.5 秒、V8 old generation 128 MiB；整个操作预算 10 秒，取消或超时终止 Worker。V8 配额不是进程 RSS 的严格上限。

## Web 工具

| 工具               | 输入与行为                                                                                                                                                                         |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| web_search         | query/queries 二选一，最多 3 查询，每查询最多 10 结果；domainFilter 支持域名包含及 `-` 前缀排除；recencyFilter 支持 day/week/month/year（1/7/30/365 天），通过搜索服务发布日期过滤 |
| source_check       | 同搜索参数；额外抓取前三个结果，返回来源、正文/摘要类别、内容哈希、抓取时间及错误；不生成真假判断或置信度                                                                          |
| fetch_content      | url/urls 二选一，最多 5 URL；只取公开 HTTP(S) HTML、文本和 PDF；禁止地址内凭据                                                                                                     |
| get_search_content | responseId、index、offset、limit；单次最多 20000 字符；findText 只做字面量查找，不支持正则或模糊匹配                                                                               |

工具结果提供 responseId 和有界预览。`search_excerpt` 表示搜索服务片段，`page` 表示应用获取的正文；抓取失败明确记录。正文最多保留 100000 字符，超出时附截断标记；contentHash 对缓存中的正文计算。发布日期仅在服务商实际返回时保留，不推测日期。外部内容作为材料，不改变应用权限或系统指令；这一标记不是提示词注入的完全防护。

任意 provider/端点、代理、Cookie、凭据命令、Git 克隆、音视频、OCR、raw/answer、queryIndex/urlIndex 选择器及模糊查找不受支持。旧会话仍可展示，但旧插件 responseId 无法用于新缓存，须重新搜索/抓取。

固定调用 Exa 公共 MCP 的 `web_search_advanced_exa`，不开放通用 MCP，不读取本机凭据，不提供付费配置或失败回退。公共接口可能限流。

- 配置固定在应用实现中；不读取 web-search.json、环境代理、服务商 Key、Google ADC、浏览器资料和历史回退配置，不启动凭据命令。首次加载即不导入旧插件。
- 网络复用项目已有 AntiSSRFPolicy 依赖，由 HTTP/HTTPS agent 在实际连接处校验地址；公开请求禁止本机、私网和保留地址。每次重定向重新建立受控请求，最多 5 次；搜索 POST 不接受重定向。
- 单个网络操作 30 秒，单次工具 90 秒；当前批量串行执行。网页/文本最大 5 MiB，PDF 最大 20 MiB；按响应流计数，不能依赖 Content-Length。请求 identity 编码，非 identity 压缩响应直接拒绝，不执行无界解压。网页类型上限在完整响应后复核，所有响应下载上限为 20 MiB。
- HTML 使用固定 Readability 0.6.0 和 linkedom 0.16.0。解析 Worker 不执行页面脚本、不加载子资源，限制元素数 50000、V8 old generation 128 MiB、解析时间 10 秒；超时和取消终止 Worker。V8 配额不是整个进程 RSS 的严格上限。输出纯文本而非可执行 HTML。[Readability 官方安全说明](https://github.com/mozilla/readability#security)
- PDF 字节直接交给现有受控 Tika 服务，校验大小、PDF 标识和检测到的 MIME，传递取消信号；沿用 Tika 的服务端解析约束与输出上限。无文本 PDF 明确报错，不声称完成 OCR。公开网络请求无法访问内部 Tika 回环地址。
- 缓存位于应用 Agent 目录的 web-cache 下，项目路径与会话 ID 的哈希区分目录；当前会话分支工具结果中的引用决定读取权限。每会话最多 32 项/16 MiB，单项最多 2 MiB，读取 TTL 一小时；写入时清理该会话超时/超额文件。过期文件不是定时删除，历史会话目录未设置跨会话全局容量门槛，不能宣称全局磁盘使用恒定。
- reload/恢复通过当前分支和磁盘缓存读取，不保存模块级结果 Map。缓存只允许 UUID 标识和内部生成的文件名，不能转化为模型提供的任意路径。未知 ID、越权、过期和缺失明确失败。
- 不记录查询正文、网页正文或凭据。网络状态错误只返回有界状态信息，预期解析错误明确报告；编程错误不作默认成功处理。

## 验证边界与依赖维护

自动测试使用模拟模型响应，覆盖配置隔离、请求编码、工具、压缩和会话恢复；不能证明真实模型的缓存收益或长任务语义恢复。真实付费模型验收和 Windows 原生验收尚未执行，Intel 实机也未验证；Rosetta 探针不能替代原生平台验收。

Web PDF 到 Tika 全链路、DNS 重绑定对抗性验证及完整中文搜索质量仍未验收。权限检查不提供恶意本机进程隔离。Web 缓存没有跨会话全局容量上限。

Pi、Pi AI 和 OpenAI SDK 升级时必须同时复核 `patches/`、宿主注入与锁文件，并执行独立进程隔离、请求编码、项目测试和目标平台安装包验证。测试命令见 [开发指南](development.md)。
