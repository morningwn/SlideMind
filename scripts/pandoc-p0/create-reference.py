from __future__ import annotations

import os
import sys
import tempfile
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET


WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
CORE_NS = "http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
DC_NS = "http://purl.org/dc/elements/1.1/"
DCTERMS_NS = "http://purl.org/dc/terms/"
W = f"{{{WORD_NS}}}"

ET.register_namespace("w", WORD_NS)
ET.register_namespace("cp", CORE_NS)
ET.register_namespace("dc", DC_NS)
ET.register_namespace("dcterms", DCTERMS_NS)


def child(parent: ET.Element, tag: str) -> ET.Element:
    found = parent.find(tag)
    return found if found is not None else ET.SubElement(parent, tag)


def set_run_style(run_properties: ET.Element, *, east_asia: str, size: int) -> None:
    fonts = child(run_properties, f"{W}rFonts")
    fonts.set(f"{W}ascii", "Aptos")
    fonts.set(f"{W}hAnsi", "Aptos")
    fonts.set(f"{W}eastAsia", east_asia)
    fonts.set(f"{W}cs", "Aptos")
    child(run_properties, f"{W}sz").set(f"{W}val", str(size))
    child(run_properties, f"{W}szCs").set(f"{W}val", str(size))


def patch_styles(value: bytes) -> bytes:
    root = ET.fromstring(value)
    defaults = child(root, f"{W}docDefaults")
    run_default = child(defaults, f"{W}rPrDefault")
    set_run_style(child(run_default, f"{W}rPr"), east_asia="Arial Unicode MS", size=22)

    sizes = {
        "Normal": 22,
        "BodyText": 22,
        "FirstParagraph": 22,
        "BlockText": 22,
        "SourceCode": 20,
        "Heading1": 32,
        "Heading2": 28,
        "Heading3": 24,
    }
    for style in root.findall(f"{W}style"):
        style_id = style.get(f"{W}styleId")
        if style_id not in sizes:
            continue
        set_run_style(
            child(style, f"{W}rPr"),
            east_asia="Arial Unicode MS",
            size=sizes[style_id],
        )
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def patch_document(value: bytes) -> bytes:
    root = ET.fromstring(value)
    section = root.find(f".//{W}sectPr")
    if section is None:
        raise RuntimeError("reference.docx does not contain a section definition")
    page_size = child(section, f"{W}pgSz")
    page_size.set(f"{W}w", "11906")
    page_size.set(f"{W}h", "16838")
    margins = child(section, f"{W}pgMar")
    for name in ("top", "right", "bottom", "left"):
        margins.set(f"{W}{name}", "1440")
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def clean_core_properties(value: bytes) -> bytes:
    root = ET.fromstring(value)
    for tag in (
        f"{{{DC_NS}}}creator",
        f"{{{CORE_NS}}}lastModifiedBy",
        f"{{{DCTERMS_NS}}}created",
        f"{{{DCTERMS_NS}}}modified",
    ):
        element = root.find(tag)
        if element is not None:
            element.text = ""
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: create-reference.py INPUT.docx OUTPUT.docx")
    source = Path(sys.argv[1]).resolve()
    destination = Path(sys.argv[2]).resolve()
    destination.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.NamedTemporaryFile(
        dir=destination.parent, prefix="reference-", suffix=".docx", delete=False
    ) as temporary:
        temporary_path = Path(temporary.name)

    try:
        with zipfile.ZipFile(source) as input_archive, zipfile.ZipFile(
            temporary_path, "w", compression=zipfile.ZIP_DEFLATED
        ) as output_archive:
            for entry in input_archive.infolist():
                value = input_archive.read(entry.filename)
                if entry.filename == "word/styles.xml":
                    value = patch_styles(value)
                elif entry.filename == "word/document.xml":
                    value = patch_document(value)
                elif entry.filename == "docProps/core.xml":
                    value = clean_core_properties(value)
                entry.date_time = (1980, 1, 1, 0, 0, 0)
                output_archive.writestr(entry, value)
        os.replace(temporary_path, destination)
        destination.chmod(0o644)
    finally:
        temporary_path.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
