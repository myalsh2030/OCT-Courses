# -*- coding: utf-8 -*-
"""تصدير كل الخطط ملفاتِ PDF منفصلة في ملف مضغوط واحد.

يشغَّل محلياً بعد البناء: `npm run export:zip`
- يخدم مجلد dist محلياً ويفتح كل مقرر في كروم مقطوع الرأس،
- يولّد PDF لكل مقرر بجودة طباعة المتصفح نفسها (A4، خلفيات مفعّلة)،
- يضغط الجميع في `خطط-القسم-<تاريخ>.zip` بجذر المشروع.

ملاحظة: هذا يحتاج محرك متصفح آلياً فلا يعمل من الصفحة المنشورة نفسها —
هناك يفي زر «طباعة جماعية» بملف PDF واحد يضم كل الخطط.
"""
import functools
import http.server
import io
import json
import socketserver
import sys
import threading
import zipfile
from datetime import date
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

from playwright.sync_api import sync_playwright

APP_DIR = Path(__file__).resolve().parent.parent
DIST = APP_DIR / "dist"
OUT = APP_DIR.parent / f"خطط-القسم-{date.today().isoformat()}.zip"
PORT = 8791
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"

if not DIST.exists():
    sys.exit("مجلد dist غير موجود — شغّل `npm run build` أولاً.")

course_ids = sorted(
    json.loads(p.read_text(encoding="utf-8"))["id"]
    for p in (APP_DIR / "src" / "data" / "courses").glob("*.json")
)

class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args, **kwargs):
        pass

handler = functools.partial(QuietHandler, directory=str(DIST))
httpd = socketserver.TCPServer(("127.0.0.1", PORT), handler)
threading.Thread(target=httpd.serve_forever, daemon=True).start()

with sync_playwright() as p, zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as zf:
    browser = p.chromium.launch(executable_path=CHROME)
    page = browser.new_page()
    for cid in course_ids:
        page.goto(f"http://127.0.0.1:{PORT}/#/course/{cid}", wait_until="networkidle")
        page.reload(wait_until="networkidle")
        page.wait_for_selector(".plan")
        name = page.locator(".course-toolbar .tb-title").inner_text().split("\n")[0].strip()
        pdf = page.pdf(format="A4", print_background=True)
        zf.writestr(f"{cid} — {name}.pdf", pdf)
        print(f"✓ {cid}  {name}  ({len(pdf) // 1024} KB)")
    browser.close()

httpd.shutdown()
print(f"\nاكتمل: {OUT} ({OUT.stat().st_size // 1024} KB، {len(course_ids)} ملفاً)")
