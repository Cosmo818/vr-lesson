"""Б51 этап 2: загрузка файлов учителем в конструкторе, одобрение директором, загрузка на шлеме. Запуск: python3 tests/e2e_open.py"""
import json, os, sqlite3, subprocess, sys, tempfile, time, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from playwright.sync_api import sync_playwright

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
tmp = tempfile.mkdtemp(); fails = []
sys.path.insert(0, os.path.join(root, 'server'))
os.environ['DATA_DIR'] = tmp
import app  # noqa: E402

NOW = int(time.time() * 1000); WHO = ('cli', 'test', '')
app.init_db()
with app.db() as c:
    c.execute("INSERT INTO schools(id, name, region, status, network, created, updated) VALUES('s-a', 'Школа А', '', 'active', '', ?, ?)", (NOW, NOW))
    t = app.user_create(c, 'tea.a', 'Учитель А', 'Pass-teaA-2026-Zq', WHO); app.role_add(c, t, 'teacher', 's-a', WHO)
    d = app.user_create(c, 'dir.a', 'Директор А', 'Pass-dirA-2026-Zq', WHO); app.role_add(c, d, 'director', 's-a', WHO)
    c.execute("INSERT INTO devices(id, school, key_hash, name, status, created, created_by, last_seen) VALUES('dv', 's-a', ?, 'шлем', 'active', ?, 'x', 0)", (app.thash('devkey-school-a-0123456789'), NOW))
    x = app.user_create(c, 'exp.a', 'Специалист А', 'Pass-expA-2026-Zq', WHO); app.role_add(c, x, 'expert', 's-a', WHO)
app.save_config({'accounts': True, 'openRooms': True, 'legacyTeacher': True, 'sessionMinutes': 30})
web = subprocess.Popen([sys.executable, '-m', 'http.server', '8788', '--bind', '127.0.0.1'], cwd=root, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
srv = subprocess.Popen([sys.executable, '-I', os.path.join(root, 'server', 'app.py')], env=dict(os.environ, DATA_DIR=tmp, PORT='8789', TEACHER_KEY='tk', DEVICE_KEY='dk'), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
for port, path in ((8788, ''), (8789, 'api/health')):
    for _ in range(50):
        try:
            urllib.request.urlopen('http://127.0.0.1:%d/%s' % (port, path), timeout=2); break
        except Exception:
            time.sleep(.2)


def ok(c, m):
    print(('ok  : ' if c else 'FAIL: ') + m, flush=True)
    if not c:
        fails.append(m)


def clear():
    k = sqlite3.connect(os.path.join(tmp, 'vrlesson.db')); k.execute('DELETE FROM login_fail'); k.commit(); k.close()


SRV = 'http://127.0.0.1:8789'; WEB = 'http://127.0.0.1:8788'


def login(pg, who, pw, page='teacher.html', sel='#app'):
    pg.goto(WEB + '/index.html')
    pg.evaluate('u=>{localStorage.clear();sessionStorage.clear();localStorage.setItem("vrlesson.server",JSON.stringify({url:u,key:""}))}', SRV)
    pg.goto(WEB + '/' + ('teacher.html?next=admin' if page == 'admin.html' else page)); pg.wait_for_timeout(900); clear()
    pg.fill('#lgn', who); pg.fill('#lgp', pw); pg.click('#acctForm .btn')
    pg.wait_for_timeout(2200)
    return pg.is_visible(sel)


try:
    with sync_playwright() as p:
        b = p.chromium.launch(); errs = []
        def newpage():
            c = b.new_context(service_workers='block'); g = c.new_page()
            g.on('pageerror', lambda e: errs.append(str(e))); g.on('dialog', lambda d: d.accept()); return g
        pg = newpage()
        ok(login(pg, 'tea.a', 'Pass-teaA-2026-Zq'), 'учитель вошёл')
        pg.click('[data-t=builder]'); pg.wait_for_timeout(300)
        pg.click('[data-bd=new] >> nth=0'); pg.wait_for_timeout(700)
        pg.click('[data-bd=pub]'); pg.wait_for_timeout(600)
        ok(pg.is_visible('[data-bd=rpub]'), 'панель «Открытая комната» открывается')
        pg.click('[data-bd=rpub]'); pg.wait_for_timeout(900)
        ok('директору' in pg.inner_text('#bdPub'), 'у учителя комната уходит на одобрение (%s)' % pg.inner_text('#bdPub')[-120:].replace('\n', ' '))
        # гость пока ничего не видит
        g = newpage(); g.goto(WEB + '/index.html'); g.evaluate('u=>localStorage.setItem("vrlesson.server",JSON.stringify({url:u,key:""}))', SRV); g.goto(WEB + '/index.html'); g.wait_for_timeout(1200)
        ok(not g.is_visible('#openBtn'), 'до одобрения кнопки «Открытые комнаты» нет')
        # директор одобряет
        pd = newpage(); ok(login(pd, 'dir.a', 'Pass-dirA-2026-Zq'), 'директор вошёл')
        pd.click('[data-t=builder]'); pd.wait_for_timeout(300); pd.click('[data-bd=new] >> nth=0'); pd.wait_for_timeout(700)
        pd.click('[data-bd=pub]'); pd.wait_for_timeout(700)
        ok(pd.locator('[data-bd=rok]').count() == 1, 'директор видит заявку с кнопкой «Одобрить»')
        pd.click('[data-bd=rok]'); pd.wait_for_timeout(900)
        ok(pd.locator('[data-bd=rok]').count() == 0 and 'открыта для всех' in pd.inner_text('#bdPub'), 'одобрено')
        # гость заходит
        g.reload(); g.wait_for_timeout(1500)
        ok(g.is_visible('#openBtn'), 'гость видит «Открытые комнаты»')
        g.click('#openBtn'); g.wait_for_timeout(300)
        ok(g.locator('#openList button').count() == 1, 'в списке одна комната')
        g.click('#openList button'); g.wait_for_timeout(700); g.click('#go'); g.wait_for_timeout(1500)
        room = g.evaluate('()=>VR.app.E.roomId')
        ok(str(room).startswith('c-open'), 'гость попал в открытую комнату (%s)' % room)
        ok(g.evaluate('()=>VR.Store.customRooms().length') == 0, 'комната не записана в хранилище гостя')
        ok(g.evaluate('()=>VR.Store.results().length') == 0, 'результаты гостя не пишутся')
        # закрытый тест
        r = pg.evaluate("""()=>{const S=VR.Store;S.saveTest({title:'Закрытый',subj:'math',gmin:1,gmax:11,closed:true,qs:[{q:'a?',a:['1','2']}]});
          S.addResult({sid:'x',score:1,total:2,closed:1});S.addResult({sid:'x',score:2,total:2});return{all:S.results().length,closed:S.tests().filter(t=>t.closed).length}}""")
        ok(r['all'] == 1 and r['closed'] == 1, 'закрытые результаты не попадают в список результатов (%s)' % r)
        # специалист входит в админку и видит раздел
        pe = newpage(); ok(login(pe, 'exp.a', 'Pass-expA-2026-Zq', 'admin.html', '#app'), 'специалист вошёл в админку')
        ok(pe.is_visible('#s-closed') and not pe.is_visible('#s-invites'), 'специалисту виден только раздел закрытых результатов')
        pe.click('#clGo'); pe.wait_for_timeout(800)
        ok('Закрытых результатов пока нет' in pe.inner_text('#clTbl'), 'таблица закрытых результатов отвечает')
        ok(not errs, 'нет ошибок JS: %s' % errs[:2])
        b.close()
finally:
    web.terminate(); srv.terminate()
print('\nИТОГО: %s' % ('FAIL %d' % len(fails) if fails else 'всё зелёное'))
sys.exit(1 if fails else 0)
