"""Шаг Э8 PLAN-einstein.md: зачётная игра в einstein.html с живым сервером (флаги accounts, studentDevices, einRating включены).
Сервер 8860, сайт 8861. Шлем школы (ключ + код ученика) и привязанное устройство: решение по pz.sol попадает в ein_solves, повтор — нет.
Запуск: python3 tests/e2e_einrate.py"""
import base64, hashlib, os, sqlite3, subprocess, sys, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
tmp = tempfile.mkdtemp(); fails = []
sys.path.insert(0, os.path.join(root, 'server'))
os.environ['DATA_DIR'] = tmp
import app, studev  # noqa: E402

NOW = int(time.time() * 1000); WHO = ('cli', 'test', '')
SRV = 'http://127.0.0.1:8860'; WEB = 'http://127.0.0.1:8861'
DEVKEY = 'devkey-e8-aaaaaaaaaaaaaaaa'


def pin_hash(sid, pin):
    return base64.b64encode(hashlib.pbkdf2_hmac('sha256', pin.encode(), ('st:' + sid).encode(), 20000, 32)).decode()


app.init_db()
with app.db() as c:
    c.execute("INSERT INTO schools(id, name, region, status, network, created, updated) VALUES('s-a', 'Школа А', 'Регион', 'active', '', ?, ?)", (NOW, NOW))
    tea = app.user_create(c, 't.a1', 'Учитель А', 'Pass-tA1-2026-Zq', WHO); app.role_add(c, tea, 'teacher', 's-a', WHO)
    inc = {'classes': [{'id': 'cA1', 'grade': 5, 'letter': 'А', 'created': NOW, 'updated': NOW, 'school': 's-a'}], 'students': [], 'results': [], 'disc': {}, 'settings': {'updated': NOW, 'minutes': 8}}
    for n, nm in ((1, 'Иванов Иван Иванович'), (2, 'Петрова Анна Ивановна')):
        inc['students'].append({'id': 'st%d' % n, 'name': nm, 'grade': 5, 'classId': 'cA1', 'created': NOW, 'updated': NOW, 'school': 's-a', 'pinHash': pin_hash('st%d' % n, '1234'), 'status': 'active'})
    app.merge_in(c, inc, 'teacher', '', None)
    c.execute("UPDATE classes SET teacherId = ?, doc = json_set(doc, '$.teacherId', ?) WHERE id = 'cA1'", (tea, tea))
    c.execute("INSERT INTO devices(id, school, key_hash, name, status, created, created_by, last_seen) VALUES('dv-a', 's-a', ?, 'Шлем', 'active', ?, 'test', ?)", (app.thash(DEVKEY), NOW, NOW))
    code = studev.issue_code(app, c, {'id': tea}, 'st2', studev.student_row(c, 'st2'), '127.0.0.1', NOW)['code']
app.save_config({'accounts': True, 'legacyTeacher': True, 'studentDevices': True, 'einRating': True, 'einMinSec': 5, 'sessionMinutes': 30})
web = subprocess.Popen([sys.executable, '-m', 'http.server', '8861', '--bind', '127.0.0.1'], cwd=root, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
srv = subprocess.Popen([sys.executable, '-I', os.path.join(root, 'server', 'app.py')], env=dict(os.environ, DATA_DIR=tmp, PORT='8860', TEACHER_KEY='tk', DEVICE_KEY='dk'), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
for port, path in ((8861, ''), (8860, 'api/health')):
    for _ in range(50):
        try:
            urllib.request.urlopen('http://127.0.0.1:%d/%s' % (port, path), timeout=2); break
        except Exception:
            time.sleep(.2)


def ok(c, m):
    print(('ok  : ' if c else 'FAIL: ') + m, flush=True)
    if not c:
        fails.append(m)


def dbq(sql, *a):
    k = sqlite3.connect(os.path.join(tmp, 'vrlesson.db')); r = k.execute(sql, a).fetchall(); k.close(); return r


errs = []


def fresh(b):
    ctx = b.new_context(); pg = ctx.new_page()
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(WEB + '/index.html'); pg.evaluate('()=>{localStorage.clear();sessionStorage.clear();}')
    return pg


def solve_by_clicks(pg):
    """решает партию по pz.sol кликами по фишкам"""
    for _ in range(40):
        pos = pg.evaluate('''()=>{const G=VR.einweb.state(),g=G.g;if(g.status!=='play')return null;for(let r=0;r<6;r++)for(let c=0;c<6;c++)if(!g.P.defined(c,r))return VR.einweb.cellPos(c,r,g.pz.sol[r][c]);return null}''')
        if not pos:
            break
        pg.locator('#cf').scroll_into_view_if_needed()
        pos = pg.evaluate('''()=>{const g=VR.einweb.state().g;for(let r=0;r<6;r++)for(let c=0;c<6;c++)if(!g.P.defined(c,r))return VR.einweb.cellPos(c,r,g.pz.sol[r][c]);return null}''')
        pg.mouse.click(pos['x'], pos['y'], button='left'); pg.wait_for_timeout(30)


try:
    with sync_playwright() as p:
        b = p.chromium.launch()

        # 1. шлем школы: ключ + код ученика
        pg = fresh(b)
        pg.evaluate('(a)=>localStorage.setItem("vrlesson.server",JSON.stringify({url:a[0],key:a[1]}))', [SRV, DEVKEY])
        pg.goto(WEB + '/einstein.html'); pg.wait_for_selector('#enter')
        n = pg.evaluate('async()=>{await VR.Store.sync();return VR.Store.students().length}')
        ok(n == 2, 'шлем: ученики школы загружены с сервера (%s)' % n)
        pg.evaluate('()=>VR.flags.set("einRating",true)')
        pg.reload(); pg.wait_for_selector('#eSchool')
        pg.select_option('#selClass', index=1)
        num = pg.evaluate('()=>VR.Store.numMap(VR.Store.classes()[0].id)["st1"]')
        pg.fill('#selNum', str(num)); pg.fill('#selPin', '1234'); pg.click('#enterBtn'); pg.wait_for_selector('#game:not([hidden])')
        ok(pg.evaluate('VR.einweb.E().student.id') == 'st1', 'шлем: ученик st1 вошёл')
        pg.click('#gStart'); pg.wait_for_timeout(800)
        G = pg.evaluate('()=>{const G=VR.einweb.state();return{ph:G.phase,rated:G.rated,seed:G.g.pz.seed}}')
        iss = dbq("SELECT seed, status FROM ein_issued WHERE pk='s' AND pid='st1'")
        ok(G['ph'] == 'play' and G['rated'] and len(iss) == 1 and iss[0][0] == G['seed'] and iss[0][1] == 'active', 'шлем: «Начать» взял номер на сервере (%s)' % (G,))
        pg.wait_for_timeout(5600)
        solve_by_clicks(pg); pg.wait_for_timeout(800)
        row = dbq("SELECT seed, t, helped, school FROM ein_solves WHERE pk='s' AND pid='st1'")
        ok(pg.evaluate('VR.einweb.state().g.status') == 'win' and len(row) == 1 and row[0][0] == G['seed'] and row[0][2] == 0 and row[0][3] == 's-a' and 5 <= row[0][1] <= 30, 'шлем: решение по pz.sol попало в ein_solves (%s)' % (row,))
        ok('засчитано' in pg.inner_text('#gMsg'), 'шлем: ученик видит «В рейтинг засчитано»')
        ok(dbq("SELECT count(*) FROM ein_solves WHERE pid='st1'")[0][0] == 1, 'шлем: ровно одно решение')
        raw = pg.evaluate('()=>JSON.stringify(Object.keys(localStorage).filter(k=>k!=="vrlesson.v1").map(k=>localStorage.getItem(k)))')  # vrlesson.v1 — школьные данные с сервера (там хэш кода и так есть)
        ok(pin_hash('st1', '1234') not in raw, 'шлем: игра не пишет хэш кода ученика на диск (журнал, настройки, очередь)')

        # 2. привязанное устройство
        pg2 = fresh(b)
        pg2.goto(WEB + '/einstein.html'); pg2.wait_for_selector('#enter')
        pg2.evaluate('(a)=>localStorage.setItem("vrlesson.server",JSON.stringify({url:a,key:""}))', SRV)
        r = pg2.evaluate('async(c)=>{const r=await VR.Store.studentPair(c,"Тест");return r.status}', code)
        ok(r == 200, 'устройство: привязка по коду')
        pg2.reload(); pg2.wait_for_selector('#eBound')
        pg2.fill('#bPin', '1234'); pg2.click('#bGo'); pg2.wait_for_selector('#game:not([hidden])')
        pg2.click('#gStart'); pg2.wait_for_timeout(800)
        G2 = pg2.evaluate('()=>{const G=VR.einweb.state();return{ph:G.phase,rated:G.rated,seed:G.g.pz.seed}}')
        ok(G2['rated'] and dbq("SELECT count(*) FROM ein_issued WHERE pk='s' AND pid='st2'")[0][0] == 1, 'устройство: номер выдан сеансу ученика (%s)' % (G2,))
        pg2.wait_for_timeout(5600)
        solve_by_clicks(pg2); pg2.wait_for_timeout(800)
        row2 = dbq("SELECT seed, helped FROM ein_solves WHERE pk='s' AND pid='st2'")
        ok(len(row2) == 1 and row2[0][0] == G2['seed'] and row2[0][1] == 0, 'устройство: решение попало в ein_solves (%s)' % (row2,))

        # 3. помощь по выданному номеру сжигает номер (helped:1), в рейтинг не идёт
        # Э12: «Новая партия» — в меню на холсте (кнопки #gNew больше нет)
        if pg2.is_visible('#gMenu'):
            pg2.click('#gMenu'); pg2.wait_for_timeout(300)
        okn = pg2.evaluate('()=>VR.einweb.press("Новая партия")')
        pg2.wait_for_timeout(800)
        if pg2.is_visible('#gStart') and pg2.is_enabled('#gStart'):
            pg2.click('#gStart'); pg2.wait_for_timeout(800)
        ok(okn, 'устройство: «Новая партия» из меню нажимается')
        pg2.click('#gOpen')
        pg2.wait_for_timeout(5600)
        solve_by_clicks(pg2); pg2.wait_for_timeout(800)
        row3 = dbq("SELECT helped FROM ein_solves WHERE pk='s' AND pid='st2' ORDER BY ts")
        ok(len(row3) == 2 and row3[1][0] == 1, 'устройство: решение с помощью записано как helped=1 (%s)' % (row3,))
        ok(dbq("SELECT n FROM ein_stats WHERE pk='s' AND pid='st2'")[0][0] == 1, 'устройство: в рейтинг идёт только решение без помощи')

        ok(not errs, 'ошибок в консоли нет (%s)' % errs[:3])
        b.close()
finally:
    srv.terminate(); web.terminate()
print('FAILS: %d' % len(fails)); sys.exit(1 if fails else 0)
