---
name: ppt-production-workflow
description: 编排 SlideMind 中从材料梳理、事实核验、叙事规划、逐页文案、模板或视觉设计、结构化写入、质量复核到 PPTX 导出的完整制作流程。适用于用户要求新建、改写或交付整份 PPT；单页润色、只做大纲或只做审查时应直接使用对应专项 Skill。
---

# PPT 制作总控流程

把演示制作视为有门禁的生产流程，而不是一次性生成。总控只负责判断阶段、加载专项 Skill、维护阶段产物和决定能否进入下一步；不要复制专项 Skill 的规则。

完整创建、重写或导出前，读取 [references/production-contract.md](references/production-contract.md)。只有在维护或评审本 Skill 时才读取 [references/open-source-foundations.md](references/open-source-foundations.md)。

## 任务路由

先判断用户实际要求的交付层级：

- 仅梳理目标、结构或大纲：读取 `../deck-strategy/SKILL.md`，生成 Markdown 策略文档后停止，不创建演示文件。
- 仅改写页面文字：读取 `../slide-copywriting/SKILL.md`。
- 仅处理数据页：读取 `../data-storytelling/SKILL.md`。
- 仅制作流程图：读取 `../slide-flowchart/SKILL.md`；按其要求再读取几何 reference。
- 仅选择或套用内置模板：读取 `../pptist-template-library/SKILL.md` 及其指定 reference。
- 仅做视觉重设计：读取 `../slide-visual-design/SKILL.md`。
- 仅检查或验收：读取 `../deck-quality-review/SKILL.md`，默认只报告，不写入。
- 新建、重写或交付完整演示：执行下方完整流程，并在对应阶段按需读取专项 Skill。

不要因为用户选择了本 Skill 就自动扩大交付范围。用户只要大纲时仅生成 Markdown 策略文档，不创建 `.slides.json` 或 PPTX；只要可编辑稿时不自动导出 PPTX；只要审查时不自动修复。

## 完整流程

### 1. 定义任务

明确受众、演示目的、期望行动、使用场景、材料范围、语言、品牌或模板约束，以及交付物是 `.slides.json`、`.pptx` 还是两者。只有会改变核心结论、受众行动或不可逆写入范围的缺口才需要追问；其余使用保守假设并显式说明。

写入已有演示前必须确认用户确实要求修改。读取外部 `.pptx` 只使用 `pptx_read`；当前工具不能把外部 PPTX 无损导入或原位编辑，不能暗示已经做到。

### 2. 建立证据底稿

先读取全部用户引用材料，再把内容分为事实、推论、建议和待确认项。需要外部检索时只补齐与核心结论直接相关的缺口，记录来源、日期、口径和适用范围；不得用搜索摘要替代原始来源。

没有依据的数字、案例、引语或客户评价不得进入成稿。来源无法写入备注时，在页面脚注、来源页或项目内伴随文本中保留可追溯信息，不能声称已写入演讲者备注。

### 3. 规划叙事与页面地图

读取 `../deck-strategy/SKILL.md`，先生成或更新 Markdown 策略文档。文档中形成核心承诺、标题序列和逐页地图；每页至少包含页面职责、结论式标题、支撑证据、视觉形式和待确认项。标题序列不能独立讲清故事，或 Markdown 策略文档尚未落盘时，不进入页面制作。

### 4. 完成内容与视觉方案

读取 `../slide-copywriting/SKILL.md`。数据页再读取 `../data-storytelling/SKILL.md`，流程页再读取 `../slide-flowchart/SKILL.md`。

视觉路线只能选一种：

- 用户指定内置模板：读取 `../pptist-template-library/SKILL.md`，先按内容角色和容量查询候选页，再映射内容。
- 用户给出明确视觉方向但未指定模板：读取 `../slide-visual-design/SKILL.md`，建立统一的网格、字体、颜色和间距系统。
- 编辑已有 `.slides.json`：以现有页面为视觉基准，不混入无关模板；先判断当前元素是否能被工具无损保留。

模板只能承载内容，不能决定叙事。容量不足时拆页或换版式，不压小字号硬塞。

### 5. 事务式写入

需要新文件时调用 `slides_create`。任何 `slides_write` 之前都必须立即调用 `slides_read` 并使用其最新 revision。

`slides_write` 会替换全部页面，只在以下条件全部满足时执行：

- 用户已要求创建或修改；
- 页面地图、文案和视觉方案已经稳定；
- 将保留的全部页面都已纳入写入参数；
- 现有复杂元素、富文本和样式可以被当前工具安全表达；
- 不存在未解决的关键事实或外部修改冲突。

尽量一次写入完整成稿，避免按页反复覆盖。发生 revision 冲突时重新读取、重新合并，不复用旧 revision。写入后立即再次 `slides_read`，核对页数、标题、元素类型、坐标和关键内容。

### 6. 质量闭环与导出

读取 `../deck-quality-review/SKILL.md`，对本轮成稿执行叙事、事实、文案、几何和导出准备度检查。发现阻塞项时先修复，再重新读取并复核。

只有用户要求 PPTX 时才调用 `slides_export`。导出后可用 `pptx_read` 回读语义内容，但这不能证明字体替换、文字溢出、图片裁切或 PowerPoint 兼容性已经通过。当前没有真实渲染检查工具时，必须把视觉验收明确标为待在 PPTist 或导出的 PowerPoint 中确认。

## 完成标准

- 交付范围与用户请求一致，没有擅自多做文件或导出；
- 标题序列构成完整论证，关键结论有证据或假设标记；
- 演示策略和逐页地图保存在独立 Markdown 文档中，不混入演示 JSON；
- 页面容量、坐标、层级和元素类型通过结构复核；
- 没有遗留占位符、伪造来源、未解释数字或已知冲突；
- 可编辑源文件是 `.slides.json`，`.pptx` 被视为派生交付物；
- 最终回复列出生成或修改的文件、已执行的检查，以及仍需人工视觉确认的限制。
