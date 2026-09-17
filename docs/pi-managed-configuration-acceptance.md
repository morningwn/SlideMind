# Pi 配置统一管理验收

日期：2026-09-17。固定依赖版本以 pnpm-lock.yaml 为准。

## 配置入口清单

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

## 自动验收

`pnpm test:agent-isolation` 构建应用 Agent 测试入口，并分别启动干净与注入标记变量的独立子进程。文件观察器先进行拒绝自检，再在模块导入前包装同步、回调及 Promise 文件访问函数和模块解析。被 SDK 捕获并忽略的访问失败也会计数并令验收失败。

测试走真实 BaseAgentService、SDK 请求编码、Todo/文件工具、两次资源重载、设置变化后的原文件恢复、并行会话、原生压缩与分支恢复。网络响应由本地模拟，不读取真实凭据，不产生模型费用。请求校验包括目标 URL、Authorization、外部请求头、模型和缓存参数。Windows 和 macOS 应各自运行；单一系统结果不证明另一个系统通过。

`node scripts/agent-isolation/verify-package.mjs` 使用本机安装包的可执行文件、app.asar 内依赖和 Resources/skills 再次执行相同测试，并断言 SDK 解析确实落在 app.asar。该项已接入打包命令。它运行于 Electron 的 Node 模式，测试夹具只为未初始化的日志适配器提供空 Electron API，不调用实际窗口/IPC/safeStorage；窗口与渲染回归由独立渲染测试承担，不能把本项称为安装后完整 UI 验收。交叉构建时明确跳过异平台执行，必须交给对应原生 runner。

`.github/workflows/check.yml` 覆盖 Linux、macOS arm64、macOS Intel、Windows 的项目测试；手动 `.github/workflows/agent-acceptance.yml` 覆盖三个桌面原生平台的完整安装包流程，不发布产物。Intel 使用官方列出的 `macos-15-intel` 标签，见 [GitHub runner 文档](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)。工作流尚未推送或触发。

观察器覆盖 Node 文件 API 和模块解析，不是操作系统级全进程系统调用跟踪，不能证明未执行路径、原生库或另一个进程的行为。实际付费长任务的语义质量也不能由模拟响应证明。

## 本机结果与未完成项

- macOS arm64：启用已准备好的 Tika 与公开 Web 集成后，69 个测试文件、330 项测试全部通过，无跳过；Node/Web/PPTist 类型检查、Electron 渲染测试和生产构建通过。
- 公开 Exa 搜索与 HTML 提取两项真实网络测试通过；不使用 Key。
- 最终锁文件与三个补丁在全新临时目录完成离线安装（该次禁用安装脚本），SDK 工厂导出验证通过；本机另已执行带安装脚本的依赖重建和完整打包。
- 干净/标记环境的独立进程测试均通过；原生压缩使用模拟模型响应，只证明结构与生命周期，不证明语义质量。
- `CSC_IDENTITY_AUTO_DISCOVERY=false pnpm package:mac` 完成，arm64 与 x64 的 DMG/ZIP 均生成（未签名）；打包后的 arm64 Tika 与 Pandoc 执行验证通过。
- x64 包内 Tika 提取与 Pandoc DOCX 转换通过 Rosetta 实际执行验证；此结果不等于 Intel 实机验证。
- arm64 原生与 x64 Rosetta 的安装包 Agent 探针均在干净/标记环境两组通过，各 14 次模拟请求、5 个直接依赖确认来自 app.asar，禁止访问为 0。x64 首次执行达到 60 秒时限；后续完整复测两组通过，保留首次超时记录，不据此推断冷启动性能。
- 已按预览修复 142 个文件的格式，全仓 Prettier 检查通过；8 个模板 JSON 与格式化前的数据深度比较一致。
- 用户于 2026-09-17 明确不批准付费调用，并暂不执行 Windows 验收；这两项保留为未验证，不计为通过。未执行 CI 推送或触发。

## 真实模型验收提案（用户已决定暂不执行）

本节仅保留后续验收方法，本轮不执行。仅使用合成资料和隔离临时项目。未来执行前须由用户明确授权使用应用安全存储中的 DeepSeek 凭据及产生模型费用；不把 Key 放入命令行、环境变量、输出或结果文件。

1. 缓存对照：固定 DeepSeek Flash、思考档位、Skill 集合与任务，准备相同内容的两个项目。分别重复至少三轮旧缓存扩展、关闭缓存扩展、现有最小前缀实现的请求；交错执行顺序。旧扩展仅在临时验收环境运行，不加回生产依赖。记录输入/缓存/输出 token、服务端报告费用、首 token 与总延迟；对照产物内容和必需信息，不以单次命中推断收益。
2. 长任务：合成多阶段 PPT 任务，明确阶段、Todo、产物相对路径和下一步。逐步接近模型实际上下文阈值，观察原生自动压缩。压缩后实际读取工作流状态和产物，再继续任务；中途恢复会话并重复核对上述四项。不得用人工写入一个“正确摘要”替代模型压缩。
3. 建议授权边界：最多 20 次模型请求，累计输入不超过 500 万 token、输出不超过 2 万 token，按模型用量估算费用上限 5 美元；达到任一边界停止。执行前核对服务商当前价格；无法确认价格或不能将最坏单次请求费用纳入剩余额度时不发送。任何失败及未完成项如实记录，不自动加预算。
4. 结果只保存合成任务、数值用量、阶段检查结果和非敏感错误；不保存真实用户资料或凭据。对照结论可以是“无显著收益”或“不通过”，不得为了关闭计划而修改验收标准。

当前机器为 macOS arm64，已使用本机 Rosetta 执行 x64 包内运行时。Intel 实机与 Windows 原生文件系统/安装包未验证；Windows 验收按用户决定暂缓。CI 配置就绪不等于 CI 已实际运行。

## 回滚与升级

回滚相应补丁、宿主注入及锁文件必须作为同一个变更进行；单独删除补丁会使类型检查失败或恢复外部配置读取。升级上述依赖时检查补丁差异，重新执行独立进程隔离、实际请求编码、完整测试与各平台安装包验证。
