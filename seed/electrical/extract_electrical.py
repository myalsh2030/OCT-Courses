# -*- coding: utf-8 -*-
"""استخراج خطتَي قسم التقنية الكهربائية معاً: القوى الكهربائية والآلات الكهربائية.

المصدران (المؤسسة العامة للتدريب التقني والمهني، ١٤٤٦هـ / 2024G):
  «الخطة التفصيلية لتخصص تقنية القوى الكهربائية - دبلوم كليات - نصفي.pdf» (١٤٨ ص)
  «الخطة التفصيلية لتخصص تقنية الآلات الكهربائية - دبلوم كليات - نصفي.pdf» (١٢٤ ص)

المخرجات (بأشكال بيانات مشروع «ملف المدرب وتوصيف المقرر» نفسها):
  plan-courses.json  الرمز والاسم والساعات ووحدات المقرر ونصّ السلامة كما ورد.
  plan-detail.json   المنهج التفصيلي: مواضيع كل وحدة ومستوياتها وأدوات تقييمها.
  conflicts.json     مقررات `كهرب` الواردة في الخطتين واختلافُها بينهما حقلاً حقلاً.

ما يميّز هذا الاستخراج عن سابقيه:

  ١) **إصلاح الخطّ من برنامج الخطّ نفسه لا بنسب العرض.** خطّ خطة القوى معطوب
     الـToUnicode: يرسم حرفاً ويُخبر القارئ بحرفٍ آخر أو بمسافة («كهرب» ← «كهر»،
     «لغة» ← «ل،ة»، «التعاوني» ← «التعاوقي»). يُستخرج ملفّ الخطّ المضمَّن ويُقرأ
     جدول `post` فيه — وأسماء رسومه `uniXXXX` تُعرّف حرفَ كلّ رسم يقيناً — ثم
     يُقارَن بما يعطيه ToUnicode فيُصلَح موضعُ الاختلاف. راجع `font_gid_text`.
     والرسوم التي لا يسمّيها الخطّ (`glyphNNNNN`) تقع بين رسوم حرفها في ترتيب
     الخطّ فتُنسب إليه، وما بقي منها مجهولاً حُقّق بصرياً وأُثبت في `MANUAL`.

  ٢) **حدود أعمدة جدول المنهج التفصيلي تُقاس من خطوط الجدول المرسومة في كل صفحة**
     (`page.get_drawings`) لا بثوابت — فموضع العمود يزيح بين صفحةٍ وأخرى في هذه
     الخطط بضع عشرات من النقاط، وثوابتُ خطةٍ أخرى لا تنتقل إليها. راجع `col_at`.

  ٣) **`كهرب` مشترك بين الخطتين**، فتُستخرج كل خطة على حدة ثم يُقارن كل مقرر ورد
     فيهما حقلاً حقلاً. المتطابق سجلٌّ واحد بـ`inPlans` باسمَي الخطتين، والمختلف
     يخرج طرفاه في `conflicts.json` بلا ترجيح، ويبقى في المخرَج سجلُّ خطة القوى
     مع `conflict: true` — والفصل بين اختلافٍ مقصود وخطأِ استخراج قرارُ المالك.

منطق العناقيد وإعادة البناء البصري مقتبس من `planlib.py` ومن `extract_ajdq.py`
و`extract_vehicles.py` في المشروع نفسه.
"""
import csv
import io
import json
import os
import re
import sys
import unicodedata
from io import BytesIO

import fitz
from fontTools.ttLib import TTFont

SRC = "M:/AI PROJECTS/ملف المدرب وتوصيف المقرر/خطط تخصصات الكلية/"
SS01 = "M:/RAYAT_REPORTS/SS01_135_144710_2026-08-19_1716.csv"
OUT_DIR = "M:/AI PROJECTS/OCT-Courses/seed/electrical"

WEEKS = 16                      # ساعات الوحدات = ساعات الاتصال × ١٦
DEPARTMENT = "التقنية الكهربائية"

# رمز «كهرا» في خطة الآلات يكتبه المصدر بألفٍ عارية، وتقيّده رايات «كهرآ» بمدّة.
# يُعتمد رسمُ رايات في مفتاح الربط ويُحفظ رسمُ الخطة في codeArPlan.
CODE_ALIAS = {"كهرا": "كهرآ"}

PLANS = (
    {"key": "qwa",
     "pdf": SRC + "الخطة التفصيلية لتخصص تقنية القوى الكهربائية - دبلوم كليات - نصفي.pdf",
     "specialty": "تقنية القوى الكهربائية",
     "own": ("كهرب", "كهرق"), "extra": ("رياد-226",),
     "fwPages": (5, 6), "detailFirst": 12},
    {"key": "alat",
     "pdf": SRC + "الخطة التفصيلية لتخصص تقنية الآلات الكهربائية - دبلوم كليات - نصفي.pdf",
     "specialty": "تقنية الآلات الكهربائية",
     "own": ("كهرب", "كهرآ"), "extra": ("رياد-226",),
     "fwPages": (5, 6), "detailFirst": 13},
)

AR_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")
KASHIDA = "ُـ"                 # الدمّة صفرية العرض هنا هي علامة التطويل
MARKS = re.compile(r"[\u064b-\u0652\u0670]")
ARABIC = re.compile(r"[\u0600-\u06ff]")
LTR = re.compile(r"^[0-9A-Za-z]")
CODE_WORD = "|".join(("كهرب", "كهرق", "كهرآ", "كهرا", "رياد", "انجل", "حاسب",
                      "فيزي", "رياض", "عربي", "اسلم", "اسلا", "اسلك"))


# ═══════════════════════════════ (١) خريطة رسوم الخطّ ═══════════════════════
UNI = re.compile(r"^uni((?:[0-9A-Fa-f]{4})+)$")

# رسوم لا يسمّيها الخطّ ويعطيها ToUnicode مسافةً — محقَّقة بصرياً من صور الصفحات
MANUAL = {("SakkalMajalla", 1645): "\u0628",   # بـ : «بهدف التحكم»، «بها مثل»
          ("SakkalMajalla", 1672): "\u0647",   # ـهـ: «التي تهم»، «لكونها»، «يهدف»
          ("SakkalMajalla", 1756): ""}         # تطويل ضبطِ السطر: «أسـاسي»


def _base(s):
    """الشكل الأساسي: تفكيك أشكال العرض، وإسقاط التطويل، وتوحيد الرسم الفارسي."""
    s = unicodedata.normalize("NFKC", s).replace("\u0640", "")
    return (s.replace("\u06be", "\u0647").replace("\u06cc", "\u064a")
             .replace("\u06a9", "\u0643"))


def font_gid_text(buf):
    """{رقم الرسم: الحرف} من برنامج الخطّ: أسماء `post` أولاً ثم cmap، ثم
    تُنسب الرسوم غير المسمّاة إلى حرف جارَيها المسمّيَين إن اتّفقا عليه."""
    f = TTFont(BytesIO(buf), fontNumber=0, lazy=True)
    order = f.getGlyphOrder()
    named = {}
    for i, gname in enumerate(order):
        m = UNI.match(gname)
        if m:
            h = m.group(1)
            named[i] = _base("".join(chr(int(h[j:j + 4], 16))
                                     for j in range(0, len(h), 4)))
    try:
        for u, gname in f.getBestCmap().items():
            if gname in order:
                named.setdefault(order.index(gname), _base(chr(u)))
    except Exception:
        pass
    out, keys = dict(named), sorted(named)
    for a, b in zip(keys, keys[1:]):
        if b - a < 2 or named[a] != named[b] or len(named[a]) != 1:
            continue
        if not ("\u0600" <= named[a] <= "\u06ff"):
            continue
        for g in range(a + 1, b):
            out.setdefault(g, named[a])
    return out


def doc_gid_text(doc):
    """{اسم الخطّ: {gid: الحرف}}؛ ومجموعات الخطّ الواحد تشترك في ترتيب الرسوم."""
    res, seen = {}, set()
    for i in range(doc.page_count):
        for xref, _name, _ftype, base, *_rest in doc[i].get_fonts(full=True):
            if xref in seen:
                continue
            seen.add(xref)
            try:
                _nm, ext, _sub, buf = doc.extract_font(xref)
            except Exception:
                continue
            if not buf or ext not in ("ttf", "otf", "cff"):
                continue
            try:
                res.setdefault(base.split("+")[-1], {}).update(font_gid_text(buf))
            except Exception:
                continue
    return res


def _w(c):
    return c["bbox"][2] - c["bbox"][0]


def kashida_x(pg):
    """نقاط بداية علامات التطويل صفرية العرض — المسافة التي تعلوها تطويلٌ يُسقط."""
    out = set()
    for blk in pg.get_text("rawdict")["blocks"]:
        for ln in blk.get("lines", []):
            for sp in ln["spans"]:
                for c in sp["chars"]:
                    if c["c"] in KASHIDA and _w(c) < 0.01:
                        out.add(round(c["bbox"][0], 2))
    return out


def glyph_fix(pg, gm):
    """{x: [(y, النص الصحيح)]} لكل رسمٍ يخالف فيه ToUnicode برنامجَ الخطّ.

    محارف الاستكمال (gid = -1) تُضمّ إلى رسمها قبل المقارنة، وإلا حُسب الرباط
    ناقصاً. وخطُّ الأساس يختلف بين texttrace وrawdict بأجزاء النقطة فيُطابق
    الموضع بتسامح رأسي عند الاستعمال.
    """
    out = {}
    for sp in pg.get_texttrace():
        tbl = gm.get(sp["font"])
        if not tbl:
            continue
        seq = []
        for c in sp["chars"]:
            if c[1] == -1 and seq:
                seq[-1][1] += chr(c[0]) if c[0] > 0 else ""
            else:
                seq.append([c[1], chr(c[0]) if c[0] > 0 else "",
                            (round(c[2][0], 1), c[2][1])])
        for g, got, xy in seq:
            man = MANUAL.get((sp["font"], g))
            if man is not None:
                out.setdefault(xy[0], []).append((xy[1], man))
                continue
            true = tbl.get(g)
            if true is None or _base(true) == _base(got):
                continue
            if any("\ue000" <= ch <= "\uf8ff" for ch in true):
                continue                       # خطٌّ يرمّز بالمنطقة الخاصة
            if true.isdigit():
                continue                       # رقم هندي مقابل عربي: سيّان
            if not (ARABIC.search(true) or ARABIC.search(got) or true == ""):
                continue
            out.setdefault(xy[0], []).append((xy[1], true))
    return out


# ═══════════════════════════ (٢) إعادة بناء نصّ الصفحة ══════════════════════
def span_text(span, drop_x=(), fix=None):
    """نص السبان مُعاد البناء: رباطات مجموعة، ترتيب بصري، وإصلاح رسوم الخطّ.

    يعيد (النص، أقصى x، أدنى x، أقصى حافة يمنى).
    """
    fix = fix or {}
    chars, marks = [], []
    for c in span["chars"]:
        if c["c"] in KASHIDA and _w(c) < 0.01:
            continue                                   # تطويل لا حركة
        if MARKS.match(c["c"]) and _w(c) < 0.01:
            marks.append(c)
            continue
        if c["c"] == " " and round(c["bbox"][0], 2) in drop_x:
            continue
        chars.append(c)

    # الرباط: مكوّناته صفرية العرض وتسبق حاملها بترتيب معكوس
    groups, pend = [], []
    for c in chars:
        if _w(c) < 0.01:
            pend.append(c)
            continue
        rep = None
        for y0, t in fix.get(round(c["origin"][0], 1), ()):
            if abs(y0 - c["origin"][1]) <= 1.5:   # خطُّ الأساس يختلف قليلاً
                rep = t                            # بين texttrace وrawdict
                break
        txt = rep if rep is not None else (
            c["c"] + "".join(p["c"] for p in reversed(pend)))
        groups.append({"t": txt, "x": c["bbox"][0], "x1": c["bbox"][2]})
        pend = []
    if pend and groups:
        groups[-1]["t"] += "".join(p["c"] for p in reversed(pend))
    if not groups:
        return "", 0.0, 0.0, 0.0

    # مسافةٌ خارج مدى حروف السبان بمراحل موضعُها مغلوط، ووصلُ الخلايا يعتمد
    # على المسافات الطرفية — فتُسقَط كي لا تشطر كلمةً موصولة.
    xs = [g["x"] for g in groups if g["t"].strip()]
    if xs:
        groups = [g for g in groups if g["t"].strip()
                  or min(xs) - 25 <= g["x"] <= max(xs) + 25]

    # الحركة الحقيقية تشترك مع حرفها في نقطة البداية؛ ما عداها زخرف تنسيق
    for m in marks:
        for g in groups:
            if abs(g["x"] - m["bbox"][0]) < 0.01:
                g["t"] += m["c"]
                break

    # الترتيب البصري: العربية يميناً ثم يساراً، ثم تُعاد مقاطع الأرقام والحروف
    # اللاتينية إلى اتجاهها (ثنائية الاتجاه داخل السبان الواحد)
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
    bx = [g["x"] for g in body]
    return ("".join(g["t"] for g in groups), max(bx), min(bx),
            max(g["x1"] for g in body))


NONCONNECT = "اأإآدذرزوةىءئ"    # لا تتصل بما بعدها فالفجوة بعدها فجوةُ كلمة


def _glued(buf, a, b, key):
    """أيَشتركان في كلمة واحدة؟ مسافةُ المصدر أولاً، ثم قرائن الخط العربي."""
    if buf.endswith(" ") or b[key].startswith(" "):
        return True                       # المصدر فصلهما بمسافته الخاصة
    gap, nxt = a["x0"] - b["x1"], b[key].lstrip()
    if gap <= 1.5:
        return True                       # متلاصقان: «التعاقب» + «ية»
    core = re.sub(r"[^\u0600-\u06ff]", "", nxt)
    if nxt[:1] in "ةى" or (len(core) == 1 and core != "و"):
        return True                       # حرفٌ لا يقوم كلمةً بذاته
    prev = buf.rstrip()[-1:]
    # ضبطُ السطر بالتطويل يوسّع الوصلات داخل الكلمة فتنشأ فجوة بلا مسافة
    return (gap < 8 and bool(prev) and prev not in NONCONNECT
            and nxt[:1] not in "اأإآو" and bool(ARABIC.match(nxt[:1] or "")))


def join_items(items, key="t"):
    """يصل بنود الصف: المصدر يقطع الكلمة الواحدة سبانين، ويضع كلمتين متجاورتين
    في سبانين بلا مسافة بينهما — فيُحكَم بينهما بقرائن `_glued`."""
    if not items:
        return ""
    buf = items[0][key]
    for a, b in zip(items, items[1:]):
        buf += ("" if _glued(buf, a, b, key) else " ") + b[key]
    return buf


def page_lines(pg, drop_x, fix):
    """يجمع سبانات الصفحة في أسطر بحسب y ويرتبها يميناً ثم يساراً."""
    items = []
    for blk in pg.get_text("rawdict")["blocks"]:
        for ln in blk.get("lines", []):
            for sp in ln["spans"]:
                t, xr, x0, x1 = span_text(sp, drop_x, fix)
                t = re.sub(r"[ \t\u200f\u200e]+", " ", t.translate(AR_DIGITS))
                if t.strip():
                    items.append({"t": t, "x0": x0, "x1": x1, "xr": xr,
                                  "y": round(sp["bbox"][1], 1)})
    rows = {}
    for s in items:
        rows.setdefault(round(s["y"] / 3), []).append(s)
    lines = []
    for key in sorted(rows):
        its = sorted(rows[key], key=lambda s: -s["xr"])
        lines.append({"y": its[0]["y"], "items": its,
                      "text": re.sub(r"\s+", " ", join_items(its)).strip()})
    return lines


# ═══════════════════════ (٣) حدود أعمدة الجدول من خطوطه ════════════════════
def vert_segs(pg):
    """القطع الرأسية المرسومة في الصفحة: (x, y0, y1) — هي حدود أعمدة الجداول."""
    out = []
    for dr in pg.get_drawings():
        for it in dr["items"]:
            if it[0] == "l":
                a, b = it[1], it[2]
                if abs(a.x - b.x) < 1.0 and abs(a.y - b.y) > 8:
                    out.append((round((a.x + b.x) / 2, 1),
                                min(a.y, b.y), max(a.y, b.y)))
            elif it[0] == "re":
                r = it[1]
                if r.width < 2.0 and r.height > 8:
                    out.append((round((r.x0 + r.x1) / 2, 1), r.y0, r.y1))
    return out


def hrules(pg):
    """مواضع y للخطوط الأفقية العريضة — وهي فواصل صفوف الجداول."""
    out = set()
    for dr in pg.get_drawings():
        for it in dr["items"]:
            if it[0] == "l":
                a, b = it[1], it[2]
                if abs(a.y - b.y) < 1.0 and abs(a.x - b.x) > 30:
                    out.add(round((a.y + b.y) / 2, 1))
            elif it[0] == "re":
                r = it[1]
                if r.height < 2.0 and r.width > 30:
                    out.add(round((r.y0 + r.y1) / 2, 1))
    return sorted(out)


def row_band(rules, y):
    """رقم صفّ الجدول الذي يقع فيه الارتفاع y — لضمّ سطور الخلية الواحدة.

    ساعاتُ الوحدة تُرسم في وسط خليتها رأسياً، فتقع بين سطرَي عنوانٍ ملتفّ؛
    ولا يجمعها بهما تقاربُ y بل حدودُ صفّ الجدول المرسومة.
    """
    n = 0
    for r in rules:
        if y > r + 1.0:
            n += 1
        else:
            break
    return n


def col_at(segs, y):
    """(حدّ عمود أدوات التقييم، حدّ عمود الساعات) عند الارتفاع y، أو None.

    جدول المنهج التفصيلي ثلاثة أعمدة: الساعات يميناً ثم المحتوى ثم أدوات
    التقييم يساراً. وموضع حدَّيهما يزيح بين الصفحات فيُقرأ من خطوط كل صفحة.
    """
    xs = sorted({x for x, y0, y1 in segs if y0 - 2 <= y <= y1 + 2})
    keep = []
    for x in xs:
        if not keep or x - keep[-1] > 3:
            keep.append(x)
    if len(keep) < 2:
        return None
    right = keep[-1]
    hours = max([x for x in keep if x < right - 25], default=None)
    if hours is None or right - hours > 80:
        return None
    tools = min([x for x in keep if 150 < x < 260], default=None)
    return tools, hours


# ══════════════════════════════ (٤) تنظيف نصّي ══════════════════════════════
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
    t = re.sub(r"^[o\u2022\u25cf\u25aa\u25e6\-\u2013]+", " ", t)
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
          "الإدارة العامة للمناهج", "التقنية الكهربائية", "القسم التخصص",
          "تقنية القوى الكهربائية", "تقنية الآلات الكهربائية")


def is_boiler(t, y=0.0, pages=0):
    if y > 795 or re.fullmatch(r"\d{1,3}\s*(%d)?\s*من\s*(%d)?" % (pages, pages), t):
        return True
    return any(t.startswith(b) for b in BOILER)


def canon(word):
    return CODE_ALIAS.get(word, word)


# ═════════════════════════ (٥) جدول الإطار المنهجي ═════════════════════════
# صفوف الفصول (ص٦–٧، صفحتان عرضيّتان) تُقرأ بإحداثيات أعمدتها لا بترتيب نصّها.
# خلية الاسم وخلية المتطلب يقطعهما المصدر أحياناً في سبانٍ واحد، فيُفصل بينهما
# بالحافة اليمنى (x1) لا بنقطة البداية، ثم يُنزع رمزُ المتطلب من ذيل الاسم.
B_ROWNO, B_CODE = (762, 795), (712, 762)
B_NAME, B_PREREQ = (546, 712), (500, 546)
B_EN_NAME, B_EN_CODE = (140, 300), (78, 138)
BANDS = (("crh", 352, 375), ("l", 383, 406), ("p", 414, 437),
         ("t", 445, 468), ("cth", 476, 500))
B_COOP_CRH = (410, 445)                 # الفصل الخامس: جدول أضيق، و.م وحدها
CODE_AR = re.compile(r"(\d{3})\s*(%s)|(%s)\s*(\d{3})" % (CODE_WORD, CODE_WORD))
TRAIL_PRE = re.compile(r"\s*(%s)\s*$" % CODE_WORD)


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
    return "%s-%s" % (canon(word), num), "%s %s" % (num, word)


def framework(pages, fw_pages):
    """الساعات الرسمية لكل مقرر من جدول توزيع الخطة على الفصول.

    رقمُ الفصل يُعدّ بصفوف «المجموع» الفاصلة بين جداول الفصول، لا برمز
    «1st Semester» — فموضعُ الرمز في وسط جدوله لا في صدره.
    """
    done, out = 0, []
    for p in fw_pages:
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
            prereq = []
            pre_txt = join_items(_band(it, *B_PREREQ, by="x1"))
            for g in CODE_AR.finditer(pre_txt):
                num, word = ((g.group(1), g.group(2)) if g.group(1)
                             else (g.group(4), g.group(3)))
                prereq.append("%s %s" % (num, canon(word)))
            if not prereq:
                # رمز المتطلب: كلمتُه ملتصقة بذيل الاسم ورقمُه في عمود المتطلب
                m = TRAIL_PRE.search(name)
                nums = _band(it, *B_PREREQ, nums_only=True, by="x1")
                if m and nums:
                    prereq = ["%s %s" % (n["t"].strip(), canon(m.group(1)))
                              for n in nums]
                    name = name[:m.start()]
            rec = {"code": code, "codeAr": code_ar,
                   "codeArPlan": code_ar, "codeEn": en_code.strip(),
                   "semester": sem, "nameAr": title(name),
                   "nameEn": re.sub(r"\s+", " ", en_name).strip(),
                   "prereqAr": prereq}
            hours = {k: _band(it, lo, hi, nums_only=True) for k, lo, hi in BANDS}
            if all(hours.values()):
                for k, _lo, _hi in BANDS:
                    rec[k] = int(hours[k][0]["t"])
                out.append(rec)
                continue
            coop = _band(it, *B_COOP_CRH, nums_only=True)
            if coop:                            # التدريب التعاوني: و.م وحدها
                rec.update({"crh": int(coop[0]["t"]), "l": None, "p": None,
                            "t": None, "cth": None, "coop": True})
                out.append(rec)
    return out


# ════════════════════════ (٦) أقسام الوصف التفصيلي ═════════════════════════
def section_starts(pages, first):
    starts = []
    for i, lines in enumerate(pages):
        if i < first:
            continue
        head = re.sub(r"[\s:ـ]", "", " ".join(l["text"] for l in lines[:8]))
        if "اسمالمقرر" in head and "لرمز" in head and "متطلبسابق" in head:
            starts.append(i)
    return starts


def section_lines(pages, a, b):
    out = []
    for p in range(a, b):
        rules = hrules(pages[p]["page"])
        for ln in pages[p]["lines"]:
            out.append({"p": p, "y": ln["y"], "t": norm(ln["text"]),
                        "band": row_band(rules, ln["y"] + 5),
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
    """رمز المقرر من صدر القسم: «الرمز ### كهرب»."""
    head = " ".join(l["t"] for l in merge_rows(lines)[:6])
    m = re.search(r"لرمز\s*(\d{3})\s*(%s)" % CODE_WORD, head)
    if m:
        return "%s-%s" % (canon(m.group(2)), m.group(1))
    m = re.search(r"لرمز\s*(%s)\s*(\d{3})" % CODE_WORD, head)
    return ("%s-%s" % (canon(m.group(1)), m.group(2))) if m else None


def head_name(lines):
    """اسم المقرر كما في صدر صفحة الوصف التفصيلي (بين «اسم المقرر» و«الرمز»)."""
    head = " ".join(l["t"] for l in merge_rows(lines)[:4])
    m = re.search(r"اسم\s*المقر\s*ر?\s*(.*?)\s*ا?لرمز", head)
    return title(m.group(1)) if m else ""


def head_prereq(lines):
    """المتطلبات السابقة من صدر القسم: «متطلب سابق ### رمز ، ### رمز»."""
    head = " ".join(l["t"] for l in merge_rows(lines)[:6])
    m = re.search(r"متطلب\s*سابق(.*?)(الفصل|الساعات|$)", head)
    if not m:
        return []
    out = []
    for a, b in re.findall(r"(\d{3})\s*(%s)" % CODE_WORD, m.group(1)):
        code = "%s %s" % (a, canon(b))
        if code not in out:
            out.append(code)
    return out


HEAD_LABEL = (("crh", "الساعات المعتمدة"), ("l", "محاضرة"), ("p", "عملي"),
              ("t", "تمرين"))
# عمود «الفصل التدريبي» في صدر القسم: موضع الرقم يدلّ على الفصل
SEM_COL = ((390, 1), (327, 2), (263, 3), (199, 4), (136, 5), (72, 6))


def head_hours(lines):
    """الساعات من صدر القسم؛ وقيمتُها ترد في عمود الفصل الذي به المقرر، فموضعها
    الأفقي شاهدٌ ثانٍ على رقم الفصل."""
    got, xs = {}, []
    for ln in merge_rows(lines)[:16]:
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


def sem_of_x(x):
    for x0, s in SEM_COL:
        if abs(x - x0) < 5:
            return s
    return None


# ═════════════════════════════ (٧) جدول الوحدات ════════════════════════════
UNIT_HOURS_X = 200          # عمود «ساعات التدريب» في أقصى يسار جدول الوحدات


def parse_units(lines, pages_n):
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
        if not t or is_boiler(t, ln["y"], pages_n):
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
                 and re.search(r"[0-9A-Za-z\u0600-\u06ff]", x["t"])]
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


# ═══════════════════════ (٨) إجراءات واشتراطات السلامة ═════════════════════
SAFETY_HEAD = re.compile(r"إجراءات\s*و\s*اشتراطات\s*السلامة")
SAFETY_END = re.compile(r"المنهج\s*التفصيلي")


def parse_safety(lines, pages_n):
    """نصّ «إجراءات واشتراطات السلامة» كما ورد في الخطة، بندًا بندًا وبلا تحسين."""
    out, on, pend = [], False, None
    for ln in merge_rows(lines):
        t = ln["t"]
        if not t or is_boiler(t, ln["y"], pages_n):
            continue
        if SAFETY_HEAD.search(t):
            on = True
            continue
        if not on:
            continue
        if SAFETY_END.search(t) or t.startswith("الوحدات"):
            break
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


# ═══════════════════ (٩) المنهج التفصيلي: المواضيع والمستويات ═══════════════
BULLET = re.compile(r"^[\u2022\u25cf\u25aa\u25e6]+$|^o$", re.I)
LVL2 = re.compile(r"^o$", re.I)
REF_LABEL = ("مراجع", "الموضوع", "مراجع الموضوع", "المراجع", "المحتوى",
             "المحتو ى", "الساعات")
TOOL_SKIP = ("أدوات التقييم", "التخصص", "الإدارة العامة", "القسم")
DETAIL_HEAD = re.compile(r"^المنهج\s*التفصيلي")
PRACTICAL_HEAD = re.compile(r"تطبيقات\s*عملية|تدريبات\s*عملية|تمارين\s*عملية")


def detail_rows(pages, a, b, pages_n):
    """صفوف جدول المنهج التفصيلي، وحدودُ أعمدة كلّ صفٍّ من خطوط صفحته."""
    raw = []
    for p in range(a, b):
        segs = vert_segs(pages[p]["page"])
        for ln in pages[p]["lines"]:
            if ln["y"] < 60:            # شريط ترويسة الصفحة فوق إطار الجدول
                continue
            cols = col_at(segs, ln["y"] + 6)
            for it in ln["items"]:
                t = norm(it["t"])
                if not t or is_boiler(t, ln["y"], pages_n):
                    continue
                raw.append({"p": p, "y": ln["y"], "x": it["x0"], "x0": it["x0"],
                            "x1": it["x1"], "xr": it["xr"], "t": t,
                            "cols": cols, "raw": norm(it["t"], True)})
    raw.sort(key=lambda i: (i["p"], i["y"], -i["xr"]))
    rows = []
    for it in raw:
        if rows and it["p"] == rows[-1][0]["p"] and it["y"] - rows[-1][0]["y"] <= 3.5:
            rows[-1].append(it)
        else:
            rows.append([it])
    return [sorted(r, key=lambda i: -i["xr"]) for r in rows]


def _cols(row, fallback):
    for i in row:
        if i["cols"]:
            return i["cols"]
    return fallback


def _cells(row, cols):
    """(رموز التعداد، نصوص المحتوى، الساعات، أدوات التقييم) في صفٍّ واحد."""
    tools_x, hours_x = cols
    tools_x = tools_x if tools_x else 200.0
    hours = [i for i in row if i["x0"] >= hours_x and is_num(i["t"])]
    tools = [i for i in row if i["x1"] < tools_x]
    mid = [i for i in row if tools_x <= i["x1"] and i["x0"] < hours_x
           and i["t"].strip() not in REF_LABEL]
    marks = [i for i in mid if BULLET.match(i["t"].strip())]
    texts = [i for i in mid if i not in marks and ARABIC.search(i["t"])]
    return marks, texts, hours, tools


def parse_detail(rows):
    """كتل المنهج التفصيلي: لكل كتلة ساعاتُها وعنوانها وبنودها ومستوياتها.

    مستويان يميّزهما رمز التعداد نفسه: «•» عنوان موضوع و«o» بندٌ تحته. وصفٌّ
    بلا رمزٍ تكملةُ سطرٍ التفَّ عن سابقه فيُضمّ إليه. وأدوات التقييم خانةٌ يسرى
    تخصّ الكتلة كلَّها، ووجودُ «الأداء العملي» فيها دليلُ شقٍّ عملي.
    """
    started, blocks, cur, last = False, [], None, None
    fallback = (200.0, 510.0)
    for row in rows:
        cols = _cols(row, fallback)
        if cols[1]:
            fallback = (cols[0] or fallback[0], cols[1])
        joined = norm(join_items(row, "raw"))
        if DETAIL_HEAD.match(joined):
            started = True
            continue
        if not started:
            continue
        marks, texts, hours, tools = _cells(row, cols)
        if any(i["t"] == "المراجع" and i["x0"] >= cols[1] for i in row):
            break                          # كتلة مراجع المقرر في آخر القسم
        tool_txt = norm(join_items(tools, "raw")) if tools else ""
        if not (ARABIC.search(tool_txt) and not tool_txt.startswith(TOOL_SKIP)):
            tool_txt = ""
        v = title(join_items(texts, "raw"))
        if len(v) < 2 or v.startswith("المحتو"):
            v = ""
        if hours:
            cur = {"hours": int(hours[-1]["t"]), "title": v, "items": [],
                   "levels": [], "tools": [tool_txt] if tool_txt else []}
            blocks.append(cur)
            last = ("title", 0)
            continue
        if cur is None:
            continue
        if tool_txt:
            cur["tools"].append(tool_txt)
        if not v:
            continue
        if not cur["title"]:
            cur["title"], last = v, ("title", 0)
            continue
        if not marks and last is not None:
            key, idx = last            # سطر ملتفٌّ: تكملةُ ما قبله لا بندٌ جديد
            if key == "title":
                cur["title"] += " " + v
            else:
                cur["items"][idx] += " " + v
            continue
        lvl = 2 if (marks and LVL2.match(marks[0]["t"].strip())) else 1
        cur["items"].append(v)
        cur["levels"].append(lvl)
        last = ("items", len(cur["items"]) - 1)
    for blk in blocks:
        seen, keep = set(), []
        for t in blk["tools"]:
            if t not in seen:
                seen.add(t)
                keep.append(t)
        blk["tools"] = keep
    return blocks


def _key(t):
    """مفتاح مقارنة العناوين: بلا تشكيل ولا ترقيم ولا فروق رسمِ الألف والياء."""
    t = re.sub(r"[^\u0621-\u064a0-9A-Za-z]", "", t or "")
    t = re.sub(r"[أإآ]", "ا", t)
    return t.replace("ى", "ي").replace("ة", "ه")


def match_blocks(units, blocks):
    """يوائم كتل المنهج التفصيلي بوحدات الجدول الرسمي.

    الوحدات مرجعُ الساعات والمنهجُ مرجعُ المواضيع، فإن اختلفت حدودُهما فلا
    توفيق اجتهادي: يُترك `officialSpan` فارغاً و`verified: false`.
    """
    out, ok, oi = [], True, 0
    for blk in blocks:
        span, acc = [], 0
        while oi < len(units) and acc < blk["hours"]:
            acc += units[oi]["hours"]
            span.append(oi)
            oi += 1
        if acc == blk["hours"] and span:
            name = " و".join(units[i]["title"] for i in span)
        else:
            ok, name, span = False, blk["title"], []
        prac = PRACTICAL_HEAD.search(blk["title"] or "")
        rec = {"title": name, "hours": blk["hours"],
               "detailTitle": blk["title"], "officialSpan": span,
               "theory": [], "theoryLevels": [],
               "practical": [], "practicalLevels": [],
               "tools": blk["tools"]}
        key = "practical" if prac else "theory"
        rec[key] = list(blk["items"])
        rec[key + "Levels"] = list(blk["levels"])
        out.append(rec)
    ok = ok and oi == len(units) and bool(blocks)
    return out, ok


# ════════════════════════════════ (١٠) رايات ═══════════════════════════════
def ss01_courses():
    if not os.path.exists(SS01):
        return {}
    out = {}
    for r in csv.DictReader(io.open(SS01, encoding="utf-8-sig")):
        code = re.sub(r"\s+", "", r["المقرر"].strip())
        d = out.setdefault(code, {
            "nameAr": r["اسم المقرر"].strip(), "sections": set(),
            "crh": r["الساعات المعتمدة"], "l": r["ساعات المحاضرة"],
            "p": r["ساعات المختبر"], "t": r["ساعات أخرى"],
            "cth": r["ساعات الاتصال"]})
        d["sections"].add(r["الرقم المرجعي"])
    return out


def is_own(code, cfg):
    return code.split("-")[0] in cfg["own"] or code in cfg["extra"]


# ════════════════════════════ (١١) استخراج خطة ═════════════════════════════
def extract_plan(cfg):
    doc = fitz.open(cfg["pdf"])
    gm = doc_gid_text(doc)
    npages = doc.page_count
    pages, lines_of = [], []
    for i in range(npages):
        pg = doc[i]
        lines = page_lines(pg, kashida_x(pg), glyph_fix(pg, gm))
        lines_of.append(lines)
        pages.append({"page": pg, "lines": lines})

    fw = {c["code"]: c for c in framework(lines_of, cfg["fwPages"])}
    starts = section_starts(lines_of, cfg["detailFirst"])
    bounds = list(zip(starts, starts[1:] + [starts[-1] + 6]))

    courses, details, problems = [], [], []
    for a, b in bounds:
        sec = section_lines(lines_of, a, b)
        code = head_code(sec)
        meta = fw.get(code)
        if meta is None:
            problems.append("قسم ص%d برمز %s غير موجود في جدول الإطار المنهجي"
                            % (a + 1, code))
            continue
        units, declared = parse_units(sec, npages)
        hours, hxs = head_hours(sec)
        cth = meta["cth"]
        rec = dict(meta)
        rec["prereqAr"] = head_prereq(sec) or meta["prereqAr"]
        rec.update({"plan": cfg["key"], "inPlans": [cfg["specialty"]],
                    "pageStart": a + 1, "pageEnd": b, "hasDetail": True,
                    "sectionNameAr": head_name(sec), "units": units,
                    "unitsSum": sum(u["hours"] for u in units),
                    "declaredTotal": declared,
                    "expectedUnitsSum": cth * WEEKS if cth else None,
                    "safetyRaw": parse_safety(sec, npages)})
        for k, lbl in (("crh", "و.م"), ("l", "مح"), ("p", "عم"), ("t", "تم")):
            if k in hours and hours[k] != meta[k]:
                problems.append("%s: %s في صدر القسم %d وفي جدول الإطار %d"
                                % (code, lbl, hours[k], meta[k]))
        sems = {sem_of_x(x) for x in hxs} - {None}
        if sems and meta["semester"] not in sems:
            problems.append("%s: عمود الفصل في صدر القسم %s وفي جدول الإطار %d"
                            % (code, sorted(sems), meta["semester"]))
        if None not in (meta["l"], meta["p"], meta["t"], cth) \
                and meta["l"] + meta["p"] + meta["t"] != cth:
            problems.append("%s: مح+عم+تم = %d ولا تساوي س.أ = %d"
                            % (code, meta["l"] + meta["p"] + meta["t"], cth))
        if cth and rec["unitsSum"] != cth * WEEKS:
            problems.append("%s: مجموع ساعات الوحدات %d ولا يساوي س.أ×%d = %d"
                            % (code, rec["unitsSum"], WEEKS, cth * WEEKS))
        if declared is not None and declared != rec["unitsSum"]:
            problems.append("%s: «المجموع» المعلن %d ومجموع الوحدات %d"
                            % (code, declared, rec["unitsSum"]))
        if not rec["safetyRaw"]:
            problems.append("%s: لا كتلة «إجراءات واشتراطات السلامة» في القسم" % code)
        courses.append(rec)

        blocks = parse_detail(detail_rows(pages, a, b, npages))
        matched, ok = match_blocks(units, blocks)
        details.append({"code": code, "plan": cfg["key"],
                        "nameAr": meta["nameAr"], "cth": cth, "verified": ok,
                        "officialUnits": len(units), "detailBlocks": len(blocks),
                        "detailHoursSum": sum(x["hours"] for x in blocks),
                        "units": matched})
        if not ok:
            problems.append(
                "%s: كتل المنهج التفصيلي (%d كتلة، مجموع ساعاتها %d) لا تنطبق "
                "على جدول الوحدات (%d وحدة، %d ساعة)"
                % (code, len(blocks), sum(x["hours"] for x in blocks),
                   len(units), sum(u["hours"] for u in units)))

    # مقررات في الإطار المنهجي بلا صفحة وصف تفصيلي
    done = {c["code"] for c in courses}
    for code, meta in sorted(fw.items()):
        if not is_own(code, cfg) or code in done:
            continue
        rec = dict(meta)
        rec.update({"plan": cfg["key"], "inPlans": [cfg["specialty"]],
                    "pageStart": None, "pageEnd": None, "hasDetail": False,
                    "sectionNameAr": "", "units": [], "unitsSum": 0,
                    "declaredTotal": None, "safetyRaw": [],
                    "expectedUnitsSum": (meta["cth"] * WEEKS) if meta["cth"] else None,
                    "note": "في مصفوفة الخطة بلا صفحةِ وصفٍ تفصيلي"})
        courses.append(rec)
        problems.append("%s: في جدول الإطار المنهجي ولا وصف تفصيلي له في الخطة"
                        % code)
    doc.close()
    courses.sort(key=lambda c: (c["semester"], c["code"]))
    return {"cfg": cfg, "framework": fw, "courses": courses,
            "details": details, "problems": problems, "pages": npages}


# ═════════════════════ (١٢) مقارنة `كهرب` بين الخطتين ══════════════════════
CMP_FIELDS = (("nameAr", "الاسم"), ("crh", "و.م"), ("l", "مح"), ("p", "عم"),
              ("t", "تم"), ("cth", "س.أ"), ("semester", "الفصل"),
              ("prereqAr", "المتطلب"))


def unit_sig(units):
    return [[u["title"], u["hours"]] for u in units]


def topics_sig(det):
    if not det:
        return None
    return [[u["hours"], u["theory"] + u["practical"]] for u in det["units"]]


def compare_shared(res_a, res_b):
    """يقارن مقررات الرمز المشترك بين الخطتين حقلاً حقلاً بلا ترجيح."""
    a, b = res_a, res_b
    ka, kb = a["cfg"]["key"], b["cfg"]["key"]
    ca = {c["code"]: c for c in a["courses"]}
    cb = {c["code"]: c for c in b["courses"]}
    da = {d["code"]: d for d in a["details"]}
    db = {d["code"]: d for d in b["details"]}
    shared = sorted(set(ca) & set(cb))
    same, conflicts = [], []
    for code in shared:
        x, y = ca[code], cb[code]
        diffs = []
        for f, lbl in CMP_FIELDS:
            if x.get(f) != y.get(f):
                diffs.append({"field": f, "label": lbl,
                              ka: x.get(f), kb: y.get(f)})
        if unit_sig(x["units"]) != unit_sig(y["units"]):
            diffs.append({"field": "units", "label": "الوحدات وساعاتها",
                          ka: unit_sig(x["units"]), kb: unit_sig(y["units"])})
        ta, tb = topics_sig(da.get(code)), topics_sig(db.get(code))
        if ta != tb:
            diffs.append({"field": "topics", "label": "مواضيع المنهج التفصيلي",
                          ka + "Count": sum(len(t[1]) for t in ta) if ta else None,
                          kb + "Count": sum(len(t[1]) for t in tb) if tb else None,
                          ka: ta, kb: tb})
        if diffs:
            conflicts.append({"code": code,
                              "nameAr": {ka: x["nameAr"], kb: y["nameAr"]},
                              "pages": {ka: x["pageStart"], kb: y["pageStart"]},
                              "diffFields": [d["label"] for d in diffs],
                              "diffs": diffs})
        else:
            same.append(code)
    return shared, same, conflicts


# ═══════════════════════════════════ main ══════════════════════════════════
def main():
    res = [extract_plan(cfg) for cfg in PLANS]
    qwa, alat = res
    kq, ka = qwa["cfg"]["key"], alat["cfg"]["key"]
    shared, same, conflicts = compare_shared(qwa, alat)
    conflict_codes = {c["code"] for c in conflicts}

    # سجلٌّ واحد لكل مقرر: المشترك المتطابق يجمع اسمَي الخطتين في inPlans،
    # والمشترك المختلف يبقى بسجلّ خطة القوى مع conflict: true
    by_alat = {c["code"]: c for c in alat["courses"]}
    both = [qwa["cfg"]["specialty"], alat["cfg"]["specialty"]]
    courses = []
    for c in qwa["courses"]:
        rec = dict(c)
        if c["code"] in same or c["code"] in conflict_codes:
            rec["inPlans"] = both
            rec["pageStartIn"] = {kq: c["pageStart"],
                                  ka: by_alat[c["code"]]["pageStart"]}
        if c["code"] in conflict_codes:
            rec["conflict"] = True
            rec["conflictNote"] = ("ورد في الخطتين باختلاف — الطرفان في "
                                   "conflicts.json والمثبت هنا من خطة القوى")
        courses.append(rec)
    qwa_codes = {c["code"] for c in qwa["courses"]}
    for c in alat["courses"]:
        if c["code"] not in qwa_codes:
            courses.append(dict(c))
    courses.sort(key=lambda c: (c["semester"], c["code"]))

    details, have = [], set()
    for d in qwa["details"]:
        details.append(d)
        have.add(d["code"])
    for d in alat["details"]:
        if d["code"] not in have or d["code"] in conflict_codes:
            details.append(d)      # الطرف الآخر للمقرر المتنازع فيه يبقى كاملاً

    os.makedirs(OUT_DIR, exist_ok=True)
    io.open(os.path.join(OUT_DIR, "plan-courses.json"), "w", encoding="utf-8").write(
        json.dumps({
            "source": [os.path.basename(p["pdf"]) for p in PLANS],
            "specialty": [p["specialty"] for p in PLANS],
            "department": DEPARTMENT, "weeksPerSemester": WEEKS,
            "codes": {"كهرب": "مقررات مشتركة بين تخصصَي القسم (في الخطتين معاً)",
                      "كهرق": "مقررات تخصص القوى الكهربائية",
                      "كهرآ": "مقررات تخصص الآلات الكهربائية (تكتبها الخطة «كهرا»)",
                      "رياد": "ريادة أعمال (٢٢٦ رياد بنكهة الطاقة)"},
            "note": "مستخرج آلياً؛ الثابت المفروض: مجموع ساعات الوحدات = س.أ × ١٦. "
                    "وsafetyRaw نصّ «إجراءات واشتراطات السلامة» كما ورد في الخطة "
                    "بلا تحسين ولا إضافة. وinPlans يذكر الخطط التي ورد فيها "
                    "المقرر، وconflict إن اختلفتا فيه",
            "courses": courses}, ensure_ascii=False, indent=1))
    io.open(os.path.join(OUT_DIR, "plan-detail.json"), "w", encoding="utf-8").write(
        json.dumps({
            "source": [os.path.basename(p["pdf"]) + " — المنهج التفصيلي"
                       for p in PLANS],
            "note": "استخراج أمين بلا تحرير. جدول «المنهج التفصيلي (النظري والعملي)» "
                    "في هاتين الخطتين جدولٌ واحد لا يفصل النظري عن العملي، فكل "
                    "المواضيع في theory إلا ما وقع تحت عنوانٍ صرّحت فيه الخطة "
                    "بـ«تطبيقات عملية». وtheoryLevels: ١ عنوان موضوع و٢ بند تحته. "
                    "وtools أدوات التقييم كما وردت في خانتها، ووجود «الأداء العملي» "
                    "فيها دليلُ شقٍّ عملي في الوحدة",
            "courses": details}, ensure_ascii=False, indent=1))
    io.open(os.path.join(OUT_DIR, "conflicts.json"), "w", encoding="utf-8").write(
        json.dumps({
            "note": "مقررات الرمز المشترك بين خطتَي القوى والآلات. لا ترجيح بين "
                    "الطرفين: التمييز بين اختلافٍ مقصود وخطأِ استخراج قرارُ المالك. "
                    "qwa = خطة القوى الكهربائية، alat = خطة الآلات الكهربائية",
            "sharedCodes": shared, "identical": same,
            "conflictCount": len(conflicts), "conflicts": conflicts},
            ensure_ascii=False, indent=1))

    # ───────────────────────────── تقرير الشاشة
    ss = ss01_courses()
    dmap = {}
    for d in details:
        dmap.setdefault(d["code"], d)
    print("خطة القوى: %d مقرراً (%d بوصف تفصيلي) — خطة الآلات: %d (%d)"
          % (len(qwa["courses"]), len(qwa["details"]),
             len(alat["courses"]), len(alat["details"])))
    print("سجلات المخرَج: %d — المشترك بالرمز %d (متطابق %d، مختلف %d)\n"
          % (len(courses), len(shared), len(same), len(conflicts)))
    print("%-10s %-38s %3s %3s %3s %3s %3s %4s %4s %4s %3s %3s %s"
          % ("code", "name", "crh", "L", "P", "T", "cth", "unit", "sum",
             "top", "saf", "sec", "plans"))
    for c in courses:
        d = dmap.get(c["code"], {"units": []})
        print("%-10s %-38s %3s %3s %3s %3s %3s %4d %4d %4d %3d %3d %s"
              % (c["code"], c["nameAr"], c["crh"], c["l"], c["p"], c["t"],
                 c["cth"], len(c["units"]), c["unitsSum"],
                 sum(len(u["theory"]) + len(u["practical"]) for u in d["units"]),
                 len(c["safetyRaw"]),
                 len(ss.get(c["code"], {"sections": ()})["sections"]),
                 ("قوى+آلات" if len(c.get("inPlans", [])) > 1
                  else ("قوى" if c["plan"] == kq else "آلات"))
                 + ("  ⚠" if c.get("conflict") else "")))

    plan_codes = {c["code"] for c in courses}
    prefixes = {c.split("-")[0] for c in plan_codes}
    ss_codes = {k for k in ss if k.split("-")[0] in prefixes}
    print("\nمقارنة رايات: مشترك %d — في الخطة بلا شعبة %d — له شعبة بلا خطة %d"
          % (len(plan_codes & ss_codes), len(plan_codes - ss_codes),
             len(ss_codes - plan_codes)))
    for c in sorted(plan_codes - ss_codes):
        print("  في الخطة ولا شعبة له: %s" % c)
    for c in sorted(ss_codes - plan_codes):
        print("  له شعب ولا وجود له في الخطة: %s (%s)" % (c, ss[c]["nameAr"]))
    byc = {c["code"]: c for c in courses}
    for c in sorted(plan_codes & ss_codes):
        x, y = byc[c], ss[c]
        for k, lbl in (("crh", "المعتمدة"), ("l", "المحاضرة"), ("p", "العملي"),
                       ("t", "التمارين"), ("cth", "الاتصال")):
            if y[k] != "" and int(y[k]) != (x[k] if x[k] is not None else 0):
                print("  اختلاف ساعات %s في %s: الخطة %s ورايات %s"
                      % (lbl, c, x[k], y[k]))

    print("\nتعارضات كهرب (%d من %d مشترك):" % (len(conflicts), len(shared)))
    for cf in conflicts:
        print("  - %-10s %s" % (cf["code"], "، ".join(cf["diffFields"])))

    for r in res:
        print("\nملاحظات خطة %s (%d):" % (r["cfg"]["specialty"], len(r["problems"])))
        for p in r["problems"]:
            print("  - %s" % p)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
