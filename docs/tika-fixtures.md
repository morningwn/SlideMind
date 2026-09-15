# Tika P0 文档样本

样本位于 `scripts/tika-p0/fixtures/`，由仓库内源文件自行生成，不含用户或第三方文档内容。以下命令均从仓库根目录执行。

- `simple-content.docx`：中文、英文、混合 Unicode、标题、段落和列表。
- `simple-content.doc`：由 `simple-content.docx` 通过 LibreOffice 的 `MS Word 97` 导出器生成，是 OLE2 复合文档，不是改后缀文件。
- `complex-content.docx`：表格、分页、页眉、页脚和多语言字符。
- `simple-spreadsheet.csv`：Excel 样本的源数据。
- `simple-spreadsheet.xls` / `simple-spreadsheet.xlsx`：由 LibreOffice 从源 CSV 导出的真实 Excel 文件。
- `simple-content.pdf`：由 LibreOffice 从 `simple-content.docx` 导出的 PDF。
- `expectations.json`：自动探针必须找到的关键文本与已知限制。

生成 DOCX 需要 Python 3 和 `python-docx`：

```bash
python3 scripts/tika-p0/fixtures/generate.py
```

生成 DOC、Excel 和 PDF 需要 LibreOffice：

```bash
soffice --headless --convert-to 'doc:MS Word 97' \
  --outdir scripts/tika-p0/fixtures \
  scripts/tika-p0/fixtures/simple-content.docx
soffice --headless --convert-to xls \
  --outdir scripts/tika-p0/fixtures \
  scripts/tika-p0/fixtures/simple-spreadsheet.csv
soffice --headless --convert-to xlsx \
  --outdir scripts/tika-p0/fixtures \
  scripts/tika-p0/fixtures/simple-spreadsheet.csv
soffice --headless --convert-to pdf \
  --outdir scripts/tika-p0/fixtures \
  scripts/tika-p0/fixtures/simple-content.docx
```

DOCX 已使用项目文档制品流程渲染为 PNG 并人工核对：正文、表格和页眉页脚无裁切或重叠。渲染中显式提供系统 CJK 字体目录；渲染 PNG 是临时 QA 产物，不提交仓库。
