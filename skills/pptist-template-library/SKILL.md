---
name: pptist-template-library
description: 为单独的模板选择任务或完整制作流程的设计阶段查询、选择并映射 SlideMind 内置的 8 套 PPTist 模板。适用于选择、套用或参考内置模板；不独立负责整份 PPT 的内容生产，也不用于导入外部 PPTX 或管理用户自定义模板。
---

# PPTist 内置模板库

先读取 [references/catalog.md](references/catalog.md)，根据受众、内容和语气选择一套模板。不要默认选择第一套，也不要混用多套模板的视觉语言。

本 Skill 负责把上游 Markdown 大纲中的语义页面映射为 PPTist 页面角色、模板容量和具体候选页。先读取用户指定或 `deck-strategy` 生成的 `.md`；大纲没有提供 PPTist 角色不是缺失，不得要求上游补写模板实现细节。

由 `ppt-production-workflow` 调用且 `workflow-status.md` 的当前阶段为视觉与模板设计时，本 Skill 只完成该阶段：把模板 ID、页面角色、候选页索引、节点容量和素材需求写入统一目录中的 `<topic>-design-spec.md`，并更新状态。审阅模式标记为 `awaiting-review` 后停止；连续模式通过自检后标记为 `completed` 并交还总控。此阶段不得调用 `slides_create`、`slides_write` 或 `slides_export`；进入上游设计稳定的可编辑草稿阶段后，才可读取映射规则并参与页面写入。

PPTist 模板是带有页面类型和节点类型标记的普通幻灯片。选定模板后，读取 [references/template-semantics.md](references/template-semantics.md)，按内容职责和项目数量匹配页面，不把模板当作不可变的整套成品。

优先使用 `template_query` 缩小上下文：`slides` 操作列出候选页的节点容量，`get` 操作只返回选中页面及其主题。该工具直接读取内置模板，不需要 shell 或外部 Node.js 环境。只有工具不可用时才直接读取对应的 `assets/template_N.json`。

将页面转换为 `slides_write` 参数前，读取 [references/slidemind-mapping.md](references/slidemind-mapping.md)。所有参考规则和模板资产都已内置，不要为了补充说明或图片访问网络。占位文字与离线示例图不是用户内容，不得原样保留。

## 转换到 SlideMind

- 保持所选模板的主色、背景、字号层级、页边距和跨页重复位置一致。
- 根据 Markdown 中的页面职责，在本阶段分配 `cover`、`contents`、`transition`、`content`、`end`；目录页和过渡页不推动叙事时应省略。
- 根据预计条目数量、文字密度和图片需求查询候选页容量，再选择具体模板页面；不要为使用模板而保留无内容的页面。
- 模板容量不足时拆页或换候选页，不删除必要证据、不合并独立结论，也不缩小字号硬塞。
- 由总控流程调用时，演示文件、导出文件和模板所需素材必须继续使用已经确定的统一产物目录，不创建平行输出目录。
- 写入前调用 `slides_read` 获取最新 revision。编辑已有演示时，如果当前工具无法保留其复杂元素，不得整体覆盖。

原始模板资产来自项目固定版本的 PPTist，随 SlideMind 一起按 AGPL-3.0 使用和分发。执行该 Skill 不依赖外部文档、图片服务或网络请求。
