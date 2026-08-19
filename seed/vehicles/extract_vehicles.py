# -*- coding: utf-8 -*-
"""استخراج خطة تخصص «تقنية كهرباء والكترونيات المركبات» (رمزا المقررات: مكمر ومتمر).

المصدر: «الخطة التفصيلية لتخصص تقنية كهرباء والكترونيات المركبات - دبلوم كليات-
نصفي.pdf» (المؤسسة العامة للتدريب التقني والمهني، ١٤٤٦هـ / 2024G، ١٣٥ صفحة).

المخرجات (JSON بأشكال بيانات مشروع «ملف المدرب وتوصيف المقرر» نفسها):
  plan-courses.json  الرمز والاسم والساعات (معتمدة/محاضرة/عملي/تمرين/اتصال)
                     ووحدات المقرر بعناوينها وساعاتها، ونصّ السلامة كما ورد.
  plan-detail.json   المنهج التفصيلي: مواضيع نظرية وعملية لكل وحدة.

هذه الخطة تختلف عن خطة «الأجهزة والآلات الدقيقة» في ثلاثة أمور بنيوية:
  ١) خطّها سليم الـcmap تقريباً؛ فجدول `GLYPH_FIX` المستعمل هناك **لا يُطبَّق**
     هنا (كان يشوّه لا يصلح). العطب الوحيد موضعٌ واحد في ص٦ يُكشف آلياً بمقارنة
     رقم الرسم (glyph id) برقم رسم المسافة الغالب في الخطّ — راجع broken_space_x.
  ٢) ضبط السطر بالتطويل يُرسم مسافةً تعلوها علاماتُ تطويل صفرية العرض في نقطة
     البداية ذاتها، فتشطر الكلمة: «أس ُُاسيات». تُكشف بجدول kashida_x وتُسقط.
  ٣) جدول «المنهج التفصيلي» هنا ثلاثة أعمدة (الساعات | المحتوى | أدوات التقييم)،
     وكثيرٌ من المقررات يمرّ على وحداته مرّتين: مرّة نظرية ومرّة عملية، ويميّز
     بينهما عنوانُ الجدول «(النظري)» / «(العملي)» أو خانةُ «الأداء العملي».
منطق العناقيد وإعادة البناء البصري مقتبس من planlib.py ومن extract_ajdq.py.
"""
import csv
import io
import json
import os
import re
import sys
from collections import Counter

import fitz

PDF = ("M:/AI PROJECTS/ملف المدرب وتوصيف المقرر/خطط تخصصات الكلية/"
       "الخطة التفصيلية لتخصص تقنية كهرباء والكترونيات المركبات - دبلوم كليات-  نصفي.pdf")
SS01 = "M:/RAYAT_REPORTS/SS01_135_144710_2026-08-19_1716.csv"
OUT_DIR = "M:/AI PROJECTS/OCT-Courses/seed/vehicles"

AR_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")
WEEKS = 16                      # ساعات الوحدات = ساعات الاتصال × ١٦
# رموز مقررات هذا التخصص: مكمر (تخصصية) ومتمر (مشتركة بقسم التقنية الميكانيكية)
# ورياد ٢٣٢ (ريادة أعمال بنكهة المركبات، وُضعت في الخطة باسم التخصص).
OWN = ("مكمر", "متمر")
EXTRA = ("رياد-232",)

KASHIDA = "ُـ"        # الدمّة صفرية العرض هنا هي علامة التطويل
MARKS = re.compile(r"[ً-ْٰ]")
ARABIC = re.compile(r"[؀-ۿ]")
LTR = re.compile(r"^[0-9A-Za-z]")


def _w(c):
    return c["bbox"][2] - c["bbox"][0]


# ------------------------------------------------- مواضع المسافات غير الحقيقية
def kashida_x(pg):
    """نقاط بداية علامات التطويل صفرية العرض.

    ضبطُ السطر في المصدر يمدّ الوصلة بمحرف مسافةٍ تعلوه علاماتُ تطويل صفرية
    العرض في نقطة البداية نفسها، فتنشطر الكلمة: «أس ُُاس ُُيات». المسافة التي
    تشترك في نقطة بدايتها مع إحدى هذه العلامات تطويلٌ لا فاصلُ كلمتين.
    """
    out = set()
    for blk in pg.get_text("rawdict")["blocks"]:
        for ln in blk.get("lines", []):
            for sp in ln["spans"]:
                for c in sp["chars"]:
                    if c["c"] in KASHIDA and _w(c) < 0.01:
                        out.add(round(c["bbox"][0], 2))
    return out


def broken_space_x(pg, modal):
    """نقاط بداية محارف U+0020 التي يرسمها الخطّ برسمٍ غير رسم المسافة.

    عطبُ cmap: الخطّ يعيد لبعض الرسوم محرفَ المسافة، فتظهر فجوةٌ مكان وصلة.
    يُكشف الموضع بمقارنة رقم الرسم (glyph id) برقم رسم المسافة الغالب في الخطّ.
    """
    out = set()
    for sp in pg.get_texttrace():
        gid0 = modal.get(sp["font"])
        for c in sp["chars"]:
            if c[0] == 32 and gid0 is not None and c[1] != gid0:
                out.add(round(c[2][0], 2))
    return out


def space_gids(doc):
    """رقم رسم المسافة الغالب في كل خطّ — مرجعُ كشف عطب الـcmap."""
    tally = {}
    for i in range(doc.page_count):
        for sp in doc[i].get_texttrace():
            for c in sp["chars"]:
                if c[0] == 32:
                    tally.setdefault(sp["font"], Counter())[c[1]] += 1
    return {f: t.most_common(1)[0][0] for f, t in tally.items()}


# ------------------------------------------------------------ إعادة بناء النصّ
def span_text(span, drop_x=()):
    """نص السبان مُعاد البناء: رباطات مجموعة، ترتيب بصري، وإسقاط المسافات الزائفة.

    يعيد (النص، أقصى x، أدنى x، أقصى حافة يمنى).
    """
    chars, marks = [], []
    for c in span["chars"]:
        if c["c"] in KASHIDA and _w(c) < 0.01:
            continue                                   # تطويل لا حركة
        if MARKS.match(c["c"]) and _w(c) < 0.01:
            marks.append(c)
            continue
        if c["c"] == " " and round(c["bbox"][0], 2) in drop_x:
            continue                                   # تطويلُ ضبطٍ أو عطبُ رسم
        chars.append(c)

    # الرباط: مكوّناته صفرية العرض وتسبق حاملها بترتيب معكوس
    groups, pend = [], []
    for c in chars:
        if _w(c) < 0.01:
            pend.append(c)
            continue
        groups.append({"t": c["c"] + "".join(p["c"] for p in reversed(pend)),
                       "x": c["bbox"][0], "x1": c["bbox"][2]})
        pend = []
    if pend and groups:
        groups[-1]["t"] += "".join(p["c"] for p in reversed(pend))
    if not groups:
        return "", 0.0, 0.0, 0.0

    # مسافةٌ خارج مدى حروف السبان بمراحل موضعُها مغلوط، ووصلُ الخلايا يعتمد
    # على المسافات الطرفية — فتُسقَط كي لا تشطر كلمةً موصولة.
    span_xs = [g["x"] for g in groups if g["t"].strip()]
    if span_xs:
        groups = [g for g in groups if g["t"].strip()
                  or min(span_xs) - 25 <= g["x"] <= max(span_xs) + 25]

    # الحركة الحقيقية تشترك مع حرفها في نقطة البداية؛ ما عداها زخرف تنسيق
    for m in marks:
        for g in groups:
            if abs(g["x"] - m["bbox"][0]) < 0.01:
                g["t"] += m["c"]
                break

    # الترتيب البصري: العربية يميناً ثم يساراً، ثم تُعاد مقاطع الأرقام
    # والحروف اللاتينية إلى اتجاهها (ثنائية الاتجاه داخل السبان الواحد)
    if ARABIC.search("".join(g["t"] for g in groups)):
        groups.sort(key=lambda g: -g["x"])
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
    body = [g for g in groups if g["t"].strip()] or groups
    xs = [g["x"] for g in body]
    return ("".join(g["t"] for g in groups), max(xs), min(xs),
            max(g["x1"] for g in body))


def page_items(pg, drop_x):
    """سبانات الصفحة: نص مع إحداثيات (x0 يسار، xr يمين) وy."""
    out = []
    for blk in pg.get_text("rawdict")["blocks"]:
        for ln in blk.get("lines", []):
            for sp in ln["spans"]:
                t, xr, x0, x1 = span_text(sp, drop_x)
                t = re.sub(r"[ \t\u200f\u200e]+", " ", t.translate(AR_DIGITS))
                if t.strip():
                    out.append({"t": t, "x0": x0, "x1": x1, "xr": xr,
                                "y": round(sp["bbox"][1], 1)})
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
    # ضبطُ السطر بالتطويل يوسّع الوصلات داخل الكلمة، فتنشأ فجوة بلا مسافة
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


def page_lines(pg, drop_x):
    """يجمع السبانات في أسطر بحسب y ويرتبها يميناً ثم يساراً."""
    rows = {}
    for s in page_items(pg, drop_x):
        rows.setdefault(round(s["y"] / 3), []).append(s)
    lines = []
    for key in sorted(rows):
        items = sorted(rows[key], key=lambda s: -s["xr"])
        text = re.sub(r"\s+", " ", join_items(items)).strip()
        lines.append({"y": items[0]["y"], "items": items, "text": text})
    return lines


# ------------------------------------------------------------ تنظيف نصّي عام
REPAIRS = [
    # رباط «لا» يرسمه المصدر أحياناً مكوّنَين منفصلين فينقلب ترتيبهما بصرياً؛
    # والتسلسلات التالية غير واردة في الإملاء العربي أصلاً فالإصلاح قاطع
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
          "الإدارة العامة للمناهج", "التقنية الميكانيكية", "القسم التخصص",
          "تقنية كهرباء والكترونيات المركبات")


def is_boiler(t, y=0.0):
    if y > 795 or re.fullmatch(r"\d{1,3}\s*(135)?\s*من\s*(135)?", t):
        return True
    return any(t.startswith(b) for b in BOILER)


# --------------------------------------------------- (١) جدول الإطار المنهجي
# صفوف الفصول (ص٦–٧، صفحتان عرضيّتان) تُقرأ بإحداثيات أعمدتها لا بترتيب نصّها.
# خلية الاسم وخلية المتطلب يقطعهما المصدر أحياناً في سبانٍ واحد، فيُفصل بينهما
# بالحافة اليمنى (x1) لا بنقطة البداية، ثم يُنزع رمزُ المتطلب من ذيل الاسم.
FW_PAGES = (5, 6)
B_ROWNO, B_CODE = (762, 795), (712, 762)
B_NAME, B_PREREQ = (546, 712), (500, 546)
B_EN_NAME, B_EN_CODE = (140, 300), (78, 138)
BANDS = (("crh", 352, 375), ("l", 383, 406), ("p", 414, 437),
         ("t", 445, 468), ("cth", 476, 500))
B_COOP_CRH = (410, 445)                 # الفصل الخامس: جدول أضيق، و.م وحدها
CODE_AR = re.compile(r"(\d{3})\s*([؀-ۿ]{3,4})|([؀-ۿ]{3,4})\s*(\d{3})")
TRAIL_PRE = re.compile(r"\s*([؀-ۿ]{3,4})\s*$")


def _band(items, lo, hi, nums_only=False, by="x0"):
    got = [i for i in items if lo <= i[by] < hi
           and (not nums_only or is_num(i["t"]))]
    return sorted(got, key=lambda i: -i["xr"])


def _code(items):
    txt = " ".join(i["t"] for i in _band(items, *B_CODE))
    m = CODE_AR.search(txt)
    if not m:
        return None, None
    num, word = (m.group(1), m.group(2)) if m.group(1) else (m.group(4), m.group(3))
    return "%s-%s" % (word, num), "%s %s" % (num, word)


def framework(pages):
    """الساعات الرسمية لكل مقرر من جدول توزيع الخطة على الفصول (ص٦–٧).

    رقمُ الفصل يُعدّ بصفوف «المجموع» الفاصلة بين جداول الفصول، لا برمز
    «1st Semester» — فموضعُ الرمز في وسط جدوله لا في صدره.
    """
    done, out = 0, []
    for p in FW_PAGES:
        for idx, ln in enumerate(pages[p]):
            it = ln["items"]
            if "المجموع" in ln["text"]:
                done += 1
                continue
            sem = done + 1
            if not _band(it, *B_ROWNO, nums_only=True):
                continue
            code, code_ar = _code(it)
            if not code:
                continue
            en_name = " ".join(i["t"] for i in sorted(_band(it, *B_EN_NAME),
                                                     key=lambda i: i["x0"]))
            if not en_name:     # اسم إنجليزي طويل يلتفّ سطراً قبل الصف وآخر بعده
                en_name = " ".join(
                    i["t"] for j in (idx - 1, idx + 1) if 0 <= j < len(pages[p])
                    for i in _band(pages[p][j]["items"], *B_EN_NAME)
                    if not ARABIC.search(i["t"]))
            en_code = " ".join(i["t"] for i in _band(it, *B_EN_CODE))
            name = join_items(_band(it, *B_NAME, by="x1"))
            # رمز المتطلب: رقمه في عمود المتطلب وكلمتُه ملتصقة أحياناً بذيل الاسم
            prereq = []
            pre_txt = join_items(_band(it, *B_PREREQ, by="x1"))
            for g in CODE_AR.finditer(pre_txt):
                num, word = (g.group(1), g.group(2)) if g.group(1) else (g.group(4),
                                                                        g.group(3))
                prereq.append("%s %s" % (num, word))
            if not prereq:
                m = TRAIL_PRE.search(name)
                nums = _band(it, *B_PREREQ, nums_only=True, by="x1")
                if m and nums:
                    prereq = ["%s %s" % (n["t"].strip(), m.group(1)) for n in nums]
                    name = name[:m.start()]
            rec = {"code": code, "codeAr": code_ar, "codeEn": en_code.strip(),
                   "semester": sem, "nameAr": title(name),
                   "nameEn": re.sub(r"\s+", " ", en_name).strip(),
                   "prereqAr": prereq}
            hours = {k: _band(it, lo, hi, nums_only=True) for k, lo, hi in BANDS}
            if all(hours.values()):
                for k, _, _ in BANDS:
                    rec[k] = int(hours[k][0]["t"])
                out.append(rec)
                continue
            coop = _band(it, *B_COOP_CRH, nums_only=True)
            if coop and sem == 5:               # التدريب التعاوني: و.م فقط
                rec.update({"crh": int(coop[0]["t"]), "l": None, "p": None,
                            "t": None, "cth": None, "coop": True})
                out.append(rec)
    return out


# ------------------------------------------------ (٢) أقسام الوصف التفصيلي
DETAIL_FIRST = 13           # قبلها: الفهرس ووصف البرنامج و«الوصف المختصر»


def section_starts(pages):
    starts = []
    for i, lines in enumerate(pages):
        if i < DETAIL_FIRST:
            continue
        head = re.sub(r"[\s:ـ]", "", " ".join(l["text"] for l in lines[:8]))
        if "اسمالمقرر" in head and "لرمز" in head and "متطلبسابق" in head:
            starts.append(i)
    return starts


def section_lines(pages, a, b):
    out = []
    for p in range(a, b):
        for ln in pages[p]:
            out.append({"p": p, "y": ln["y"], "t": norm(ln["text"]),
                        "items": [{"x": i["x0"], "x0": i["x0"], "x1": i["x1"],
                                   "xr": i["xr"], "t": norm(i["t"]),
                                   "raw": norm(i["t"], True)} for i in ln["items"]]})
    return out


def merge_rows(lines, tol=3.5):
    """يدمج أسطر الصف الواحد: خلايا الصف تتذبذب رأسياً بضع نقاط في المصدر."""
    out = []
    for ln in lines:
        if out and ln["p"] == out[-1]["p"] and ln["y"] - out[-1]["y"] <= tol:
            out[-1]["items"] = sorted(out[-1]["items"] + ln["items"],
                                      key=lambda i: -i["xr"])
            out[-1]["t"] = norm(join_items(out[-1]["items"], "raw"))
        else:
            out.append(dict(ln))
    return out


def head_code(lines):
    """رمز المقرر من صدر القسم: «الرمز ### مكمر»."""
    head = " ".join(l["t"] for l in merge_rows(lines)[:6])
    m = re.search(r"لرمز\s*(\d{3})\s*(مكمر|متمر|رياد)", head)
    if m:
        return "%s-%s" % (m.group(2), m.group(1))
    m = re.search(r"لرمز\s*(مكمر|متمر|رياد)\s*(\d{3})", head)
    return ("%s-%s" % (m.group(1), m.group(2))) if m else None


def head_name(lines):
    """اسم المقرر كما في صدر صفحة الوصف التفصيلي (بين «اسم المقرر» و«الرمز»)."""
    head = " ".join(l["t"] for l in merge_rows(lines)[:4])
    m = re.search(r"اسم\s*المقرر\s*(.*?)\s*ا?لرمز", head)
    return title(m.group(1)) if m else ""


def head_prereq(lines):
    """المتطلبات السابقة من صدر القسم: «متطلب سابق ### رمز ، ### رمز»."""
    head = " ".join(l["t"] for l in merge_rows(lines)[:6])
    m = re.search(r"متطلب\s*سابق(.*?)(الفصل|الساعات|$)", head)
    if not m:
        return []
    out = []
    for a, b in re.findall(r"(\d{3})\s*([؀-ۿ]{3,4})", m.group(1)):
        code = "%s %s" % (a, b)
        if code not in out and b in OWN + ("رياد",):
            out.append(code)
    return out


HEAD_LABEL = (("crh", "الساعات المعتمدة"), ("l", "محاضرة"), ("p", "عملي"),
              ("t", "تمرين"))


def head_hours(lines):
    """الساعات من صدر القسم؛ وقيمتُها ترد في عمود الفصل التدريبي الذي به المقرر،
    فموضعها الأفقي شاهدٌ ثانٍ على رقم الفصل."""
    got, xs = {}, []
    for ln in merge_rows(lines)[:14]:
        key = None
        for it in ln["items"]:
            for k, lbl in HEAD_LABEL:
                if it["t"].strip().rstrip(":") == lbl:
                    key = k
                    break
            if key:
                break
        if not key:
            continue
        nums = [x for x in ln["items"] if is_num(x["t"]) and x["x0"] < 430]
        if nums:
            got[key] = int(nums[0]["t"])
            xs.append(nums[0]["x0"])
    return got, xs


# عمود «الفصل التدريبي» في صدر القسم: موضع الرقم يدلّ على الفصل
SEM_COL = ((389, 1), (325, 2), (261, 3), (198, 4), (134, 5), (70, 6))


def sem_of_x(x):
    for x0, s in SEM_COL:
        if abs(x - x0) < 5:
            return s
    return None


# ---------------------------------------------------------- (٣) جدول الوحدات
UNIT_HOURS_X = 200          # عمود «ساعات التدريب» في أقصى يسار جدول الوحدات


def parse_units(lines):
    """جدول «الوحدات (النظرية والعملية) — ساعات التدريب» حتى «المجموع»."""
    lines = merge_rows(lines)
    start = None
    for i, ln in enumerate(lines):
        t = ln["t"].lstrip(")(")
        if t.startswith("الوحدات") and ("ساعات التدريب" in ln["t"]
                                        or "العملية" in ln["t"]):
            start = i + 1
            break
    if start is None:
        return [], None
    units, total, pending, pending_num = [], None, None, None
    for ln in lines[start:]:
        t = ln["t"]
        if not t or is_boiler(t, ln["y"]):
            continue
        if "المجموع" in t:
            nums = re.findall(r"\d+", t)
            if nums:
                total = int(nums[-1])
                break
            total = "PENDING"
            continue
        if total == "PENDING":
            total = int(t) if is_num(t) else None
            break
        nums = [x for x in ln["items"] if is_num(x["t"]) and x["x"] < UNIT_HOURS_X]
        texts = [x for x in ln["items"] if x not in nums
                 and re.search(r"[0-9A-Za-z؀-ۿ]", x["t"])]
        if texts and nums:
            head = title(join_items(texts, "raw"))
            units.append({"title": (pending + " " + head) if pending else head,
                          "hours": int(nums[-1]["t"])})
            pending = pending_num = None
        elif texts:
            head = title(join_items(texts, "raw"))
            if pending_num is not None:
                units.append({"title": head, "hours": pending_num})
                pending_num = None
            elif pending:
                pending += " " + head
            else:
                pending = head
        elif nums:
            if pending is not None:
                units.append({"title": pending, "hours": int(nums[-1]["t"])})
                pending = None
            else:
                pending_num = int(nums[-1]["t"])
    return units, (total if total != "PENDING" else None)


# ---------------------------------------------------- (٤) اشتراطات السلامة
SAFETY_HEAD = re.compile(r"إجراءات\s*و\s*اشتراطات\s*السلامة")
SAFETY_END = re.compile(r"المنهج\s*التفصيلي")


def parse_safety(lines):
    """نصّ «إجراءات واشتراطات السلامة» كما ورد في الخطة، بندًا بندًا وبلا تحسين."""
    out, on, pend = [], False, None
    for ln in merge_rows(lines):
        t = ln["t"]
        if not t or is_boiler(t, ln["y"]):
            continue
        if SAFETY_HEAD.search(t):
            on = True
            continue
        if not on:
            continue
        if SAFETY_END.search(t) or t.startswith("الوحدات"):
            break
        # بند مرقّم: «1 . نص» أو «1 - نص» وقد ينفصل رقمُه عن نصّه سطراً
        m = re.match(r"^(\d{1,2})\s*[.\-–]?\s*(.*)$", t)
        if m:
            if pend:
                out.append(pend)
            pend = norm(m.group(2))
        elif pend:
            pend = pend + " " + t
        elif ARABIC.search(t):
            pend = t
    if pend:
        out.append(pend)
    return [re.sub(r"\s+", " ", s).strip(" .،") for s in out if s.strip()]


# ------------------------------------------- (٥) المنهج التفصيلي: المواضيع
X_HOURS = 506                       # حدّ عمود «الساعات» يميناً
X_CELL = (186, 512)                 # حدود عمود «المحتوى» (خطوط الجدول)
BULLET = re.compile(r"^[\u2022\u25cf\u25aa]+$|^o$")
REF_LABEL = ("مراجع", "الموضوع", "مراجع الموضوع", "المراجع")
TOOL_SKIP = ("أدوات التقييم", "التخصص", "الإدارة العامة")
DETAIL_HEAD = re.compile(r"^المنهج\s*التفصيلي\s*\(?\s*([^)]*)\)?\s*$")
PRACTICAL_HEAD = re.compile(r"^العملي")
THEORY_HEAD = re.compile(r"^النظري[ةه]?$")
PRACTICAL_TOOL = "الأداء العملي"


def _cells(row):
    """خلايا عمود المحتوى في الصف: رمز التعداد أولاً ثم نصوصه.

    كتلة «مراجع الموضوع» تقع في العمود نفسه ونصُّها لاتيني، فتُستبعد بعنوانها
    وباشتراط العربية في النصّ."""
    c = [i for i in row if X_CELL[0] <= i["x1"] < X_CELL[1]
         and i["t"].strip() not in REF_LABEL]
    marks = [i for i in c if BULLET.match(i["t"].strip())]
    texts = [i for i in c if i not in marks and ARABIC.search(i["t"])]
    return marks, texts


def detail_rows(pages, a, b):
    """صفوف جدول المنهج التفصيلي (بندٌ لكل خلية، مرتّبةً بصرياً)."""
    raw = []
    for p in range(a, b):
        for ln in pages[p]:
            if ln["y"] < 60:            # شريط ترويسة الصفحة فوق إطار الجدول
                continue
            for it in ln["items"]:
                t = norm(it["t"])
                if not t or is_boiler(t, ln["y"]):
                    continue
                raw.append({"p": p, "y": ln["y"], "x": it["x0"], "x0": it["x0"],
                            "x1": it["x1"], "xr": it["xr"], "t": t,
                            "raw": norm(it["t"], True)})
    raw.sort(key=lambda i: (i["p"], i["y"], -i["xr"]))
    rows = []
    for it in raw:
        if rows and it["p"] == rows[-1][0]["p"] and it["y"] - rows[-1][0]["y"] <= 3.5:
            rows[-1].append(it)
        else:
            rows.append([it])
    rows = [sorted(r, key=lambda i: -i["xr"]) for r in rows]
    # رمز التعداد يبقى أحياناً في صفٍّ وحده، فيُردّ إلى سطر نصّه المجاور العاري منه
    for i, r in enumerate(rows):
        marks, texts = _cells(r)
        if not (marks and not texts):
            continue
        for j in (i - 1, i + 1):
            if 0 <= j < len(rows):
                m2, t2 = _cells(rows[j])
                if t2 and not m2:
                    rows[j] = sorted(rows[j] + marks, key=lambda x: -x["xr"])
                    break
    return rows


def bullet_level1(rows):
    """حدّ المستوى الأول: أقصى موضعٍ يمينيّ لرمز تعداد في القسم كلّه."""
    xs = [i["x0"] for r in rows for i in r
          if BULLET.match(i["t"].strip()) and X_CELL[0] <= i["x1"] < X_CELL[1]]
    return (max(xs) - 8.0) if xs else 1e9


def parse_detail(rows):
    """كتل المنهج التفصيلي: لكل كتلة ساعاتُها وعنوانها وبنودها ومستوياتها.

    تُميَّز الكتلة العملية بعنوان الجدول «(العملي)» إن صرّح به، وإلا فبخانة
    أدوات التقييم «الأداء العملي» وحدَها (لا «الملاحظة المباشرة (الأداء العملي)»).
    """
    lvl1 = bullet_level1(rows)
    started, blocks, cur, last = False, [], None, None
    header, heads = "", []
    for row in rows:
        joined = norm(join_items(row, "raw"))
        m = DETAIL_HEAD.match(joined)
        if m:
            started, header = True, norm(m.group(1))
            if header not in heads:
                heads.append(header)
            continue
        if not started:
            continue
        if any(i["t"] == "المراجع" and i["x"] > X_HOURS for i in row):
            break                            # كتلة مراجع المقرر في آخر القسم
        hours = [i for i in row if i["x"] >= X_HOURS and is_num(i["t"])]
        marks, texts = _cells(row)
        tools = [i for i in row if i["x1"] < X_CELL[0]]
        tools = [norm(join_items(tools, "raw"))] if tools else []
        tools = [t for t in tools if ARABIC.search(t) and t not in TOOL_SKIP]
        v = title(join_items(texts, "raw"))
        if len(v) < 2 or v.startswith("المحتوى"):
            v = ""
        if hours:
            cur = {"hours": int(hours[-1]["t"]), "title": v, "header": header,
                   "items": [], "levels": [], "tools": list(tools)}
            blocks.append(cur)
            last = ("title", 0)
            continue
        if cur is None:
            continue
        cur["tools"].extend(tools)
        if not v:
            continue
        if not cur["title"]:
            cur["title"], last = v, ("title", 0)
            continue
        if not marks and last is not None:
            key, idx = last              # سطر ملتفٌّ: تكملةُ ما قبله لا بندٌ جديد
            if key == "title":
                cur["title"] += " " + v
            else:
                cur["items"][idx] += " " + v
            continue
        lvl = 1 if (marks and max(i["x0"] for i in marks) >= lvl1) else 2
        cur["items"].append(v)
        cur["levels"].append(lvl)
        last = ("items", len(cur["items"]) - 1)
    for blk in blocks:
        head = blk["header"]
        if PRACTICAL_HEAD.match(head):
            blk["practical"] = True
        elif THEORY_HEAD.match(head):
            blk["practical"] = False
        else:
            blk["practical"] = any(t.strip() == PRACTICAL_TOOL
                                   for t in blk["tools"])
        seen, keep = set(), []
        for t in blk["tools"]:
            if t not in seen:
                seen.add(t)
                keep.append(t)
        blk["tools"] = keep
    return blocks, heads


def _key(t):
    """مفتاح مقارنة العناوين: بلا تشكيل ولا ترقيم ولا فروق رسمِ الألف والياء."""
    t = re.sub(r"[^ء-ي0-9A-Za-z]", "", t)
    t = re.sub(r"[أإآ]", "ا", t)
    return t.replace("ى", "ي").replace("ة", "ه")


def _blank(u, i):
    return {"title": u["title"], "hours": u["hours"], "officialSpan": [i],
            "theoryHours": None, "theory": [], "theoryLevels": [],
            "theoryTools": [], "practicalHours": None, "practical": [],
            "practicalLevels": [], "practicalTools": []}


def match_blocks(units, blocks):
    """يوائم كتل المنهج التفصيلي بوحدات الجدول الرسمي.

    الخطة تمرّ على وحدات المقرر مرّةً نظرية ومرّةً عملية، فتُقابَل كتلُ كل
    مرّةٍ بالوحدات: بالعنوان أولاً ثم بالترتيب. وشرطُ القبول أن يساوي مجموعُ
    ساعات كتلتَي الوحدة ساعاتِها في الجدول الرسمي؛ فإن لم يكن فلا توفيق
    اجتهادي: تُخرج الكتل كما وردت بلا نسبة و`verified: false`.
    """
    th = [b for b in blocks if not b["practical"]]
    pr = [b for b in blocks if b["practical"]]
    out = [_blank(u, i) for i, u in enumerate(units)]
    ok = bool(units) and bool(blocks)
    for key, seq in (("theory", th), ("practical", pr)):
        if not seq:
            continue
        if len(seq) != len(units):
            ok = False
            continue
        order = None
        ukeys = [_key(u["title"]) for u in units]
        if len(set(ukeys)) == len(ukeys):
            got = [ukeys.index(_key(b["title"])) if _key(b["title"]) in ukeys
                   else None for b in seq]
            if None not in got and len(set(got)) == len(got):
                order = got                      # مطابقة بالعنوان
        if order is None:
            order = list(range(len(units)))      # مطابقة بالترتيب
        for j, blk in zip(order, seq):
            out[j][key] = list(blk["items"])
            out[j][key + "Levels"] = list(blk["levels"])
            out[j][key + "Tools"] = list(blk["tools"])
            out[j][key + "Hours"] = blk["hours"]
    for rec in out:
        got = [h for h in (rec["theoryHours"], rec["practicalHours"])
               if h is not None]
        if not got or sum(got) != rec["hours"]:
            ok = False
    if not ok:                      # لم تنطبق: تُخرج الكتل كما وردت بلا نسبة
        out = []
        for blk in blocks:
            key = "practical" if blk["practical"] else "theory"
            rec = {"title": blk["title"], "hours": blk["hours"],
                   "officialSpan": [], "theoryHours": None, "theory": [],
                   "theoryLevels": [], "theoryTools": [],
                   "practicalHours": None, "practical": [],
                   "practicalLevels": [], "practicalTools": []}
            rec[key] = list(blk["items"])
            rec[key + "Levels"] = list(blk["levels"])
            rec[key + "Tools"] = list(blk["tools"])
            rec[key + "Hours"] = blk["hours"]
            out.append(rec)
    return out, ok


# ------------------------------------------------------------------ التقرير
def ss01_courses():
    if not os.path.exists(SS01):
        return {}
    out = {}
    for r in csv.DictReader(io.open(SS01, encoding="utf-8-sig")):
        code = re.sub(r"\s+", "", r["المقرر"].strip())
        if code.split("-")[0] not in OWN:
            continue
        d = out.setdefault(code, {
            "nameAr": r["اسم المقرر"].strip(), "sections": set(),
            "crh": r["الساعات المعتمدة"], "l": r["ساعات المحاضرة"],
            "p": r["ساعات المختبر"], "t": r["ساعات أخرى"],
            "cth": r["ساعات الاتصال"]})
        d["sections"].add(r["الرقم المرجعي"])
    return out


def is_own(code):
    return code.split("-")[0] in OWN or code in EXTRA


def main():
    doc = fitz.open(PDF)
    modal = space_gids(doc)
    pages = []
    for i in range(doc.page_count):
        pg = doc[i]
        pages.append(page_lines(pg, kashida_x(pg) | broken_space_x(pg, modal)))

    fw = {c["code"]: c for c in framework(pages)}
    starts = section_starts(pages)
    bounds = list(zip(starts, starts[1:] + [starts[-1] + 6]))

    courses, details, problems = [], [], []
    for a, b in bounds:
        lines = section_lines(pages, a, b)
        code = head_code(lines)
        meta = fw.get(code)
        if meta is None:
            problems.append("قسم ص%d برمز %s غير موجود في جدول الإطار المنهجي"
                            % (a + 1, code))
            continue
        units, declared = parse_units(lines)
        hours, hxs = head_hours(lines)
        cth = meta["cth"]
        rec = dict(meta)
        rec["prereqAr"] = head_prereq(lines) or meta["prereqAr"]
        rec.update({"pageStart": a + 1, "pageEnd": b, "hasDetail": True,
                    "sectionNameAr": head_name(lines),
                    "units": units, "unitsSum": sum(u["hours"] for u in units),
                    "declaredTotal": declared, "expectedUnitsSum": cth * WEEKS,
                    "safetyRaw": parse_safety(lines)})
        for k, lbl in (("crh", "و.م"), ("l", "مح"), ("p", "عم"), ("t", "تم")):
            if k in hours and hours[k] != meta[k]:
                problems.append("%s: %s في صدر القسم %d وفي جدول الإطار %d"
                                % (code, lbl, hours[k], meta[k]))
        sems = {sem_of_x(x) for x in hxs} - {None}
        if sems and meta["semester"] not in sems:
            problems.append("%s: عمود الفصل في صدر القسم %s وفي جدول الإطار %d"
                            % (code, sorted(sems), meta["semester"]))
        if meta["l"] + meta["p"] + meta["t"] != cth:
            problems.append("%s: مح+عم+تم = %d ولا تساوي س.أ = %d"
                            % (code, meta["l"] + meta["p"] + meta["t"], cth))
        if rec["unitsSum"] != cth * WEEKS:
            problems.append("%s: مجموع ساعات الوحدات %d ولا يساوي س.أ×%d = %d"
                            % (code, rec["unitsSum"], WEEKS, cth * WEEKS))
        if declared is not None and declared != rec["unitsSum"]:
            problems.append("%s: «المجموع» المعلن %d ومجموع الوحدات %d"
                            % (code, declared, rec["unitsSum"]))
        if not rec["safetyRaw"]:
            problems.append("%s: لا كتلة «إجراءات واشتراطات السلامة» في القسم" % code)
        courses.append(rec)

        blocks, heads = parse_detail(detail_rows(pages, a, b))
        matched, ok = match_blocks(units, blocks)
        nth = sum(1 for x in blocks if not x["practical"])
        details.append({"code": code, "nameAr": meta["nameAr"], "cth": cth,
                        "verified": ok, "officialUnits": len(units),
                        "detailHeadersRaw": heads,
                        "theoryBlocks": nth, "practicalBlocks": len(blocks) - nth,
                        "detailHoursSum": sum(x["hours"] for x in blocks),
                        "units": matched})
        if not ok:
            problems.append(
                "%s: كتل المنهج التفصيلي (%d نظرية + %d عملية، مجموع ساعاتها %d) "
                "لا تنطبق على جدول الوحدات (%d وحدة، %d ساعة)"
                % (code, nth, len(blocks) - nth, sum(x["hours"] for x in blocks),
                   len(units), sum(u["hours"] for u in units)))

    # مقررات في الإطار المنهجي بلا صفحة وصف تفصيلي
    done = {c["code"] for c in courses}
    for code, meta in sorted(fw.items()):
        if not is_own(code) or code in done:
            continue
        rec = dict(meta)
        rec.update({"pageStart": None, "pageEnd": None, "hasDetail": False,
                    "sectionNameAr": "", "units": [], "unitsSum": 0,
                    "declaredTotal": None,
                    "expectedUnitsSum": (meta["cth"] * WEEKS) if meta["cth"] else None,
                    "safetyRaw": [],
                    "note": "لا صفحةَ وصفٍ تفصيلي لهذا المقرر في الخطة"})
        courses.append(rec)
        problems.append("%s: في جدول الإطار المنهجي ولا وصف تفصيلي له في الخطة"
                        % code)

    courses.sort(key=lambda c: (c["semester"], c["code"]))
    os.makedirs(OUT_DIR, exist_ok=True)
    src = os.path.basename(PDF)
    io.open(os.path.join(OUT_DIR, "plan-courses.json"), "w", encoding="utf-8").write(
        json.dumps({"source": src + " — جدول الإطار المنهجي (ص٦–٧) وصفحات الوصف التفصيلي",
                    "specialty": "تقنية كهرباء والكترونيات المركبات",
                    "department": "التقنية الميكانيكية", "weeksPerSemester": WEEKS,
                    "codes": {"مكمر": "مقررات التخصص",
                              "متمر": "مقررات مشتركة بين تخصصات قسم التقنية الميكانيكية",
                              "رياد": "ريادة أعمال (٢٣٢ رياد بنكهة المركبات)"},
                    "note": "مستخرج آلياً؛ الثابت المفروض: مجموع ساعات الوحدات = س.أ × ١٦. "
                            "وsafetyRaw نصّ «إجراءات واشتراطات السلامة» كما ورد في "
                            "الخطة بلا تحسين ولا إضافة",
                    "courses": courses}, ensure_ascii=False, indent=1))
    io.open(os.path.join(OUT_DIR, "plan-detail.json"), "w", encoding="utf-8").write(
        json.dumps({"source": src + " — المنهج التفصيلي (النظري والعملي)",
                    "note": "استخراج أمين بلا تحرير؛ الخطة تمرّ على وحدات المقرر مرّةً "
                            "نظرية ومرّةً عملية، ويميّزهما عنوانُ الجدول "
                            "«(النظري)»/«(العملي)» أو خانةُ «الأداء العملي». "
                            "وtheoryLevels/practicalLevels: ١ عنوان موضوع و٢ بند تحته",
                    "courses": details}, ensure_ascii=False, indent=1))

    # -------- تقرير الشاشة
    own = {c for c in fw if is_own(c)}
    print("مقررات جدول الإطار المنهجي: %d — منها مكمر/متمر/رياد٢٣٢: %d"
          % (len(fw), len(own)))
    print("المكتوبة: %d (منها %d بوصف تفصيلي)\n" % (len(courses), len(details)))
    dmap = {d["code"]: d for d in details}
    ss = ss01_courses()
    print("%-10s %-42s %3s %3s %3s %3s %3s %5s %5s %4s %4s %4s"
          % ("code", "name", "crh", "L", "P", "T", "cth", "unit", "sum",
             "th", "pr", "sec"))
    for c in courses:
        d = dmap.get(c["code"], {"units": []})
        print("%-10s %-42s %3s %3s %3s %3s %3s %5d %5d %4d %4d %4d"
              % (c["code"], c["nameAr"], c["crh"], c["l"], c["p"], c["t"],
                 c["cth"], len(c["units"]), c["unitsSum"],
                 sum(len(u["theory"]) for u in d["units"]),
                 sum(len(u["practical"]) for u in d["units"]),
                 len(ss.get(c["code"], {"sections": ()})["sections"])))

    plan = {c["code"] for c in courses if c["code"].split("-")[0] in OWN}
    print("\nمقارنة مع SS01: مقررات مكمر/متمر في الخطة %d — في التقرير %d"
          % (len(plan), len(ss)))
    for c in sorted(plan - set(ss)):
        print("  في الخطة ولا شعبة له: %s" % c)
    for c in sorted(set(ss) - plan):
        print("  له شعب ولا وجود له في الخطة: %s (%s)" % (c, ss[c]["nameAr"]))
    byar = {c["code"]: c for c in courses}
    for c in sorted(plan & set(ss)):
        a, b = byar[c], ss[c]
        for k, lbl in (("crh", "المعتمدة"), ("l", "المحاضرة"), ("p", "العملي"),
                       ("t", "التمارين"), ("cth", "الاتصال")):
            if b[k] != "" and int(b[k]) != (a[k] if a[k] is not None else 0):
                print("  اختلاف ساعات %s في %s: الخطة %s ورايات %s"
                      % (lbl, c, a[k], b[k]))
    print("\nمجموع شعب مكمر: %d — ومتمر: %d"
          % (sum(len(v["sections"]) for k, v in ss.items()
                 if k.startswith("مكمر")),
             sum(len(v["sections"]) for k, v in ss.items()
                 if k.startswith("متمر"))))

    print("\nملاحظات (%d):" % len(problems))
    for p in problems:
        print("  - %s" % p)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
