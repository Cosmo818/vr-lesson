"""Проверка в настоящем браузере (Chromium/Playwright): навигация туда-обратно, перезагрузка, вход учителя.
Запуск из корня репозитория: python3 tests/e2e.py"""
import subprocess, sys, time, os
from playwright.sync_api import sync_playwright
root = os.path.join(os.path.dirname(__file__), '..')
srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8771', '--bind', '127.0.0.1'], cwd=root, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
fails = []
def ok(c, m):
    print(('ok  : ' if c else 'FAIL: ') + m)
    if not c: fails.append(m)
try:
    with sync_playwright() as p:
        b = p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        pg = b.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        U = 'http://127.0.0.1:8771/'
        pg.goto(U + 'index.html'); pg.wait_for_timeout(1200)
        pg.click('text=Справка'); pg.wait_for_timeout(300); pg.go_back(); pg.wait_for_timeout(1000)
        pg.click('#guestBtn'); ok(pg.is_visible('#ready'), 'старт: после «Справка» и «Назад» кнопки работают')
        pg.reload(); pg.wait_for_timeout(1000); pg.click('#guestBtn'); ok(pg.is_visible('#ready'), 'старт: после перезагрузки кнопки работают')
        pg.goto(U + 'teacher.html'); pg.fill('#pin', '1234'); pg.click('#pinForm .btn'); pg.wait_for_timeout(700)
        ok(pg.is_visible('#lock'), 'учитель: старый PIN 1234 не подходит')
        pg.fill('#pin', '94346655'); pg.click('#pinForm .btn'); pg.wait_for_timeout(700)
        ok(pg.is_visible('#app'), 'учитель: вход по паролю')
        pg.click('text=Справка'); pg.wait_for_timeout(300); pg.go_back(); pg.wait_for_timeout(800)
        pg.click('[data-t=students]'); ok(pg.is_visible('#t-students'), 'учитель: после «Справка» и «Назад» вкладки работают')
        pg.reload(); pg.wait_for_timeout(800); pg.click('[data-t=tests]'); ok(pg.is_visible('#t-tests'), 'учитель: после перезагрузки вкладки работают')
        pg.goto(U + 'help-teacher.html'); pg.click('text=← Назад'); pg.wait_for_timeout(800)
        pg.click('[data-t=feedback]'); ok(pg.is_visible('#t-feedback'), 'учитель: из справки обратно без повторного входа')
        pg.click('#toStudents'); pg.wait_for_timeout(800); pg.go_back(); pg.wait_for_timeout(800)
        ok(pg.is_visible('#lock') and not pg.is_visible('#app'), 'учитель: после «Выйти к ученикам» и «Назад» снова нужен пароль')
        pg.goto(U + 'index.html'); pg.wait_for_timeout(800); pg.goto(U + 'teacher.html'); pg.wait_for_timeout(500)
        ok(pg.is_visible('#lock'), 'учитель: открытие экрана учеников закрывает сессию учителя')
        pg.evaluate("sessionStorage.setItem('vrl.teacher', String(Date.now()-1))"); pg.reload(); pg.wait_for_timeout(500)
        ok(pg.is_visible('#lock'), 'учитель: истёкшая сессия требует пароль')
        pg.fill('#pin', '94346655'); pg.click('#pinForm .btn'); pg.wait_for_timeout(700)
        pg.click('[data-t=feedback]'); ok(pg.is_visible('#t-feedback'), 'учитель: ссылка «Назад» из справки')
        ok(not errs, 'ошибок JS нет' + ('' if not errs else ': ' + '; '.join(errs[:3])))
        b.close()
finally:
    srv.terminate()
print('\nПРОВАЛЕНО: %d' % len(fails) if fails else '\nВсе проверки пройдены')
sys.exit(1 if fails else 0)
