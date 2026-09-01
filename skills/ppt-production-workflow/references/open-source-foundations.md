# 开源项目依据

本 reference 记录总控流程的设计来源，供维护或评审 Skill 时使用，不是日常制作任务的必读材料。SlideMind 没有从这些项目复制新的运行时代码；这里只吸收工作流与数据建模思想。

## 来源基线

| 来源 | 本次核对基线 | 许可证/性质 | 用途 |
| --- | --- | --- | --- |
| [Agent Skills specification](https://agentskills.io/specification) | 2026-09-01 在线规范 | 开放规范 | Skill 目录、触发描述、渐进披露和相对引用原则 |
| [OpenAI skills](https://github.com/openai/skills) | 2026-09-01 `main` | 以各目录许可证为准 | Skill 编写、资源拆分和验证方法 |
| [earendil-works/pi](https://github.com/earendil-works/pi) | `@earendil-works/pi-coding-agent` 0.84.4 | MIT | SlideMind 实际 Skill 加载器与运行环境 |
| [PPTist](https://github.com/pipipi-pikachu/PPTist/tree/e4912589ffdbec389fcc1bf25a85852dfe3040a8) | commit `e4912589ffdbec389fcc1bf25a85852dfe3040a8` | AGPL-3.0 | 编辑数据、模板角色、画布和渲染 |
| [PptxGenJS](https://github.com/gitbrent/PptxGenJS) | 4.0.1 | MIT | SlideMind 当前 PPTX 导出实现及导出限制 |
| [Slidev](https://github.com/slidevjs/slidev) | 2026-09-01 默认分支，仅设计参考 | MIT | 可维护源与派生输出分层 |
| [Marp](https://github.com/marp-team/marp) | 2026-09-01 默认分支，仅设计参考 | MIT | 可维护源与派生输出分层 |

运行时事实必须以 `package.json`、锁文件、当前工具 schema 和仓库固定源码为准。没有固定版本的外部资料只能支持设计原则，不能支持具体能力声明。

## Pi coding agent

Pi 按名称和描述发现 Skill，并在任务匹配时按需读取完整 `SKILL.md`。因此总控 Skill 只保存路由、阶段门禁和工具事务规则，专项知识继续由已注册 Skill 单独维护，避免所有规则常驻上下文或相互漂移。总控按 Skill 名称解析已注册路径，不依赖 `../` 形式的物理目录关系。

## PPTist

PPTist 的 AIPPT 内容模型把页面分为 `cover`、`contents`、`transition`、`content` 和 `end`，再把结构化内容映射到带节点角色的模板页面。SlideMind 因此坚持“证据与叙事 → 页面角色和条目数量 → 模板容量匹配”，不让模板先于内容结构。

PPTist 也是 SlideMind 可编辑源格式的基础。模板资产、画布坐标和元素能力以仓库固定版本及本地映射 reference 为准，而不是依赖在线文档的最新状态。

## PptxGenJS

PptxGenJS 通过母版、占位符、图表、演讲者备注和 OOXML 导出支持程序化 PowerPoint。总控流程吸收其“重复视觉规则进入统一布局、内容按语义角色填充”的思想，但实际创作仍使用 SlideMind 的 `slides_*` 工具；不能把 PptxGenJS 的完整能力误报为当前 `slides_write` 已支持。

## Slidev 与 Marp

Slidev 和 Marp 都把可维护的源内容与浏览器渲染、PDF/PPTX 等派生输出分开。SlideMind 对应地把 `.slides.json` 视为可编辑源，把 `.pptx` 视为按需导出的派生物，并要求导出前完成源结构复核。

两者的导出路径依赖各自的 Markdown、HTML、CSS 和浏览器渲染语义，不能用于证明 SlideMind/PPTist 的 PPTX 可编辑性或像素保真度。因此它们只影响流程分层，不作为运行时依赖或替代导出引擎。

## 采纳边界

- 采纳：渐进披露、结构先于模板、内容角色、统一布局系统、源与导出分离、写后复核。
- 不采纳：引入新的演示运行时、把网页截图式 PPTX 当作可编辑稿、绕过 SlideMind 工具直接写 OOXML、假设第三方项目能力自动存在于本应用。
- 维护时优先核对仓库锁定版本和实际工具契约；外部项目的新功能只能作为候选思路，不能直接升级为本 Skill 的事实。
