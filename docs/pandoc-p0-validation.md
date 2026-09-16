# Pandoc P0 验证记录

记录日期：2026-09-16。该记录只覆盖 Markdown 导出 Word 的 P0 可行性验证，不代表产品功能已接入。

## 固定候选

- Pandoc 3.11，官方不可变 Release：<https://github.com/jgm/pandoc/releases/tag/3.11>。
- 目标发行物：macOS arm64 ZIP、macOS x64 ZIP、Windows x64 ZIP。
- `scripts/pandoc-p0/runtime-manifest.json` 固定官方下载 URL、精确字节数和 SHA-256。
- P0 只保留运行所需可执行文件，以及固定版本的官方许可证和版权声明；不使用系统 PATH 中的 Pandoc。

## 复现命令

```sh
pnpm pandoc:p0:prepare
pnpm pandoc:p0:probe

# 仅在调整候选样式时重新生成确定性参考文档
python3 scripts/pandoc-p0/create-reference.py \
  out/.pandoc-p0-runtime/darwin-arm64/default-reference.docx \
  assets/document-export/reference.docx

# 非本机目标仅做下载、校验、解压与文件架构静态检查
node scripts/pandoc-p0/prepare-runtime.mjs --platform darwin-x64 --skip-execution
node scripts/pandoc-p0/prepare-runtime.mjs --platform win32-x64 --skip-execution
```

探针的机器可读结果写入 Git 忽略的 `.local/pandoc-p0-probe.json`。运行时与下载缓存写入 `out/.pandoc-p0-runtime/`。

## 当前验证矩阵

| 项目                                  | macOS arm64        | macOS x64           | Windows x64        |
| ------------------------------------- | ------------------ | ------------------- | ------------------ |
| 固定 ZIP 下载、大小与 SHA-256         | 通过               | 通过                | 通过               |
| 文件格式与 CPU 架构                   | Mach-O arm64，通过 | Mach-O x86_64，通过 | PE32+ x86-64，通过 |
| 目标平台真实启动                      | Pandoc 3.11，通过  | 待目标机            | 待目标机           |
| GFM → JSON 沙箱解析                   | 通过               | 待目标机            | 待目标机           |
| HTML、路径和 URL AST 识别             | 通过               | 待目标机            | 待目标机           |
| data URI 图片 + reference.docx → DOCX | 通过               | 待目标机            | 待目标机           |
| DOCX 标题、列表、表格、代码与媒体结构 | 通过               | 待目标机            | 待目标机           |
| RTS 512 MiB 堆限制                    | 通过               | 待目标机            | 待目标机           |
| Word 真实视觉验收                     | 待人工             | 待人工              | 待人工             |

## 2026-09-16 macOS arm64 结果

本机为 macOS 15.7.5、arm64。机器可读报告的 10 项自动探针全部通过。

| 指标                |       macOS arm64 |         macOS x64 |       Windows x64 |
| ------------------- | ----------------: | ----------------: | ----------------: |
| 官方 ZIP            |  41,832,712 bytes |  26,145,603 bytes |  41,761,100 bytes |
| Pandoc 可执行文件   | 190,159,728 bytes | 121,579,520 bytes | 233,626,888 bytes |
| 许可证与版权声明    |      27,361 bytes |      27,361 bytes |      27,361 bytes |
| 最小运行时合计      | 190,187,089 bytes | 121,606,881 bytes | 233,654,249 bytes |
| 候选 reference.docx |      10,907 bytes |          同一资源 |          同一资源 |

- 多次复跑中，GFM → JSON 用时 34–127 ms，采样峰值 RSS 39,392–40,864 KiB。
- JSON → DOCX 用时 297–448 ms，采样峰值 RSS 153,744–155,216 KiB；约 12.7 KiB 的输出包含表格、编号、代码样式和一个 PNG 媒体项。
- 原始 HTML 在 AST 中表现为 `RawBlock`。绝对路径、父目录越界和 HTTP 图片都保留为可检查的 `Image` 目标。
- 未经应用改写的三种不可信图片交给沙箱 writer 时只产生 `PandocResourceNotFound` 警告；回环诱捕请求数为 0，输出包未出现本地文件哨兵。
- 固定 `+RTS -M512m -RTS` 被官方二进制接受。
- 候选参考文档使用固定 ZIP 时间戳，可重复生成；当前 SHA-256 为 `0060f4bb31602e311d191a0037b03c107ad6c617cd001ceeb58fa43266234be7`。

这些耗时和 RSS 是多次小样本观测，不是性能承诺。macOS x64 与 Windows x64 目前只完成了下载完整性和静态架构检查，不能记为运行通过。

## P0 当前判定

[事实] 安全与图片技术链路在 macOS arm64 上成立；三目标官方发行物可取得且静态架构正确。

[事实] P0 尚未整体通过：安装包压缩增量尚未做同构构建对比，macOS x64 / Windows x64 未在目标机真实运行，Word 视觉验收未完成，用户也尚未确认可接受体积。

[事实] 使用 `documents` skill 的隔离 LibreOffice 渲染器检查一页中文样本时，页面结构、英文、列表、表格和代码可见，但中文字符未渲染。将 East Asian 字体从 `Microsoft YaHei` 调整为本机存在的 `Arial Unicode MS` 后现象仍存在，因此目前不能判定是参考文档、隔离渲染器字体访问还是 LibreOffice 兼容性问题。Microsoft Word 未安装，真实 Word 视觉门禁保持未通过。

[推论] 单个解压 Pandoc 可执行文件约 116–223 MiB，安装后体积成本显著，不能仅用 25–42 MB 的 ZIP 下载大小代表实际安装增量。

## 边界

- 探针验证 Pandoc 的沙箱链路及应用层 AST 拦截所需信息是否完整；`--sandbox` 不是操作系统进程沙箱。
- 参考文档候选从固定 Pandoc 内嵌默认文档派生，设置 A4、2.54 cm 页边距、11 pt 正文和 `Arial Unicode MS` East Asian 字体，并清理作者与修改者元数据。
- RSS 是短生命周期进程的高频采样值，不等同于操作系统保证的峰值；跨平台需在目标机复测。
- P0 不修改 preload、IPC、主进程服务或渲染界面，不具备用户可用的导出入口。
- Pandoc 采用 GPL-2.0-or-later。P0 已固定并保留上游许可证与版权声明；P2 打包链路进一步随包提供校验固定的 Pandoc 3.11 对应源码归档，缺失或被修改时打包校验失败。
