"""Inspect exported slides without modifying their content."""
from pathlib import Path
import json
import zipfile
import xml.etree.ElementTree as ET
import pymupdf as fitz

root = Path(".local/outputs")
stem = root / "Vernatun-Commercial-Proposal-HY"
pdf = fitz.open(str(stem) + ".pdf")
assert len(pdf) == 10
report = {"pdf_pages": len(pdf), "pdf": [], "pptx": []}
for i, page in enumerate(pdf):
    text = page.get_text()
    report["pdf"].append({"slide": i + 1, "armenian_chars": sum("\u0530" <= c <= "\u058f" for c in text),
                          "image_count": len(page.get_images()), "fonts": [f[3] for f in page.get_fonts()]})
    page.get_pixmap(matrix=fitz.Matrix(1, 1)).save(str(root / f"verify-slide-{i+1}.png"))
for start in (0, 5):
    sheet = fitz.open()
    canvas = sheet.new_page(width=1200, height=1060)
    for index in range(start, start+5):
        x = (index-start) % 2 * 600
        y = (index-start) // 2 * 350
        canvas.insert_image(fitz.Rect(x, y, x+595, y+335), filename=str(root / f"verify-slide-{index+1}.png"))
    canvas.get_pixmap().save(str(root / f"verify-sheet-{start}.png"))

ns = {"a": "http://schemas.openxmlformats.org/drawingml/2006/main"}
with zipfile.ZipFile(str(stem)+".pptx") as z:
    slides = sorted((n for n in z.namelist() if __import__("re").fullmatch(r"ppt/slides/slide\d+\.xml", n)),
                    key=lambda n: int(__import__("re").search(r"slide(\d+)", n).group(1)))
    assert len(slides) == 10
    for filename in slides:
        doc = ET.fromstring(z.read(filename))
        texts = [node.text or "" for node in doc.findall(".//a:t", ns)]
        report["pptx"].append({"slide": filename, "text_runs": len(texts),
                               "armenian_chars": sum("\u0530" <= c <= "\u058f" for c in "".join(texts)),
                               "expo_label": any("Expo Web" in t for t in texts)})
    report["pptx_media"] = len([n for n in z.namelist() if n.startswith("ppt/media/")])
assert all(row["armenian_chars"] > 0 for row in report["pdf"])
assert all(row["armenian_chars"] > 0 for row in report["pptx"])
assert report["pptx"][4]["expo_label"]
(root / "export-check.json").write_text(json.dumps(report, ensure_ascii=False, indent=2))
print(json.dumps(report, ensure_ascii=False, indent=2))
