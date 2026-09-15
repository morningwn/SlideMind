# Java 运行时优化

## 构建契约

Tika 和 Java 版本保持为 4.0.0 / Temurin 21.0.12.1+1。默认 `minimal` 使用固定版本 JDK 的 jlink，执行资源压缩 `--compress=zip-6`、移除调试信息 `--strip-debug`、不生成头文件和手册。Java 模块依赖由 jlink 自动补齐，不生成 CDS 类缓存。

下载清单和 SHA-256 固定在 [runtime-manifest.json](../scripts/tika-p0/runtime-manifest.json)。准备过程仍校验原始 JRE，用其实际 `lib/modules` 镜像确定对照模块、统计原始体积，并保留完整上游 `NOTICE` 和 `legal/`。上游 JRE 的 `release` 字段可能包含不在实际镜像中的 JDK 模块，不能直接用它生成对照版。

构建工具使用宿主平台的固定 JDK，模块和原生库来自目标平台同版本 JDK 的 `jmods/`，不依赖系统 Java。`build-tools/`、`downloads/` 均在运行时目录外，不进入应用。跨架构生成只验证结构，必须在目标系统继续完成运行与安装验收。

| 模式         | 行为                                        | 用途             |
| ------------ | ------------------------------------------- | ---------------- |
| `full`       | 完整上游 JRE，包含 CDS 缓存，不下载构建 JDK | 兼容性对照和回退 |
| `compressed` | 保留原 JRE 的全部模块，压缩并移除调试信息   | 单独验证压缩影响 |
| `minimal`    | 压缩并仅保留固定依赖、提供程序及传递依赖    | 默认打包         |

模式优先级为命令参数 `--java-mode`、环境变量 `SLIDEMIND_JAVA_MODE`、默认 `minimal`。未知模式直接报错。准备失败后不会留下有效的旧 `prepared-runtime.json` 指向不完整资源。

```bash
node scripts/tika-p0/prepare-runtime.mjs --java-mode minimal
node scripts/tika-package/prepare.mjs --platforms darwin-x64,darwin-arm64 --java-mode compressed

# 回退完整 JRE 后执行正常打包链路（POSIX shell）
SLIDEMIND_JAVA_MODE=full pnpm package
```

PowerShell 先执行 `$env:SLIDEMIND_JAVA_MODE='full'`，再执行打包命令；删除该环境变量恢复默认。每种模式都需重新准备和打包，不会修改已安装的应用。

## 模块依据

[java-runtime.mjs](../scripts/tika-p0/java-runtime.mjs) 维护两组根模块：

- 静态依赖：`java.base`、`java.compiler`、`java.desktop`、`java.management`、`java.naming`、`java.net.http`、`java.rmi`、`java.scripting`、`java.security.jgss`、`java.sql`、`java.xml.crypto`、`jdk.unsupported`。
- 动态能力与兼容性保留项：`jdk.charsets`、`jdk.localedata`、`jdk.crypto.ec`、`jdk.crypto.cryptoki`、`jdk.management`、`jdk.naming.dns`、`jdk.net`、`jdk.nio.mapmode`、`jdk.security.auth`、`jdk.security.jgss`、`jdk.zipfs`；Windows 额外保留 `jdk.crypto.mscapi`。

保留 `java.desktop` 及其字体/图像库，避免破坏 PDF 和 Office 依赖；不限制地区语言或字符集。没有使用 `--bind-services` 自动加入所有提供程序，由上述保留项显式维护动态依赖。

macOS 最终为 29 个模块，较原始 JRE 的 49 个模块移除了 20 个：`java.instrument`、`java.management.rmi`、`java.se`、`java.smartcardio`、`java.sql.rowset`、`jdk.accessibility`、`jdk.dynalink`、`jdk.httpserver`、`jdk.incubator.vector`、`jdk.internal.vm.ci`、`jdk.internal.vm.compiler`、`jdk.internal.vm.compiler.management`、`jdk.jdwp.agent`、`jdk.jfr`、`jdk.jsobject`、`jdk.management.agent`、`jdk.management.jfr`、`jdk.naming.rmi`、`jdk.sctp`、`jdk.xml.dom`。Windows 最终为 30 个模块。

依赖分析覆盖所有随附 Tika JAR，包括未启用解析器的类；本次未裁剪 Tika 依赖。分析脚本在临时目录按 Java 21 选择多版本 JAR 的有效类，并移除模块描述符，以匹配 Tika 的 classpath 启动方式。直接把所有模块化 JAR 交给 jdeps 会要求未随附的可选 `jakarta.mail` 模块。

```bash
node scripts/tika-p0/analyze-java-modules.mjs \
  --jdk-home out/.tika-p0-runtime/darwin-arm64/build-tools/darwin-arm64/jdk-21.0.12.1+1/Contents/Home \
  --tika-root out/.tika-p0-runtime/darwin-arm64/runtime/tika
```

该脚本使用 `--ignore-missing-deps`，输出只作为 JDK 静态依赖依据，不证明所有可选第三方依赖齐全，也不能发现所有反射和服务提供程序。升级 Tika/JDK 后必须重新分析、人工复核保留项并执行真实解析测试，不能自动把分析结果作为最小集合。

## 2026-09-15 测量

按文件逻辑字节统计，含完整上游许可证；MiB = 1,048,576 bytes。安装包压缩后的大小尚未测量。

| macOS arm64 对照     |   Java 字节 | Java MiB |
| -------------------- | ----------: | -------: |
| 完整上游 JRE         | 157,823,454 |    150.5 |
| 仅移除 CDS（上一轮） | 130,494,942 |    124.4 |
| 全模块压缩版         |  73,317,390 |     69.9 |
| 压缩并裁剪模块       |  69,950,174 |     66.7 |

压缩并裁剪相对完整 JRE 减少 83.8 MiB（55.7%），相对上一轮减少 57.7 MiB；其中模块裁剪相对全模块压缩版另减 3.2 MiB。Tika 依赖保持 64,674,709 bytes，组合运行时由 222,498,163 bytes 降至 134,624,883 bytes（128.4 MiB）。

| 目标        | 精简 Java 字节 | Tika + Java 字节 | 本次运行覆盖                       |
| ----------- | -------------: | ---------------: | ---------------------------------- |
| macOS arm64 |     69,950,174 |      134,624,883 | 全模块压缩版和精简版六样本解析通过 |
| macOS x64   |     71,905,992 |      136,580,701 | 跨架构生成，待目标机运行           |
| Windows x64 |     65,438,736 |      130,113,445 | 跨架构生成，待目标机运行           |

六样本覆盖 DOC、简单/复杂 DOCX、XLS、XLSX、PDF，检查 MIME、中文、表格文本、页眉页脚、多语言及结束标记。打包验证同步覆盖六样本，按 `expectations.json` 核对正文；跨架构跳过执行。

三种模式均通过正式准备脚本和 macOS arm64 六样本集成测试。三架构通过真实 `afterPack` 钩子的隔离复制、模块与许可证检查，复制后的逻辑字节数与清单一致；macOS arm64 通过打包后六样本检查。本次未重新生成 DMG/NSIS 安装包。`pnpm test` 通过 252 项单元测试及 Electron 渲染测试，主进程类型检查通过；显式开启的运行时集成测试另行执行通过。修改文件的格式检查通过，全仓仍有 153 个文件的既有格式问题。

## 代价与验证边界

- 构建需要额外下载 JDK：单个 JDK 归档约 190–196 MiB；跨平台需要宿主与目标两份，校验通过的下载会缓存。安装包不包含 JDK。
- 不再提供被裁剪的调试、JFR 和远程管理功能；移除调试信息可能减少 Java 堆栈的源码行号。
- 压缩和取消 CDS 可能影响启动、CPU 与内存；本次未做统计性能对比，不能承诺性能改善。
- 六样本通过不等于任意办公文档均兼容；复杂编码、特殊 PDF 字体、异常文档、签名、公证及目标机安装仍需按 [Tika 验收矩阵](tika-validation.md#待完成验收) 验证。
- jlink 能力及选项见 [Java 21 官方文档](https://docs.oracle.com/en/java/javase/21/docs/specs/man/jlink.html)，静态分析工具见 [jdeps 文档](https://docs.oracle.com/en/java/javase/21/docs/specs/man/jdeps.html)。
