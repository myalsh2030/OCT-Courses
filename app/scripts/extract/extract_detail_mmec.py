# -*- coding: utf-8 -*-
"""استخراج «المنهج التفصيلي» لمقررات منتج من خطة تقنية التصنيع.

نفس منطق extract_detail لكن على ملف التصنيع وعلى صفحات الأقسام التي
حدّدها extract_plan_mmec. المخرج مرجعٌ للمحرّر (أنا) لصياغة المواضيع في
plan-detail.json — لا يُستهلك مباشرةً من التطبيق.
"""
import io
import json
import sys

import fitz
import extract_detail as D

sys.stdout.reconfigure(encoding="utf-8")

PDF = "M:/AI PROJECTS/ملف المدرب وتوصيف المقرر/الخطة التفصيلية لتخصص تقنية التصنيع - دبلوم كليات - نصفي.pdf"
SRC = "M:/AI PROJECTS/ملف المدرب وتوصيف المقرر/app/scripts/extract/mmec-raw.json"
OUT = "M:/AI PROJECTS/ملف المدرب وتوصيف المقرر/app/scripts/extract/mmec-detail-raw.json"


def main():
    doc = fitz.open(PDF)
    src = json.load(io.open(SRC, encoding="utf-8"))["courses"]
    out = []
    for c in src:
        items = D.collect(doc, c["pageStart"] - 1, c["pageEnd"])
        units = D.parse_detail(items, c["cth"] * 16)
        out.append({"code": c["code"], "nameAr": c["nameAr"],
                    "unitsFromPlan": c["units"], "detail": units})
        print("%-10s كتل=%2d ساعات=%3d/%3d" % (
            c["code"], len(units), sum(u["hours"] for u in units), c["cth"] * 16))
    io.open(OUT, "w", encoding="utf-8").write(
        json.dumps({"source": PDF, "courses": out}, ensure_ascii=False, indent=1))
    print("→ %s" % OUT)


main()
