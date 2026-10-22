"""Офлайн-кэш (sw.js): после первого открытия страницы кабинета и справки открываются из кэша без сети и без ожидания.
Запуск: python3 tests/e2e_sw.py (свой статический сервер на порту 8766)."""
import os, subprocess, sys, time
from playwright.sync_api import sync_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
bad = 0
def ok(c, m):
    global bad
    print(('ok  : ' if c else 'FAIL: ') + m); bad += 0 if c else 1
srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8766'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
try:
    with sync_playwright() as p:
        b = p.chromium.launch(); ctx = b.new_context(); pg = ctx.new_page()
        pg.goto('http://localhost:8766/index.html')
        pg.wait_for_function('navigator.serviceWorker && navigator.serviceWorker.controller', timeout=20000)
        ok(True, 'sw: установлен и управляет страницей')
        ctx.set_offline(True)
        for page in ('teacher.html', 'help-teacher.html', 'help.html'):
            t = time.time(); pg.goto('http://localhost:8766/' + page); dt = time.time() - t
            ok(pg.locator('body').inner_text().strip() != '' and dt < 2, f'sw: {page} без сети открывается из кэша за {dt:.2f} с')
        ctx.set_offline(False)
        pg.goto('http://localhost:8766/teacher.html?next=admin')
        ok(pg.locator('#lock').count() == 1, 'sw: адрес с параметрами берётся из кэша той же страницы')
        b.close()
finally:
    srv.kill()
print('Все проверки пройдены' if not bad else 'ПРОВАЛЕНО: %d' % bad)
sys.exit(1 if bad else 0)
