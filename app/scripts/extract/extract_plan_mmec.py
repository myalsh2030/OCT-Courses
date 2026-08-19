# -*- coding: utf-8 -*-
"""استخراج مقررات «منتج» (MMEC) من خطة تقنية التصنيع.

خطة التصنيع تشترك مع خطة الصيانة في بنية صفحات المقرر (اسم المقرر/الرمز،
جدول الوحدات وساعاتها، وصف المقرر، الهدف العام)، فيُعاد استعمال منطق
extract_plan نفسه مع كشف الأقسام بالاسم لا بالترتيب — لأن خطة التصنيع
تضم مقررات تخصصها هي أيضاً ولا نريد منها إلا الستة المشتركة مع القسم.

المخرج يُدمج يدوياً في plan-courses.json بعد التحقق من ثابت س.أ × ١٦.
"""
import io
import json
import re
import sys

import fitz
import planlib
from extract_plan import (BOILER, clean_para, between, is_boiler, norm,
                          parse_safety, parse_units, section_lines, squash)

sys.stdout.reconfigure(encoding="utf-8")

PDF = "M:/AI PROJECTS/ملف المدرب وتوصيف المقرر/الخطة التفصيلية لتخصص تقنية التصنيع - دبلوم كليات - نصفي.pdf"
CAT = "M:/AI PROJECTS/ملف المدرب وتوصيف المقرر/app/src/data/department/catalogue.json"
OUT = "M:/AI PROJECTS/ملف المدرب وتوصيف المقرر/app/scripts/extract/mmec-raw.json"

# المقررات المشتركة مع قسمنا: مفتاح التعرف من اسم المقرر في صدر القسم،
# وصفحة البداية المتحققة بصرياً حارساً ضد التقاط قسم آخر.
WANTED = [
    ("MMEC 101", "ورشةتأسيسية", 20),
    ("MMEC 121", "النيوماتي", 76),
    ("MMEC 131", "الرسمالهندسي", 16),
    ("MMEC 141", "قياسات", 25),
    ("MMEC 145", "علمالمواد", 49),
    ("MMEC 233", "بمساعدةالحاسب", 54),
]


def main():
    doc = fitz.open(PDF)
    pages = [planlib.page_lines(doc[i]) for i in range(doc.page_count)]

    starts = []
    for i, lines in enumerate(pages):
        head = " ".join(norm(l["text"]) for l in lines[:12]).replace("ا سم", "اسم")
        if "اسم المقرر" in head and "لرمز" in head:
            starts.append(i)
    bounds = list(zip(starts, starts[1:] + [len(pages)]))
    print("أقسام المقررات في خطة التصنيع: %d" % len(bounds))

    sections = []
    for a, b in bounds:
        lines = section_lines(pages, a, b)
        head = squash(" ".join(l["t"] for l in lines[:14]))
        units, declared = parse_units(lines)
        sections.append({
            "pageStart": a + 1, "pageEnd": b, "head": head,
            "units": units, "unitsSum": sum(u["hours"] for u in units),
            "declaredTotal": declared,
            "safety": parse_safety(lines),
            "description": clean_para(between(lines, "وصفالمقرر", ["الهدفالعام"])),
            "generalObjective": clean_para(
                between(lines, "الهدفالعاممنالمقرر",
                        ["الأهدافالتفصيلية", "الاهدافالتفصيلية"])),
        })

    cat = {c["code"]: c for c in json.load(io.open(CAT, encoding="utf-8"))["courses"]}
    picked, ok = [], True
    for code, key, page in WANTED:
        match = [s for s in sections
                 if s["units"] and (key in s["head"] or s["pageStart"] == page)]
        if not match:
            print("✗ %s: لم يُعثر على قسمه (مفتاح «%s»)" % (code, key))
            ok = False
            continue
        if match[0]["pageStart"] != page:
            print("✗ %s: القسم عند ص%d لا ص%d" % (code, match[0]["pageStart"], page))
            ok = False
        s = dict(match[0])
        s.pop("head")
        s["code"] = code
        s["nameAr"] = cat[code]["nameAr"]
        s["cth"] = cat[code]["cth"]
        s["expected"] = cat[code]["cth"] * 16
        s["valid"] = s["unitsSum"] == s["expected"]
        ok = ok and s["valid"]
        picked.append(s)

    io.open(OUT, "w", encoding="utf-8").write(json.dumps(
        {"source": "الخطة التفصيلية لتخصص تقنية التصنيع — صفحات تفاصيل المقررات",
         "courses": picked}, ensure_ascii=False, indent=1))

    for s in picked:
        print("  %s %-9s p%-3d units=%2d sum=%3d expected=%3d desc=%d obj=%d" % (
            "OK " if s["valid"] else "BAD", s["code"], s["pageStart"],
            len(s["units"]), s["unitsSum"], s["expected"],
            len(s["description"]), len(s["generalObjective"])))
        for u in s["units"]:
            print("       %3d  %s" % (u["hours"], u["title"]))
    print("ALL VALID" if ok else "SOME INVALID")


main()
