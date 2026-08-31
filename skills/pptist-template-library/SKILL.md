---
name: pptist-template-library
description: 使用 SlideMind 内置的 8 套 PPTist 主题和页面模板创建或重设计演示。适用于用户要求选择、套用或参考内置模板；不用于导入外部 PPTX 或管理用户自定义模板。
---

# PPTist 内置模板库

先读取 [references/catalog.md](references/catalog.md)，根据受众、内容和语气选择一套模板。不要默认选择第一套，也不要混用多套模板的视觉语言。

PPTist 模板是带有页面类型和节点类型标记的普通幻灯片。选定模板后，读取 [references/template-semantics.md](references/template-semantics.md)，按内容职责和项目数量匹配页面，不把模板当作不可变的整套成品。

将本文件所在的绝对目录记为 `SKILL_DIR`，优先使用查询脚本缩小上下文：

```bash
node "${SKILL_DIR}/scripts/query-template.mjs" slides template_2 content
node "${SKILL_DIR}/scripts/query-template.mjs" get template_2 17
```

不要猜测 `SKILL_DIR`，也不要依赖当前工作目录。第一个命令列出候选页的节点容量，第二个命令只返回选中页面及其主题。只有脚本不可用时才直接读取对应的 `assets/template_N.json`。

将页面转换为 `slides_write` 参数前，读取 [references/slidemind-mapping.md](references/slidemind-mapping.md)。占位文字与示例图片不是用户内容，不得原样保留。

## 转换到 SlideMind

- 保持所选模板的主色、背景、字号层级、页边距和跨页重复位置一致。
- 先完成内容结构，再匹配封面、目录、过渡、内容和结束页面。不要为使用模板而保留无内容的页面。
- 写入前调用 `slides_read` 获取最新 revision。编辑已有演示时，如果当前工具无法保留其复杂元素，不得整体覆盖。

原始模板资产来自项目固定版本的 PPTist，随 SlideMind 一起按 AGPL-3.0 使用和分发。
