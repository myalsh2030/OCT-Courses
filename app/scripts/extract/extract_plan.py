# -*- coding: utf-8 -*-
"""استخراج تفاصيل مقررات القسم من الخطة الرسمية، مع التحقق من ثابت س.أ × ١٦."""
import io
import json
import re

import fitz
import planlib

PDF = "M:/AI PROJECTS/ملف المدرب وتوصيف المقرر/خطة تقنية الصيانة الميكانيكية.pdf"
CAT = "M:/AI PROJECTS/ملف المدرب وتوصيف المقرر/app/src/data/department/catalogue.json"
OUT = "M:/AI PROJECTS/ملف المدرب وتوصيف المقرر/app/src/data/department/plan-courses.json"

AR_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")

# ترتيب أقسام المقررات كما تظهر في الملف — تحقّقتُ منه بصرياً من صور الصفحات
ORDER = ["MMIN 141", "MMIN 151", "MMIN 252", "MMIN 171", "MMIN 253",
         "MMIN 221", "MMIN 261", "MMIN 262", "MMIN 264"]

BOILER = ("المملكة العربية السعودية", "القسم التخصص", "المؤسسة العامة للتدريب",
          "التقنية الميكانيكية تقنية الصيانة", "الإدارة العامة للمناهج")


def norm(s):
    return re.sub(r"[ \t\u200f\u200e]+", " ", s.translate(AR_DIGITS)).strip()


def is_num(s):
    return bool(re.fullmatch(r"\d{1,3}", s.strip()))


def is_boiler(t):
    """ترويسة الصفحة وتذييلها «ص من ٦٩» تتخلل الجداول الممتدة على صفحتين."""
    if re.fullmatch(r"\d{1,2}\s*من\s*69", t):
        return True
    return any(t.startswith(b) for b in BOILER)


def section_lines(pages, a, b):
    out = []
    for p in range(a, b):
        for ln in pages[p]:
            out.append({
                "p": p, "y": ln["y"], "t": norm(ln["text"]),
                "items": [{"x": i["x0"], "t": norm(i["t"])} for i in ln["items"]],
            })
    return out


def parse_units(lines):
    """جدول الوحدات وساعاتها حتى «المجموع». الرقم قد يسبق عنوانه أو يليه."""
    start = None
    for i, ln in enumerate(lines):
        if "الوحدات" in ln["t"] and ("ساعات التدريب" in ln["t"] or "العملية" in ln["t"]):
            start = i + 1
            break
    if start is None:
        return [], None

    units, total, pending, pending_num = [], None, None, None
    for ln in lines[start:]:
        t = ln["t"]
        if not t or "النظرية و العملية" in t or is_boiler(t):
            continue
        if "المجموع" in t:
            nums = re.findall(r"\d+", t)
            total = int(nums[-1]) if nums else "PENDING"
            if nums:
                break
            continue
        if total == "PENDING":
            if is_num(t):
                total = int(t)
            break
        nums = [x for x in ln["items"] if is_num(x["t"])]
        texts = [x for x in ln["items"] if not is_num(x["t"]) and len(x["t"]) > 2]
        if texts and nums:
            units.append({"title": " ".join(x["t"] for x in texts),
                          "hours": int(nums[-1]["t"])})
            pending = pending_num = None
        elif texts:
            title = " ".join(x["t"] for x in texts)
            if pending_num is not None:
                units.append({"title": title, "hours": pending_num})
                pending_num = None
            else:
                pending = title
        elif nums:
            if pending is not None:
                units.append({"title": pending, "hours": int(nums[-1]["t"])})
                pending = None
            else:
                pending_num = int(nums[-1]["t"])
    return units, total


def squash(t):
    """المصدر يقحم نقطتين وفراغات داخل العناوين: «و:صف المقرر»، «ا :لهدف»."""
    return re.sub(r"[\s:ـ]", "", t)


def between(lines, start_key, end_keys):
    """يقصّ ما بين عنوانين، والمطابقة على النص منزوع الفراغات والنقطتين."""
    buf, on = [], False
    for ln in lines:
        t = ln["t"]
        if is_boiler(t):
            continue
        key = squash(t)
        if not on:
            if start_key in key:
                on = True
                idx = key.index(start_key) + len(start_key)
                if idx < len(key) and len(key) - idx > 6:
                    buf.append(re.sub(r"^.*?" + re.escape(start_key[-4:]), "", t).strip(" :ـ"))
            continue
        if any(k in key for k in end_keys):
            break
        if t:
            buf.append(t)
    return buf


def parse_safety(lines):
    raw = between(lines, "إجراءاتواشتراطاتالسلامة", ["المنهجالتفصيلي", "الوحدات"])
    numbered = sum(1 for t in raw if re.match(r"^\d{1,2}\s*[\.\-]", t))
    if numbered < 2:
        # بعض المقررات تكتب الاشتراطات فقرةً واحدة لا قائمة مرقّمة
        para = clean_para(raw)
        return [para] if len(para) > 10 else []
    out, cur = [], None
    for t in raw:
        m = re.match(r"^(\d{1,2})\s*[\.\-]?\s*(.*)$", t)
        if m and m.group(2):
            if cur:
                out.append(cur)
            cur = m.group(2).strip()
        elif re.fullmatch(r"\d{1,2}", t):
            continue
        elif t.startswith("."):
            if cur:
                out.append(cur)
            cur = t.lstrip(". ").strip()
        elif cur:
            cur += " " + t
    if cur:
        out.append(cur)
    return [re.sub(r"\s+", " ", x).strip(" .") + "." for x in out if len(x) > 5]


def clean_para(parts):
    """يجمع الفقرة كما وردت. النقاط والأقواس قد تظهر في غير موضعها لأن المصدر
    يخزّن ترقيم الجمل بترتيب بصري — تُترك كما هي لأن أي إزاحة تخمينية قد تُفسد
    المعنى، والمستخدم يحرّر النص في الواجهة على أي حال."""
    txt = re.sub(r"\s+", " ", " ".join(parts)).strip()
    txt = re.sub(r"\s+\.", ".", txt)          # فراغ قبل النقطة
    txt = re.sub(r"\.(?=[^\s\d])", ". ", txt)  # نقطة ملتصقة بما بعدها
    txt = re.sub(r"\s+", " ", txt).strip()
    return (txt.rstrip(" .") + ".") if txt else ""


def main():
    doc = fitz.open(PDF)
    pages = [planlib.page_lines(doc[i]) for i in range(doc.page_count)]

    starts = []
    for i, lines in enumerate(pages):
        head = " ".join(norm(l["text"]) for l in lines[:12]).replace("ا سم", "اسم")
        if "اسم المقرر" in head and "لرمز" in head:
            starts.append(i)
    bounds = list(zip(starts, starts[1:] + [len(pages)]))

    courses = []
    for a, b in bounds:
        lines = section_lines(pages, a, b)
        units, declared = parse_units(lines)
        if not units:
            continue
        courses.append({
            "pageStart": a + 1, "pageEnd": b,
            "units": units,
            "unitsSum": sum(u["hours"] for u in units),
            "declaredTotal": declared,
            "safety": parse_safety(lines),
            "description": clean_para(
                between(lines, "وصفالمقرر", ["الهدفالعام"])),
            "generalObjective": clean_para(
                between(lines, "الهدفالعاممنالمقرر", ["الأهدافالتفصيلية", "الاهدافالتفصيلية"])),
        })

    cat = {c["code"]: c for c in json.load(io.open(CAT, encoding="utf-8"))["courses"]}
    ok = True
    for c, code in zip(courses, ORDER):
        c["code"] = code
        c["nameAr"] = cat[code]["nameAr"]
        c["cth"] = cat[code]["cth"]
        c["expected"] = cat[code]["cth"] * 16
        c["valid"] = c["unitsSum"] == c["expected"]
        ok = ok and c["valid"]

    payload = {
        "source": "خطة تقنية الصيانة الميكانيكية.pdf — صفحات تفاصيل المقررات",
        "note": "مستخرج آلياً؛ الثابت المفروض: مجموع ساعات الوحدات = س.أ × ١٦",
        "courses": [{k: v for k, v in c.items() if k != "valid"} for c in courses],
    }
    io.open(OUT, "w", encoding="utf-8").write(
        json.dumps(payload, ensure_ascii=False, indent=1))

    print("sections: %d" % len(courses))
    for c in courses:
        print("  %s %-9s p%-3d units=%2d sum=%3d expected=%3d safety=%2d desc=%d" % (
            "OK " if c["valid"] else "BAD", c["code"], c["pageStart"],
            len(c["units"]), c["unitsSum"], c["expected"],
            len(c["safety"]), len(c["description"])))
    print("ALL VALID" if ok else "SOME INVALID")


# يُستورد هذا الملف من extract_plan_mmec لإعادة استعمال محلّلاته — والحارس
# يمنع إعادة كتابة plan-courses.json عند الاستيراد (تُفقد بها التنقيحات).
if __name__ == "__main__":
    main()
