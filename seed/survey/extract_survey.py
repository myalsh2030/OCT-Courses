# -*- coding: utf-8 -*-
"""استخراج خطة تخصص «تقنية المساحة» (رمز مقررات التخصص: يمسح).

المصدر: «الخطة التفصيلية لتخصص تقنية المساحة - دبلوم كليات - نصفي.pdf»
(المؤسسة العامة للتدريب التقني والمهني — الإدارة العامة للمناهج، ١٤٤٦هـ /
2024G، ٨٥ صفحة).

المخرجات (بأشكال بيانات مشروع «ملف المدرب وتوصيف المقرر» نفسها، ومطابقةً
لمخرجات طيّار «الأجهزة والآلات الدقيقة» في `seed/ajdq/`):
  plan-courses.json  الرمز والاسم والساعات ووحدات المقرر وساعاتها، ونص
                     «إجراءات واشتراطات السلامة» كما ورد في الخطة (safetyRaw).
  plan-detail.json   المنهج التفصيلي: مواضيع كل وحدة.

جوهر جودة النص العربي أربع معالجات على مستوى المحرف — راجع span_text:
  ١) مكوّنات الرباط (ligature) تُستخرج بعرض صفري وترتيب معكوس، فتُلحق بحاملها.
  ٢) ترتيب الرسم في المصدر مبعثر، فتُرتَّب العناقيد بصرياً يميناً ثم يساراً.
  ٣) خطّ المصدر (___WRD_EMBED_SUB_45) يربط حرفَي «س» و«ك» بمحرف المسافة
     بنسبتَي عرضٍ ثابتتين، وهو عطب في cmap الخط يُصلَح بجدول إحلال محقَّق
     بصرياً من صور الصفحات.
  ٤) محرف التطويل (كشيدة ضبط السطر) يُرسم في هذا الملف نوناً بنسبة عرض ٠٫١٢،
     فيُسقط. (لا يرد إلا في ص٥ خارج نطاق الاستخراج، ويُسقط احترازاً.)
منطق العناقيد مقتبس من planlib.py في مشروع «ملف المدرب وتوصيف المقرر»،
والسكربت مبنيّ على extract_ajdq.py.
"""
import csv
import io
import json
import os
import re
import sys

import fitz

PDF = ("M:/AI PROJECTS/ملف المدرب وتوصيف المقرر/خطط تخصصات الكلية/"
       "الخطة التفصيلية لتخصص تقنية المساحة - دبلوم كليات - نصفي.pdf")
SS01 = "M:/RAYAT_REPORTS/SS01_135_144710_2026-08-19_1716.csv"
OUT_DIR = "M:/AI PROJECTS/OCT-Courses/seed/survey"

AR_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")
WEEKS = 16                      # ساعات الوحدات = ساعات الاتصال × ١٦

# رمز مقررات التخصص، ومعه المقرر المُنكَّه بالتخصص من عائلة «رياد»
SPEC = "يمسح"
EXTRA_CODES = ("رياد-282",)     # ريادة الأعمال في مجال الهندسة المدنية

# ---------------------------------------------------------------- محارف وخطوط
# خطّ المصدر يربط رمزين مفقودين من cmap بمحرف المسافة، ويتميّز كلٌّ منهما
# بنسبة عرضٍ ثابتة إلى حجم الخط. الجدول محقَّق بصرياً من صور الصفحات.
GLYPH_FIX = ((" ", 0.795, 0.807, "س"),        # مقاييس، الملابس، أسس، التنفس
             (" ", 0.640, 0.650, "ك"))        # والسلوك، ويترك
FIX_FONT = "WRD_EMBED"          # لا تُطبَّق قواعد العرض إلا على الخط المعطوب
KASHIDA_N = (0.10, 0.14)        # النون بهذه النسبة محرفُ تطويلٍ لا حرف
WIDE_SPACE = 0.45               # ما جاوزها وشارك حرفاً موضعَه فهو تطويل ضبط
KASHIDA = "ُـ"        # الدمّة صفرية العرض قد تكون محرف التطويل أيضاً
MARKS = re.compile(r"[ً-ْٰ]")
ARABIC = re.compile(r"[؀-ۿ]")
SEMESTER = re.compile(r"([1-5])(st|nd|rd|th)\s*Semester")
LTR = re.compile(r"^[0-9A-Za-z]")


def _w(c):
    return c["bbox"][2] - c["bbox"][0]


def span_text(span):
    """نص السبان مُعاد البناء: رباطات مجموعة، ترتيب بصري، وإحلال الرموز المعطوبة.

    يعيد (النص، أقصى x، أدنى x، أقصى حافة يمنى).
    """
    size = span.get("size") or 1.0
    broken = FIX_FONT in span.get("font", "")
    # المسافة التي تشترك في نقطة بدايتها مع حرف هي تطويلُ ضبطِ السطر يعلو
    # الحرف، لا فاصلَ كلمتين — تُسقَط وإلا شطرت الكلمة.
    letters = {round(c["bbox"][0], 1) for c in span["chars"] if c["c"] != " "}
    chars, marks = [], []
    for c in span["chars"]:
        if c["c"] in KASHIDA and _w(c) < 0.01:
            continue                                   # تطويل لا حركة
        if MARKS.match(c["c"]) and _w(c) < 0.01:
            marks.append(c)
            continue
        if broken and c["c"] == "ن" and KASHIDA_N[0] <= _w(c) / size <= KASHIDA_N[1]:
            continue                                   # (٤) كشيدة مرسومة نوناً
        chars.append(c)

    # (١) الرباط: مكوّناته صفرية العرض وتسبق حاملها بترتيب معكوس
    groups, pend = [], []
    for c in chars:
        if _w(c) < 0.01:
            pend.append(c)
            continue
        txt, ratio = c["c"], _w(c) / size
        for ch, lo, hi, rep in (GLYPH_FIX if broken else ()):
            if txt == ch and lo <= ratio <= hi:
                txt = rep                          # (٣) عطب cmap الخط
                break
        else:
            if (txt == " " and ratio > WIDE_SPACE
                    and round(c["bbox"][0], 1) in letters):
                continue        # مسافة تعلو حرفاً = تطويل ضبط لا فاصل كلمتين
        groups.append({"t": txt + "".join(p["c"] for p in reversed(pend)),
                       "x": c["bbox"][0], "x1": c["bbox"][2]})
        pend = []
    if pend and groups:
        groups[-1]["t"] += "".join(p["c"] for p in reversed(pend))
    if not groups:
        return "", 0.0, 0.0, 0.0

    # مسافةٌ خارج مدى حروف السبان بمراحل موضعُها مغلوط، ووصلُ الخلايا يعتمد
    # على المسافات الطرفية — فتُسقَط كي لا تشطر كلمةً موصولة.
    spread = [g["x"] for g in groups if g["t"].strip()]
    if spread:
        groups = [g for g in groups if g["t"].strip()
                  or min(spread) - 25 <= g["x"] <= max(spread) + 25]

    # الحركة الحقيقية تشترك مع حرفها في نقطة البداية؛ ما عداها زخرف تنسيق
    for m in marks:
        for g in groups:
            if abs(g["x"] - m["bbox"][0]) < 0.01:
                g["t"] += m["c"]
                break

    # (٢) الترتيب البصري: العربية يميناً ثم يساراً، ثم تُعاد مقاطع الأرقام
    #     والحروف اللاتينية إلى اتجاهها (ثنائية الاتجاه داخل السبان الواحد)
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
    # المدى يُحسب من الحروف وحدها: المسافة قد ترسم بعيداً عن موضعها المنطقي
    body = [g for g in groups if g["t"].strip()] or groups
    xs = [g["x"] for g in body]
    return ("".join(g["t"] for g in groups), max(xs), min(xs),
            max(g["x1"] for g in body))


def page_items(pg):
    """سبانات الصفحة: نص مع إحداثيات (x0 يسار، xr يمين) وy.

    تُحفظ المسافات الطرفية كما وردت في المصدر لأنها الفيصل في وصل السبانات:
    المصدر يقطع الكلمة الواحدة سبانين بلا مسافة بينهما.
    """
    out = []
    for blk in pg.get_text("rawdict")["blocks"]:
        for ln in blk.get("lines", []):
            for sp in ln["spans"]:
                t, xr, x0, x1 = span_text(sp)
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


# ------------------------------------------------------------ تنظيف نصّي عام
# ما عجزت إعادةُ البناء عنه: رباط «لا» يرسمه المصدر أحياناً مكوّنَين منفصلين
# فينقلب ترتيبهما بصرياً. التسلسلات التالية غير واردة في الإملاء العربي أصلاً
# فالإصلاح قاطع، وكل بند منه مذكور في REPORT.md.
REPAIRS = [
    ("األ", "الأ"), ("اإل", "الإ"), ("اآل", "الآ"),
    ("اال", "الا"), ("أال", "الأ"), ("إال", "الإ"),
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
    # قوسان فارغان ورمزٌ لاتيني في الذيل: موضع الرمز بينهما
    m = re.search(r"\(\s*\)(.*?)\s+([0-9A-Za-z][0-9A-Za-z\-]*)$", t)
    if m:
        t = t[:m.start()] + "(" + m.group(3) + ")" + m.group(2)
    return re.sub(r"\s+", " ", t).strip()


def is_num(t):
    return bool(re.fullmatch(r"\d{1,3}", t.strip()))


BOILER = ("المملكة العربية السعودية", "المؤسسة العامة للتدريب",
          "الإدارة العامة للمناهج", "القسم التخصص", "تقنية المساحة",
          "المنهج التفصيلي", "أدوات التقييم", "راجع ملحق", "الساعات المحتوى",
          "المحتوى", "الساعات", "الوحدات")


def is_boiler(t, y=0.0):
    """ترويسة الصفحة وتذييلها. الترويسة تُقطَّع سباناتٍ («الإدارة العامة» + «ل» +
    «لمناهج») فلا تكفي مطابقةُ النص، ويحسمها موضعُها: أعلى ٦٠ نقطة من الصفحة."""
    if y > 795 or (0 < y < 60) or re.fullmatch(r"\d{1,2}\s*(85)?\s*من\s*(85)?", t):
        return True
    return any(t.startswith(b) for b in BOILER)


# --------------------------------------------------- (١) جدول الإطار المنهجي
# صفحتا الإطار المنهجي عرضيّتان (ص٧–٨)، وصفوفها تُقرأ بإحداثيات أعمدتها لا
# بترتيب نصّها: الأرقام وحدها ثابتة الموضع.
FW_PAGES = (6, 7)
BANDS = (("cth", 476, 500), ("t", 446, 466), ("p", 416, 436),
         ("l", 386, 406), ("crh", 352, 376))
B_ROWNO, B_CODE, B_NAME = (768, 790), (718, 766), (505, 716)
B_EN_NAME, B_EN_CODE, B_COOP_CRH = (140, 300), (78, 138), (408, 446)
CODE_AR = re.compile(r"(\d{3})\s*([؀-ۿ]{3,4})|([؀-ۿ]{3,4})\s*(\d{3})")
TRAIL_PRE = re.compile(r"\s*(\d{3}\s*[؀-ۿ]{3,4}|[؀-ۿ]{3,4}\s*\d{3})\s*$")
TOTAL_ROW = re.compile(r"Total\s+Number\s+of\s+Units")


def _band(items, lo, hi, nums_only=False):
    got = [i for i in items if lo <= i["x0"] < hi and (not nums_only or is_num(i["t"]))]
    return sorted(got, key=lambda i: -i["xr"])


def _code(items):
    txt = " ".join(i["t"] for i in _band(items, *B_CODE))
    txt = re.sub(r"(?<=[؀-ۿ])\s+(?=[؀-ۿ])", "", txt)   # «فيز ي» ← «فيزي»
    m = CODE_AR.search(txt)
    if not m:
        return None, None
    num, word = (m.group(1), m.group(2)) if m.group(1) else (m.group(4), m.group(3))
    return "%s-%s" % (word, num), "%s %s" % (num, word)


def framework(pages):
    """الساعات الرسمية لكل مقرر من جدول توزيع الخطة على الفصول (ص٧–٨).

    ترتيبُ الرسم يضع لافتةَ الفصل بعد صفّه الأول، فلا يُعتمد عليها في تحديد
    الفصل؛ يُعدّ الفصل بصفّ «المجموع / Total Number of Units» الذي يختم كل جدول.
    """
    sem, out, labels = 1, [], []
    for p in FW_PAGES:
        for idx, ln in enumerate(pages[p]):
            m = SEMESTER.search(ln["text"])
            if m:
                labels.append(int(m.group(1)))
            it = ln["items"]
            if TOTAL_ROW.search(ln["text"]):
                sem += 1
                continue
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
            name = " ".join(i["t"] for i in _band(it, *B_NAME))
            prereq = []
            m = TRAIL_PRE.search(name)
            if m:
                a, b = m.group(1), None
                mm = re.match(r"(\d{3})\s*([؀-ۿ]{3,4})$", a.strip())
                if mm:
                    b = "%s %s" % (mm.group(1), mm.group(2))
                else:
                    mm = re.match(r"([؀-ۿ]{3,4})\s*(\d{3})$", a.strip())
                    b = "%s %s" % (mm.group(2), mm.group(1)) if mm else a.strip()
                prereq = [b]
                name = name[:m.start()]
            rec = {"code": code, "codeAr": code_ar, "codeEn": en_code.strip(),
                   "semester": sem, "nameAr": title(name),
                   "nameEn": re.sub(r"\s+", " ", en_name).strip(), "prereqAr": prereq}
            hours = {k: _band(it, lo, hi, nums_only=True) for k, lo, hi in BANDS}
            if all(hours.values()):
                for k in ("crh", "l", "p", "t", "cth"):
                    rec[k] = int(hours[k][0]["t"])
                out.append(rec)
                continue
            coop = _band(it, *B_COOP_CRH, nums_only=True)
            if coop:                            # التدريب التعاوني: و.م فقط
                rec.update({"crh": int(coop[0]["t"]), "l": None, "p": None,
                            "t": None, "cth": None, "coop": True})
                out.append(rec)
    return out, labels


# ---------------------------------------------- (٢) أقسام الوصف التفصيلي
def section_starts(pages):
    starts = []
    for i, lines in enumerate(pages):
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


def head_code(lines):
    """رمز المقرر من صدر القسم: «الرمز ### يمسح»."""
    head = " ".join(l["t"] for l in lines[:10])
    m = re.search(r"(\d{3})\s*(%s)" % SPEC, head)
    if m:
        return "%s-%s" % (m.group(2), m.group(1))
    m = re.search(r"(%s)\s*(\d{3})" % SPEC, head)
    return ("%s-%s" % (m.group(1), m.group(2))) if m else None


def head_name(lines):
    """اسم المقرر كما في صدر صفحة الوصف التفصيلي (للمقارنة بجدول الإطار).

    الاسم يقع في صفّ لصاقة «اسم المقرر» بين اللصاقة ولصاقة «الرمز».
    """
    for ln in merge_rows(lines)[:10]:
        lbl = [i for i in ln["items"] if i["t"].startswith("اسم المقرر")]
        if not lbl:
            continue
        rmz = [i for i in ln["items"] if i["t"].startswith("الرمز")]
        left = max(i["xr"] for i in rmz) if rmz else 0
        got = [i for i in ln["items"] if left < i["xr"] < min(x["x0"] for x in lbl)]
        # لصاقة «الرمز» تلتصق أحياناً بذيل الاسم في سبانٍ واحد
        return re.sub(r"\s*الرمز\b.*$", "", title(join_items(got, "raw"))) if got else ""
    return ""


def head_prereq(lines):
    """المتطلبات السابقة من صدر القسم: «متطلب سابق ### رمز ، ### رمز»."""
    head = " ".join(l["t"] for l in merge_rows(lines)[:12])
    m = re.search(r"متطلب\s*سابق(.*?)(الفصل|الساعات|$)", head)
    if not m:
        return []
    out = []
    for a, b in re.findall(r"(\d{3})\s*([؀-ۿ]{3,4})", m.group(1)):
        code = "%s %s" % (a, b)
        if code not in out:
            out.append(code)
    return out


H_VAL = (350, 420)              # عمود قيم الساعات في صدر القسم


def head_hours(lines):
    """الساعات من صدر القسم: معتمدة/محاضرة/عملي/تمرين — قيمتها في عمود فصلها."""
    got = {}
    for ln in merge_rows(lines)[:20]:
        key = None
        for it in ln["items"]:
            t = it["t"]
            key = ("crh" if "الساعات المعتمدة" in t else
                   "l" if t == "محاضرة" else "p" if t == "عملي" else
                   "t" if t == "تمرين" else None)
            if key:
                break
        if not key:
            continue
        nums = [x for x in ln["items"] if is_num(x["t"])
                and H_VAL[0] <= x["x0"] < H_VAL[1]]
        if nums:
            got[key] = int(nums[0]["t"])
    return got


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


def parse_units(lines):
    """جدول «الوحدات (النظرية والعملية) — ساعات التدريب» حتى «المجموع»."""
    lines = merge_rows(lines)
    start = None
    for i, ln in enumerate(lines):
        t = ln["t"].lstrip(")(")
        if t.startswith("الوحدات") and ("ساعات التدريب" in ln["t"] or "العملية" in ln["t"]):
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
        nums = [x for x in ln["items"] if is_num(x["t"]) and x["x"] < 200]
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


# ------------------------------------------- (٣) نص السلامة كما ورد في الخطة
SAFETY_HEAD = re.compile(r"إجراءات\s*واشتراطات\s*السلامة")


def parse_safety(lines):
    """نصّ «إجراءات واشتراطات السلامة» حرفياً بين عنوانه وجدول المنهج التفصيلي.

    لا يُحرَّر ولا يُهذَّب: يُفكّ التفافُ الأسطر فقط (وصلٌ بمسافة واحدة).
    """
    lines = merge_rows(lines)
    out, started = [], False
    for ln in lines:
        t = ln["t"]
        if not started:
            started = bool(SAFETY_HEAD.search(t))
            continue
        if "المنهج التفصيلي" in t or t.startswith("اسم المقرر"):
            break                       # يُفحص قبل is_boiler لأن الترويسة منه
        if not t or is_boiler(t, ln["y"]):
            continue
        out.append(t)
    return re.sub(r"\s+", " ", " ".join(out)).strip()


# ------------------------------------------- (٤) المنهج التفصيلي: المواضيع
X_HOURS = 495                   # عمود الساعات في يمين الجدول
X_CELL = (200, 495)             # مدى حافة خلية المحتوى اليسرى
REF_LABEL = ("مراجع", "الموضوع", "مراجع الموضوع")
REF_HEAD = re.compile(r"^مراجع\s*ال?موضوع")
BULLET = re.compile(r"^[\u2022\u25cf\u25aa]+$|^[oO]$")
# لصاقات عمود «أدوات التقييم»: مجموعة مغلقة تتكرر بنصّها في الخطة كلها،
# تُقتطع فقط من خليةٍ رسمها المصدر عابرةً حدَّ العمودين (راجع REPORT.md).
TOOLS = ("الأسئلة التحريرية", "الأسئلة الشفهية", "الملاحظة المباشرة",
         "الملاحظة المباشره", "التقييم أثناء العمل", "التقييم على رأس العمل",
         "الحالات الدرأسية", "الأداء العملي", "الاختبارات والأعمال التحريرية",
         "الاختبارات والأعمال", "راجع ملحق أدوات التقييم", "أدوات التقييم")
TOOLS_TAIL = re.compile(r"\s*(%s)\s*\.?\s*$" % "|".join(TOOLS))
X_TOOLS = 190                   # حدّ عمود أدوات التقييم الأيسر


def _cells(row):
    """خلايا عمود المحتوى في الصف: رمز التعداد أولاً ثم نصوصه.

    صفّ «مراجع الموضوع» يقع في العمود نفسه، ويميّزه إمّا لصاقةُ العنوان (وقد
    يقطعها المصدر سبانين) وإمّا رقمُ ترتيبه المجرّد في أقصى يمين الخلية —
    فيُستبعد صفُّه كلُّه.
    """
    c = [i for i in row if X_CELL[0] <= i["x1"] < X_CELL[1]]
    if any(i["t"] in REF_LABEL and i["x0"] >= 400 for i in c):
        return [], []
    if c and REF_HEAD.match(norm(join_items(c, "raw"))):
        return [], []
    marks = [i for i in c if BULLET.match(i["t"])]
    texts = [i for i in c if not BULLET.match(i["t"]) and i["t"] not in REF_LABEL]
    if not marks and texts and re.fullmatch(r"\d{1,2}", texts[0]["t"]):
        return [], []                    # صفّ مرجعٍ مرقّم لا بندَ محتوى
    return marks, texts


def detail_rows(pages, a, b):
    """صفوف جدول المنهج التفصيلي.

    صفّ الجدول يتذبذب رأسياً بضع نقاط فتُجمع بنوده بتسامح ٣٫٥ نقطة. ويبقى
    رمز التعداد أحياناً في صفٍّ وحده، فيُردّ إلى سطر نصّه المجاور العاري منه.
    """
    raw = []
    for p in range(a, b):
        for ln in pages[p]:
            for it in ln["items"]:
                t, rt = norm(it["t"]), norm(it["t"], True)
                # المصدر يرسم أحياناً خليةَ المحتوى ولصاقةَ عمود «أدوات التقييم»
                # في سبانٍ واحد يعبر حدَّ العمودين، فتُقتطع اللصاقة من ذيله.
                if it["x0"] < X_TOOLS < it["x1"] < X_CELL[1]:
                    t2 = TOOLS_TAIL.sub("", t)
                    if t2 != t:
                        t, rt = t2, TOOLS_TAIL.sub("", rt) + " "
                if not t or (is_boiler(t, ln["y"]) and "المنهج التفصيلي" not in t):
                    continue
                raw.append({"p": p, "y": ln["y"], "x": it["x0"], "x0": it["x0"],
                            "x1": it["x1"], "xr": it["xr"], "t": t, "raw": rt})
    raw.sort(key=lambda i: (i["p"], i["y"], -i["xr"]))
    rows = []
    for it in raw:
        if rows and it["p"] == rows[-1][0]["p"] and it["y"] - rows[-1][0]["y"] <= 3.5:
            rows[-1].append(it)
        else:
            rows.append([it])
    rows = [sorted(r, key=lambda i: -i["xr"]) for r in rows]
    for i, r in enumerate(rows):
        marks, texts = _cells(r)
        if not (marks and not texts):
            continue
        for j in (i - 1, i + 1):
            if 0 <= j < len(rows):
                m2, t2 = _cells(rows[j])
                if t2 and not m2:
                    rows[j] = sorted(rows[j] + marks, key=lambda i: -i["xr"])
                    break
    return rows


def parse_detail(rows):
    """يقسّم بنود المحتوى على الوحدات بحسب أرقام عمود الساعات.

    مستويان: «•» عنوان موضوع و«o» بند تحته، ويُستدل على المستوى برمز التعداد
    نفسه (لا بموضعه: إزاحة العمود تختلف بين المقررات). وصفٌّ بلا رمزٍ تكملةُ
    سطرٍ التفَّ عن سابقه فيُضمّ إليه. ولا فاصل «تطبيقات عملية» في هذه الخطة،
    فكلّ المواضيع نظرية و`practical` تبقى فارغة — راجع REPORT.md.
    """
    started, units, cur, last = False, [], None, None
    for row in rows:
        joined = " ".join(i["t"] for i in row)
        if not started:
            started = "المنهج التفصيلي" in joined
            continue
        # كتلة «المراجع» في آخر القسم تقع في عمود الساعات وتوقف القراءة
        head = norm(join_items([i for i in row if i["x0"] >= X_HOURS], "raw"))
        if head == "المراجع":
            break
        if "المنهج التفصيلي" in joined:
            continue                         # ترويسة الجدول تتكرر كل صفحة
        hours = [i for i in row if i["x"] >= X_HOURS and is_num(i["t"])]
        marks, texts = _cells(row)
        v = title(join_items(texts, "raw"))
        if len(v) < 2 or not ARABIC.search(v):
            v = ""
        if hours:
            cur = {"hours": int(hours[-1]["t"]), "title": v,
                   "theory": [], "practical": []}
            units.append(cur)
            last = ("title", 0)
            continue
        if cur is None or not v:
            continue
        if not cur["title"]:
            cur["title"], last = v, ("title", 0)
            continue
        if not marks and last is not None:
            key, idx = last              # سطر ملتفٌّ: تكملةُ ما قبله لا بندٌ جديد
            if key == "title":
                cur["title"] += " " + v
            else:
                cur[key][idx] += " " + v
            continue
        cur["theory"].append(v)
        last = ("theory", len(cur["theory"]) - 1)
    return units


# ------------------------------------------------------------------ التقرير
def ss01_courses(prefixes):
    if not os.path.exists(SS01):
        return {}
    out = {}
    for r in csv.DictReader(io.open(SS01, encoding="utf-8-sig")):
        code = r["المقرر"].strip()
        if not any(code.startswith(p) for p in prefixes):
            continue
        d = out.setdefault(code, {
            "nameAr": r["اسم المقرر"].strip(), "sections": set(),
            "dept": r["القسم"].strip(),
            "crh": r["الساعات المعتمدة"], "l": r["ساعات المحاضرة"],
            "p": r["ساعات المختبر"], "t": r["ساعات أخرى"], "cth": r["ساعات الاتصال"]})
        d["sections"].add(r["الرقم المرجعي"])
    return out


def main():
    doc = fitz.open(PDF)
    pages = [page_lines(doc[i]) for i in range(doc.page_count)]
    fw_list, sem_labels = framework(pages)
    fw = {c["code"]: c for c in fw_list}
    starts = section_starts(pages)
    # آخر قسم ينتهي عند صفحة «الملاحق والمراجع»
    end = next((i for i in range(starts[-1], len(pages))
                if any("الملاحق والمراجع" in l["text"] for l in pages[i])),
               starts[-1] + 3)
    bounds = list(zip(starts, starts[1:] + [end]))

    courses, details, problems = [], [], []
    for a, b in bounds:
        lines = section_lines(pages, a, b)
        code = head_code(lines)
        units, declared = parse_units(lines)
        meta = fw.get(code)
        if meta is None:
            problems.append("قسم ص%d برمز %s غير موجود في جدول الإطار المنهجي"
                            % (a + 1, code))
            continue
        hours, cth = head_hours(lines), meta["cth"]
        rec = dict(meta)
        rec["prereqAr"] = head_prereq(lines) or meta["prereqAr"]
        rec.update({"pageStart": a + 1, "pageEnd": b, "units": units,
                    "unitsSum": sum(u["hours"] for u in units),
                    "declaredTotal": declared, "expectedUnitsSum": cth * WEEKS,
                    "safetyRaw": parse_safety(lines)})
        hname = head_name(lines)
        if hname and hname != meta["nameAr"]:
            problems.append("%s: الاسم في جدول الإطار «%s» وفي صدر القسم «%s»"
                            % (code, meta["nameAr"], hname))
        for k, lbl in (("crh", "و.م"), ("l", "مح"), ("p", "عم"), ("t", "تم")):
            if k in hours and hours[k] != meta[k]:
                problems.append("%s: %s في صدر القسم %d وفي جدول الإطار %d"
                                % (code, lbl, hours[k], meta[k]))
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
            problems.append("%s: لم يُعثر على نص «إجراءات واشتراطات السلامة»" % code)
        courses.append(rec)

        du = parse_detail(detail_rows(pages, a, b))
        matched, ok, oi = [], True, 0
        for u in du:
            span, acc = [], 0
            while oi < len(units) and acc < u["hours"]:
                acc += units[oi]["hours"]
                span.append(oi)
                oi += 1
            if acc == u["hours"] and span:
                name = " و".join(units[i]["title"] for i in span)
            else:
                ok, name = False, u["title"]
                span = []
            matched.append({"title": name, "hours": u["hours"], "officialSpan": span,
                            "theory": u["theory"], "practical": u["practical"]})
        ok = ok and oi == len(units)
        details.append({"code": code, "nameAr": meta["nameAr"], "cth": cth,
                        "verified": ok, "officialUnits": len(units),
                        "detailSum": sum(u["hours"] for u in du), "units": matched})
        if not ok:
            problems.append("%s: كتل المنهج التفصيلي لا تنطبق على جدول الوحدات" % code)

    # مقررات في الإطار المنهجي بلا صفحة وصف تفصيلي (التدريب التعاوني، ورياد ٢٨٢)
    done = {c["code"] for c in courses}
    for code, meta in sorted(fw.items()):
        if code in done:
            continue
        if not (code.startswith(SPEC) or code in EXTRA_CODES):
            continue
        rec = dict(meta)
        rec.update({"pageStart": None, "pageEnd": None, "units": [], "unitsSum": 0,
                    "declaredTotal": None,
                    "expectedUnitsSum": (meta["cth"] * WEEKS) if meta["cth"] else None,
                    "safetyRaw": "",
                    "note": "لا صفحةَ وصفٍ تفصيلي لهذا المقرر في الخطة"})
        courses.append(rec)
        problems.append("%s: في جدول الإطار المنهجي ولا وصف تفصيلي له في الخطة" % code)

    os.makedirs(OUT_DIR, exist_ok=True)
    src = os.path.basename(PDF)
    io.open(os.path.join(OUT_DIR, "plan-courses.json"), "w", encoding="utf-8").write(
        json.dumps({"source": src + " — جدول الإطار المنهجي (ص٧–٨) وصفحات الوصف التفصيلي",
                    "specialty": "تقنية المساحة",
                    "department": "تقنية المساحة", "weeksPerSemester": WEEKS,
                    "note": "مستخرج آلياً؛ الثابت المفروض: مجموع ساعات الوحدات = س.أ × ١٦. "
                            "و`safetyRaw` نصّ «إجراءات واشتراطات السلامة» من الخطة حرفياً "
                            "بلا تحرير (فُكّ التفافُ الأسطر فقط)",
                    "courses": courses}, ensure_ascii=False, indent=1))
    io.open(os.path.join(OUT_DIR, "plan-detail.json"), "w", encoding="utf-8").write(
        json.dumps({"source": src + " — المنهج التفصيلي (النظري والعملي)",
                    "note": "استخراج أمين بلا تحرير؛ «•» موضوع و«o» بند تحته. "
                            "ولا فاصل «تطبيقات عملية» في هذه الخطة، فكل المواضيع في "
                            "`theory` و`practical` فارغة — راجع REPORT.md",
                    "courses": details}, ensure_ascii=False, indent=1))

    # -------- تقرير الشاشة
    print("مقررات جدول الإطار المنهجي: %d — منها %s: %d"
          % (len(fw), SPEC, sum(1 for c in fw if c.startswith(SPEC))))
    print("لافتات الفصول المقروءة: %s" % sem_labels)
    print("المقررات المكتوبة: %d (منها %d بوصف تفصيلي)\n" % (len(courses), len(details)))
    dmap = {d["code"]: d for d in details}
    print("%-10s %-34s %3s %3s %3s %3s %3s %5s %5s %5s %4s %4s %4s"
          % ("code", "name", "crh", "L", "P", "T", "cth", "unit", "sum", "decl",
             "th", "sfty", "sec"))
    ss = ss01_courses((SPEC,) + tuple(c.split("-")[0] for c in EXTRA_CODES))
    for c in courses:
        d = dmap.get(c["code"], {"units": []})
        print("%-10s %-34s %3s %3s %3s %3s %3s %5d %5d %5s %4d %4d %4d"
              % (c["code"], c["nameAr"], c["crh"], c["l"], c["p"], c["t"], c["cth"],
                 len(c["units"]), c["unitsSum"], c["declaredTotal"],
                 sum(len(u["theory"]) for u in d["units"]),
                 len(c.get("safetyRaw", "")), len(ss.get(c["code"], {"sections": ()})["sections"])))

    plan = {c["code"] for c in courses}
    spec_ss = {k: v for k, v in ss.items() if k.startswith(SPEC)}
    print("\nمقارنة مع SS01: مقررات %s في الخطة %d — في التقرير %d (%d شعبة)"
          % (SPEC, sum(1 for c in plan if c.startswith(SPEC)), len(spec_ss),
             sum(len(v["sections"]) for v in spec_ss.values())))
    for c in sorted(plan - set(ss)):
        print("  في الخطة ولا شعبة له: %s (%s)" % (c, fw[c]["nameAr"]))
    for c in sorted(set(ss) - plan):
        print("  له شعب ولا وجود له في الخطة: %s (%s)" % (c, ss[c]["nameAr"]))
    for c in sorted(plan & set(ss)):
        a, b = fw[c], ss[c]
        for k, lbl in (("crh", "المعتمدة"), ("l", "المحاضرة"), ("p", "العملي"),
                       ("t", "التمارين"), ("cth", "الاتصال")):
            if b[k] != "" and int(b[k]) != (a[k] if a[k] is not None else 0):
                print("  اختلاف ساعات %s في %s: الخطة %s ورايات %s"
                      % (lbl, c, a[k], b[k]))

    print("\nملاحظات (%d):" % len(problems))
    for p in problems:
        print("  - %s" % p)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
