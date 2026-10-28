"""Шаг Э2 PLAN-einstein.md: привязка устройства к ученику в браузере. Сервер (8850, accounts+studentDevices), сайт (8851), 1 школа, 3 ученика с кодами.
Запуск: python3 tests/e2e_studev.py"""
import base64, hashlib, json, os, sqlite3, subprocess, sys, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
tmp = tempfile.mkdtemp(); fails = []
sys.path.insert(0, os.path.join(root, 'server'))
os.environ['DATA_DIR'] = tmp
import app  # noqa: E402

NOW = int(time.time() * 1000); WHO = ('cli', 'test', '')
SRV = 'http://127.0.0.1:8850'; WEB = 'http://127.0.0.1:8851'


def pin_hash(sid, pin):  # как Store.pinHash
    return base64.b64encode(hashlib.pbkdf2_hmac('sha256', pin.encode(), ('st:' + sid).encode(), 20000, 32)).decode()


app.init_db()
with app.db() as c:
    c.execute("INSERT INTO schools(id, name, region, status, network, created, updated) VALUES('s-a', 'Школа А', 'Регион', 'active', '', ?, ?)", (NOW, NOW))
    tea = app.user_create(c, 't.a1', 'Учитель А', 'Pass-tA1-2026-Zq', WHO); app.role_add(c, tea, 'teacher', 's-a', WHO)
    sub = app.user_create(c, 't.sub', 'Предметник', 'Pass-tSub-2026-Zq', WHO); app.role_add(c, sub, 'teacher', 's-a', WHO)
    inc = {'classes': [{'id': 'cA1', 'grade': 5, 'letter': 'А', 'created': NOW, 'updated': NOW, 'school': 's-a'}], 'students': [], 'results': [], 'disc': {}, 'settings': {'updated': NOW, 'minutes': 8}}
    for n in (1, 2, 3):
        inc['students'].append({'id': 'st%d' % n, 'name': 'Фамилия%d Имя%d Отчество%d' % (n, n, n), 'grade': 5, 'classId': 'cA1', 'created': NOW, 'updated': NOW, 'school': 's-a', 'pinHash': pin_hash('st%d' % n, '1234')})
    app.merge_in(c, inc, 'teacher', '', None)
    c.execute("UPDATE classes SET teacherId = ?, doc = json_set(doc, '$.teacherId', ?) WHERE id = 'cA1'", (tea, tea))
    c.execute("INSERT INTO class_teachers(class_id, user_id, subject, since, by_user) VALUES('cA1', ?, 'Информатика', ?, ?)", (sub, NOW, tea))
app.save_config({'accounts': True, 'legacyTeacher': True, 'studentDevices': True, 'sessionMinutes': 30})
web = subprocess.Popen([sys.executable, '-m', 'http.server', '8851', '--bind', '127.0.0.1'], cwd=root, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
srv = subprocess.Popen([sys.executable, '-I', os.path.join(root, 'server', 'app.py')], env=dict(os.environ, DATA_DIR=tmp, PORT='8850', TEACHER_KEY='tk', DEVICE_KEY='dk'), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
for port, path in ((8851, ''), (8850, 'api/health')):
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
    k = sqlite3.connect(os.path.join(tmp, 'vrlesson.db')); r = k.execute(sql, a).fetchall(); k.commit(); k.close(); return r


def teacher_page(b, login, pw):
    pg = b.new_page(); pg.on('dialog', lambda d: d.accept())
    pg.goto(WEB + '/index.html')
    pg.evaluate('()=>{localStorage.clear();sessionStorage.clear();localStorage.setItem("vrlesson.server",JSON.stringify({url:"%s",key:""}))}' % SRV)
    pg.goto(WEB + '/teacher.html'); pg.wait_for_timeout(1500)
    dbq('DELETE FROM login_fail')
    pg.fill('#lgn', login); pg.fill('#lgp', pw); pg.click('#acctForm .btn'); pg.wait_for_timeout(3000)
    return pg


try:
    with sync_playwright() as p:
        b = p.chromium.launch(); errs = []
        pg = teacher_page(b, 't.a1', 'Pass-tA1-2026-Zq'); pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.click('#tabs [data-t=students]') if pg.locator('#tabs [data-t=students]').count() else None
        pg.wait_for_timeout(800)
        try:
            pg.wait_for_selector('#cCard tr[data-id="st1"] .dev', timeout=8000)
        except Exception:
            pass
        row = pg.locator('#cCard tr[data-id="st1"]')
        ok(row.count() == 1 and row.locator('.dev').count() == 1, 'у ученика в кабинете есть кнопка «Устройства»')
        row.locator('.dev').click(); pg.wait_for_timeout(1000)
        ok(pg.is_visible('#devWin') and pg.is_visible('#devGive'), 'окно открыто, есть «Выдать код привязки»')
        pg.click('#devGive'); pg.wait_for_timeout(900)
        code = pg.inner_text('#devCodeVal').strip()
        ok(len(code) == 8 and 'до ' in pg.inner_text('#devCode'), 'код привязки 8 знаков и «действует до» (%s)' % pg.inner_text('#devCode').replace('\n', ' '))
        pg.click('#devClose'); pg.wait_for_timeout(300)
        row.locator('.dev').click(); pg.wait_for_timeout(900)
        ok(code not in pg.inner_text('#devWin') and pg.locator('#devCodeVal').count() == 0, 'при повторном открытии кода уже не видно (показ один раз)')
        pg.click('#devClose')

        # шлем со школьным ключом: привязка запрещена, запроса нет
        sch = b.new_page(); sch.goto(WEB + '/index.html')
        sch.evaluate('()=>{localStorage.clear();sessionStorage.clear();localStorage.setItem("vrlesson.server",JSON.stringify({url:"%s",key:"%s"}))}' % (SRV, 'k' * 24)); sch.reload(); sch.wait_for_timeout(500)
        r = sch.evaluate('async()=>{let n=0;const f=window.fetch;window.fetch=(...a)=>{n++;return f(...a)};const r=await VR.Store.studentPair("%s","x");window.fetch=f;return{s:r.status,n,self:VR.Store.studentSelf()}}' % code)
        ok(r['s'] == 0 and r['n'] == 0 and r['self'] is None, 'на школьном шлеме привязка отказана без запроса')

        # личное устройство ученика (без ключа школы)
        st = b.new_page(); st.on('pageerror', lambda e: errs.append(str(e))); st.goto(WEB + '/index.html')
        st.evaluate('()=>{localStorage.clear();sessionStorage.clear();localStorage.setItem("vrlesson.server",JSON.stringify({url:"%s",key:""}))}' % SRV); st.reload(); st.wait_for_timeout(500)
        bad = st.evaluate('async()=>{const r=await VR.Store.studentPair("ZZZZZZZZ","Тел");return{s:r.status,self:VR.Store.studentSelf()}}')
        ok(bad['s'] == 403 and bad['self'] is None, 'чужой код: 403, ключ не сохранён')
        r = st.evaluate('async()=>{const r=await VR.Store.studentPair("%s","Телефон");return{s:r.status,self:VR.Store.studentSelf(),raw:localStorage.getItem("vrlesson.student")}}' % code)
        ok(r['s'] == 200 and r['self'] and r['self']['sid'] == 'st1' and r['self']['schoolName'] == 'Школа А', 'вкладка без ключа школы привязалась (%s)' % r['self'])
        ok('1234' not in (r['raw'] or ''), 'код ученика в хранилище не лежит')
        r = st.evaluate('async()=>{const l=await VR.Store.studentLogin("1234");const m=await VR.Store.studentMe();return{l:l.status,m:m.status,name:m.data.name,tok:!!sessionStorage.getItem("vrl.stoken")}}')
        ok(r['l'] == 200 and r['m'] == 200 and 'Имя1' in r['name'] and '.' in r['name'] and 'Фамилия1' not in r['name'] and r['tok'], 'вход с верным кодом: studentMe «%s», токен в sessionStorage' % r['name'])
        r = st.evaluate('async()=>{await VR.Store.studentLogout();const m=await VR.Store.studentMe();return{m:m.status,tok:sessionStorage.getItem("vrl.stoken"),self:!!VR.Store.studentSelf()}}')
        ok(r['m'] == 401 and not r['tok'] and r['self'], 'выход гасит сеанс, привязка остаётся')
        r = st.evaluate('async()=>{const a=[];for(let i=0;i<6;i++){const l=await VR.Store.studentLogin("0000");a.push(l.status)}return a}')
        ok(r[:5] == [403] * 5 and r[5] == 429, 'неверный код 5 раз → пауза (%s)' % r)
        r = st.evaluate('async()=>{const l=await VR.Store.studentLogin("1234");return l.status}')
        ok(r == 429, 'верный код во время паузы → 429')
        dbq('DELETE FROM login_fail')

        # учитель видит устройство и отвязывает
        row.locator('.dev').click(); pg.wait_for_timeout(1000)
        ok(pg.locator('#devList [data-dev]').count() == 1 and 'Телефон' in pg.inner_text('#devList'), 'в окне виден привязанный «Телефон»')
        pg.locator('#devList [data-dev] button').click(); pg.wait_for_timeout(1000)
        ok(pg.locator('#devList [data-dev]').count() == 0 and dbq("select count(*) from student_devices where status='active'")[0][0] == 0, '«Отвязать»: устройство снято')
        pg.click('#devClose')
        r = st.evaluate('async()=>{const l=await VR.Store.studentLogin("1234");return{l:l.status,self:VR.Store.studentSelf()}}')
        ok(r['l'] == 401 and r['self'] is None, 'после отвязки вкладка получает 401 и забывает ключ')

        # unpair без связи/с сервера: локальная запись стирается
        r = st.evaluate('async()=>{localStorage.setItem("vrlesson.student",JSON.stringify({key:"x".repeat(30),sid:"st9",name:"n",grade:5,cls:"",schoolName:""}));const u=await VR.Store.studentUnpair("1234");return{u:u.status,self:VR.Store.studentSelf()}}')
        ok(r['self'] is None, 'studentUnpair стирает локальную запись (ответ %s)' % r['u'])
        r = st.evaluate('async()=>{localStorage.setItem("vrlesson.student",JSON.stringify({key:"x".repeat(30),sid:"st9",name:"n",grade:5,cls:"",schoolName:""}));const f=window.fetch;window.fetch=()=>Promise.reject(new Error("offline"));let u;try{u=await VR.Store.studentUnpair("1234")}finally{window.fetch=f}return{u:u.status,off:u.data.offline===true,hint:String(u.data.hint||""),self:VR.Store.studentSelf()}}')
        ok(r['u'] == 0 and r['off'] and 'учител' in r['hint'] and r['self'] is None, 'studentUnpair без связи: запись стёрта, в ответе offline и подсказка «попросите учителя» (%s)' % r)
        r = st.evaluate('async()=>{const old=VR.Store.server();localStorage.setItem("vrlesson.student",JSON.stringify({key:"x".repeat(30),sid:"st9",name:"n",grade:5,cls:"",schoolName:""}));sessionStorage.setItem("vrl.stoken","tok");VR.Store.setServer("https://school.example","");const keep=!!VR.Store.studentSelf();VR.Store.setServer("https://school.example","k".repeat(24));const res={keep:keep,self:VR.Store.studentSelf(),tok:sessionStorage.getItem("vrl.stoken")};if(old)VR.Store.setServer(old.url,old.key);else VR.Store.setServer("");return res}')
        ok(r['keep'] and r['self'] is None and not r['tok'], 'setServer без ключа школы запись ученика не трогает; с ключом школы — стирает запись и токен (%s)' % r)
        ok('(tag,txt,cls)' not in open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'teacher.html'), encoding='utf-8').read(), 'openDevices: параметр mk не называется cls (общая функция страницы)')
        st.evaluate('()=>localStorage.setItem("vrlesson.student",JSON.stringify({key:"short",sid:"st1"}))')
        ok(st.evaluate('()=>VR.Store.studentSelf()') is None, 'испорченная запись устройства → studentSelf() = null')

        # предметник: список без кнопок
        ps = teacher_page(b, 't.sub', 'Pass-tSub-2026-Zq'); ps.wait_for_timeout(500)
        ps.click('#tabs [data-t=students]') if ps.locator('#tabs [data-t=students]').count() else None
        ps.wait_for_selector('tr[data-id="st2"] .dev', timeout=8000)
        ps.locator('#cCard tr[data-id="st2"] .dev').click(); ps.wait_for_timeout(1000)
        ok(ps.is_visible('#devWin') and ps.locator('#devGive').count() == 0, 'предметнику: окно со списком, кнопки выдачи нет')
        # вывод через textContent: имя устройства с разметкой не исполняется
        with app.db() as c:
            c.execute("INSERT INTO student_devices(id, student_id, school, key_hash, name, created, last_seen, status) VALUES('dev-xss', 'st3', 's-a', 'h', '<img src=x onerror=\"window.__xss=1\">', ?, ?, 'active')", (NOW, NOW))
        pg.locator('#cCard tr[data-id="st3"] .dev').click(); pg.wait_for_timeout(1000)
        ok(pg.evaluate('window.__xss') is None and pg.locator('#devList img').count() == 0 and 'onerror' in pg.inner_text('#devList'), 'имя устройства выводится текстом')
        ok(not errs, 'ошибок страниц нет (%s)' % errs[:2])
        b.close()
finally:
    srv.terminate(); web.terminate()
print('FAILS: %d' % len(fails)); sys.exit(1 if fails else 0)
