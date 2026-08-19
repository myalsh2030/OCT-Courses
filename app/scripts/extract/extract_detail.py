# -*- coding: utf-8 -*-
"""استخراج «المنهج التفصيلي» — بنود المحتوى وأدوات التقييم لكل وحدة.

أعمدة الجدول ثابتة الإحداثيات: الساعات يميناً (x>500)، والمحتوى وسطاً
(250<x<480)، وأدوات التقييم يساراً (x<110). و«o» تعلّم البنود العملية
التي تلي «تدريبات وتمارين».
"""
import io
import json
import re

import fitz
import planlib

PDF = "M:/AI PROJECTS/ملف المدرب وتوصيف المقرر/خطة تقنية الصيانة الميكانيكية.pdf"
SRC = "M:/AI PROJECTS/ملف المدرب وتوصيف المقرر/app/src/data/department/plan-courses.json"
OUT = "M:/AI PROJECTS/ملف المدرب وتوصيف المقرر/app/src/data/department/plan-detail.json"

AR_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")
PRACTICAL_MARK = "تدريبات وتمارين"
STOP = ("مراجع الموضوع", "المراجع")
BOILER = ("المملكة العربية", "القسم", "التخصص", "المؤسسة العامة للتدريب",
          "التقنية الميكانيكية", "تقنية الصيانة", "الإدارة العامة للمناهج",
          "الساعات", "المحتوى", "أدوات التقييم")


def norm(s):
    s = re.sub(r"[ \t\u200f\u200e]+", " ", s.translate(AR_DIGITS)).strip()
    return s.strip(" :ـ").strip()


def clean(t):
    t = norm(t)
    t = re.sub(r"^[o\-\u2022\u25cf\u25aa]+\s*", "", t)
    return t.strip(" .:،")


def is_boiler(t, y=0.0):
    # التذييل «ص من ٦٩» ينشطر أحياناً لثلاثة عناصر، فنستبعد أسفل الصفحة كله
    if y > 790:
        return True
    if re.fullmatch(r"\d{1,2}\s*من\s*69", t):
        return True
    return any(t.startswith(b) for b in BOILER)


def collect(doc, a, b):
    """كل عناصر صفحات المقرر مرتبةً رأسياً مع عمودها."""
    items = []
    for p in range(a, b):
        for ln in planlib.page_lines(doc[p]):
            for it in ln["items"]:
                t = norm(it["t"])
                if not t or is_boiler(t, ln["y"]):
                    continue
                items.append({"p": p, "y": ln["y"], "x": it["x0"], "t": t})
    items.sort(key=lambda i: (i["p"], i["y"], -i["x"]))
    return items


def parse_detail(items, target):
    """يقسّم البنود على الوحدات بحسب أسطر الساعات في العمود الأيمن."""
    started = False
    units, cur, practical = [], None, False
    for it in items:
        t, x = it["t"], it["x"]
        if not started:
            # لا يُفتح الجدول إلا بعد عنوانه، وإلا التقطنا أرقام صفحة الغلاف
            if "المنهج التفصيلي" in t:
                started = True
            continue
        if "المنهج التفصيلي" in t:
            continue
        # «مراجع الموضوع» تتكرر بعد كل وحدة فلا تصلح نهايةً للجدول
        if "مراجع" in t:
            continue
        # أسطر المراجع لاتينية؛ نستثني الأرقام المجردة فهي ساعات الوحدات
        if re.search(r"[A-Za-z]", t) and not re.search(r"[؀-ۿ]", t):
            continue
        if x > 500 and re.fullmatch(r"\d{1,3}", t):
            if sum(u["hours"] for u in units) >= target:
                break          # بلغنا مجموع الخطة الرسمي، فما بعده ليس من المقرر
            cur = {"hours": int(t), "title": "", "theory": [], "practical": [], "tools": []}
            units.append(cur)
            practical = False
            continue
        if cur is None:
            continue
        if x < 110:
            v = clean(t)
            # نطاقات صفحات المراجع تتسرب لعمود الأدوات، فنشترط نصاً عربياً
            if len(v) > 3 and re.search(r"[؀-ۿ]", v)                     and not re.search(r"\d", v) and v not in cur["tools"]:
                cur["tools"].append(v)
            continue
        if 250 <= x <= 480:
            if PRACTICAL_MARK in t:
                practical = True
                continue
            v = clean(t)
            # رموز التعداد تُستخرج كمحارف غير مطبوعة، فنشترط حرفاً حقيقياً
            if len(v) < 2 or not re.search(r"[؀-ۿA-Za-z]", v):
                continue
            if not cur["title"]:
                cur["title"] = v
            elif practical:
                cur["practical"].append(v)
            else:
                cur["theory"].append(v)
    return units


def main():
    doc = fitz.open(PDF)
    src = json.load(io.open(SRC, encoding="utf-8"))["courses"]
    out, report = [], []
    for c in src:
        items = collect(doc, c["pageStart"] - 1, c["pageEnd"])
        units = parse_detail(items, c['cth'] * 16)
        # مواءمة مع جدول الوحدات الرسمي. الكتلة التفصيلية قد تغطي عدة وحدات
        # رسمية متتالية (في ١٧١ يدمج المنهجُ التفصيلي «أساسيات عملية القطع ٥»
        # و«عمليات القطع ٣٢» في كتلة واحدة ٣٧ ساعة) — فنقبل التجزئة الأخشن:
        # ساعات الكتلة = مجموع ساعات وحداتها، والعنوان يُركَّب من عناوينها.
        official = c["units"]
        matched, ok, oi = [], True, 0
        for u in units:
            span, acc = [], 0
            while oi < len(official) and acc < u["hours"]:
                acc += official[oi]["hours"]
                span.append(oi)
                oi += 1
            if acc == u["hours"] and span:
                title = " و".join(official[i]["title"] for i in span)
            else:
                ok = False
                title = u["title"]
            # عمود أدوات التقييم يخرج مشظّى بين سبانات، وأدوات التقييم على أي
            # حال قائمة منسدلة يؤلفها النظام لا تُؤخذ من الخطة — فلا نصدّرها.
            matched.append({"title": title, "hours": u["hours"],
                            "officialSpan": span,
                            "theory": u["theory"], "practical": u["practical"]})
        ok = ok and oi == len(official)
        out.append({"code": c["code"], "nameAr": c["nameAr"], "cth": c["cth"],
                    "verified": ok, "officialUnits": len(official),
                    "units": matched})
        report.append((c["code"], len(units), len(official), ok,
                       sum(len(u["theory"]) for u in matched),
                       sum(len(u["practical"]) for u in matched)))

    io.open(OUT, "w", encoding="utf-8").write(json.dumps(
        {"source": "خطة تقنية الصيانة الميكانيكية.pdf — المنهج التفصيلي",
         "courses": out}, ensure_ascii=False, indent=1))

    print("%-10s %-6s %-8s %-6s %-8s %s" % ("code", "units", "official", "match", "theory", "practical"))
    allok = True
    for r in report:
        allok = allok and r[3]
        print("%-10s %-6d %-8d %-6s %-8d %d" % (r[0], r[1], r[2], "OK" if r[3] else "BAD", r[4], r[5]))
    print("ALL MATCH" if allok else "SOME MISMATCH")


# حارس الاستيراد: extract_detail_mmec يستورد محلّلات هذا الملف، ولا يجوز
# أن يعيد الاستيرادُ كتابةَ plan-detail.json المنقّح تحريرياً.
if __name__ == "__main__":
    main()
