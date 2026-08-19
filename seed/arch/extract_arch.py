# -*- coding: utf-8 -*-
"""استخراج خطة تخصص «تقنية الإنشاءات المعمارية» (رموز المقررات: يعمر ويمدن ورياد).

المصدر: «الخطة التفصيلية لتخصص تقنية الإنشاءات المعمارية - دبلوم كليات -
نصفي.pdf» (المؤسسة العامة للتدريب التقني والمهني، ١٤٤٦هـ / 2024G، ١٠٥ صفحات).

المخرجات (JSON بأشكال بيانات مشروع «ملف المدرب وتوصيف المقرر» نفسها):
  plan-courses.json  الرمز والاسم والساعات (معتمدة/محاضرة/عملي/تمرين/اتصال)
                     ووحدات المقرر بعناوينها وساعاتها ونصّ السلامة كما ورد.
  plan-detail.json   المنهج التفصيلي: مواضيع كل وحدة وأدوات تقييمها.

يقوم الاستخراج على ركيزتين:

  ١) **الشبكة**: جداول هذه الخطة مرسومة بخطوط حقيقية، فحدود الأعمدة والصفوف
     تُقرأ من `get_drawings()` لا بعتبات إحداثيات مقدَّرة. وصفُّ جدول المنهج
     التفصيلي هو الوحدة بعينها، فانقسام الوحدات مقروء من الرسم لا مستنبط.

  ٢) **إعادة بناء النص العربي على مستوى المحرف** (راجع `span_text`):
     أ) مكوّنات الرباط تُستخرج بعرض صفري وترتيب معكوس، فتُلحق بحاملها.
     ب) ترتيب الرسم مبعثر، فتُرتَّب العناقيد بصرياً يميناً ثم يساراً.
     ج) خطّ المصدر معطوب الـcmap في موضعين محقَّقين بصرياً: عنقود «في» بنسبة
        عرض ٠٫٨٠١ في الخط SUB_49 هو في الحقيقة «س» الطرفية، ومسافةٌ بنسبة
        ٠٫٥٠٧ في الخط نفسه هي رباط «لآ».
     د) تطويل ضبط السطر يُرسم هنا مسافةً تحملها حركةُ ضمّ صفرية العرض بموضعها
        نفسه، فتُسقط المسافة كي لا تشطر الكلمة.
منطق العناقيد وقرائن الوصل مقتبس من `extract_ajdq.py` و`planlib.py`.
"""
import collections
import csv
import io
import json
import os
import re
import sys

import fitz

PDF = ("M:/AI PROJECTS/ملف المدرب وتوصيف المقرر/خطط تخصصات الكلية/"
       "الخطة التفصيلية لتخصص تقنية الإنشاءات المعمارية - دبلوم كليات - نصفي.pdf")
SS01 = "M:/RAYAT_REPORTS/SS01_135_144710_2026-08-19_1716.csv"
OUT_DIR = "M:/AI PROJECTS/OCT-Courses/seed/arch"

AR_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")
WEEKS = 16                      # ساعات الوحدات = ساعات الاتصال × ١٦
FRAMEWORK_PAGES = (6, 7)        # صفحتا «توزيع الخطة على الفصول» (٧ و٨)

# ---------------------------------------------------------------- محارف وخطوط
# جدول إحلال العناقيد المعطوبة: (الخط، النص كما يقرؤه cmap، أدنى نسبة عرض،
# أقصاها، الصواب). محقَّق بصرياً من صور الصفحات ومن سياقات متعددة لكل بند.
GLYPH_FIX = (("SUB_49", "في", 0.798, 0.804, "س"),     # مقاييس، الخامس، يقيس
             ("SUB_49", " ", 0.504, 0.510, "لآ"),     # الحاسب الآلي
             ("SUB_49", "أ", 0.826, 0.832, "يخ"),     # يختار، يختص
             ("SUB_49", "ي", 0.924, 0.930, "لمح"))    # المحلية، المحاضر
WIDE_SPACE = 0.45               # ما جاوزها وشارك حرفاً موضعَه فهو تطويل ضبط
KASHIDA = "ُـ"        # الدمّة صفرية العرض هنا هي محرف التطويل
MARKS = re.compile(r"[ً-ْٰ]")
ARABIC = re.compile(r"[؀-ۿ]")
SEMESTER = re.compile(r"([1-5])(?:st|nd|rd|th)\s*Semester")
LTR = re.compile(r"^[0-9A-Za-z]")


def _w(c):
    return c["bbox"][2] - c["bbox"][0]


def span_text(span):
    """نص السبان مُعاد البناء: رباطات مجموعة، ترتيب بصري، وإحلال المعطوب.

    يعيد (النص، أقصى x، أدنى x، أقصى حافة يمنى).
    """
    size = span.get("size") or 1.0
    font = span.get("font") or ""
    # المسافة التي تشترك في نقطة بدايتها مع حرف هي تطويلُ ضبطِ السطر يعلو
    # الحرف، لا فاصلَ كلمتين — تُسقَط وإلا شطرت الكلمة.
    letters = {round(c["bbox"][0], 1) for c in span["chars"] if c["c"] != " "}
    raw = span["chars"]
    chars, marks = [], []
    for i, c in enumerate(raw):
        if c["c"] in KASHIDA and _w(c) < 0.01:
            continue                                   # تطويل لا حركة
        if MARKS.match(c["c"]) and _w(c) < 0.01:
            marks.append(c)
            continue
        if c["c"] == " ":
            # تطويلُ ضبطٍ في هذا الخط: مسافةٌ تعلوها حركةُ ضمٍّ صفرية العرض
            # بموضعها نفسه («التخص ُُص» = التخصص) — تُسقَط.
            nxt = raw[i + 1] if i + 1 < len(raw) else None
            if (nxt is not None and MARKS.match(nxt["c"]) and _w(nxt) < 0.01
                    and abs(nxt["bbox"][0] - c["bbox"][0]) < 0.05):
                continue
        chars.append(c)

    # (١) الرباط: مكوّناته صفرية العرض وتسبق حاملها بترتيب معكوس
    groups, pend = [], []
    for c in chars:
        if _w(c) < 0.01:
            pend.append(c)
            continue
        txt = c["c"] + "".join(p["c"] for p in reversed(pend))
        ratio = _w(c) / size
        for fnt, src, lo, hi, rep in GLYPH_FIX:
            if fnt in font and txt == src and lo <= ratio <= hi:
                txt = rep                          # (٣) عطب cmap الخط
                break
        else:
            if (txt == " " and ratio > WIDE_SPACE
                    and round(c["bbox"][0], 1) in letters):
                continue        # مسافة تعلو حرفاً = تطويل ضبط لا فاصل كلمتين
        groups.append({"t": txt, "x": c["bbox"][0], "x1": c["bbox"][2]})
        pend = []
    if pend and groups:
        groups[-1]["t"] += "".join(p["c"] for p in reversed(pend))
    if not groups:
        return "", 0.0, 0.0, 0.0

    # مسافةٌ خارج مدى حروف السبان بمراحل موضعُها مغلوط، ووصلُ الخلايا يعتمد
    # على المسافات الطرفية — فتُسقَط كي لا تشطر كلمةً موصولة.
    xspan = [g["x"] for g in groups if g["t"].strip()]
    if xspan:
        groups = [g for g in groups if g["t"].strip()
                  or min(xspan) - 25 <= g["x"] <= max(xspan) + 25]

    # الحركة الحقيقية تشترك مع حرفها في نقطة البداية؛ ما عداها زخرف تنسيق
    for m in marks:
        for g in groups:
            if abs(g["x"] - m["bbox"][0]) < 0.01:
                g["t"] += m["c"]
                break

    # (٢) الترتيب البصري: العربية يميناً ثم يساراً، ثم تُعاد مقاطع الأرقام
    #     والحروف اللاتينية إلى اتجاهها (ثنائية الاتجاه داخل السبان الواحد)
    if ARABIC.search("".join(g["t"] for g in groups)):
        # مسافةٌ ترسم في موضع حرفٍ بعينه هي مسافةُ السبان الطرفية لا فاصلَ
        # كلمتين، فيتقدّمها الحرف («المعمار ي» ← «المعماري»).
        groups.sort(key=lambda g: (-g["x"], not g["t"].strip()))
        i = 0
        while i < len(groups):
            if LTR.match(groups[i]["t"]):
                j = i
                while j < len(groups) and LTR.match(groups[j]["t"]):
                    j += 1
                groups[i:j] = groups[i:j][::-1]
                i = j
            else:
                i += 1
    # المدى يُحسب من الحروف وحدها: المسافة قد ترسم بعيداً عن موضعها المنطقي
    body = [g for g in groups if g["t"].strip()] or groups
    xs = [g["x"] for g in body]
    return ("".join(g["t"] for g in groups), max(xs), min(xs),
            max(g["x1"] for g in body))


def page_items(pg):
    """سبانات الصفحة: نص مع إحداثيات (x0 يسار، x1 يمين، xr بداية بصرية) وy."""
    out = []
    for blk in pg.get_text("rawdict")["blocks"]:
        for ln in blk.get("lines", []):
            for sp in ln["spans"]:
                t, xr, x0, x1 = span_text(sp)
                t = re.sub(r"[ 	‏‎]+", " ", t.translate(AR_DIGITS))
                if t.strip():
                    out.append({"t": t, "x0": x0, "x1": x1, "xr": xr,
                                "y": round(sp["bbox"][1], 1),
                                "y1": round(sp["bbox"][3], 1)})
    return out


# حروف لا تتصل بما بعدها، فالفجوة التي تليها فجوةُ كلمةٍ لا تطويلُ ضبط
NONCONNECT = "اأإآدذرزوةىءئ"


def _glued(buf, a, b, key):
    """أيَشتركان في كلمة واحدة؟ مسافةُ المصدر أولاً، ثم قرائن الخط العربي."""
    if buf.endswith(" ") or b[key].startswith(" "):
        return True                       # المصدر فصلهما بمسافته الخاصة
    gap, nxt = a["x0"] - b["x1"], b[key].lstrip()
    if gap <= 1.5:
        return True                       # متلاصقان: «التعاقب» + «ية»
    core = re.sub(r"[^؀-ۿ]", "", nxt)
    if nxt[:1] in "ةى" or (len(core) == 1 and core != "و"):
        return True                       # حرفٌ لا يقوم كلمةً بذاته
    prev = buf.rstrip()[-1:]
    # ضبطُ السطر بالتطويل يوسّع الوصلات داخل الكلمة، فتنشأ فجوة بلا مسافة:
    # «أكس» + «يد». وعلامتها أن ما قبلها حرفٌ واصل وما بعدها ليس ألفَ كلمةٍ جديدة.
    return (gap < 8 and bool(prev) and prev not in NONCONNECT
            and nxt[:1] not in "اأإآو" and bool(ARABIC.match(nxt[:1] or "")))


def join_items(items, key="t"):
    """يصل بنود الصف: المصدر يقطع الكلمة الواحدة سبانين، ويضع كلمتين
    متجاورتين في سبانين بلا مسافة بينهما — فيُحكَم بينهما بقرائن `_glued`."""
    if not items:
        return ""
    buf = items[0][key]
    for a, b in zip(items, items[1:]):
        buf += ("" if _glued(buf, a, b, key) else " ") + b[key]
    return buf


def page_lines(pg):
    """يجمع السبانات في أسطر بحسب y ويرتبها يميناً ثم يساراً."""
    rows = {}
    for s in page_items(pg):
        rows.setdefault(round(s["y"] / 3), []).append(s)
    lines = []
    for key in sorted(rows):
        items = sorted(rows[key], key=lambda s: -s["xr"])
        text = re.sub(r"\s+", " ", join_items(items)).strip()
        lines.append({"y": items[0]["y"], "items": items, "text": text})
    return lines


# ------------------------------------------------------------- شبكة الجداول
def page_grid(pg):
    """الخطوط المرسومة: (رأسية x ← مقاطع y، أفقية y ← مقاطع x).

    جداول هذه الخطة يُرسم إطارُ كل خلية على حدة، فمقاطعُ الخط الرأسي هي
    صفوفُ الجدول بعينها، وغيابُ خطٍّ أفقي في عمودٍ دون آخر يكشف الخليةَ
    المدموجة — لا حاجة إلى تخمين حدود الصف من تذبذب y.
    """
    v, h = collections.defaultdict(set), collections.defaultdict(set)
    for d in pg.get_drawings():
        for it in d["items"]:
            if it[0] == "l":
                a, b = it[1], it[2]
                if abs(a.x - b.x) < 0.8 and abs(a.y - b.y) > 1:
                    v[round(a.x, 1)].add((round(min(a.y, b.y), 1),
                                          round(max(a.y, b.y), 1)))
                elif abs(a.y - b.y) < 0.8 and abs(a.x - b.x) > 1:
                    h[round(a.y, 1)].add((round(min(a.x, b.x), 1),
                                          round(max(a.x, b.x), 1)))
            elif it[0] == "re":
                r = it[1]
                if r.width < 1.5 and r.height > 1:
                    v[round((r.x0 + r.x1) / 2, 1)].add((round(r.y0, 1),
                                                        round(r.y1, 1)))
                elif r.height < 1.5 and r.width > 1:
                    h[round((r.y0 + r.y1) / 2, 1)].add((round(r.x0, 1),
                                                        round(r.x1, 1)))
    return ({x: sorted(s) for x, s in v.items()},
            {y: sorted(s) for y, s in h.items()})


def _near(grid, x, tol=4.0):
    """مقاطع أقرب خط رأسي إلى x (أو لا شيء إن لم يوجد)."""
    got = [k for k in grid if abs(k - x) <= tol]
    if not got:
        return []
    return grid[min(got, key=lambda k: abs(k - x))]


def rows_of(grid, x, tol=4.0):
    return _near(grid, x, tol)


def in_row(items, y0, y1):
    return [i for i in items if y0 - 1.5 <= i["y"] < y1 - 0.5]


# ------------------------------------------------------------ تنظيف نصّي عام
# ما عجزت إعادةُ البناء عنه: تسلسلات لا ترد في الإملاء العربي أصلاً، فالإصلاح
# قاطع لا اجتهادي. وكل بند منها مذكور في REPORT.md.
REPAIRS = [
    # رباط «لا» يرسمه المصدر أحياناً مكوّنَين منفصلين فينقلب ترتيبهما بصرياً
    ("األ", "الأ"), ("اإل", "الإ"), ("اآل", "الآ"),
]


def norm(t, keep_edges=False):
    """يوحّد الفراغات. مع keep_edges تبقى المسافة الطرفية: هي وحدها ما يفصل
    خليتين متجاورتين عن كلمة واحدة قطعها المصدر سبانين."""
    for a, b in REPAIRS:
        t = t.replace(a, b)
    t = re.sub(r"\s+", " ", t)
    return t if keep_edges else t.strip()


def title(t):
    """عنوان وحدة أو موضوع: النقطة داخله أثر ترتيب بصري لا علامة ترقيم."""
    t = norm(t)
    t = re.sub(r"^[o\u2022\u25cf\u25aa\-\u2013]+", " ", t)
    t = re.sub(r"(^|\s)[\u064b-\u0652\u0670]+", r"\1", t)
    t = re.sub(r"\.+", " ", t)
    t = re.sub(r"\s*،\s*", "، ", t)
    t = re.sub(r"\s+([)\]])", r"\1", t)
    t = re.sub(r"([(\[])\s+", r"\1", t)
    t = re.sub(r"([\u0600-\u06ff])([A-Za-z])", r"\1 \2", t)
    t = re.sub(r"([A-Za-z])([\u0600-\u06ff])", r"\1 \2", t)
    t = re.sub(r"\s+", " ", t).strip(" :-،.")
    # المصدر يرسم المقطع اللاتيني في أقصى يمين الخلية خطأً — موضعه آخرُ العنوان
    m = re.match(r"^([0-9A-Za-z][0-9A-Za-z\-]{0,11})\s+(.*[\u0600-\u06ff].*)$", t)
    if m:
        t = m.group(2) + " " + m.group(1)
    return re.sub(r"\s+", " ", t).strip()


def is_num(t):
    return bool(re.fullmatch(r"\d{1,3}", t.strip()))


BOILER = ("المملكة العربية السعودية", "المؤسسة العامة للتدريب",
          "الإدارة العامة للمناهج", "التقنية المدنية والمعمارية",
          "تقنية الإنشاءات المعمارية", "القسم التخصص", "لقسم التخصص")


def is_boiler(t, y=0.0):
    if y > 795 or re.fullmatch(r"\d{1,3}\s*(105)?\s*من\s*(105)?", t.strip()):
        return True
    return any(t.startswith(b) for b in BOILER)


def clean_lines(pg_lines):
    """أسطر الصفحة بلا ترويسة الغلاف ولا ترقيم الصفحات."""
    return [ln for ln in pg_lines if not is_boiler(ln["text"], ln["y"])]


# --------------------------------------------------- (١) جدول الإطار المنهجي
# أعمدة جدول «توزيع الخطة التدريبية على الفصول» (صفحتان أفقيتان، عرض ٨٤٢).
# التخصيص بالحافة البصرية xr لا بـx0: خليةُ الاسم تمتدّ أحياناً داخل عمود
# المتطلب، وبدايتُها البصرية وحدها هي الفيصل.
BANDS = (("cth", 471.0, 501.5), ("t", 440.0, 471.0), ("p", 409.4, 440.0),
         ("l", 378.8, 409.4), ("crh", 348.0, 378.8))
B_ROWNO, B_CODE, B_NAME, B_PRE = (765, 800), (717, 765), (557, 717), (501.5, 557)
B_EN_NAME, B_EN_CODE = (135, 292), (79, 135)
B_COOP_CRH = (409, 445)                 # عمود و.م في جدول الفصل الخامس
CODE_AR = re.compile(r"(\d{3})\s*([؀-ۿ]{3,4})|([؀-ۿ]{3,4})\s*(\d{3})")


def _band(items, lo, hi, nums_only=False):
    got = [i for i in items if lo <= i["xr"] < hi
           and (not nums_only or is_num(i["t"]))]
    return sorted(got, key=lambda i: -i["xr"])


def _code(items):
    # المصدر يشطر كلمةَ الرمز أحياناً («فيز ي») فتُزال الفراغات قبل المطابقة
    txt = re.sub(r"\s+", "", " ".join(i["t"] for i in _band(items, *B_CODE)))
    m = CODE_AR.search(txt)
    if not m:
        return None, None
    num, word = (m.group(1), m.group(2)) if m.group(1) else (m.group(4), m.group(3))
    return "%s-%s" % (word, num), "%s %s" % (num, word)


def framework(pages):
    """الساعات الرسمية لكل مقرر من جدول توزيع الخطة على الفصول (ص٧–٨)."""
    out = []
    for p in FRAMEWORK_PAGES:
        marks = sorted((ln["y"], int(SEMESTER.search(ln["text"]).group(1)))
                       for ln in pages[p] if SEMESTER.search(ln["text"]))
        for idx, ln in enumerate(pages[p]):
            it = ln["items"]
            if not _band(it, *B_ROWNO, nums_only=True):
                continue
            code, code_ar = _code(it)
            if not code:
                continue
            sem = 0
            for my, ms in marks:                  # علامة الفصل تقع قرب صدر جدوله
                if my <= ln["y"] + 30:
                    sem = ms
            en_name = " ".join(i["t"] for i in sorted(_band(it, *B_EN_NAME),
                                                     key=lambda i: i["x0"]))
            if not en_name:     # اسم إنجليزي طويل يلتفّ سطراً قبل الصف وآخر بعده
                en_name = " ".join(
                    i["t"] for j in (idx - 1, idx + 1) if 0 <= j < len(pages[p])
                    for i in _band(pages[p][j]["items"], *B_EN_NAME)
                    if not ARABIC.search(i["t"]))
            en_code = " ".join(i["t"] for i in _band(it, *B_EN_CODE))
            name = join_items(_band(it, *B_NAME))
            if not name:        # اسم عربي طويل يرتفع سطراً فوق بقية خلايا صفه
                for j in (idx - 1, idx + 1):
                    if 0 <= j < len(pages[p]) and not name:
                        near = pages[p][j]
                        if abs(near["y"] - ln["y"]) < 12 and not _band(
                                near["items"], *B_ROWNO, nums_only=True):
                            name = join_items(_band(near["items"], *B_NAME))
            prereq = [t for t in (i["t"].strip() for i in _band(it, *B_PRE)) if t]
            rec = {"code": code, "codeAr": code_ar,
                   "codeEn": re.sub(r"\s+", " ", en_code).strip(),
                   "semester": sem, "nameAr": title(name),
                   "nameEn": re.sub(r"\s+", " ", en_name).strip(),
                   "prereqRaw": prereq}
            hours = {k: _band(it, lo, hi, nums_only=True) for k, lo, hi in BANDS}
            if all(hours.values()):
                for k in ("crh", "l", "p", "t", "cth"):
                    rec[k] = int(hours[k][0]["t"])
                out.append(rec)
                continue
            coop = _band(it, *B_COOP_CRH, nums_only=True)
            if coop and sem == 5:               # التدريب التعاوني: و.م فقط
                rec.update({"crh": int(coop[0]["t"]), "l": None, "p": None,
                            "t": None, "cth": None, "coop": True})
                out.append(rec)
    return out


def split_prereq(rows):
    """يفصل رمز المتطلب عن ذيل اسم المقرر.

    خلية «المتطلب» تلتصق أحياناً بخلية الاسم فيبتلع الاسمُ كلمةَ الرمز ويبقى
    رقمُه وحده في عمود المتطلب («كميات ومواصفات رياض» + «121»). تُعرف كلمةُ
    الرمز بأنها إحدى كلمات الرموز الواردة في الجدول نفسه.
    """
    words = {c["codeAr"].split()[1] for c in rows}
    for c in rows:
        raw, name = list(c.pop("prereqRaw")), c["nameAr"]
        tail = name.split()[-1] if name.split() else ""
        if tail in words and any(re.fullmatch(r"\d{3}", t) for t in raw):
            name = name[: -len(tail)].strip()
            raw = [("%s %s" % (t, tail) if re.fullmatch(r"\d{3}", t) else t)
                   for t in raw]
        c["nameAr"] = name
        pre, txt = [], " ".join(raw)
        for m in CODE_AR.finditer(txt):
            num, word = ((m.group(1), m.group(2)) if m.group(1)
                         else (m.group(4), m.group(3)))
            item = "%s %s" % (num, word)
            if item not in pre:
                pre.append(item)
        c["prereqAr"] = pre
    return rows


# ---------------------------------------------- (٢) أقسام الوصف التفصيلي
HEAD = re.compile(r"ا?سم\s*المقرر\s*(.+?)\s*ا?لرمز\s*"
                  r"(\d{3}\s*[؀-ۿ]{3,4}|[؀-ۿ]{3,4}\s*\d{3})")


def section_starts(pages):
    starts = []
    for i, lines in enumerate(pages):
        head = " ".join(ln["text"] for ln in clean_lines(lines)[:3])
        if HEAD.search(head) and "متطلب" in " ".join(
                ln["text"] for ln in clean_lines(lines)[:4]):
            starts.append(i)
    return starts


def head_fields(lines):
    """الرمز والاسم كما وردا في صدر صفحة الوصف التفصيلي."""
    head = " ".join(ln["text"] for ln in clean_lines(lines)[:3])
    m = HEAD.search(head)
    if not m:
        return None, ""
    mm = CODE_AR.search(m.group(2))
    num, word = ((mm.group(1), mm.group(2)) if mm.group(1)
                 else (mm.group(4), mm.group(3)))
    return "%s-%s" % (word, num), title(m.group(1))


def head_prereq(lines):
    """المتطلبات السابقة من صدر القسم: «متطلب سابق ### رمز»."""
    head = " ".join(ln["text"] for ln in clean_lines(lines)[:6])
    m = re.search(r"متطلب\s*سابق(.*?)(الفصل\s*التدريبي|الساعات|$)", head)
    if not m:
        return []
    out = []
    for mm in CODE_AR.finditer(m.group(1)):
        num, word = ((mm.group(1), mm.group(2)) if mm.group(1)
                     else (mm.group(4), mm.group(3)))
        item = "%s %s" % (num, word)
        if item not in out:
            out.append(item)
    return out


HEAD_LABELS = (("crh", "الساعات المعتمدة"), ("l", "محاضرة"), ("p", "عملي"),
               ("t", "تمرين"))
HEAD_VALUE_X = (296.0, 361.0)   # عمود قيم الساعات في جدول صدر القسم


def head_hours(lines):
    """الساعات من صدر القسم: قيمةُ كل خانة في عمودها وعلى سطر عنوانها."""
    items = [i for ln in clean_lines(lines)[:20] for i in ln["items"]]
    nums = [i for i in items if is_num(i["t"])
            and HEAD_VALUE_X[0] <= i["x0"] < HEAD_VALUE_X[1]]
    got = {}
    for key, label in HEAD_LABELS:
        for i in items:
            if i["t"].strip() != label:
                continue
            near = [n for n in nums if abs(n["y"] - i["y"]) <= 6]
            if near:
                got[key] = int(min(near, key=lambda n: abs(n["y"] - i["y"]))["t"])
            break
    return got


# ------------------------------------------------- (٣) جدول وحدات المقرر
UNITS_HEAD = "الوحدات"


def _units_cols(vgrid):
    """(يسار، فاصل عمود الساعات، يمين) لجدول الوحدات، أو لا شيء.

    جدول الوحدات وحده ثلاثةُ خطوطٍ رأسية طويلة: حافتاه وفاصلُ عمود الساعات
    اليساري. أما جدول صدر القسم فأعمدتُه أكثر، وجدولُ المنهج التفصيلي أربعة.
    """
    long_x = sorted(x for x, segs in vgrid.items()
                    if sum(e - s for s, e in segs) > 100)
    if len(long_x) != 3 or not (100 < long_x[1] < 260) or long_x[2] < 500:
        return None
    return long_x[0], long_x[1], long_x[2]


def parse_units(pages, a, b):
    """جدول «الوحدات (النظرية والعملية) | ساعات التدريب» من شبكة الرسم.

    خانةُ الساعات تُدمج أحياناً على عدة صفوفٍ من العناوين (مقررات الاستوديو:
    «برنامج المشروع المعماري» و«مشروع»)، ويُكشف الدمج بغياب الخط الأفقي
    الفاصل في عمود الساعات وحده. فالوحدة هنا خانةُ ساعاتٍ لا سطرَ عنوان،
    وتُحفظ سطورُها كلُّها في `rows`.
    """
    units, declared = [], None
    for p in range(a, b):
        vgrid, hgrid = page_grid(pages[p]["doc"])
        cols = _units_cols(vgrid)
        if cols is None:
            continue
        left, inner, right = cols
        rows = rows_of(vgrid, inner)
        if not rows:
            continue
        # حدود خانات عمود الساعات: الخطوط الأفقية التي تعبره هو نفسه
        cuts = sorted(y for y, segs in hgrid.items()
                      if any(s <= left + 3 and e >= inner - 3 for s, e in segs))
        items = [i for ln in clean_lines(pages[p]["lines"]) for i in ln["items"]]
        cells, seen_head = collections.OrderedDict(), False
        texts = [(y0, y1, norm(join_items(sorted(in_row(items, y0, y1),
                                                 key=lambda i: -i["xr"]), "t")))
                 for y0, y1 in rows]
        if not any(UNITS_HEAD in t and ("ساعات التدريب" in t or "العملية" in t)
                   for _, _, t in texts):
            continue                       # ليس جدول الوحدات وإن شابه شبكتَه
        for y0, y1, txt in texts:
            row = in_row(items, y0, y1)
            if not row:
                continue
            if UNITS_HEAD in txt and ("ساعات التدريب" in txt or "العملية" in txt):
                seen_head = True
                continue                                   # ترويسة الجدول
            if not seen_head:
                continue
            nums = [i for i in row if is_num(i["t"]) and i["x0"] < inner]
            heads = [i for i in row if i["x0"] >= inner]
            if "المجموع" in txt:
                declared = int(nums[-1]["t"]) if nums else None
                continue
            mid = (y0 + y1) / 2.0
            lo = max([c for c in cuts if c <= mid], default=y0)
            cell = cells.setdefault(lo, {"rows": [], "hours": None})
            if heads:
                cell["rows"].append(title(join_items(
                    sorted(heads, key=lambda i: -i["xr"]), "t")))
            if nums:
                cell["hours"] = int(nums[-1]["t"])
        for cell in cells.values():
            rws = [r for r in cell["rows"] if r]
            if not rws:
                continue
            unit = {"title": rws[0], "hours": cell["hours"]}
            if len(rws) > 1:
                unit["rows"] = rws
            units.append(unit)
    return units, declared


SAFETY_HEAD = "إجراءات واشتراطات السلامة"


def parse_safety(pages, a, b):
    """نصّ «إجراءات واشتراطات السلامة» كما ورد في الخطة، بلا تحسين."""
    for p in range(a, b):
        lines = clean_lines(pages[p]["lines"])
        for i, ln in enumerate(lines):
            if SAFETY_HEAD in ln["text"]:
                out = []
                for nxt in lines[i + 1:]:
                    if not nxt["text"] or SAFETY_HEAD in nxt["text"]:
                        break
                    out.append(nxt["text"])
                return norm(" ".join(out))
    return ""


# ------------------------------------------- (٤) المنهج التفصيلي: المواضيع
DETAIL_X = (42.6, 186.6, 512.0, 559.0)   # يسار | محتوى | ساعات | يمين
BULLET = re.compile(r"^[\u2022\u25cf\u25aa\u25e6\u00b7]+$|^o$|^O$")
DETAIL_HEAD = ("المنهج التفصيلي", "أدوات التقييم", "الساعات", "المحتوى")


X_TOOLS = (180.0, 195.0)        # فاصل عمود «أدوات التقييم» عن «المحتوى»
X_HOURS = (500.0, 525.0)        # فاصل عمود «المحتوى» عن «الساعات»


def _detail_cols(grid):
    """فاصلا عمودَي جدول المنهج التفصيلي (المحتوى بينهما)، أو لا شيء.

    تُختار في كل نطاقٍ أطولُ خطوطه: جدولُ «المراجع» في ذيل القسم يشارك
    الصفحةَ خطوطاً قصيرة في المواضع نفسها تقريباً، فتُقصى بطول مقاطعها.
    """
    def pick(lo, hi):
        got = [(sum(b - a for a, b in segs), x)
               for x, segs in grid.items() if lo <= x <= hi
               and sum(b - a for a, b in segs) > 40]
        return max(got)[1] if got else None

    c1, c2 = pick(*X_TOOLS), pick(*X_HOURS)
    return None if c1 is None or c2 is None else (c1, c2)


def detail_units(pages, a, b, code):
    """كتل «المنهج التفصيلي»: كلُّ صفٍّ في الشبكة وحدةٌ بساعاتها ومواضيعها."""
    blocks, problems = [], []
    for p in range(a, b):
        grid = page_grid(pages[p]["doc"])[0]
        cols = _detail_cols(grid)
        if cols is None:
            continue
        c1, c2 = cols
        rows = rows_of(grid, c2, tol=0.5)
        items = [i for ln in clean_lines(pages[p]["lines"]) for i in ln["items"]]
        for y0, y1 in rows:
            row = in_row(items, y0, y1)
            if not row:
                continue
            hours = [i for i in row if i["x0"] >= c2 - 4 and is_num(i["t"])]
            body = [i for i in row if i["x1"] > c1 + 3 and i["x0"] < c2 - 4]
            tools = [i for i in row if i["x1"] <= c1 + 3]
            txt = " ".join(i["t"] for i in body)
            if any(h in txt for h in DETAIL_HEAD) and not hours:
                continue                                   # ترويسة الجدول
            if not body and not hours:
                continue
            entry = {"hours": int(hours[-1]["t"]) if hours else None,
                     "page": p + 1,
                     "content": _content_lines(body),
                     "tools": _tool_texts(tools)}
            if entry["hours"] is None and blocks:
                blocks[-1]["content"] += entry["content"]   # صفٌّ امتدّ صفحتين
                blocks[-1]["tools"] += [t for t in entry["tools"]
                                        if t not in blocks[-1]["tools"]]
            elif entry["hours"] is None:
                problems.append("%s: صفٌّ في المنهج التفصيلي ص%d بلا ساعات"
                                % (code, p + 1))
            else:
                blocks.append(entry)
    return blocks, problems


def _rows_by_y(items, tol=3.0):
    """يجمع بنود الخلية في أسطر بحسب y ويرتب كلَّ سطر يميناً ثم يساراً."""
    out = []
    for i in sorted(items, key=lambda i: (i["y"], -i["xr"])):
        if out and i["y"] - out[-1][0]["y"] <= tol:
            out[-1].append(i)
        else:
            out.append([i])
    return [sorted(r, key=lambda i: -i["xr"]) for r in out]


def _content_lines(body):
    """أسطر عمود المحتوى: نصٌّ + وجود رمز تعداد + حافة النص اليمنى (المستوى)."""
    out = []
    for row in _rows_by_y(body):
        marks = [i for i in row if BULLET.match(i["t"].strip())]
        rest = [i for i in row if i not in marks]
        txt = title(join_items(rest, "t")) if rest else ""
        if not txt and not marks:
            continue
        out.append({"t": txt, "bullet": bool(marks),
                    "right": max(i["x1"] for i in row)})
    return out


def _tool_texts(tools):
    out = []
    for row in _rows_by_y(tools):
        t = norm(join_items(row, "t")).strip(" .")
        if t and t not in out:
            out.append(t)
    return out


def block_topics(block):
    """يقسم أسطر الكتلة إلى عنوانٍ ومواضيع.

    السطر الحامل لرمز التعداد موضوعٌ جديد، والعاري منه تكملةُ سابقه — إلا أن
    يكون على حافة العنوان اليمنى نفسها فهو عنوانٌ فرعي مستقل (لا تكملة).
    """
    lines = [l for l in block["content"] if l["t"] or l["bullet"]]
    if not lines:
        return "", []
    head_right = max((l["right"] for l in lines if not l["bullet"]),
                     default=max(l["right"] for l in lines))
    head, topics, i = [], [], 0
    while i < len(lines) and not lines[i]["bullet"]:
        head.append(lines[i]["t"])
        i += 1
    for l in lines[i:]:
        if l["bullet"] or l["right"] >= head_right - 3:
            if l["t"]:
                topics.append(l["t"])
        elif topics:
            topics[-1] = (topics[-1] + " " + l["t"]).strip()
        elif l["t"]:
            topics.append(l["t"])
    return title(" ".join(x for x in head if x)), [t for t in topics if t]


# ------------------------------------------------------------------ رايات
PLAN_CODES = ("يعمر", "يمدن", "رياد")


def ss01_all():
    """كل مقررات تقرير الشعب برمز «رمز-رقم» نفسه المستعمل هنا."""
    out = {}
    if not os.path.exists(SS01):
        return out
    for r in csv.DictReader(io.open(SS01, encoding="utf-8-sig")):
        code = re.sub(r"\s+", "", r["المقرر"].strip())
        d = out.setdefault(code, {
            "nameAr": r["اسم المقرر"].strip(), "sections": set(),
            "dept": r.get("القسم", "").strip(),
            "crh": r["الساعات المعتمدة"], "l": r["ساعات المحاضرة"],
            "p": r["ساعات المختبر"], "t": r["ساعات أخرى"],
            "cth": r["ساعات الاتصال"]})
        d["sections"].add(r["الرقم المرجعي"])
    return out


# ------------------------------------------------------------------- التشغيل
def main():
    doc = fitz.open(PDF)
    pages = [{"lines": page_lines(doc[i]), "doc": doc[i]}
             for i in range(doc.page_count)]
    plain = [p["lines"] for p in pages]

    fw = split_prereq(framework(plain))
    fw_map = {c["code"]: c for c in fw}
    starts = section_starts(plain)
    bounds = list(zip(starts, starts[1:] + [starts[-1] + 5]))

    courses, details, problems, notes = [], [], [], []
    for a, b in bounds:
        lines = [ln for pg in plain[a:b] for ln in pg]
        code, head_name = head_fields(plain[a])
        meta = fw_map.get(code)
        if meta is None:
            problems.append("قسم ص%d برمز %s غير موجود في جدول الإطار المنهجي"
                            % (a + 1, code))
            continue
        units, declared = parse_units(pages, a, b)
        hours, cth = head_hours(plain[a]), meta["cth"]
        rec = dict(meta)
        rec["prereqAr"] = head_prereq(plain[a]) or meta["prereqAr"]
        rec.update({"hasDetail": True, "pageStart": a + 1, "pageEnd": b,
                    "units": units,
                    "unitsSum": sum(u["hours"] or 0 for u in units),
                    "declaredTotal": declared,
                    "expectedUnitsSum": cth * WEEKS if cth else None,
                    "safetyRaw": parse_safety(pages, a, b)})
        if head_name and head_name != meta["nameAr"]:
            notes.append("%s: الاسم في صدر القسم «%s» وفي جدول الإطار «%s»"
                         % (code, head_name, meta["nameAr"]))
        for k, lbl in (("crh", "و.م"), ("l", "مح"), ("p", "عم"), ("t", "تم")):
            if k in hours and hours[k] != meta[k]:
                problems.append("%s: %s في صدر القسم %d وفي جدول الإطار %d"
                                % (code, lbl, hours[k], meta[k]))
        if None in (meta["l"], meta["p"], meta["t"], cth):
            problems.append("%s: أعمدة الساعات ناقصة في جدول الإطار" % code)
        elif meta["l"] + meta["p"] + meta["t"] != cth:
            problems.append("%s: مح+عم+تم = %d ولا تساوي س.أ = %d"
                            % (code, meta["l"] + meta["p"] + meta["t"], cth))
        if any(u["hours"] is None for u in units):
            problems.append("%s: وحدةٌ بلا ساعات في جدول الوحدات" % code)
        if cth and rec["unitsSum"] != cth * WEEKS:
            problems.append("%s: مجموع ساعات الوحدات %d ولا يساوي س.أ×%d = %d"
                            % (code, rec["unitsSum"], WEEKS, cth * WEEKS))
        if declared is not None and declared != rec["unitsSum"]:
            problems.append("%s: «المجموع» المعلن %d ومجموع الوحدات %d"
                            % (code, declared, rec["unitsSum"]))
        courses.append(rec)

        blocks, probs = detail_units(pages, a, b, code)
        problems += probs
        matched, ok, oi = [], True, 0
        for blk in blocks:
            head, topics = block_topics(blk)
            span, acc = [], 0
            while oi < len(units) and acc < blk["hours"]:
                acc += units[oi]["hours"] or 0
                span.append(oi)
                oi += 1
            if acc == blk["hours"] and span:
                name = " و".join(units[i]["title"] for i in span)
            else:
                ok, name, span = False, head, []
            matched.append({"title": name, "hours": blk["hours"],
                            "officialSpan": span, "detailTitle": head,
                            "theory": topics, "practical": [],
                            "assessment": blk["tools"]})
        ok = ok and oi == len(units)
        detail_sum = sum(u["hours"] for u in blocks)
        details.append({"code": code, "nameAr": meta["nameAr"], "cth": cth,
                        "verified": ok, "officialUnits": len(units),
                        "detailSum": detail_sum, "units": matched})
        if not ok:
            problems.append("%s: كتل المنهج التفصيلي لا تنطبق على جدول الوحدات"
                            % code)
        if cth and detail_sum != cth * WEEKS:
            problems.append("%s: مجموع ساعات كتل المنهج التفصيلي %d ولا يساوي "
                            "س.أ×%d = %d" % (code, detail_sum, WEEKS, cth * WEEKS))

    # مقررات الخطة التي لا صفحةَ وصفٍ تفصيلي لها
    done = {c["code"] for c in courses}
    for code, meta in fw_map.items():
        if code in done:
            continue
        rec = dict(meta)
        rec.update({"hasDetail": False, "pageStart": None, "pageEnd": None,
                    "units": [], "unitsSum": 0, "declaredTotal": None,
                    "expectedUnitsSum": (meta["cth"] * WEEKS)
                    if meta["cth"] else None, "safetyRaw": "",
                    "note": "لا صفحةَ وصفٍ تفصيلي لهذا المقرر في الخطة"})
        courses.append(rec)
    order = {c["code"]: i for i, c in enumerate(fw)}
    courses.sort(key=lambda c: order.get(c["code"], 999))

    # تمييز مقررات التخصص عن مقررات الثقافة العامة المشتركة
    for c in courses:
        word = c["codeAr"].split()[1]
        c["specialty"] = bool(word in ("يعمر", "يمدن") or c["hasDetail"]
                              or "معمار" in c["nameAr"])

    os.makedirs(OUT_DIR, exist_ok=True)
    src = os.path.basename(PDF)
    io.open(os.path.join(OUT_DIR, "plan-courses.json"), "w", encoding="utf-8").write(
        json.dumps({"source": src + " — جدول الإطار المنهجي (ص٧–٨) وصفحات الوصف التفصيلي",
                    "specialty": "تقنية الإنشاءات المعمارية",
                    "department": "التقنية المدنية والمعمارية",
                    "weeksPerSemester": WEEKS,
                    "note": "مستخرج آلياً؛ الثابت المفروض: مجموع ساعات الوحدات "
                            "= س.أ × ١٦. حقل specialty يميّز مقررات التخصص "
                            "(يعمر/يمدن ورياد المعمارية) من مقررات الثقافة "
                            "العامة المشتركة، وhasDetail يميّز ما له صفحة وصف "
                            "تفصيلي، وsafetyRaw نصّ السلامة كما ورد في الخطة.",
                    "courses": courses}, ensure_ascii=False, indent=1))
    io.open(os.path.join(OUT_DIR, "plan-detail.json"), "w", encoding="utf-8").write(
        json.dumps({"source": src + " — المنهج التفصيلي (النظري والعملي)",
                    "note": "استخراج أمين بلا تحرير؛ صفُّ الجدول وحدةٌ بساعاتها، "
                            "وبنودُ عمود «المحتوى» في theory بترتيب ورودها. "
                            "لا تمييز للعملي في هذه الخطة (لا عنوان «تطبيقات "
                            "عملية») فـpractical فارغ في كل المقررات. "
                            "assessment أدوات التقييم كما وردت في عمودها، "
                            "وdetailTitle عنوان الكتلة كما ورد في المنهج.",
                    "courses": details}, ensure_ascii=False, indent=1))

    # -------- تقرير الشاشة
    codes = {c["code"] for c in courses}
    ss_all = ss01_all()
    ss = {k: v for k, v in ss_all.items() if k in codes}
    spec = [c for c in courses if c["specialty"]]
    print("مقررات جدول الإطار المنهجي: %d — منها تخصصية: %d — بوصف تفصيلي: %d"
          % (len(courses), len(spec), len(details)))
    dmap = {d["code"]: d for d in details}
    print("\n%-10s %-34s %3s %3s %3s %3s %3s %5s %5s %5s %4s %4s"
          % ("code", "name", "crh", "L", "P", "T", "cth", "unit", "sum", "blk",
             "top", "sec"))
    for c in courses:
        d = dmap.get(c["code"], {"units": []})
        print("%-10s %-34s %3s %3s %3s %3s %3s %5d %5d %5d %4d %4d %s"
              % (c["code"], c["nameAr"], c["crh"], c["l"], c["p"], c["t"],
                 c["cth"], len(c["units"]), c["unitsSum"], len(d["units"]),
                 sum(len(u["theory"]) for u in d["units"]),
                 len(ss.get(c["code"], {"sections": ()})["sections"]),
                 "" if c["specialty"] else "(عام)"))

    print("\nمقارنة مع SS01: مقررات الخطة %d — منها في التقرير %d"
          % (len(codes), len(ss)))
    for c in sorted(codes - set(ss)):
        print("  في الخطة ولا شعبة له: %s (%s)" % (c, fw_map[c]["nameAr"]))
    for c, d in sorted(ss_all.items()):
        if c.split("-")[0] in PLAN_CODES and c not in codes:
            print("  له شعب ولا وجود له في الخطة: %s (%s) — %d شعبة"
                  % (c, d["nameAr"], len(d["sections"])))
    for c in sorted(codes & set(ss)):
        a, b = fw_map[c], ss[c]
        for k, lbl in (("crh", "المعتمدة"), ("l", "المحاضرة"), ("p", "العملي"),
                       ("t", "التمارين"), ("cth", "الاتصال")):
            if b[k] != "" and int(b[k]) != (a[k] if a[k] is not None else 0):
                print("  اختلاف ساعات %s في %s: الخطة %s ورايات %s"
                      % (lbl, c, a[k], b[k]))

    print("\nمخالفات (%d):" % len(problems))
    for p in problems:
        print("  - %s" % p)
    print("\nملاحظات (%d):" % len(notes))
    for n in notes:
        print("  - %s" % n)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
