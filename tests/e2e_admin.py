"""Шаги 10–12 PLAN.md: страница admin.html в браузере. Сервер с учётками (8777), сайт (8776), 2 школы, 2000 учеников.
Запуск: python3 tests/e2e_admin.py"""
import json, os, sqlite3, subprocess, sys, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
tmp = tempfile.mkdtemp(); fails = []
sys.path.insert(0, os.path.join(root, 'server'))
os.environ['DATA_DIR'] = tmp
import app  # noqa: E402

NOW = int(time.time() * 1000); WHO = ('cli', 'test', '')
app.init_db()
with app.db() as c:
    for sid, name, reg in (('s-a', 'Школа А', 'Север'), ('s-b', 'Школа Б', 'Юг')):
        c.execute("INSERT INTO schools(id, name, region, status, network, created, updated) VALUES(?, ?, ?, 'active', '', ?, ?)", (sid, name, reg, NOW, NOW))
    dirA = app.user_create(c, 'dir.a', 'Директор А', 'Pass-dirA-2026-Zq', WHO); app.role_add(c, dirA, 'director', 's-a', WHO)
    tea = app.user_create(c, 'tea.a', 'Учитель А', 'Pass-teaA-2026-Zq', WHO); app.role_add(c, tea, 'teacher', 's-a', WHO)
    sup = app.user_create(c, 'super.one', 'Админ', 'Pass-sup-2026-Zq', WHO); app.role_add(c, sup, 'superadmin', '', WHO)
    classes = [{'id': 'cA1', 'grade': 5, 'letter': 'А', 'created': NOW, 'updated': NOW, 'school': 's-a'}, {'id': 'cB1', 'grade': 7, 'letter': 'Б', 'created': NOW, 'updated': NOW, 'school': 's-b'}]
    studs = [{'id': 'sB', 'name': 'Чужой Б', 'grade': 7, 'classId': 'cB1', 'created': NOW, 'updated': NOW, 'school': 's-b'},
             {'id': 'sX', 'name': '<img src=x onerror="window.__xss=1">', 'grade': 5, 'classId': 'cA1', 'created': NOW, 'updated': NOW, 'school': 's-a'}]
    app.merge_in(c, {'classes': classes, 'students': studs, 'results': [], 'disc': {}, 'settings': {'updated': NOW, 'minutes': 8}}, 'teacher', '', None)
    c.execute("UPDATE classes SET teacherId = ?, doc = json_set(doc, '$.teacherId', ?) WHERE id = 'cA1'", (tea, tea))
cc = sqlite3.connect(os.path.join(tmp, 'vrlesson.db'))
for i in range(2000):
    d = {'id': 'bulk%d' % i, 'name': 'Масс Ученик %04d' % i, 'grade': 5, 'classId': 'cA1', 'school': 's-a', 'created': NOW, 'updated': NOW}
    cc.execute('INSERT INTO students(id, name, grade, school, status, updated, doc) VALUES(?, ?, 5, ?, ?, ?, ?)', (d['id'], d['name'], 's-a', 'active', NOW, json.dumps(d, ensure_ascii=False)))
cc.commit(); cc.close()
app.save_config({'accounts': True, 'legacyTeacher': True, 'sessionMinutes': 30})
web = subprocess.Popen([sys.executable, '-m', 'http.server', '8776', '--bind', '127.0.0.1'], cwd=root, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
srv = subprocess.Popen([sys.executable, '-I', os.path.join(root, 'server', 'app.py')], env=dict(os.environ, DATA_DIR=tmp, PORT='8777', TEACHER_KEY='tk', DEVICE_KEY='dk'), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
for port, path in ((8776, ''), (8777, 'api/health')):
    for _ in range(50):
        try:
            urllib.request.urlopen('http://127.0.0.1:%d/%s' % (port, path), timeout=2); break
        except Exception:
            time.sleep(.2)


def ok(c, m):
    print(('ok  : ' if c else 'FAIL: ') + m, flush=True)
    if not c:
        fails.append(m)


def clear_throttle():
    k = sqlite3.connect(os.path.join(tmp, 'vrlesson.db')); k.execute('DELETE FROM login_fail'); k.commit(); k.close()


def enter(pg, login, pw):
    pg.goto('http://127.0.0.1:8776/index.html')
    pg.evaluate('()=>{localStorage.clear();sessionStorage.clear();localStorage.setItem("vrlesson.server",JSON.stringify({url:"http://127.0.0.1:8777",key:""}))}')
    pg.goto('http://127.0.0.1:8776/admin.html'); pg.wait_for_timeout(1500)  # без входа страница сама ведёт на единый вход
    assert 'teacher.html' in pg.url, pg.url
    clear_throttle()
    pg.fill('#lgn', login); pg.fill('#lgp', pw); pg.click('#acctForm .btn'); pg.wait_for_timeout(2800)


try:
    with sync_playwright() as p:
        b = p.chromium.launch(); pg = b.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('dialog', lambda d: d.accept())
        enter(pg, 'dir.a', 'не-тот-пароль-1')
        ok(pg.is_visible('#lock') and 'Неверн' in pg.inner_text('#pinErr') and 'teacher.html' in pg.url, 'неверный пароль: сообщение на едином входе')
        enter(pg, 'dir.a', 'Pass-dirA-2026-Zq')
        ok('admin.html' in pg.url and pg.is_visible('#app') and not pg.is_visible('#lock'), 'директор входит единым входом и попадает в администрирование (%s)' % pg.url)
        ok(not pg.is_visible('#s-schools'), 'директору раздел «Школы» не показан')
        ok(pg.inner_text('#pager').startswith('Страница 1 из 41') and '2001' in pg.inner_text('#pager'), 'ученики: 2001 запись, 41 страница (%s)' % pg.inner_text('#pager'))
        ok(pg.locator('#tbl tr').count() == 51, 'на странице 50 строк + заголовок')
        ok('Чужой Б' not in pg.inner_text('#tbl'), 'ученика чужой школы нет')
        pg.click('#next'); pg.wait_for_timeout(600)
        ok(pg.inner_text('#pager').startswith('Страница 2'), 'листание вперёд работает')
        pg.fill('#fQ', '<img'); pg.wait_for_timeout(900)
        ok(pg.evaluate('window.__xss') is None and pg.locator('#tbl img').count() == 0, '<img onerror> в имени не исполняется')
        ok('onerror' in pg.inner_text('#tbl'), 'имя показано текстом')
        pg.fill('#fQ', ''); pg.wait_for_timeout(700)
        pg.click('[data-k=teachers]'); pg.wait_for_timeout(700)
        ok('tea.a' in pg.inner_text('#tbl') and 'hash' not in pg.inner_text('#tbl').lower(), 'список учителей без хэшей')
        pg.click('#tbl >> text=В архив'); pg.wait_for_timeout(900)
        st = sqlite3.connect(os.path.join(tmp, 'vrlesson.db')).execute("SELECT status FROM users WHERE login = 'tea.a'").fetchone()[0]
        ok(st != 'active', 'архив учителя после подтверждения')
        pg.click('[data-k=classes]'); pg.wait_for_timeout(700)
        ok('Школа А' in pg.inner_text('#tbl') and 'Школа Б' not in pg.inner_text('#tbl'), 'классы только своей школы')
        # приглашение
        pg.click('#invGo'); pg.wait_for_timeout(900)
        ok(pg.is_visible('.code') and len(pg.inner_text('.code').strip()) == 10, 'приглашение: код показан (10 знаков)')
        code = pg.inner_text('.code').strip(); pg.click('.dlg >> text=Закрыть'); pg.wait_for_timeout(500)
        ok(pg.locator('#invTbl tr').count() == 2 and code not in pg.inner_text('#invTbl'), 'в списке приглашение без кода')
        # шлем
        pg.fill('#devName', 'шлем 1'); pg.click('#devCode'); pg.wait_for_timeout(900)
        ok(pg.is_visible('.code') and len(pg.inner_text('.code').strip()) == 8, 'код привязки шлема: 8 знаков')
        pg.click('.dlg >> text=Закрыть'); pg.wait_for_timeout(500)
        ok('из 20' in pg.inner_text('#devInfo'), 'лимит шлемов показан (%s)' % pg.inner_text('#devInfo'))
        # активация приглашения новой вкладкой без входа
        pg2 = b.new_page(); pg2.on('pageerror', lambda e: errs.append(str(e)))
        pg2.goto('http://127.0.0.1:8776/index.html')
        pg2.evaluate('()=>{localStorage.clear();sessionStorage.clear();localStorage.setItem("vrlesson.server",JSON.stringify({url:"http://127.0.0.1:8777",key:""}))}')
        pg2.goto('http://127.0.0.1:8776/admin.html'); pg2.wait_for_timeout(1500); clear_throttle()
        pg2.click('#toInv'); pg2.fill('#icode', code); pg2.fill('#iname', 'Новая'); pg2.fill('#ilog', 'new.teacher'); pg2.fill('#ipw', 'Long-Pass-2026-Xy'); pg2.click('#invForm .btn'); pg2.wait_for_timeout(1500)
        pg2.wait_for_timeout(1500)
        ok('teacher.html' in pg2.url and pg2.is_visible('#app'), 'учитель по приглашению активирован и сразу попадает в кабинет учителя (%s)' % pg2.url)
        # два приглашения подряд: разные коды и подписи роли; регистрация на странице учителя
        pg.select_option('#invRole', 'teacher'); pg.click('#invGo'); pg.wait_for_timeout(900)
        t1 = pg.inner_text('.code').strip(); h1 = pg.inner_text('.dlg h2'); pg.click('.dlg >> text=Закрыть'); pg.wait_for_timeout(300)
        pg.select_option('#invRole', 'expert'); pg.click('#invGo'); pg.wait_for_timeout(900)
        t2 = pg.inner_text('.code').strip(); h2 = pg.inner_text('.dlg h2'); pg.click('.dlg >> text=Закрыть'); pg.wait_for_timeout(300)
        ok(t1 != t2 and 'учитель' in h1 and 'специалист' in h2, 'два приглашения подряд: разные коды, роль в заголовке (%s / %s)' % (h1, h2))
        pg4 = b.new_page(); pg4.on('pageerror', lambda e: errs.append(str(e)))
        pg4.goto('http://127.0.0.1:8776/index.html')
        pg4.evaluate('()=>{localStorage.clear();sessionStorage.clear();localStorage.setItem("vrlesson.server",JSON.stringify({url:"http://127.0.0.1:8777",key:""}))}')
        pg4.goto('http://127.0.0.1:8776/teacher.html'); pg4.wait_for_timeout(900); clear_throttle()
        ok(pg4.is_visible('#toInv'), 'на странице учителя есть «У меня код приглашения»')
        pg4.click('#toInv'); pg4.fill('#icode', t1); pg4.fill('#iname', 'Вторая'); pg4.fill('#ilog', 'second.teacher'); pg4.fill('#ipw', 'Long-Pass-2026-Xy'); pg4.click('#invForm .btn'); pg4.wait_for_timeout(1800)
        ok(pg4.is_visible('#app'), 'регистрация по коду на странице учителя открывает кабинет')
        ok(sqlite3.connect(os.path.join(tmp, 'vrlesson.db')).execute("SELECT COUNT(*) FROM users WHERE login = 'new.teacher'").fetchone()[0] == 1, 'учётка создана по коду')
        pg2.close()
        # суперадмин
        enter(pg, 'super.one', 'Pass-sup-2026-Zq')
        ok(pg.is_visible('#s-schools') and pg.is_visible('#fRegion'), 'суперадмин видит школы и регионы')
        pg.select_option('#fRegion', 'Юг'); pg.wait_for_timeout(900)
        ok(pg.locator('#fSchool option').count() == 2, 'регион «Юг» → одна школа в списке')
        pg.select_option('#fSchool', 's-b'); pg.wait_for_timeout(900)
        ok('Чужой Б' in pg.inner_text('#tbl') and '2001' not in pg.inner_text('#pager'), 'фильтр по школе показывает её учеников')
        pg.fill('#shName', 'Школа В'); pg.fill('#shReg', 'Запад'); pg.fill('#shDist', 'Северный'); pg.click('#shGo'); pg.wait_for_timeout(1200)
        ok('Школа В' in pg.inner_text('#shTbl'), 'суперадмин добавил школу')
        ok('Северный' in pg.inner_text('#shTbl'), 'у школы есть район')
        ok('Школа В' in pg.locator('#invSchool').inner_text() and 'Школа В' in pg.locator('#devSchool').inner_text(), 'новая школа сразу в списках приглашений и шлемов без перезагрузки')
        ok('Школа В' in pg.locator('#clSchool').inner_text(), 'новая школа сразу в списке закрытых результатов без перезагрузки')
        pg.select_option('#fRegion', 'Запад'); pg.wait_for_timeout(900)
        ok(pg.locator('#fDistrict option').count() == 2 and pg.locator('#fSchool option').count() == 2, 'фильтр по району: регион «Запад» → район «Северный» → школа В')
        pg.select_option('#fRegion', ''); pg.wait_for_timeout(900)
        # отказ одного раздела не ломает остальные
        pg.route('**/api/admin/device.list', lambda r: r.fulfill(status=500, body='{"error":"сбой"}', content_type='application/json'))
        pg.select_option('#devSchool', 's-a'); pg.wait_for_timeout(900)
        ok('сбой' in pg.inner_text('#devErr') and pg.locator('#tbl tr').count() >= 2, 'ошибка раздела «Шлемы» показана, остальные работают')
        # привязка шлема по коду из кабинета учителя
        enter(pg, 'dir.a', 'Pass-dirA-2026-Zq')
        pg.fill('#devName', 'шлем 2'); pg.select_option('#devSchool', 's-a'); pg.click('#devCode'); pg.wait_for_timeout(900)
        pc = pg.inner_text('.code').strip(); pg.click('.dlg >> text=Закрыть')
        pg3 = b.new_page(); pg3.on('pageerror', lambda e: errs.append(str(e)))
        pg3.goto('http://127.0.0.1:8776/index.html'); pg3.evaluate('()=>{localStorage.clear();sessionStorage.clear()}')
        pg3.goto('http://127.0.0.1:8776/teacher.html'); pg3.wait_for_timeout(600)
        ok(pg3.evaluate('!!document.getElementById("pairGo")'), 'поле кода привязки есть в кабинете')
        r = pg3.evaluate('([u,c])=>VR.Store.pair(u,c,"")', ['http://127.0.0.1:8777', 'ZZZZZZZZ'])
        ok(not r['ok'], 'неверный код привязки отклонён')
        clear_throttle()
        r = pg3.evaluate('([u,c])=>VR.Store.pair(u,c,"")', ['http://127.0.0.1:8777', pc])
        sv = pg3.evaluate('VR.Store.server()')
        ok(r['ok'] and sv and len(sv['key']) >= 16 and sv['key'] != 'dk', 'код привязки даёт личный ключ шлема')
        pg3.close()
        # сессия закончилась
        pg.unroute('**/api/admin/device.list')
        pg.route('**/api/accounts*', lambda r: r.fulfill(status=401, body='{"error":"x"}', content_type='application/json'))
        pg.click('[data-k=teachers]'); pg.wait_for_timeout(900)
        pg.wait_for_timeout(1200)
        ok('teacher.html' in pg.url, '401: возврат к единому входу (%s)' % pg.url)
        ok(not errs, 'нет ошибок JS на странице: %s' % errs[:2])
        b.close()
finally:
    web.terminate(); srv.terminate()
print('\nИТОГО: %s' % ('FAIL %d' % len(fails) if fails else 'всё зелёное'))
sys.exit(1 if fails else 0)
