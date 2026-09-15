# Tika P0 可行性验证

日期：2026-09-15

状态：P0 进行中；macOS arm64 首轮 Server 原型通过当前探针，macOS x64 与 Windows x64 待补。超时、峰值资源和外部访问诱捕尚未完成。

## 结论

[事实] 候选版本锁定为 Apache Tika Server 4.0.0 和 Eclipse Temurin JRE 21.0.12.1+1。下载地址、资源大小与完整性摘要记录在 `scripts/tika-p0/runtime-manifest.json`，运行时资源不提交仓库。macOS arm64 实测同时通过 Apache 发布签名、固定签名者指纹、Tika SHA-512 与 Temurin SHA-256 校验。

[事实] Tika 官方安全文档明确说明 Tika Server 不提供认证或授权。`allowPipes=false`、`allowPerRequestConfig=false`、受限端点和关闭 CORS 能缩小能力面，但不能阻止本机其他进程直接访问回环端口。

决策：首版将同一 OS 用户下的本机原生进程视为可信调用方，不承诺在多用户共享主机或恶意本机原生进程存在时提供隔离。在该威胁模型下，接受官方 Server 的无认证回环端口，不再将其列为 P0 阻断项。

[事实] macOS arm64 首轮探针通过：无认证 `/version` 按预期返回 200；CORS 未授予非可信来源；每请求配置返回 403；Pipes 端点返回 404；DOC/DOCX 内容与 MIME 检测通过；客户端取消后服务仍响应；被杀死的解析 fork 可替换；退出后所属进程树无残留。

## 固定版本和来源

| 组件 | 固定版本 | 来源 | 完整性 |
|---|---|---|---|
| Apache Tika Server | 4.0.0 | Apache 官方发行站 | SHA-512；清单同时固定发布签名与签名者指纹 |
| Eclipse Temurin JRE | 21.0.12.1+1 | Adoptium 官方 GitHub Release | 各平台 SHA-256 |

目标资源为 macOS arm64、macOS x64、Windows x64。Tika 4.x 必须使用包含 launcher 及相邻 `lib/` 的完整 ZIP，不能单独分发 Maven launcher JAR。

## 原型安全配置

- 仅加载 `ooxml-parser` 与 `office-parser`，不加载 OCR、外部命令、URL fetcher 或通用解析器集合。
- 仅启用 `tika`、`rmeta`、`meta`、`detect`、`version`、`status` 端点。
- `allowPipes=false`、`allowPerRequestConfig=false`、`cors=""`。
- 输入上限 30 MiB；正文上限 200 万字符；限制 XML、包嵌套、压缩比、元数据体积。
- 单个 fork，fork 堆 512 MiB，总任务 90 秒、无进展 30 秒。
- 启动进程只继承路径、区域和临时目录等最小环境，不继承应用密钥与代理配置。

## 复现方法

```bash
pnpm tika:p0:prepare
pnpm tika:p0:probe
```

资源准备脚本会校验大小和摘要，解压到被 Git 忽略的 `out/.tika-p0-runtime/<platform>/`。探针使用动态回环端口和随机 Server ID，输出结构化结果到 `.local/tika-p0-probe.json`，退出时按所属进程组回收 Tika 父进程与 fork。

测试样本位于 `scripts/tika-p0/fixtures/`，由仓库内 `generate.py` 自行生成，不包含用户数据。DOCX 通过文档渲染流程做视觉核对。`simple-content.doc` 由 LibreOffice 的 Microsoft Word 97 导出器生成，`file` 识别为 OLE2 Composite Document File，不是 DOCX 改后缀文件。

## 首轮验证矩阵

| 项目 | macOS arm64 | macOS x64 | Windows x64 |
|---|---|---|---|
| 下载、摘要、启动 | 通过；PGP/SHA 已校验 | 待执行 | 待执行 |
| 版本和端点 | 通过 | 待执行 | 待执行 |
| 当前本地信任边界 | 通过；无凭据返回 200 符合已接受模型 | 待执行 | 待执行 |
| CORS 与高风险端点 | CORS、配置、Pipes 通过；外网诱捕待补 | 待执行 | 待执行 |
| 中文 DOCX 内容 | 通过当前基础与表格样本 | 待执行 | 待执行 |
| 真实 DOC 内容 | 通过当前基础样本 | 待执行 | 待执行 |
| 取消、超时、fork 崩溃恢复 | 取消后响应与 fork 崩溃恢复通过；超时待补 | 待执行 | 待执行 |
| 完整进程树回收 | 通过；无剩余 PID | 待执行 | 待执行 |
| 冷启动、解析耗时、RSS、包大小 | 已取首轮观测；峰值采样待补 | 待执行 | 待执行 |

## macOS arm64 首轮数据

测试机器为 Darwin arm64。以下是可复现实测值，不是跨机器性能承诺：

| 指标 | 结果 |
|---|---:|
| 下载归档合计 | 106,508,235 bytes，约 101.6 MiB |
| 解压运行时合计 | 222,498,163 bytes，约 212.2 MiB |
| Server 冷启动至 `/version` 就绪 | 8.2–8.8 s |
| 当前小样本文本解析 | 31–108 ms |
| 父进程加单个 fork 的观测 RSS | 约 258–397 MiB |

RSS 是数次运行结束前的瞬时总和，不是峰值。小样本解析耗时不包含 Server 冷启动，也不能外推到 30 MiB 或复杂文档。首次 `/detect` 会触发 fork 懒启动，当前探针尚未单独记录这段耗时。

内容观察：DOC 与 DOCX 的关键中文、英文、多语言文本、页眉页脚和表格单元格顺序均通过。由于配置以 `maxDepth=0`、`maxCount=0` 禁止嵌入递归，普通 DOCX 的元数据会出现 `tk:exception:embedded-resource-limit-reached`；P1 若继续使用该配置，不能把这个标志一概解释为正文提取失败，需先确定非递归端点或更精确的嵌入选择策略。

## 剩余项与约束

1. 无认证回环端口是已接受风险，不是鉴权。当前设计不支持多用户共享主机或不可信本机原生进程隔离；产品文档必须保留该边界。
2. 客户端取消后服务可继续响应，但当前样本解析太快，尚未证明正在运行的解析 fork 会因取消而终止；仍需可控慢解析样本和超时测试。
3. 当前探针记录观测时 RSS，不代表峰值；需要周期采样整棵进程树。
4. 已加入自生成真实二进制 DOC；批注、修订、文本框、脚注和更复杂表格样本仍待补。
5. 需要在另两个目标平台执行同一清单，验证签名、可执行权限、路径和进程回收。

若后续威胁模型扩大，可评估 mTLS、每次请求启动 `tika-app` 的 stdin/stdout CLI，或只接受受限二进制协议的小型 Java 子进程适配器；当前 P0 不提前引入这些复杂度。

## 依据

- Apache Tika 下载页：https://tika.apache.org/download
- Tika Server 4.x 文档：https://tika.apache.org/docs/4.0.x/using-tika/server/index.html
- Tika 安全模型：https://tika.apache.org/security-model.html
- Tika 限制配置：https://tika.apache.org/docs/4.0.x/advanced/setting-limits.html
- Eclipse Temurin 21 发布：https://github.com/adoptium/temurin21-binaries/releases/tag/jdk-21.0.12.1%2B1
