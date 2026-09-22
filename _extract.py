# -*- coding: utf-8 -*-
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

import pymupdf

PDF = Path(r"C:\Users\User\OneDrive\Desktop\ישיבה תיכונית תשפז\משנה") / "מחברת משנה_ברכות_הקדמה וחלק ב להפצה (1).pdf"
OUT = Path(__file__).resolve().parent / "pages"
OUT.mkdir(exist_ok=True)

doc = pymupdf.open(PDF)
print("pages", doc.page_count, "size", doc[7].rect)
mat = pymupdf.Matrix(2.0, 2.0)
for i in range(7, doc.page_count):
    dest = OUT / f"p{i + 1:02d}.jpg"
    pix = doc[i].get_pixmap(matrix=mat, alpha=False)
    pix.save(dest, jpg_quality=88)
    print("wrote", dest.name, pix.width, pix.height)
print("done", len(list(OUT.glob("p*.jpg"))))
