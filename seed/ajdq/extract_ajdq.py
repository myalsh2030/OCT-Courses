# -*- coding: utf-8 -*-
"""استخراج خطة تخصص «تقنية الأجهزة والآلات الدقيقة» (رمز المقررات: اجدق).

المصدر: «الخطة التفصيلية لتخصص تقنية الأجهزة والآلات الدقيقة - دبلوم كليات -
نصفي.pdf» (المؤسسة العامة للتدريب التقني والمهني، ١٤٤٦هـ / 2024G، ٩٤ صفحة).

المخرجات (JSON بأشكال بيانات مشروع «ملف المدرب وتوصيف المقرر» نفسها):
  plan-courses.json  الرمز والاسم والساعات (معتمدة/محاضرة/عملي/تمرين/اتصال)
                     ووحدات المقرر بعناوينها وساعاتها.
  plan-detail.json   المنهج التفصيلي: مواضيع نظرية وعملية لكل وحدة.

جوهر جودة النص العربي هنا ثلاث معالجات على مستوى المحرف — راجع span_text:
  ١) مكوّنات الرباط (ligature) تُستخرج بعرض صفري وترتيب معكوس، فتُلحق بحاملها.
  ٢) ترتيب الرسم في المصدر مبعثر، فتُرتَّب العناقيد بصرياً يميناً ثم يساراً.
  ٣) خطّ المصدر يربط رباطَي «لمج» و«لمح» بمحرفَي المسافة والفاصلة (بعرض ٠٫٩٣
     من حجم الخط)، وهو عطب في cmap الخط يُصلَح بجدول إحلال.
منطق العناقيد مقتبس من planlib.py في مشروع «ملف المدرب وتوصيف المقرر».
"""
import csv
import io
import json
import os
import re
import sys

import fitz

PDF = ("M:/AI PROJECTS/ملف المدرب وتوصيف المقرر/خطط تخصصات الكلية/"
       "الخطة التفصيلية لتخصص تقنية الأجهزة والآلات الدقيقة - دبلوم كليات - نصفي.pdf")
SS01 = "M:/RAYAT_REPORTS/SS01_135_144710_2026-08-19_1716.csv"
OUT_DIR = "M:/AI PROJECTS/OCT-Courses/seed/ajdq"

AR_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")
WEEKS = 16                      # ساعات الوحدات = ساعات الاتصال × ١٦

# ---------------------------------------------------------------- محارف وخطوط
# خطّ المصدر يربط رموزاً مفقودة من cmap بمحرفَي المسافة والفاصلة، ويتميّز
# كلٌّ منها بنسبة عرضٍ ثابتة إلى حجم الخط. الجدول محقَّق من صور الصفحات.
GLYPH_FIX = ((" ", 0.5150, 0.5210, "ى"),      # مستوى، مدى، لدى، أخرى
             (" ", 0.6420, 0.6480, "ك"),      # مشترك، المتحرك، أسلاك
             (" ", 0.8285, 0.8295, "نج"),     # إنجاز، الإنجليزية
             (" ", 0.9250, 0.9290, "لمج"),    # المجال، المجهولة
             ("،", 0.9250, 0.9290, "لمح"))   # المحولات، المحركات
WIDE_SPACE = 0.45               # ما جاوزها وشارك حرفاً موضعَه فهو تطويل ضبط
KASHIDA = "ُـ"        # الدمّة صفرية العرض هنا هي محرف التطويل
MARKS = re.compile(r"[ً-ْٰ]")
ARABIC = re.compile(r"[؀-ۿ]")
SEMESTER = re.compile(r"([1-5])(st|nd|rd|th)\s*Semester")
LTR = re.compile(r"^[0-9A-Za-z]")


def _w(c):
    return c["bbox"][2] - c["bbox"][0]


def span_text(span):
    """نص السبان مُعاد البناء: رباطات مجموعة، ترتيب بصري، وإحلال الرباط المعطوب.

    يعيد (النص، أقصى x، أدنى x، أقصى حافة يمنى).
    """
    size = span.get("size") or 1.0
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
        chars.append(c)

    # (١) الرباط: مكوّناته صفرية العرض وتسبق حاملها بترتيب معكوس
    groups, pend = [], []
    for c in chars:
        if _w(c) < 0.01:
            pend.append(c)
            continue
        txt, ratio = c["c"], _w(c) / size
        for ch, lo, hi, rep in GLYPH_FIX:
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
    span = [g["x"] for g in groups if g["t"].strip()]
    if span:
        groups = [g for g in groups if g["t"].strip()
                  or min(span) - 25 <= g["x"] <= max(span) + 25]

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
                t = re.sub(r"[ 	‏‎]+", " ", t.translate(AR_DIGITS))
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
# ما عجزت إعادةُ البناء عنه: كلمات لصقها المصدر. الإصلاح لفظي بحت (مسافة
# مفقودة) لا يضيف معنى، وكل بند منه مذكور في REPORT.md.
REPAIRS = [
    ("الدوائرالمنطقية", "الدوائر المنطقية"),
    ("مراجعةاستعمال", "مراجعة استعمال"),
    ("الفولتميترالتناظري", "الفولتميتر التناظري"),
    ("ريا ض", "رياض"),
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
    # قوسان فارغان ورمزٌ لاتيني في الذيل: موضع الرمز بينهما
    m = re.search(r"\(\s*\)(.*?)\s+([0-9A-Za-z][0-9A-Za-z\-]*)$", t)
    if m:
        t = t[:m.start()] + "(" + m.group(3) + ")" + m.group(2)
    return re.sub(r"\s+", " ", t).strip()


def is_num(t):
    return bool(re.fullmatch(r"\d{1,3}", t.strip()))


BOILER = ("المؤسسة العامة للتدريب", "الإدارة العامة للمناهج", "التقنية الإلكترونية",
          "تقنية الأجهزة والآلات الدقيقة", "المنهج التفصيلي", "أدوات التقييم",
          "المحتوى", "الساعات", "الوحدات")


def is_boiler(t, y=0.0):
    if y > 795 or re.fullmatch(r"\d{1,2}\s*(94)?\s*من\s*(94)?", t):
        return True
    return any(t.startswith(b) for b in BOILER)


# --------------------------------------------------- (١) جدول الإطار المنهجي
# صفوف الفصول (ص٥–٦) تُقرأ بإحداثيات أعمدتها لا بترتيب نصّها: ترتيب الخلايا
# يختلف بين جدولَي الصفحتين، والأرقام وحدها ثابتة الموضع.
BANDS = (("cth", 470, 500), ("t", 442, 468), ("p", 410, 438),
         ("l", 380, 406), ("crh", 348, 378))
B_ROWNO, B_CODE, B_NAME = (765, 795), (700, 768), (490, 700)
B_EN_NAME, B_EN_CODE, B_COOP_CRH = (120, 295), (78, 118), (405, 440)
CODE_AR = re.compile(r"(\d{3})\s*([؀-ۿ]{3,4})|([؀-ۿ]{3,4})\s*(\d{3})")
TRAIL_PRE = re.compile(r"\s*(\d{3}\s*[؀-ۿ]{3,4}|[؀-ۿ]{3,4}\s*\d{3})\s*$")


def _band(items, lo, hi, nums_only=False):
    got = [i for i in items if lo <= i["x0"] < hi and (not nums_only or is_num(i["t"]))]
    return sorted(got, key=lambda i: -i["xr"])


def _code(items):
    txt = " ".join(i["t"] for i in _band(items, *B_CODE))
    m = CODE_AR.search(txt)
    if not m:
        return None, None
    num, word = (m.group(1), m.group(2)) if m.group(1) else (m.group(4), m.group(3))
    return "%s-%s" % (word, num), "%s %s" % (num, word)


def framework(pages):
    """الساعات الرسمية لكل مقرر من جدول توزيع الخطة على الفصول (ص٥–٦)."""
    sem, out = 0, []
    for p in (4, 5):
        for idx, ln in enumerate(pages[p]):
            m = SEMESTER.search(ln["text"])
            if m:
                sem = int(m.group(1)[0])
            it = ln["items"]
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
            if not name:        # جدول الفصل الخامس أضيق، فاسمه في عمود أيسر
                name = " ".join(i["t"] for i in _band(it, 330, B_NAME[1])
                                if ARABIC.search(i["t"]))
            prereq = []
            m = TRAIL_PRE.search(name)
            if m:
                prereq = [re.sub(r"(\d{3})\s*", r"\1 ", m.group(1)).strip()]
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
            if coop and sem == 5:               # التدريب التعاوني: و.م فقط
                rec.update({"crh": int(coop[0]["t"]), "l": None, "p": None,
                            "t": None, "cth": None, "coop": True})
                out.append(rec)
    return out


# ---------------------------------------------- (٢) أقسام الوصف التفصيلي
def section_starts(pages):
    starts = []
    for i, lines in enumerate(pages):
        head = re.sub(r"[\s:ـ]", "", " ".join(l["text"] for l in lines[:6]))
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
    """رمز المقرر من صدر القسم: «الرمز ### اجدق»."""
    head = " ".join(l["t"] for l in lines[:4])
    m = re.search(r"(\d{3})\s*(اجدق|الكت|اجطب)", head)
    if m:
        return "%s-%s" % (m.group(2), m.group(1))
    m = re.search(r"(اجدق|الكت|اجطب)\s*(\d{3})", head)
    return ("%s-%s" % (m.group(1), m.group(2))) if m else None


def head_prereq(lines):
    """المتطلبات السابقة من صدر القسم: «متطلب سابق ### رمز ، ### رمز»."""
    head = " ".join(l["t"] for l in merge_rows(lines)[:6])
    m = re.search(r"متطلب\s*سابق(.*?)(الفصل|الساعات|$)", head)
    if not m:
        return []
    out = []
    for a, b in re.findall(r"(\d{3})\s*([؀-ۿ]{3,4})", m.group(1)):
        code = "%s %s" % (a, b)
        if code not in out:
            out.append(code)
    return out


def head_hours(lines):
    """الساعات من صدر القسم: معتمدة/محاضرة/عملي/تمرين — قيمتها في عمود فصلها."""
    got, pending = {}, None
    for ln in lines[:14]:
        key = None
        for it in ln["items"]:
            t = it["t"]
            key = ("crh" if "الساعات المعتمدة" in t or t == "المعتمدة" else
                   "l" if t == "محاضرة" else "p" if t == "عملي" else
                   "t" if t == "تمرين" else None)
            if key:
                break
        if key:
            nums = [x for x in ln["items"] if is_num(x["t"])]
            if nums:
                got[key] = int(nums[-1]["t"])
                pending = None
            else:
                pending = key
        elif pending and len(ln["items"]) == 1 and is_num(ln["items"][0]["t"]):
            got[pending] = int(ln["items"][0]["t"])
            pending = None
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


# ------------------------------------------- (٣) المنهج التفصيلي: المواضيع
PRACTICAL = re.compile(r"تطبيق(ات)?\s*عملي|تدريب(ات)?\s*عملي|تمارين\s*عملي")
X_HOURS, X_LEVEL1 = 505, 470          # عمود الساعات يميناً، ورمز «•» دونه
X_CELL = (185, 512)                   # حافة خلية المحتوى اليمنى بين العمودين
BULLET = re.compile(r"^[\u2022\u25cf\u25aa]+$|^o$")


def _cells(row):
    """خلايا عمود المحتوى في الصف: رمز التعداد أولاً ثم نصوصه.

    قائمة «مراجع الموضوع» المرقّمة تقع في العمود نفسه، ويميّزها رقمٌ مجرّد
    في موضع رمز التعداد — فيُستبعد صفُّها كلُّه."""
    c = [i for i in row if X_CELL[0] <= i["x1"] < X_CELL[1]
         and "مراجع" not in i["t"] and i["t"] != "الموضوع"]
    if any(re.fullmatch(r"\d{1,2}", i["t"]) and 400 <= i["x0"] <= 480 for i in c):
        return [], []
    return [i for i in c if BULLET.match(i["t"])], [i for i in c if not BULLET.match(i["t"])]


def detail_rows(pages, a, b):
    """صفوف جدول المنهج التفصيلي.

    صفّ الجدول يتذبذب رأسياً بضع نقاط فتُجمع بنوده بتسامح ٣٫٥ نقطة. ويبقى
    رمز التعداد أحياناً في صفٍّ وحده، فيُردّ إلى سطر نصّه المجاور العاري منه.
    """
    raw = []
    for p in range(a, b):
        for ln in pages[p]:
            for it in ln["items"]:
                t = norm(it["t"])
                if not t or (is_boiler(t, ln["y"]) and "المنهج التفصيلي" not in t):
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


def parse_detail(rows, target):
    """يقسّم بنود المحتوى على الوحدات بحسب أرقام عمود الساعات.

    مستويان: «•» عنوان موضوع و«o» بند تحته، ويُستدل على المستوى برمز التعداد
    في الصف. صفٌّ بلا رمزٍ تكملةُ سطرٍ التفَّ عن سابقه فيُضمّ إليه. وما وقع
    تحت عنوان يبدأ بـ«تطبيقات عملية» يُعدّ عملياً وما عداه نظرياً.
    """
    started, units, cur = False, [], None
    level, prac_level, last = 1, None, None
    for row in rows:
        joined = " ".join(i["t"] for i in row)
        if not started:
            started = "المنهج التفصيلي" in joined
            continue
        if any(i["t"] == "المراجع" and i["x"] > X_HOURS for i in row):
            break                            # كتلة مراجع المقرر في آخر القسم
        if "المنهج التفصيلي" in joined:
            continue                         # ترويسة الجدول تتكرر كل صفحة
        hours = [i for i in row if i["x"] >= X_HOURS and is_num(i["t"])]
        marks, texts = _cells(row)
        v = title(join_items(texts, "raw"))
        if len(v) < 2 or not ARABIC.search(v) or v.startswith("الموضوع"):
            v = ""
        if hours:
            if sum(u["hours"] for u in units) >= target:
                break         # بلغنا مجموع الخطة الرسمي فما بعده ليس من المقرر
            cur = {"hours": int(hours[-1]["t"]), "title": v,
                   "theory": [], "practical": []}
            units.append(cur)
            prac_level, level, last = None, 1, ("title", 0)
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
        if marks:
            level = 1 if max(i["x"] for i in marks) > X_LEVEL1 else 2
        if prac_level is not None and level <= prac_level:
            prac_level = None
        if PRACTICAL.search(v):
            prac_level = level
        key = "practical" if prac_level is not None else "theory"
        cur[key].append(v)
        last = (key, len(cur[key]) - 1)
    return units


# ------------------------------------------------------------------ التقرير
def ss01_courses():
    if not os.path.exists(SS01):
        return {}
    out = {}
    for r in csv.DictReader(io.open(SS01, encoding="utf-8-sig")):
        code = r["المقرر"].strip()
        if not code.startswith("اجدق"):
            continue
        d = out.setdefault(code, {
            "nameAr": r["اسم المقرر"].strip(), "sections": set(),
            "crh": r["الساعات المعتمدة"], "l": r["ساعات المحاضرة"],
            "p": r["ساعات المختبر"], "t": r["ساعات أخرى"], "cth": r["ساعات الاتصال"]})
        d["sections"].add(r["الرقم المرجعي"])
    return out


def main():
    doc = fitz.open(PDF)
    pages = [page_lines(doc[i]) for i in range(doc.page_count)]
    fw = {c["code"]: c for c in framework(pages)}
    starts = section_starts(pages)
    bounds = list(zip(starts, starts[1:] + [starts[-1] + 5]))

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
                    "declaredTotal": declared, "expectedUnitsSum": cth * WEEKS})
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
        courses.append(rec)

        du = parse_detail(detail_rows(pages, a, b), cth * WEEKS)
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
            matched.append({"title": name, "hours": u["hours"], "officialSpan": span,
                            "theory": u["theory"], "practical": u["practical"]})
        ok = ok and oi == len(units)
        details.append({"code": code, "nameAr": meta["nameAr"], "cth": cth,
                        "verified": ok, "officialUnits": len(units), "units": matched})
        if not ok:
            problems.append("%s: كتل المنهج التفصيلي لا تنطبق على جدول الوحدات" % code)

    # مقررا «مشروع» و«التدريب التعاوني» في الإطار المنهجي بلا صفحة وصف تفصيلي
    done = {c["code"] for c in courses}
    for code, meta in sorted(fw.items()):
        if not code.startswith("اجدق") or code in done:
            continue
        rec = dict(meta)
        rec.update({"pageStart": None, "pageEnd": None, "units": [], "unitsSum": 0,
                    "declaredTotal": None,
                    "expectedUnitsSum": (meta["cth"] * WEEKS) if meta["cth"] else None,
                    "note": "لا صفحةَ وصفٍ تفصيلي لهذا المقرر في الخطة"})
        courses.append(rec)
        problems.append("%s: في جدول الإطار المنهجي ولا وصف تفصيلي له في الخطة" % code)

    os.makedirs(OUT_DIR, exist_ok=True)
    src = os.path.basename(PDF)
    io.open(os.path.join(OUT_DIR, "plan-courses.json"), "w", encoding="utf-8").write(
        json.dumps({"source": src + " — جدول الإطار المنهجي (ص٥–٧) وصفحات الوصف التفصيلي",
                    "specialty": "تقنية الأجهزة والآلات الدقيقة",
                    "department": "التقنية الإلكترونية", "weeksPerSemester": WEEKS,
                    "note": "مستخرج آلياً؛ الثابت المفروض: مجموع ساعات الوحدات = س.أ × ١٦",
                    "courses": courses}, ensure_ascii=False, indent=1))
    io.open(os.path.join(OUT_DIR, "plan-detail.json"), "w", encoding="utf-8").write(
        json.dumps({"source": src + " — المنهج التفصيلي (النظري والعملي)",
                    "note": "استخراج أمين بلا تحرير؛ «•» موضوع و«o» بند تحته، "
                            "والعملي ما وقع تحت عنوان «تطبيقات عملية»",
                    "courses": details}, ensure_ascii=False, indent=1))

    # -------- تقرير الشاشة
    print("مقررات جدول الإطار المنهجي: %d — منها اجدق: %d"
          % (len(fw), sum(1 for c in fw if c.startswith("اجدق"))))
    print("مقررات اجدق المكتوبة: %d (منها %d بوصف تفصيلي)\n"
          % (len(courses), len(details)))
    dmap = {d["code"]: d for d in details}
    print("%-10s %-36s %3s %3s %3s %3s %3s %5s %5s %4s %4s %4s"
          % ("code", "name", "crh", "L", "P", "T", "cth", "unit", "sum", "th", "pr", "sec"))
    ss = ss01_courses()
    for c in courses:
        d = dmap.get(c["code"], {"units": []})
        print("%-10s %-36s %3s %3s %3s %3s %3s %5d %5d %4d %4d %4d"
              % (c["code"], c["nameAr"], c["crh"], c["l"], c["p"], c["t"], c["cth"],
                 len(c["units"]), c["unitsSum"],
                 sum(len(u["theory"]) for u in d["units"]),
                 sum(len(u["practical"]) for u in d["units"]),
                 len(ss.get(c["code"], {"sections": ()})["sections"])))

    plan = {c for c in fw if c.startswith("اجدق")}
    print("\nمقارنة مع SS01: مقررات اجدق في الخطة %d — في التقرير %d"
          % (len(plan), len(ss)))
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
