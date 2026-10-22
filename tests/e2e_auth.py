"""Шаг 9 PLAN.md: вход учителя по логину в браузере. Сервер с включёнными учётками (8774) и без них (8775).
Запуск: python3 tests/e2e_auth.py"""
import json, os, subprocess, sys, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
tmp, tmp2 = tempfile.mkdtemp(), tempfile.mkdtemp()
fails = []
sys.path.insert(0, os.path.join(root, 'server'))
os.environ['DATA_DIR'] = tmp
import app  # noqa: E402

app.init_db()
with app.db() as c:
    uid = app.user_create(c, 'ivanova', 'Иванова', 'Pass-ivanova-2026-Zq', ('cli', 'test', ''))
    app.role_add(c, uid, 'teacher', app.DEFAULT_SCHOOL, ('cli', 'test', ''))
app.save_config({'accounts': True, 'legacyTeacher': True, 'sessionMinutes': 15})
web = subprocess.Popen([sys.executable, '-m', 'http.server', '8773', '--bind', '127.0.0.1'], cwd=root, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
on = subprocess.Popen([sys.executable, os.path.join(root, 'server', 'app.py')], env=dict(os.environ, DATA_DIR=tmp, PORT='8774', TEACHER_KEY='tk-test', DEVICE_KEY='dk-test'), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
off = subprocess.Popen([sys.executable, os.path.join(root, 'server', 'app.py')], env=dict(os.environ, DATA_DIR=tmp2, PORT='8775', TEACHER_KEY='tk-test', DEVICE_KEY='dk-test'), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
for port in (8773, 8774, 8775):
    for _ in range(50):
        try:
            urllib.request.urlopen('http://127.0.0.1:%d/%s' % (port, 'api/health' if port != 8773 else ''), timeout=2); break
        except Exception:
            time.sleep(.2)


def ok(c, m):
    print(('ok  : ' if c else 'FAIL: ') + m, flush=True)
    if not c:
        fails.append(m)


def setsrv(pg, url):
    pg.goto('http://127.0.0.1:8773/index.html')
    pg.evaluate('u=>{localStorage.clear();sessionStorage.clear();localStorage.setItem("vrlesson.server",JSON.stringify({url:u,key:""}))}', url)


try:
    with sync_playwright() as p:
        b = p.chromium.launch(); pg = b.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('dialog', lambda d: d.accept())
        setsrv(pg, 'http://127.0.0.1:8774'); pg.goto('http://127.0.0.1:8773/teacher.html'); pg.wait_for_timeout(1200)
        ok(pg.is_visible('#acctForm') and not pg.is_visible('#pinForm'), 'учётки включены: форма «логин + пароль» вместо прежней')
        ok(pg.get_attribute('#lgp', 'inputmode') != 'numeric', 'поле пароля принимает буквы')
        pg.fill('#lgn', 'ivanova'); pg.fill('#lgp', 'не-тот-пароль-123'); pg.click('#acctForm .btn'); pg.wait_for_timeout(900)
        ok(pg.is_visible('#lock') and 'Неверный' in pg.inner_text('#pinErr'), 'неверный пароль: понятное сообщение, кабинет закрыт')
        pg.fill('#lgn', 'ivanova'); pg.fill('#lgp', 'Pass-ivanova-2026-Zq'); pg.click('#acctForm .btn'); pg.wait_for_timeout(2500)
        ok(pg.is_visible('#app') and not pg.is_visible('#lock'), 'верный логин и пароль открывают кабинет')
        ok(len(pg.evaluate('sessionStorage.getItem("vrl.token")') or '') > 20, 'токен лежит в sessionStorage')
        ok(pg.evaluate('(()=>{const t=sessionStorage.getItem("vrl.token");return Object.keys(localStorage).every(k=>!(localStorage.getItem(k)||"").includes(t))})()'), 'токена нет в localStorage')
        ok(pg.evaluate('VR.Store.status.state') == 'ok' and pg.evaluate('VR.Store.status.role') == 'teacher', 'синхронизация по токену: статус «ок», роль teacher')
        pg.goto('http://127.0.0.1:8773/help-teacher.html'); pg.click('text=← Назад'); pg.wait_for_timeout(800)
        ok(pg.is_visible('#app') or pg.is_visible('#lock'), '«Справка → Назад» не ломает страницу')
        pg.goto('http://127.0.0.1:8773/teacher.html'); pg.wait_for_timeout(1500)
        pg.click('#toStudents'); pg.wait_for_timeout(1200)
        ok(not pg.evaluate('sessionStorage.getItem("vrl.token")'), 'после «Выйти к ученикам» токена в sessionStorage нет')
        # сессия закончилась на сервере → понятное сообщение и закрытый кабинет
        setsrv(pg, 'http://127.0.0.1:8774'); pg.goto('http://127.0.0.1:8773/teacher.html'); pg.wait_for_timeout(1000)
        pg.fill('#lgn', 'ivanova'); pg.fill('#lgp', 'Pass-ivanova-2026-Zq'); pg.click('#acctForm .btn'); pg.wait_for_timeout(1500)
        pg.evaluate('sessionStorage.setItem("vrl.token","просрочен")'.replace('просрочен', 'expired-token-xyz')); pg.evaluate('VR.Store.sync()'); pg.wait_for_timeout(1500)
        ok(pg.is_visible('#lock') and 'Сессия' in pg.inner_text('#pinErr'), 'просроченный токен: кабинет закрыт, сообщение «Сессия закончилась»')
        # сервер без учёток: всё как раньше
        setsrv(pg, 'http://127.0.0.1:8775'); pg.goto('http://127.0.0.1:8773/teacher.html'); pg.wait_for_timeout(1200)
        ok(pg.is_visible('#pinForm') and not pg.is_visible('#acctForm'), 'флаг выключен: прежняя форма с паролем учителя')
        # сервер недоступен: прежняя форма, не белый экран
        setsrv(pg, 'http://127.0.0.1:8779'); pg.goto('http://127.0.0.1:8773/teacher.html'); pg.wait_for_timeout(1500)
        ok(pg.is_visible('#pinForm'), 'сервер недоступен: страница работает с прежней формой')
        ok(not errs, 'ошибок JS нет' + ('' if not errs else ': ' + '; '.join(errs[:3])))
        b.close()
finally:
    for x in (web, on, off):
        x.terminate()
print('\nПРОВАЛЕНО: %d' % len(fails) if fails else '\nВсе проверки пройдены')
sys.exit(1 if fails else 0)
