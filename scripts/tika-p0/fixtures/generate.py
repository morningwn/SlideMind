from pathlib import Path

from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt


ROOT = Path(__file__).resolve().parent


def set_cell_shading(cell, fill):
    properties = cell._tc.get_or_add_tcPr()
    shading = OxmlElement('w:shd')
    shading.set(qn('w:fill'), fill)
    properties.append(shading)


def configure(document, title):
    section = document.sections[0]
    section.page_width = Inches(8.5)
    section.page_height = Inches(11)
    section.top_margin = Inches(0.8)
    section.bottom_margin = Inches(0.8)
    section.left_margin = Inches(0.85)
    section.right_margin = Inches(0.85)
    styles = document.styles
    for style_name in ['Normal', 'Title', 'Heading 1', 'Heading 2']:
        style = styles[style_name]
        style.font.name = 'Arial Unicode MS'
        style._element.get_or_add_rPr().get_or_add_rFonts().set(qn('w:eastAsia'), 'Arial Unicode MS')
    styles['Normal'].font.size = Pt(11)
    title_style = styles['Title']
    title_style.font.color.rgb = None
    title_paragraph = document.add_paragraph(title, style='Title')
    title_paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
    document.core_properties.title = title
    document.core_properties.author = 'SlideMind P0 fixture generator'


def build_simple():
    document = Document()
    configure(document, 'SlideMind 中文文档读取样本')
    document.add_paragraph('该样本用于核对 Apache Tika 对中文、英文和混合 Unicode 的正文提取。')
    document.add_heading('段落与列表', level=1)
    document.add_paragraph('关键短语：春江潮水连海平。English marker: faithful extraction.')
    for value in ['第一项 苹果', '第二项 Banana', '第三项 emoji 🚀']:
        document.add_paragraph(value, style='List Bullet')
    document.add_heading('结论', level=1)
    document.add_paragraph('结束标记 SLIDEMIND TIKA P0 END')
    document.save(ROOT / 'simple-content.docx')


def build_complex():
    document = Document()
    configure(document, 'SlideMind 复杂内容读取样本')
    section = document.sections[0]
    section.header.paragraphs[0].text = '页眉标记 HEADER 中文'
    section.footer.paragraphs[0].text = '页脚标记 FOOTER'
    document.add_paragraph('该样本覆盖表格、合并单元格、分页、页眉和页脚。')
    document.add_heading('销售数据表', level=1)
    table = document.add_table(rows=4, cols=3)
    table.style = 'Table Grid'
    headers = ['区域', '季度', '收入 万元']
    for index, text in enumerate(headers):
        cell = table.rows[0].cells[index]
        cell.text = text
        cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
        set_cell_shading(cell, 'D9EAF7')
    rows = [
        ('华东', '第一季度', '120'),
        ('华东', '第二季度', '135'),
        ('华南', '第一季度', '98'),
    ]
    for row_index, values in enumerate(rows, start=1):
        for column_index, text in enumerate(values):
            table.rows[row_index].cells[column_index].text = text
    document.add_paragraph('表格关系标记：华东第二季度收入一百三十五万元。')
    document.add_page_break()
    document.add_heading('第二页内容', level=1)
    document.add_paragraph('分页后标记 PAGE TWO CONTENT。')
    document.add_paragraph('混合字符：简体中文，繁體中文，日本語，한국어，café，naïve，😀。')
    document.save(ROOT / 'complex-content.docx')


build_simple()
build_complex()
