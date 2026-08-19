#!/usr/bin/env python
"""
تحقّق حقيقي من الطباعة — يصيّر الوثيقة إلى PDF عبر متصفح فعلي ويعدّ الصفحات.

سبب وجوده: عطل «١١ صفحة بدل ٦» لم يظهر في اختبارات jsdom لأنها لا تطبع،
ولا في قياس الارتفاع على الشاشة لأن المتصفح يقيس استعلامات العرض على
عرض الورقة عند الطباعة لا على النافذة.

الاستعمال:
    python scripts/print_check.py                    # يفحص النموذج المرجعي
    python scripts/print_check.py <ملف.html> [عدد]   # يفحص ملفاً محدداً

يتطلب: pip install playwright pymupdf  (ويستخدم Chrome المثبّت على الجهاز)
"""

import pathlib
import sys

# طرفية ويندوز الافتراضية cp1256 تختنق بالرموز؛ نفرض UTF-8 على المخرجات.
for stream in (sys.stdout, sys.stderr):
    try:
        stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

EXPECTED_PAGES = 6
A4_MARGIN = {"top": "8mm", "bottom": "8mm", "left": "8mm", "right": "8mm"}

CHROME_CANDIDATES = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    "/usr/bin/google-chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
]


def find_chrome() -> str | None:
    for path in CHROME_CANDIDATES:
        if pathlib.Path(path).exists():
            return path
    return None


def render_pdf(src: pathlib.Path, out: pathlib.Path) -> None:
    from playwright.sync_api import sync_playwright

    chrome = find_chrome()
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=chrome) if chrome else p.chromium.launch()
        page = browser.new_page()
        page.goto(src.resolve().as_uri())
        page.wait_for_timeout(600)
        page.pdf(path=str(out), format="A4", margin=A4_MARGIN, print_background=True)
        browser.close()


def main() -> int:
    root = pathlib.Path(__file__).resolve().parent.parent
    src = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else root / "src/test/fixtures/reference.html"
    expected = int(sys.argv[2]) if len(sys.argv) > 2 else EXPECTED_PAGES

    if not src.exists():
        print(f"✗ الملف غير موجود: {src}")
        return 2

    out = root / "print-check.pdf"
    print(f"… تصيير {src.name} إلى PDF بمقاس A4 وهوامش 8مم")
    render_pdf(src, out)

    import fitz

    doc = fitz.open(out)
    count = doc.page_count
    sizes = {(round(p.rect.width), round(p.rect.height)) for p in doc}

    print(f"  الصفحات: {count} (المتوقع {expected})")
    print(f"  المقاسات: {sizes}   [A4 = (595, 842)]")

    if count != expected:
        print(f"✗ فشل: عدد الصفحات {count} لا يساوي {expected}.")
        print("  الشبهة الأولى: استعلام @media بعرض غير مقيّد بـ screen،")
        print("  فينطبق تخطيط الجوال على الورقة (A4 ≈ 794px < 820px).")
        print(f"  عاين الناتج: {out}")
        return 1

    print(f"✓ نجح. الناتج: {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
