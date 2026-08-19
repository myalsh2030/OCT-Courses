# -*- coding: utf-8 -*-
"""استخراج مقررات الدراسات العامة العشرة من ملفات مواصفاتها الرسمية.

المصدر: `ملف المدرب وتوصيف المقرر/المواد العامة/*.pdf` — عشر مواصفات
بثلاثة قوالب مختلفة، بعضها عربي وبعضها إنجليزي.

## علل المصدر التي يعالجها محرّك النص

1. الحروف مخزّنة بصيغ العرض (Presentation Forms)، ومحارف الروابط صفرية
   العرض تسبق حاملها — فتخرج الكلمات مشوّهة. الحل: إعادة ترتيب صفريات
   العرض بعد حاملها، ثم NFKC.
2. محرف الفراغ يُكتب في غير موضعه داخل السبان فتلتصق الكلمات. الحل: إسقاط
   الفراغات كلها واستنتاجها هندسياً من الفجوة الأفقية، بعتبة مشتقة من عرض
   الفراغ الحقيقي في الملف نفسه (٠٫٢١ من قياس الخط) لا من تخمين ثابت —
   وهي تفصل الفراغ عن فجوة الحرف غير المتصل (٠٫٠٦ من القياس) بأمان.
3. المصدر يخزّن المحارف بترتيب بصري لا منطقي: مسحُها يميناً ← يساراً يعطي
   الترتيب المنطقي للعربي، أما مقاطع الأرقام واللاتيني فتُقرأ يساراً ←
   يميناً فتُعكس. بهذا تُصحَّح السنوات المقلوبة (٥١٤١ ← ١٤١٥) والرموز
   المقلوبة (سلما ← اسلم) وتُوضع علامات الترقيم في مواضعها.

## قواعد التحقق

- `مح + عم + تم = س.أ` لكل مقرر.
- `مجموع ساعات الوحدات = س.أ × ١٦`.
- مطابقة الرموز والساعات بشعب رايات في تقرير SS01.

لا تأليف: ما عجز الاستخراج عنه يُكتب `""` ويُسجَّل في التقرير.
"""
import collections
import csv
import io
import json
import os
import re
import statistics
import unicodedata

import fitz

SRC = "M:/AI PROJECTS/ملف المدرب وتوصيف المقرر/المواد العامة"
OUT = "M:/AI PROJECTS/OCT-Courses/seed/general"
SS01 = "M:/RAYAT_REPORTS/SS01_135_144710_2026-08-19_1716.csv"
GENERAL_DEPT = "الدراسات العامة"

# ---------------------------------------------------------------- محرّك النص

DIGITS = re.compile(r"[0-9\u0660-\u0669\u06f0-\u06f9]")
LAT = re.compile(r"[A-Za-z]")
ARABIC = re.compile(r"[\u0600-\u06ff\u0750-\u077f]")
BULLETS = "\u2022\u25aa\u25cf\u00b7"
AR2EN = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")


def _ordered_chars(span):
    """الحرف الحامل للرباط يسبق مكوّناته صفرية العرض في مصدر PDF."""
    ch = list(span["chars"])
    zero = lambda c: (c["bbox"][2] - c["bbox"][0]) < 0.01
    out, i = [], 0
    while i < len(ch):
        if zero(ch[i]):
            j = i
            while j < len(ch) and zero(ch[j]):
                j += 1
            if j < len(ch):
                out.append(ch[j])
                out.extend(reversed(ch[i:j]))
                i = j + 1
            else:
                out.extend(ch[i:j])
                i = j
        else:
            out.append(ch[i])
            i += 1
    return out


# خط Calibri في المواصفات الإنجليزية يخزّن رباط «ti» برمز U+019F لخللٍ في
# جدول ToUnicode. راجعتُ الخمسة والأربعين موضعاً كلها فكانت «ti» بلا استثناء
# (Troubleshooting، Action، Descriptions…)، فالإبدال محقَّق لا مخمَّن.
BROKEN_GLYPHS = {"Ɵ": "ti"}


def _clean(c):
    s = unicodedata.normalize("NFKC", BROKEN_GLYPHS.get(c, c))
    return s.replace("\u200f", "").replace("\u200e", "").replace("\u0640", "")


def space_widths(doc):
    """عرض الفراغ الحقيقي لكل قياس خط في الملف — أساس عتبة فصل الكلمات."""
    acc = {}
    for pg in doc:
        for blk in pg.get_text("rawdict")["blocks"]:
            for ln in blk.get("lines", []):
                for sp in ln["spans"]:
                    for c in sp["chars"]:
                        w = c["bbox"][2] - c["bbox"][0]
                        if c["c"] == " " and w > 0.1:
                            acc.setdefault(round(sp["size"], 1), []).append(w)
    return {k: statistics.median(v) for k, v in acc.items()}


def _thr(size, widths):
    key = round(size, 1)
    if key in widths:
        return 0.55 * widths[key]
    near = [k for k in widths if abs(k - size) < 1.5]
    if near:
        return 0.55 * widths[min(near, key=lambda k: abs(k - size))]
    return 0.12 * size


def span_clusters(span):
    """عناقيد: حرف حامل ومعه ما يتبعه من محارف صفرية العرض."""
    out = []
    for c in _ordered_chars(span):
        s = _clean(c["c"])
        if not s.strip():
            continue
        if (c["bbox"][2] - c["bbox"][0]) < 0.01 and out:
            out[-1]["c"] += s
            continue
        out.append({"c": s, "x0": c["bbox"][0], "x1": c["bbox"][2],
                    "size": span["size"]})
    return out


def _kind(c):
    """الأرقام الهندية تقع في كتلة العربية يونيكوديّاً لكنها تُقرأ يساراً ←
    يميناً كنظيرتها اللاتينية، فتُصنَّف معها لا مع الحروف."""
    t = c["c"]
    if DIGITS.search(t) or LAT.search(t):
        return "L"
    if ARABIC.search(t):
        return "R"
    return "N"


def _reorder(cl, rtl):
    """إعادة بناء الترتيب المنطقي من المواضع الأفقية."""
    cl = sorted(cl, key=(lambda c: -c["x0"]) if rtl else (lambda c: c["x0"]))
    want = "L" if rtl else "R"
    out, i, n = [], 0, len(cl)
    while i < n:
        if _kind(cl[i]) == want:
            j = i + 1
            while j < n and (_kind(cl[j]) == want or
                             (_kind(cl[j]) == "N" and j + 1 < n and
                              _kind(cl[j + 1]) == want)):
                j += 1
            out.extend(sorted(cl[i:j],
                              key=(lambda c: c["x0"]) if rtl else (lambda c: -c["x0"])))
            i = j
        else:
            out.append(cl[i])
            i += 1
    return out


def is_rtl_text(t):
    return len(ARABIC.findall(t)) >= len(LAT.findall(t))


def join_clusters(cl, rtl, widths):
    if not cl:
        return ""
    cl = _reorder(cl, rtl)
    thr = _thr(max(c["size"] for c in cl), widths)
    parts = []
    for i, c in enumerate(cl):
        if i:
            p = cl[i - 1]
            # الفجوة أفقية صرفة: بعد إعادة الترتيب قد يسبق العنقودُ جارَه
            # يميناً أو يساراً، فلا يصلح طرحٌ ذو اتجاه واحد.
            if max(p["x0"] - c["x1"], c["x0"] - p["x1"]) > thr:
                parts.append(" ")
        parts.append(c["c"])
    return polish(re.sub(r" +", " ", "".join(parts)).strip())


def fix_brackets(t):
    """المصدر يخزّن شكل القوس البصري أحياناً فينقلب زوجه في السياق العربي.

    الدليل على الانقلاب قوسٌ مغلق يسبق أيَّ افتتاح، لا مجرّد تجاور «)…(» —
    فالتجاور وارد في نصٍّ سليم مثل «(2-6-1) Scalar Product (Dot Product)».
    """
    if "(" not in t or ")" not in t:
        return t
    depth = 0
    for ch in t:
        if ch == "(":
            depth += 1
        elif ch == ")":
            if depth == 0:
                return t.translate(str.maketrans("()", ")("))
            depth -= 1
    return t


def polish(t):
    """تنقية شكلية لا تمسّ المعنى: الأقواس المقلوبة والترقيم الزائد."""
    t = fix_brackets(t)
    t = re.sub(r"\s+([،:؛.!؟])", r"\1", t)
    t = re.sub(r"\.{2,}", ".", t)
    t = re.sub(r"([:،؛])(?=\S)", r"\1 ", t)
    return re.sub(r" +", " ", t).strip()


def page_spans(pg, widths):
    out = []
    for blk in pg.get_text("rawdict")["blocks"]:
        for ln in blk.get("lines", []):
            for sp in ln["spans"]:
                cl = span_clusters(sp)
                if not cl:
                    continue
                rtl = is_rtl_text("".join(c["c"] for c in cl))
                out.append({"cl": cl, "size": sp["size"],
                            "t": join_clusters(cl, rtl, widths),
                            "x0": sp["bbox"][0], "x1": sp["bbox"][2],
                            "y": round(sp["bbox"][1], 1)})
    return out


def cell_text(spans, widths, rtl=None):
    """نص خلية = عناقيد سباناتها مجموعةً ومعاداً بناء ترتيبها المنطقي."""
    cl = []
    for s in spans:
        cl.extend(s["cl"])
    if not cl:
        return ""
    if rtl is None:
        rtl = is_rtl_text("".join(c["c"] for c in cl))
    return join_clusters(cl, rtl, widths)


def bands(spans, tol=3.0):
    """يجمع السبانات في نطاقات أفقية (أسطر) بحسب y، والصفحةُ أسبقُ من y."""
    out = collections.OrderedDict()
    for s in sorted(spans, key=lambda s: (s.get("p", 0), s["y"], -s["x0"])):
        cur, key = (s.get("p", 0), s["y"]), None
        for k in out:
            if k[0] == cur[0] and abs(k[1] - cur[1]) <= tol:
                key = k
                break
        out.setdefault(cur if key is None else key, []).append(s)
    return out


def is_bullet(t):
    return bool(t) and all(c in BULLETS or 0xE000 <= ord(c) <= 0xF8FF for c in t)


def strip_bullet(t):
    return re.sub(r"^[\s\u2022\u25aa\u25cf\u00b7o\-\u2013\ue000-\uf8ff]+", "", t).strip()


# ------------------------------------------------------------ إعداد المقررات
#
# `hoursDir`: اتجاه صف الساعات في الجدول — عربي: مح ثم عم ثم تم يميناً ←
# يساراً؛ إنجليزي: L ثم P ثم T يساراً ← يميناً. تحقّقتُ من الاتجاهين بصرياً
# من صور صفحات الغلاف العشر.
# `cols`: حدود أعمدة «المنهج التفصيلي» بالنقاط — (ساعات، محتوى) لكل قالب.

COURSES = [
    {"code": "اسلم-101", "file": "101اسلم - الدراسات الإسلامية.pdf",
     "tpl": "classic", "hoursDir": "ar", "cols": (505, 170, 505)},
    {"code": "حاسب-101", "file": "101حاسب - مقدمة تطبيقات الحاسب.pdf",
     "tpl": "hasb", "hoursDir": "hasb", "cols": (500, 170, 500)},
    {"code": "رياض-101", "file": "101رياض - الرياضيات.pdf",
     "tpl": "classic", "hoursDir": "ar", "cols": (505, 170, 505)},
    {"code": "عربي-101", "file": "101عربي - الكتابة الفنية.pdf",
     "tpl": "classic", "hoursDir": "ar", "cols": (500, 160, 500)},
    {"code": "فيزي-101", "file": "101فيزي - الفيزياء.pdf",
     "tpl": "phys", "hoursDir": "en", "cols": (95, 95, 425), "subrowX": 553},
    {"code": "رياض-121", "file": "121رياض - الرياضيات.pdf",
     "tpl": "classic", "hoursDir": "ar", "cols": (505, 170, 505)},
    {"code": "انجل-101", "file": "ENGL101 - English Language 1.pdf",
     "tpl": "engl", "hoursDir": "en", "cols": (95, 95, 350)},
    {"code": "انجل-102", "file": "ENGL102 - English Language 2.pdf",
     "tpl": "engl", "hoursDir": "en", "cols": (95, 95, 350)},
    {"code": "انجل-103", "file": "ENGL103 - English Language 3.pdf",
     "tpl": "engl", "hoursDir": "en", "cols": (95, 95, 350)},
    {"code": "اسلك-201", "file": "السلوك الوظيفي والمستقبل المهني.pdf",
     "tpl": "slk", "hoursDir": "slk", "cols": (500, 175, 500)},
]

# رموز المواصفات الإنجليزية لا تطابق ترميز رايات، والمقابلة مثبتة في التقرير
CODE_MAP = {"PHYS 101": "فيزي-101", "ENGL 101": "انجل-101",
            "ENGL 102": "انجل-102", "ENGL 103": "انجل-103"}

DETAIL_HEAD = ("المنهج التفصيلي", "Detailed of Theoretical", "SYLLABUS")
UNITS_HEAD = "الوحدات"
SAFETY_HEAD = ("إجراءات واشتراطات السلامة", "Safety Procedures")
REF_MARK = ("مراجع", "المو", "ضوع", "المراج", "Textbooks")

# ترويسة الجدول تتكرر في رأس كل صفحة: يُسقَط النطاق كاملاً لا السبان وحده،
# وإلا تسرّبت بقيّته («النظري» من «المنهج التفصيلي النظري») إلى بنود الوحدة.
HEAD_ROW = DETAIL_HEAD + (
    "المحتوى", "الساعات", "الساعا", "أدوات التقييم", "المملكة العربية",
    "المؤسسة العامة", "الإدارة العامة", "الدراسات العامة", "مقررات عامة",
    "ومتطلبات كلية", "Contents", "Hours", "Assessment Tools",
    "Instructional Objectives", "Students will learn",
    "Language forms and functions")

# نهاية جدول المنهج: صف المجموع، وقائمة تجهيزات المعمل التي تليه في فيزي.
# «المجموع» يُطابَق كاملاً لا بالبادئة، وإلا ابتلع وحدةَ «المجموعات» في رياض.
STOP_TOTAL = re.compile(r"(?:المجموع|Total)\s*:?\s*\d{0,3}$")
DETAIL_STOP = ("List of Detailed Equipment", "Capacity of Human Resources",
               "تلميحات هامة", "المراجع المؤلف")


def is_stop(t):
    t = t.strip()
    return bool(STOP_TOTAL.fullmatch(t)) or t.startswith(DETAIL_STOP)


# ------------------------------------------------------------------ الترويسة

def norm_code(raw):
    """يوحّد الرمز على صيغة رايات: حروف عربية وأرقام إنجليزية، «حاسب-101»."""
    raw = raw.strip()
    if raw in CODE_MAP:
        return CODE_MAP[raw]
    digits = re.search(r"[0-9\u0660-\u0669]{3}", raw)
    letters = re.search(r"[\u0621-\u064a]{3,5}", raw)
    if digits and letters:
        return "%s-%s" % (letters.group(0), digits.group(0).translate(AR2EN))
    return ""


def parse_header(pages, widths, tpl):
    """اسم المقرر ورمزه والمتطلب السابق من جدول الغلاف."""
    rtl = tpl not in ("engl", "phys")
    name, code, prereq = "", "", ""
    for _, row in bands(pages[0]).items():
        t = cell_text(row, widths, rtl)
        m = re.search(r"اسم\s*المقرر\s*(.*?)\s*(?:رمز\s*المقرر|الرمز)\s*(.+)$", t)
        if m and not code:
            name, code = m.group(1).strip(), m.group(2).strip()
        m = re.search(r"Course\s*Name\s*(.*?)\s*Course\s*Code\s*(.+)$", t)
        if m and not code:
            name, code = m.group(1).strip(), m.group(2).strip()
        m = re.search(r"(?:المتطلب\s*السابق|متطلب\s*سابق)\s*(.*)$", t)
        if m:
            prereq = m.group(1).strip()
        m = re.search(r"Prerequisites\s*(.+)$", t)
        if m:
            prereq = m.group(1).strip()
    return name, code, prereq


def parse_hours(pages, widths, direction):
    """الساعات من جدول الغلاف.

    القالب الكلاسيكي: صفٌ فيه «المعتمدة» و«س.أ»، وتحته صف «مح/عم/تم».
    القالب الإنجليزي: `Credit Hours CRH` ثم `CTH`، وتحته `L/P/T`.
    القالبان الحديثان (حاسب واسلك) يسمّيان أعمدتهما صراحةً.
    """
    rows = bands(pages[0])
    if direction == "slk":
        # صف عناوين «معتمدة نظري عملي تمارين اتصال» يليه صف قيمه
        for (pg, y), row in rows.items():
            t = cell_text(row, widths, True)
            if "معتمدة" in t and "اتصال" in t:
                nxt = [r for (q, k), r in rows.items() if q == pg and y < k < y + 45]
                if not nxt:
                    break
                nums = _numbers(nxt[0], rtl=True)
                if len(nums) == 5:
                    return dict(zip(("crh", "lecture", "practical",
                                     "tutorial", "cth"), nums))
        return {}
    if direction == "hasb":
        # جدول فصلي: لكل بند سطرُه، وقيمته يسار عنوانه
        want = {"الساعات المعتمدة": "crh", "محاضرة": "lecture",
                "عملي": "practical", "تمرين": "tutorial"}
        got = {}
        for (pg, y), row in rows.items():
            t = cell_text(row, widths, True)
            for lbl, key in want.items():
                if t.startswith(lbl) and key not in got:
                    nums = _numbers([s for s in row if s["x0"] < 430], rtl=True)
                    near = [r for (q, k), r in rows.items() if q == pg and y < k < y + 4]
                    if not nums and near:
                        nums = _numbers(near[0], rtl=True)
                    if nums:
                        got[key] = nums[0]
        if len(got) == 4:
            got["cth"] = got["lecture"] + got["practical"] + got["tutorial"]
            got["cthDerived"] = True
        return got
    # القالب الكلاسيكي (عربي/إنجليزي): نطاقان متتاليان من الأرقام
    rtl = direction == "ar"
    numeric = []
    for (_, y), row in rows.items():
        if y > 200:
            break
        nums = _numbers(row, rtl, cap=20)
        if nums:
            numeric.append((y, nums))
    pair = [n for n in numeric if len(n[1]) == 2]
    trio = [n for n in numeric if len(n[1]) == 3]
    if not pair or not trio:
        return {}
    a, b = pair[0][1]
    l, p, t = trio[0][1]
    # المعتمدة وس.أ يتبادلان الطرفين بين القالبين؛ س.أ هي التي تساوي مجموع
    # مح+عم+تم، فيُحسم التمييز بالبيانات لا بالاتجاه.
    crh, cth = (a, b) if b == l + p + t else (b, a)
    return {"crh": crh, "cth": cth, "lecture": l, "practical": p, "tutorial": t}


def _numbers(spans, rtl, cap=None):
    """الأعداد في نطاق، بترتيب القراءة.

    `cap` يستبعد ما ليس ساعةً: رمز المقرر «ENGL 101» و«١٠١ اسلم» ورقم
    مستوى اللغة في «English Language 1» تقع كلها في صف الترويسة نفسه.
    """
    out = []
    for s in sorted(spans, key=(lambda s: -s["x0"]) if rtl else (lambda s: s["x0"])):
        t = s["t"].translate(AR2EN)
        if cap is not None and (LAT.search(t) or re.search(r"\d{3}", t)):
            continue
        for m in re.finditer(r"\d{1,3}", t):
            v = int(m.group(0))
            if cap is None or v <= cap:
                out.append(v)
    return out


# -------------------------------------------------------------- جدول الوحدات

UNITS_HOURS_X = 200   # عمود «ساعات التدريب» في جدول الوحدات يقع يسار الصفحة


def parse_units_table(pages, widths):
    """جدول «الوحدات (النظرية والعملية) ساعات التدريب» حتى «المجموع».

    الرقم في عمود الساعات يفتتح صفَّ وحدة، وعنوانها في العمود الأيمن قد
    ينزل عنه بنحو ثلاث نقاط، فيُؤخذ ما بين افتتاحين متتاليين.
    """
    body, on = [], False
    for p, pg in enumerate(pages):
        for _, row in bands(pg).items():
            t = cell_text(row, widths, True)
            if not on:
                if t.startswith(UNITS_HEAD) and "ساعات" in t:
                    on = True
                continue
            if t.startswith("المجموع"):
                nums = _numbers(row, True)
                return _units_rows(body, widths), (nums[-1] if nums else None)
            body.extend(dict(s, p=p) for s in row)
    return (_units_rows(body, widths), None) if body else ([], None)


def _units_rows(body, widths):
    body.sort(key=lambda s: (s["p"], s["y"], -s["x0"]))
    marks = [s for s in body if s["x1"] <= UNITS_HOURS_X and
             re.fullmatch(r"\d{1,3}", s["t"].translate(AR2EN))]
    units = []
    for k, s in enumerate(marks):
        lo = (s["p"], s["y"] - 4.0)
        hi = (marks[k + 1]["p"], marks[k + 1]["y"] - 4.0) if k + 1 < len(marks) \
            else (10 ** 6, 10 ** 6)
        cells = [x for x in body if lo <= (x["p"], x["y"]) < hi
                 and x["x0"] > UNITS_HOURS_X]
        title = " ".join(cell_text(r, widths, True)
                         for r in bands(cells).values()).strip()
        units.append({"title": _tidy_title(title),
                      "hours": int(s["t"].translate(AR2EN))})
    return units


def _tidy_title(t):
    t = re.sub(r"\s*:\s*$", "", strip_bullet(t)).strip()
    t = re.sub(r"^الوحدة\s+(\d+)\s*:?\s*", r"الوحدة \1: ", t)
    return re.sub(r"\s+", " ", t).strip(" :،")


# ------------------------------------------------------- المنهج التفصيلي

def page_rules(pg):
    """خطوط الجدول الأفقية — حدودُ صفوفه الحقيقية.

    رقم الساعات يُوسَّط رأسياً في الصف، فقد يبعد عن عنوان الوحدة عشرات
    النقاط (صف «محضر الاجتماع» في عربي ١٠١). الخط الفاصل يحسم بداية الصف.
    """
    ys = set()
    for dr in pg.get_drawings():
        for it in dr["items"]:
            if it[0] == "l" and abs(it[1].y - it[2].y) < 0.6 \
                    and abs(it[1].x - it[2].x) > 100:
                ys.add(round(it[1].y, 1))
            elif it[0] == "re" and it[1].height < 1.5 and it[1].width > 100:
                ys.add(round(it[1].y0, 1))
    return sorted(ys)


def page_subrows(pg, xlo, xhi):
    """رؤوس الصفوف الفرعية، من الخط الرأسي المقطَّع عند حافة عمود الساعات.

    صف «مراجع الموضوع» صفٌّ فرعيٌّ مستقل داخل صف الوحدة، ولا يفصله خطٌّ
    أفقي؛ لكن الخط الرأسي عند الحافة ينقطع عند حدّه — وهذا أضبط دليل عليه.
    """
    tops = set()
    for dr in pg.get_drawings():
        for it in dr["items"]:
            if it[0] == "l" and abs(it[1].x - it[2].x) < 0.6 \
                    and abs(it[1].y - it[2].y) > 5 and xlo <= it[1].x <= xhi:
                tops.add(round(min(it[1].y, it[2].y), 1))
            elif it[0] == "re" and it[1].width < 1.5 and it[1].height > 5 \
                    and xlo <= it[1].x0 <= xhi:
                tops.add(round(it[1].y0, 1))
    return sorted(tops)


def detail_start(doc, widths):
    """موضع عنوان «المنهج التفصيلي» — بدايةُ الجدول، وما قبله ليس منه."""
    for p in range(doc.page_count):
        for s in sorted(page_spans(doc[p], widths), key=lambda s: s["y"]):
            if any(s["t"].startswith(h) for h in DETAIL_HEAD):
                return (p, s["y"])
    return None


def parse_detail(doc, widths, cfg):
    """كتل المنهج التفصيلي: لكل كتلة ساعاتها وعنوانها وبنودها.

    الكتلة تُفتتح برقم في عمود الساعات؛ وعنوانها أول نص في عمود المحتوى
    (قد يعلو رقمَ الساعات ببضع نقاط، فنسمح بهامش ٤ نقاط)، وما بعده بنود
    يفصلها رمز التعداد. صفوف «مراجع الموضوع» تُستبعد.
    """
    hx, cx0, cx1 = cfg["cols"]
    rtl = cfg["tpl"] not in ("engl", "phys")
    start = detail_start(doc, widths)
    if start is None:
        return []
    items, stop = [], False
    for p in range(start[0], doc.page_count):
        if stop:
            break
        page = [dict(s, p=p) for s in page_spans(doc[p], widths)
                if s["t"] and 70 <= s["y"] <= 782]
        for (_, y), row in bands(page).items():
            if (p, y) <= start:
                continue
            # صف المجموع يُلغى كاملاً: رقمه في عمود الساعات يسبق كلمته
            if any(is_stop(s["t"]) for s in row):
                # رقم المجموع قد يعلو كلمته بأكثر من سماحة النطاق، فيُقتطع
                # ما التُقط في محيط صف التوقّف
                items = [x for x in items if (x["p"], x["y"]) < (p, y - 10)]
                stop = True
                break
            if any(s["t"].startswith(HEAD_ROW) for s in row):
                continue
            items.extend(row)
    items.sort(key=lambda s: (s["p"], s["y"], -s["x0"] if rtl else s["x0"]))

    # مواضع افتتاح الكتل: أرقام مجرّدة في عمود الساعات
    def in_hours(s):
        return (s["x0"] >= hx) if rtl else (s["x1"] <= hx)

    marks = [s for s in items
             if in_hours(s) and re.fullmatch(r"\d{1,3}", s["t"].translate(AR2EN))]
    rules = {p: page_rules(doc[p]) for p in range(start[0], doc.page_count)}

    def row_top(s):
        """بداية صف الوحدة: أقرب خطٍّ فاصل فوق رقم الساعات."""
        above = [r for r in rules.get(s["p"], []) if s["y"] - 90 < r < s["y"]]
        top = max(above) if above else s["y"] - 4.0
        return (s["p"], max(top, start[1]) if s["p"] == start[0] else top)

    # الصفوف الفرعية تعزل خانة «مراجع الموضوع» (كلاسيكي) وكتلة المراجع
    # (فيزي). ما دون ١١٠ نقطة رؤوسُ ترويسة الجدول لا صفوفٌ فرعية.
    sx = cfg.get("subrowX", cx1)
    subs = {p: [t for t in page_subrows(doc[p], sx - 12, sx + 12) if t > 110]
            for p in range(start[0], doc.page_count)} \
        if cfg["tpl"] in ("classic", "phys", "slk") else {}

    def content_end(lo, hi):
        """نهاية محتوى الصف: أول رأس صفٍّ فرعي بعده."""
        for p in range(lo[0], min(hi[0], doc.page_count - 1) + 1):
            for t in subs.get(p, []):
                # رأس الصف نفسه يقع تحت خطّه الأفقي بأقل من نقطتين
                if (lo[0], lo[1] + 4) < (p, t) < hi:
                    return (p, t)
        return hi

    blocks = []
    for k, s in enumerate(marks):
        lo = row_top(s)
        hi = row_top(marks[k + 1]) if k + 1 < len(marks) else (10 ** 6, 10 ** 6)
        end = content_end(lo, hi)
        body = [x for x in items
                if lo <= (x["p"], x["y"]) < end and cx0 <= x["x0"] <= cx1
                and x is not s]
        blocks.append({"hours": int(s["t"].translate(AR2EN)), "body": body})
    return [_block_items(b, widths, rtl, cfg) for b in blocks]


def _block_items(block, widths, rtl, cfg):
    """يقسّم بنود الكتلة: أول نطاق عنوانٌ، وما بعده بنود يفتحها التعداد."""
    title, topics, stopped = "", [], False
    for _, row in bands(block["body"]).items():
        if stopped:
            break
        marker = any(is_bullet(s["t"]) for s in row)
        if cfg["tpl"] == "engl":
            # عمود المحتوى الإنجليزي مرقّم لا معدّد: «1.1» في حافته اليسرى
            marker = any(s["x0"] < 115 for s in row)
        txt = strip_bullet(cell_text([s for s in row if not is_bullet(s["t"])],
                                     widths, rtl))
        if any(txt.startswith(m) for m in REF_MARK) or \
                any(s["t"].startswith(REF_MARK) and s["x0"] > 430 for s in row):
            stopped = True
            break
        if not txt:
            continue
        # محتوى القالب الكلاسيكي عربي بالكامل، فسطرٌ لاتيني صرف شظيةُ مرجع
        # (لاحقة «St» من ترقيم الطبعات) لا بندَ منهج
        if cfg["tpl"] == "classic" and not ARABIC.search(txt):
            continue
        if not title:
            title = txt
        elif marker or not topics:
            topics.append(txt)
        else:
            topics[-1] = polish(topics[-1] + " " + txt)
    return {"hours": block["hours"], "title": _tidy_title(title),
            "theory": [polish(t) for t in topics if len(t) > 2], "practical": []}


# ------------------------------------------------------------- نصوص إضافية

def parse_prose(pages, widths, rtl):
    """الوصف والهدف العام والأهداف التفصيلية كما وردت."""
    keys = [("description", ("وصف المقرر", "Course Description")),
            ("generalObjective", ("الهدف العام من المقرر", "General Objective")),
            ("objectives", ("الأهداف التفصيلية", "Detailed Objectives"))]
    stops = tuple(k for _, kk in keys for k in kk) + \
        (UNITS_HEAD,) + SAFETY_HEAD + DETAIL_HEAD
    out = {k: [] for k, _ in keys}
    cur = None
    for pg in pages:
        for (_, y), row in bands(pg).items():
            t = cell_text(row, widths, rtl)
            if not t or y < 60 or y > 790:
                continue
            hit = None
            for key, labels in keys:
                if any(t.replace(" ", "").startswith(l.replace(" ", ""))
                       for l in labels):
                    hit = key
            if hit:
                cur = hit
                continue
            if cur and any(t.replace(" ", "").startswith(s.replace(" ", ""))
                           for s in stops):
                cur = None
                continue
            if cur:
                out[cur].append(t)
    desc = polish(" ".join(out["description"]))
    obj = polish(" ".join(out["generalObjective"]))
    return desc, obj, _numbered(out["objectives"])


def _numbered(lines):
    """\u0642\u0627\u0626\u0645\u0629 \u0645\u0631\u0642\u0651\u0645\u0629\u060c \u0648\u0631\u0642\u0645\u064f\u0647\u0627 \u0642\u062f \u064a\u064f\u0643\u062a\u0628 \u0641\u064a \u0639\u0645\u0648\u062f \u0645\u0633\u062a\u0642\u0644 \u064a\u062a\u0648\u0633\u0651\u0637 \u0628\u0646\u062f\u064e\u0647 \u0631\u0623\u0633\u064a\u0627\u064b.

    \u0641\u0625\u0646 \u0648\u0631\u062f \u0627\u0644\u0631\u0642\u0645 \u0648\u062d\u062f\u0647 \u0641\u064a \u0633\u0637\u0631\u060c \u0641\u0628\u062f\u0627\u064a\u0629\u064f \u0628\u0646\u062f\u0647 \u0627\u0644\u0633\u0637\u0631\u064f \u0627\u0644\u0633\u0627\u0628\u0642 \u0644\u0627 \u0627\u0644\u062a\u0627\u0644\u064a \u2014
    \u0643\u0645\u0627 \u0641\u064a \u0623\u0647\u062f\u0627\u0641 \u0627\u0633\u0644\u0645 \u0661\u0660\u0661 \u062d\u064a\u062b \u00ab\u0665-\u00bb \u064a\u0642\u0639 \u0628\u064a\u0646 \u0634\u0637\u0631\u064a \u0628\u0646\u062f\u0647.
    """
    items = []
    for line in lines:
        t = line.translate(AR2EN).strip()
        head = re.match(r"^\d{1,2}\s*[-.\u2013]\s*(.+)$", t)
        if head:
            items.append([head.group(1)])
        elif re.fullmatch(r"\d{1,2}\s*[-.\u2013]?", t):
            if items and len(items[-1]) > 1:
                items.append([items[-1].pop()])
        elif items:
            items[-1].append(line)
    return [polish(" ".join(p)) for p in items]


def parse_safety(pages, widths, rtl):
    """نص السلامة كما ورد في المواصفة — بلا تحسين ولا إضافة."""
    out, on = [], False
    for pg in pages:
        for _, row in bands(pg).items():
            t = cell_text(row, widths, rtl)
            if not t:
                continue
            if any(t.replace(" ", "").startswith(h.replace(" ", ""))
                   for h in SAFETY_HEAD):
                on = True
                continue
            if on:
                if any(t.startswith(h) for h in DETAIL_HEAD) or \
                        t.startswith(UNITS_HEAD):
                    return out
                v = strip_bullet(re.sub(r"^\d{1,2}\s*[-.\u2013]\s*", "",
                                        t.translate(AR2EN)))
                if len(v) > 5:
                    out.append(polish(v))
    return out


# ------------------------------------------------------------- مطابقة رايات

def read_ss01():
    """شعب الدراسات العامة في تقرير رايات، مجمّعةً بالرمز."""
    agg = {}
    with io.open(SS01, encoding="utf-8-sig", newline="") as fh:
        for r in csv.DictReader(fh):
            if r["القسم"].strip() != GENERAL_DEPT:
                continue
            code = r["المقرر"].strip()
            e = agg.setdefault(code, {"code": code, "name": r["اسم المقرر"].strip(),
                                      "sections": 0, "hours": None})
            e["sections"] += 1
            if e["hours"] is None:
                num = lambda k: int(r[k]) if r[k].strip().isdigit() else 0
                e["hours"] = {"crh": num("الساعات المعتمدة"),
                              "lecture": num("ساعات المحاضرة"),
                              "practical": num("ساعات المختبر"),
                              "tutorial": num("ساعات أخرى"),
                              "cth": num("ساعات الاتصال")}
    return agg


# -------------------------------------------------------------------- التنفيذ

def build():
    ss01 = read_ss01()
    courses, details, issues = [], [], []
    for cfg in COURSES:
        path = os.path.join(SRC, cfg["file"])
        doc = fitz.open(path)
        widths = space_widths(doc)
        rtl = cfg["tpl"] not in ("engl", "phys")
        pages = [page_spans(doc[p], widths) for p in range(doc.page_count)]

        name, raw_code, prereq = parse_header(pages, widths, cfg["tpl"])
        hours = parse_hours(pages, widths, cfg["hoursDir"])
        blocks = parse_detail(doc, widths, cfg)
        table_units, declared = parse_units_table(pages, widths)
        desc, gobj, dobj = parse_prose(pages, widths, rtl)
        safety = parse_safety(pages, widths, rtl)

        src_code = norm_code(raw_code)
        if src_code and src_code != cfg["code"]:
            issues.append("%s: رمز المواصفة «%s» يخالف رمز رايات" %
                          (cfg["code"], raw_code))
        if cfg["tpl"] == "slk" and (not name or name == GENERAL_DEPT):
            # عيب في المصدر: خانة الاسم تحمل اسم القسم، والاسم في خانة المتطلب
            name, prereq = prereq, ""
            issues.append("اسلك-201: خانتا «اسم المقرر» و«متطلب سابق» متبادلتان "
                          "في المصدر — أُخذ الاسم من الخانة الحاملة له")

        units = table_units if table_units else _units_from_blocks(blocks)
        u_sum = sum(u["hours"] for u in units)
        cth = hours.get("cth")
        expected = cth * 16 if cth else None
        contact_ok = cth is not None and cth == (hours.get("lecture", 0) +
                                                 hours.get("practical", 0) +
                                                 hours.get("tutorial", 0))
        rec = {
            "code": cfg["code"],
            "sourceCode": raw_code,
            "nameAr": name if is_rtl_text(name) else "",
            "nameEn": "" if is_rtl_text(name) else name,
            "file": cfg["file"],
            "pages": doc.page_count,
            "template": cfg["tpl"],
            "hasDetail": bool(blocks),
            "prerequisite": prereq,
            "hours": {"credit": hours.get("crh"), "lecture": hours.get("lecture"),
                      "practical": hours.get("practical"),
                      "tutorial": hours.get("tutorial"), "contact": cth},
            "contactValid": contact_ok,
            "cthDerived": bool(hours.get("cthDerived")),
            "unitsFrom": "جدول الوحدات" if table_units else "المنهج التفصيلي",
            "units": units,
            "unitsSum": u_sum,
            "declaredTotal": declared,
            "expected": expected,
            "unitsValid": expected is not None and u_sum == expected,
            "description": desc,
            "generalObjective": gobj,
            "detailedObjectives": dobj,
            "safetyRaw": safety,
        }
        # الاسم العربي يُستكمل من رايات عند غيابه من المواصفة الإنجليزية
        if not rec["nameAr"] and cfg["code"] in ss01:
            rec["nameAr"] = ss01[cfg["code"]]["name"]
            rec["nameArSource"] = "SS01"
        courses.append(rec)

        b_sum = sum(b["hours"] for b in blocks)
        details.append({
            "code": cfg["code"], "nameAr": rec["nameAr"], "nameEn": rec["nameEn"],
            "cth": cth, "language": "ar" if rtl else "en",
            "detailBlocks": len(blocks), "detailHoursSum": b_sum,
            "verified": expected is not None and b_sum == expected,
            "units": blocks,
        })
        if not rec["contactValid"]:
            issues.append("%s: مح+عم+تم ≠ س.أ" % cfg["code"])
        if not rec["unitsValid"]:
            issues.append("%s: مجموع ساعات الوحدات %s ≠ س.أ×١٦ (%s)" %
                          (cfg["code"], u_sum, expected))
        if expected and b_sum != expected:
            issues.append("%s: مجموع ساعات المنهج التفصيلي %s ≠ %s" %
                          (cfg["code"], b_sum, expected))
        for b in blocks:
            if not b["title"]:
                issues.append("%s: كتلة بلا عنوان (%s ساعة)" % (cfg["code"], b["hours"]))
        doc.close()
    return courses, details, issues, ss01


def _units_from_blocks(blocks):
    """القوالب بلا جدول وحدات: الوحدة هي مجموع الكتل المتتالية بعنوان واحد."""
    units = []
    for b in blocks:
        title = b["title"]
        if units and units[-1]["title"] == title:
            units[-1]["hours"] += b["hours"]
        else:
            units.append({"title": title, "hours": b["hours"]})
    return units


def main():
    courses, details, issues, ss01 = build()
    os.makedirs(OUT, exist_ok=True)
    io.open(os.path.join(OUT, "plan-courses.json"), "w", encoding="utf-8").write(
        json.dumps({
            "source": "ملف المدرب وتوصيف المقرر/المواد العامة — عشر مواصفات مقرر رسمية",
            "note": "مستخرج آلياً من ملفات المواصفات. الثوابت المفروضة: "
                    "مح+عم+تم = س.أ، ومجموع ساعات الوحدات = س.أ×١٦. "
                    "الرموز موحّدة على صيغة رايات.",
            "courses": courses}, ensure_ascii=False, indent=1))
    io.open(os.path.join(OUT, "plan-detail.json"), "w", encoding="utf-8").write(
        json.dumps({
            "source": "ملف المدرب وتوصيف المقرر/المواد العامة — المنهج التفصيلي",
            "note": "المواضيع كما وردت في المواصفات بلا تحرير. لا مواصفة من "
                    "العشر تفرد قائمةً للمحتوى العملي، فحقل practical فارغ.",
            "courses": details}, ensure_ascii=False, indent=1))

    print("%-10s %-28s %-5s %-5s %-6s %-6s %-7s %s" %
          ("code", "name", "crh", "cth", "units", "sum", "detail", "ok"))
    for c, d in zip(courses, details):
        print("%-10s %-28.28s %-5s %-5s %-6d %-6d %-7d %s%s" % (
            c["code"], c["nameAr"] or c["nameEn"], c["hours"]["credit"],
            c["hours"]["contact"], len(c["units"]), c["unitsSum"],
            d["detailHoursSum"],
            "OK" if c["unitsValid"] and c["contactValid"] else "BAD",
            "" if d["verified"] else " detail!"))
    print("\n--- مطابقة SS01 (قسم الدراسات العامة) ---")
    mine = {c["code"] for c in courses}
    for code, e in sorted(ss01.items()):
        if code not in mine:
            print("  شعب بلا مواصفة: %-10s %-30s شعب=%d" %
                  (code, e["name"], e["sections"]))
    for c in courses:
        e = ss01.get(c["code"])
        if not e:
            print("  مواصفة بلا شعب: %-10s %s" % (c["code"], c["nameAr"]))
            continue
        diff = [k for k, v in (("crh", c["hours"]["credit"]),
                               ("lecture", c["hours"]["lecture"]),
                               ("practical", c["hours"]["practical"]),
                               ("tutorial", c["hours"]["tutorial"]),
                               ("cth", c["hours"]["contact"]))
                if e["hours"][k] != v]
        print("  %-10s شعب=%-3d %s" % (c["code"], e["sections"],
                                        "مطابق" if not diff else "اختلاف: %s" % diff))
    if issues:
        print("\n--- ملاحظات ---")
        for i in issues:
            print("  -", i)


# حارس الاستيراد: استيراد سكربت استخراج بلا حارس أتلف بيانات منسّقة يدوياً
# في هذا المشروع سابقاً، فلا يجوز أن تُعاد الكتابة عند الاستيراد.
if __name__ == "__main__":
    main()
