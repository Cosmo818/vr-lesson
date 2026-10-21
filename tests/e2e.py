"""Проверка в настоящем браузере (Chromium/Playwright): навигация туда-обратно, перезагрузка, вход учителя.
Запуск из корня репозитория: python3 tests/e2e.py"""
import subprocess, sys, time, os
from playwright.sync_api import sync_playwright
root = os.path.join(os.path.dirname(__file__), '..')
srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8771', '--bind', '127.0.0.1'], cwd=root, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
import tempfile, json
api = subprocess.Popen([sys.executable, os.path.join(root, 'server', 'app.py')], env=dict(os.environ, DATA_DIR=tempfile.mkdtemp(), PORT='8772', TEACHER_KEY='tk-test', DEVICE_KEY='dk-test'), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
fails = []
T = int(time.time() * 1000)
# данные старого формата (ученики без класса, результаты, отзывы) — на них падала страница учителя
LEGACY = {'v': 2, 'students': [{'id': 's1', 'name': 'Иван', 'grade': 6, 'created': T, 'updated': T}, {'id': 's2', 'name': 'Оля', 'grade': 9, 'created': T, 'updated': T}],
          'results': [{'id': 'r1', 'sid': 's1', 'subj': 'math', 'score': 3, 'total': 5, 'ts': T}, {'id': 'r2', 'sid': 's2', 'subj': 'hist', 'score': 5, 'total': 5, 'ts': T}],
          'disc': {'s1': {'math:cube': T}}, 'feedback': [{'id': 'f1', 'ts': T, 'kind': 'idea', 'text': 'круто'}],
          'tests': [{'id': 't1', 'title': 'T', 'subj': 'math', 'updated': T, 'questions': [{'q': '2+2', 'a': ['4', '5'], 'c': 0}]}], 'deleted': {}, 'settings': {'minutes': 8, 'updated': T}}
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
        pg.evaluate('s=>localStorage.setItem("vrlesson.v1",s)', json.dumps(LEGACY, ensure_ascii=False)); pg.reload(); pg.wait_for_timeout(800)
        for t in ['rating', 'students', 'tests', 'questions', 'feedback', 'data']:
            pg.click('[data-t=%s]' % t); pg.wait_for_timeout(150)
        ok(not errs, 'учитель: вкладки с реальными данными (старые ученики, результаты) без ошибок' + ('' if not errs else ': ' + errs[0]))
        ok(pg.evaluate('VR.errors.list().length')==0, 'учитель: журнал ошибок пуст на старых данных')
        pg.fill('#srvUrl', 'http://127.0.0.1:8772'); pg.fill('#srvKey', '"tk-test"'); pg.click('#srvSave'); pg.wait_for_timeout(2500)
        msg = pg.inner_text('#srvMsg'); ok(msg.startswith('Синхронизировано') and 'ключ учителя' in msg, 'учитель: «Подключить» → статус «Синхронизировано» (не висит «Связь…»): ' + msg)
        pg.fill('#srvUrl', 'http://127.0.0.1:8779'); pg.fill('#srvKey', 'x'); pg.click('#srvSave'); pg.wait_for_timeout(2500)
        ok(pg.inner_text('#srvMsg').startswith('Ошибка'), 'учитель: недоступный сервер → понятная ошибка, а не вечная «Связь…»')
        ok(not errs, 'ошибок JS нет' + ('' if not errs else ': ' + '; '.join(errs[:3])))
        b.close()
finally:
    srv.terminate(); api.terminate()
print('\nПРОВАЛЕНО: %d' % len(fails) if fails else '\nВсе проверки пройдены')
sys.exit(1 if fails else 0)
