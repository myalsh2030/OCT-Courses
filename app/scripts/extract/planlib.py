"""استخراج نص عربي سليم من ملف الخطة: الحرف صفري العرض يُبدَّل مع تاليه."""
import fitz

def span_text(span):
    ch = list(span["chars"])
    zero = lambda c: (c["bbox"][2] - c["bbox"][0]) < 0.01
    out, i = [], 0
    while i < len(ch):
        if zero(ch[i]):
            j = i
            while j < len(ch) and zero(ch[j]):
                j += 1
            if j < len(ch):            # الحرف الحامل للرباط يسبق مكوّناته
                out.append(ch[j])
                out.extend(reversed(ch[i:j]))
                i = j + 1
            else:
                out.extend(ch[i:j]); i = j
        else:
            out.append(ch[i]); i += 1
    return "".join(c["c"] for c in out)

def page_spans(pg):
    out = []
    for blk in pg.get_text("rawdict")["blocks"]:
        for ln in blk.get("lines", []):
            for sp in ln["spans"]:
                t = span_text(sp).strip()
                if t:
                    out.append({"t": t, "x0": sp["bbox"][0], "x1": sp["bbox"][2],
                                "y": round(sp["bbox"][1], 1)})
    return out

def page_lines(pg):
    """يجمع السبانات في أسطر بحسب y، مرتبة يميناً ← يساراً."""
    spans = page_spans(pg)
    rows = {}
    for s in spans:
        rows.setdefault(round(s["y"] / 3), []).append(s)
    lines = []
    for key in sorted(rows):
        items = sorted(rows[key], key=lambda s: -s["x0"])
        lines.append({"y": items[0]["y"], "items": items,
                      "text": " ".join(i["t"] for i in items)})
    return lines
