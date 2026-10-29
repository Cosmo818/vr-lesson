"""Шаг Н7б: аватары по сети в настоящих браузерах (две вкладки).
Живые app.py и hub.py на свободных портах, статика — http.server; учитель открывает урок через API, два ученика входят через
«Урок идёт — войти» в режиме экрана (desk) и видят друг друга: E.peers с именем «Имя Ф.» и desk=true. Ошибок JS нет.
Запуск: python3 -I tests/e2e_net.py (нужен Playwright с chromium). Печатает «ok  : …» / «FAIL: …»."""
import base64, hashlib, json, os, socket, subprocess, sys, tempfile, time, urllib.error, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
tmp = tempfile.mkdtemp()
PORT, HPORT, WPORT = 8841, 8842, 8843
os.environ.update(DATA_DIR=tmp)
sys.path.insert(0, os.path.join(ROOT, 'server'))
fails = []


def ok(c, m):
    print(('ok  : ' if c else 'FAIL: ') + m, flush=True)
    if not c:
        fails.append(m)


def pin_hash(sid, pin):  # как Store.pinHash: PBKDF2-SHA256, соль 'st:'+id, 20000 кругов
    return base64.b64encode(hashlib.pbkdf2_hmac('sha256', pin.encode(), ('st:' + sid).encode(), 20000, 32)).decode()


procs = []
try:
    import secrets
    import app  # noqa: E402
    NOW = int(time.time() * 1000)
    SECRET = secrets.token_hex(32)
    WEB = 'http://127.0.0.1:%d' % WPORT
    API = 'http://127.0.0.1:%d' % PORT
    DEVKEY = 'devkey-e2e-net-0123456789'
    TPW = 'Pass-teach-2026-Zq'
    app.init_db()
    with app.db() as c:
        c.execute("INSERT INTO schools(id, name, region, status, network, created, updated) VALUES('s-a', 'Школа А', '', 'active', '', ?, ?)", (NOW, NOW))
        uid = app.user_create(c, 't.net', 'Учитель Тест', TPW, ('cli', 'test', ''))
        app.role_add(c, uid, 'teacher', 's-a', ('cli', 'test', ''))
        studs = [{'id': 'st1', 'name': 'Петров Иван Игоревич', 'grade': 5, 'classId': 'cA1', 'created': NOW, 'updated': NOW, 'school': 's-a', 'pinHash': pin_hash('st1', '1111')},
                 {'id': 'st2', 'name': 'Сидорова Мария', 'grade': 5, 'classId': 'cA1', 'created': NOW, 'updated': NOW, 'school': 's-a', 'pinHash': pin_hash('st2', '2222')}]
        inc = {'classes': [{'id': 'cA1', 'grade': 5, 'letter': 'А', 'created': NOW, 'updated': NOW, 'school': 's-a'}], 'students': studs, 'results': [], 'disc': {}, 'settings': {'updated': NOW, 'minutes': 8}}
        app.merge_in(c, inc, 'teacher', '', None)
        # Т6: класс другого учителя и предметник (учитель без своего класса)
        uid2 = app.user_create(c, 't.other', 'Учитель Чужой', TPW, ('cli', 'test', ''))
        app.role_add(c, uid2, 'teacher', 's-a', ('cli', 'test', ''))
        uid3 = app.user_create(c, 't.sub', 'Учитель Предметник', TPW, ('cli', 'test', ''))
        app.role_add(c, uid3, 'teacher', 's-a', ('cli', 'test', ''))
        app.merge_in(c, {'classes': [{'id': 'cB1', 'grade': 6, 'letter': 'Б', 'created': NOW, 'updated': NOW, 'school': 's-a'}], 'students': [], 'results': [], 'disc': {}, 'settings': {'updated': NOW}}, 'teacher', '', None)
        c.execute("UPDATE classes SET teacherId = ?, doc = json_set(doc, '$.teacherId', ?) WHERE id = 'cB1'", (uid2, uid2))
        c.execute("UPDATE classes SET teacherId = ?, doc = json_set(doc, '$.teacherId', ?) WHERE id = 'cA1'", (uid, uid))
        c.execute("INSERT INTO devices(id, school, key_hash, name, status, created, created_by, last_seen) VALUES('dvA', 's-a', ?, 'шлем А', 'active', ?, 'x', 0)", (app.thash(DEVKEY), NOW))
    app.save_config({'accounts': True, 'legacyTeacher': True, 'sessionMinutes': 15, 'net': True, 'hubSecret': SECRET,
                     'hubUrl': 'ws://127.0.0.1:%d/ws' % HPORT, 'hubOrigins': [WEB], 'hubAppUrl': API})

    env = dict(os.environ, DATA_DIR=tmp, PORT=str(PORT), TEACHER_KEY='teach-secret', DEVICE_KEY='dev-secret')
    slog, hlog = open(os.path.join(tmp, 'server.log'), 'w'), open(os.path.join(tmp, 'hub.log'), 'w')
    procs.append(subprocess.Popen([sys.executable, '-I', os.path.join(ROOT, 'server', 'app.py')], env=env, stdout=slog, stderr=slog))
    procs.append(subprocess.Popen([sys.executable, '-I', os.path.join(ROOT, 'server', 'hub.py'), '--port', str(HPORT), '--config', os.path.join(tmp, 'config.json'), '--report_s', '1', '--poll_s', '1'], stdout=hlog, stderr=hlog))
    procs.append(subprocess.Popen([sys.executable, '-m', 'http.server', str(WPORT), '--bind', '127.0.0.1'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))

    def req(method, path, body=None, headers=None):
        r = urllib.request.Request(API + path, data=json.dumps(body).encode() if body is not None else None, method=method, headers=dict({'Content-Type': 'application/json'}, **(headers or {})))
        try:
            with urllib.request.urlopen(r, timeout=30) as f:
                return f.status, json.loads(f.read().decode() or '{}')
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read().decode() or '{}')

    for port in (PORT, HPORT, WPORT):
        for _ in range(80):
            try:
                socket.create_connection(('127.0.0.1', port), 0.2).close()
                break
            except OSError:
                time.sleep(.1)

    # учитель входит и открывает урок класса
    st, b = req('POST', '/api/auth/login', {'login': 't.net', 'password': TPW})
    tok = b.get('token', '')
    ok(st == 200 and tok, 'учитель вошёл')
    st, b = req('POST', '/api/admin/session.open', {'class_id': 'cA1', 'room': 'hall', 'settings': {'chat': 'text'}}, {'Authorization': 'Bearer ' + tok})
    ok(st == 200 and b.get('id', '').startswith('rs-'), 'учитель открыл урок класса (%s)' % st)

    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        br = p.chromium.launch(args=['--use-gl=swiftshader', '--enable-unsafe-swiftshader'])
        errs = []
        pages = []
        for sid, name, pin in (('st1', 'Иван П.', '1111'), ('st2', 'Мария С.', '2222')):
            pg = br.new_context(service_workers='block', viewport={'width': 1000, 'height': 650}).new_page()
            pg.on('pageerror', lambda e, n=sid: errs.append(n + ': ' + str(e)))
            pages.append((pg, sid, name, pin))
            pg.goto(WEB + '/index.html'); pg.wait_for_timeout(600)
            pg.evaluate("""([url,key,studs])=>{const n=Date.now();localStorage.setItem('vrlesson.server',JSON.stringify({url,key}));
              localStorage.setItem('vrlesson.v1',JSON.stringify({v:5,classes:[{id:'cA1',grade:5,letter:'А',created:n,updated:n}],students:studs,results:[],disc:{},tests:[],feedback:[],deleted:{},settings:{}}));}""",
                        [API, DEVKEY, [{'id': s['id'], 'name': s['name'], 'grade': 5, 'classId': 'cA1', 'created': NOW, 'updated': NOW, 'pinHash': s['pinHash']} for s in studs]])
            pg.goto(WEB + '/index.html'); pg.wait_for_timeout(1200)
        for pg, sid, name, pin in pages:
            pg.select_option('#selClass', 'cA1')
            num = pg.evaluate("VR.Store.numOf(VR.Store.student('%s'))" % sid)
            pg.fill('#selNum', str(num)); pg.fill('#selPin', pin); pg.click('#enterBtn')
            try:
                pg.wait_for_selector('#netGo', state='visible', timeout=10000)
            except Exception:
                pass
            ok(pg.is_visible('#netGo'), '%s: выбран ученик, урок идёт — кнопка «Урок идёт — войти» видна' % sid)
        for pg, sid, name, pin in pages:
            pg.click('#netGo'); pg.wait_for_timeout(500)
            ok(pg.evaluate("VR.app.E.deskInput===true&&VR.app.E.student.id==='%s'" % sid), '%s: вход в режиме экрана после подключения' % sid)
        for (pg, sid, name, pin), other in zip(pages, ('Мария С.', 'Иван П.')):
            try:
                pg.wait_for_function("n=>VR.app.E.peers.some(p=>String(p.name).indexOf(n)===0)", arg=other, timeout=20000)
            except Exception:
                pass
            peers = pg.evaluate("VR.app.E.peers.map(p=>({name:p.name,desk:p.desk}))")
            ok(any(q['name'].startswith(other) and q['desk'] is True for q in peers), '%s видит аватар «%s» с desk=true (%s)' % (sid, other, peers))
            ok(pg.evaluate("VR.net.status().state") == 'on', '%s: связь с hub установлена' % sid)
        # кабинет учителя: вкладка «Урок» видит участников, закрывает и снова открывает урок с кодом для дома
        tp = br.new_context(service_workers='block', viewport={'width': 1200, 'height': 800}).new_page()
        tp.on('pageerror', lambda e: errs.append('teacher: ' + str(e)))
        tp.goto(WEB + '/teacher.html'); tp.wait_for_timeout(500)
        tp.evaluate("""([url,tok,studs])=>{const n=Date.now();localStorage.setItem('vrlesson.server',JSON.stringify({url,key:''}));sessionStorage.setItem('vrl.token',tok);
          localStorage.setItem('vrlesson.v1',JSON.stringify({v:5,classes:[{id:'cA1',grade:5,letter:'А',created:n,updated:n}],students:studs,results:[],disc:{},tests:[],feedback:[],deleted:{},settings:{}}));}""",
                    [API, tok, [{'id': s['id'], 'name': s['name'], 'grade': 5, 'classId': 'cA1', 'created': NOW, 'updated': NOW} for s in studs]])
        tp.goto(WEB + '/teacher.html'); tp.wait_for_timeout(1500)
        tp.click('[data-t=lesson]')
        try:
            tp.wait_for_function("document.querySelectorAll('#lsTab tr').length>=3&&document.getElementById('lsTab').textContent.indexOf('Иван П.')>=0", timeout=20000)
        except Exception:
            pass
        txt = tp.inner_text('#lsBox')
        ok('Урок идёт' in txt and 'Иван П.' in txt and 'Мария С.' in txt, 'кабинет: вкладка «Урок» показывает идущий урок и обоих учеников (%s)' % txt[:160].replace('\n', ' '))
        ok('в сети' in txt and 'ученик' in txt, 'кабинет: у участников видны роль и связь')
        # Н9: устройство из статуса ученика (за экраном), тревоги из ev st, план класса
        try:
            tp.wait_for_function("document.getElementById('lsTab').textContent.indexOf('экран')>=0", timeout=15000)
        except Exception:
            pass
        ok('экран' in tp.inner_text('#lsTab'), 'кабинет: устройство ученика «экран» (статус ev st из netsafe)')
        pages[0][0].evaluate("VR.netsafe.detach();VR.net.send({t:'ev',k:'st',cal:1,off:1,near:2,vr:1,fps:72})")
        try:
            tp.wait_for_function("document.getElementById('lsTab').textContent.indexOf('ближе 0,8 м')>=0", timeout=10000)
        except Exception:
            pass
        tt = tp.inner_text('#lsTab')
        ok('ближе 0,8 м' in tt and 'ушёл с места' in tt and '72' in tt and 'шлем' in tt, 'кабинет: тревоги, кадр/с и шлем из статуса ученика (%s)' % tt.replace('\n', ' ')[-200:])
        ok(tp.evaluate("!!document.getElementById('lsPlan')"), 'кабинет: план класса нарисован')
        tp.fill('#lsArea', '30'); tp.select_option('#lsMode', 'stand')
        tp.fill('#lsSn0', 'Лаб 1'); tp.fill('#lsSx0', '1,5'); tp.fill('#lsSz0', '-2'); tp.fill('#lsSy0', '90'); tp.fill('#lsSn1', 'Лаб 2')
        tp.click('#lsSave'); tp.wait_for_timeout(800)
        st, lst = req('POST', '/api/admin/session.list', {'class_id': 'cA1'}, {'Authorization': 'Bearer ' + tok})
        o = (lst.get('open') or [{}])[0].get('settings', {})
        ok(o.get('area_m2') == 30 and o.get('mode') == 'stand' and o.get('stations') == [{'id': 'Лаб 1', 'x': 1.5, 'z': -2.0, 'yaw': 90.0}, {'id': 'Лаб 2', 'x': 0.0, 'z': 0.0, 'yaw': 0.0}],
           'кабинет: настройки и станции с координатами сохранены на сервере (%s)' % o)
        ok('ходьба' in tp.inner_text('#lsDens'), 'кабинет: пределы площади и доступность ходьбы показаны')
        # Н10: кнопки ведущего → ученики; «Убрать» двойным нажатием → 4012; «Вернуть» снимает запрет
        sp = pages[1][0]
        try:
            tp.wait_for_selector('#lsFreeze', timeout=10000)
        except Exception:
            print('lsLead:', tp.inner_text('#lsLead'), tp.evaluate("JSON.stringify({me:LS.me,r:LS.roster})"))
            raise
        tp.click('#lsFreeze')
        try:
            sp.wait_for_function("VR.app.E.frozen===true", timeout=10000)
        except Exception:
            pass
        ok(sp.evaluate("VR.app.E.frozen===true&&document.getElementById('toastBox').textContent.indexOf('внимания')>=0"), 'Н10: «Внимание» из кабинета — ученик заморожен, табличка')
        tp.click('#lsFreeze')
        try:
            sp.wait_for_function("VR.app.E.frozen===false", timeout=10000)
        except Exception:
            pass
        ok(sp.evaluate("VR.app.E.frozen===false"), 'Н10: «внимание» снято')
        go = tp.evaluate("[...document.querySelectorAll('#lsGo option')].map(o=>o.value).find(v=>v!=='hall')")
        tp.select_option('#lsGo', go); tp.click('#lsGoBtn')
        want = sp.evaluate("v=>VR.entryOf?VR.entryOf(v):v", go)
        sp.wait_for_timeout(1200)
        ok(sp.evaluate("VR.app.E.roomId") != want and 'через 3 с' in sp.inner_text('#toastBox'), 'Н10: «Позвать» — сначала табличка, переход не сразу')
        try:
            sp.wait_for_function("w=>VR.app.E.roomId===w", arg=want, timeout=8000)
        except Exception:
            pass
        ok(sp.evaluate("VR.app.E.roomId") == want, 'Н10: через 3 с ученик в комнате «%s»' % want)
        tp.click('#lsGather')
        sp.wait_for_timeout(800)
        ok('у доски' in sp.inner_text('#toastBox'), 'Н10: «Все к доске» — ученик собран у доски (%s)' % sp.inner_text('#toastBox'))
        victim = pages[0][0]
        tp.click('#lsTab tr:has-text("Иван П.") [data-kick]')
        ok('Точно убрать' in tp.inner_text('#lsTab'), 'Н10: «Убрать» — первое нажатие просит подтверждения')
        tp.click('#lsTab tr:has-text("Иван П.") [data-kick]')
        try:
            victim.wait_for_function("VR.net.status().state==='off'", timeout=10000)
        except Exception:
            pass
        ok(victim.evaluate("VR.net.status().state") == 'off' and 'убрал' in victim.inner_text('#toastBox'), 'Н10: ученик убран — связь закрыта, табличка')
        try:
            tp.wait_for_selector('[data-unkick]', timeout=15000)
        except Exception:
            pass
        ok('Петров' in tp.inner_text('#lsBan') or 'Иван' in tp.inner_text('#lsBan'), 'Н10: кабинет — «Убраны с урока» с именем (%s)' % tp.inner_text('#lsBan')[:80])
        tp.click('[data-unkick]'); tp.wait_for_timeout(1000)
        st, lst2 = req('POST', '/api/admin/session.list', {'class_id': 'cA1'}, {'Authorization': 'Bearer ' + tok})
        ok(not (lst2.get('open') or [{}])[0].get('banned_ids'), 'Н10: «Вернуть» — на сервере запрет снят')
        tp.click('#lsClose'); tp.wait_for_timeout(300); tp.click('#lsClose'); tp.wait_for_selector('#lsOpen', timeout=10000)
        st, lst = req('POST', '/api/admin/session.list', {'class_id': 'cA1'}, {'Authorization': 'Bearer ' + tok})
        ok(not lst.get('open'), 'кабинет: урок закрыт после двойного нажатия')
        tp.check('#lsRemote'); tp.click('#lsOpen'); tp.wait_for_selector('#lsClose', timeout=10000)
        code = tp.evaluate("(document.querySelector('#lsBox span[style*=letter-spacing]')||{}).textContent||''")
        ok(len(code) >= 4, 'кабинет: урок открыт заново, код для дома показан (%d зн.)' % len(code))
        # Т6: учитель логинится прямо на экране шлема и входит ведущим по билету учётки
        def adm(tk, act, body):
            return req('POST', '/api/admin/' + act, body, {'Authorization': 'Bearer ' + tk})
        st, b = req('POST', '/api/auth/login', {'login': 't.other', 'password': TPW}); tok2 = b.get('token', '')
        st, b = req('POST', '/api/auth/login', {'login': 't.sub', 'password': TPW}); tok3 = b.get('token', '')
        st, b = adm(tok2, 'session.open', {'class_id': 'cB1', 'room': 'hall'})
        sidB = b.get('id', '')
        ok(st == 200 and sidB, 'Т6: другой учитель открыл урок своего класса cB1 (%s)' % st)
        st, lst = adm(tok, 'session.list', {})
        sidA = (lst.get('open') or [{}])[0].get('id', '')
        ok(sidA and sidB and sidA != sidB, 'Т6: у класса А идёт свой урок')
        TKJS = """()=>{window.__tk=null;const c=VR.net.connect.bind(VR.net);VR.net.connect=o=>{try{window.__tk=JSON.parse(atob(o.ticket.split('.')[0].replace(/-/g,'+').replace(/_/g,'/')));}catch(e){}return c(o);};}"""

        def headset(login):
            pg = br.new_context(service_workers='block', viewport={'width': 1000, 'height': 650}).new_page()
            pg.on('pageerror', lambda e: errs.append('headset ' + login + ': ' + str(e)))
            pg.goto(WEB + '/index.html'); pg.wait_for_timeout(500)
            pg.evaluate("""([url,key,n])=>{localStorage.setItem('vrlesson.server',JSON.stringify({url,key}));
              localStorage.setItem('vrlesson.v1',JSON.stringify({v:5,classes:[{id:'cA1',grade:5,letter:'А',created:n,updated:n}],students:[],results:[],disc:{},tests:[],feedback:[],deleted:{},settings:{}}));}""", [API, DEVKEY, NOW])
            pg.goto(WEB + '/index.html'); pg.wait_for_timeout(1200)
            pg.evaluate(TKJS)
            pg.click('#teachBtn'); pg.wait_for_timeout(800)
            return pg

        def lesson_login(pg, login):
            pg.fill('#tnLogin', login); pg.fill('#tnPass', TPW); pg.click('#tnBtn')
            try:
                pg.wait_for_function("document.getElementById('tnList').textContent.indexOf('Ищу')<0&&!document.getElementById('tnList').hidden", timeout=10000)
            except Exception:
                pass
            return pg.evaluate("[...document.querySelectorAll('#tnList button')].map(b=>b.dataset.sid)")

        def enter(pg):
            pg.click('#tnList button')
            try:
                pg.wait_for_function("VR.net.status().state==='on'", timeout=15000)
            except Exception:
                pass
            return pg.evaluate("({st:VR.net.status().state,r:window.__tk&&window.__tk.r,sid:window.__tk&&window.__tk.sid,tch:VR.app.E.isTeacher(),id:VR.app.E.student.id})")

        h1 = headset('t.net')
        ok('teacher.html' not in h1.url and h1.is_visible('#tnForm') and not h1.is_visible('#go'), 'Т6: «Я учитель» без входа на сервере — форма логина на экране шлема, «Войти в VR» скрыта')
        ids1 = lesson_login(h1, 't.net')
        ok(ids1 == [sidA] and h1.is_visible('#go') and not h1.is_visible('#tnForm'), 'Т6: после логина виден один урок — своего класса (%s)' % ids1)
        ok(h1.evaluate("sessionStorage.getItem('vrl.token')") and not h1.evaluate("localStorage.getItem('vrl.token')"), 'Т6: токен только в sessionStorage вкладки')
        r1 = enter(h1)
        ok(r1['st'] == 'on' and r1['r'] == 't' and r1['sid'] == sidA and r1['tch'] is True and r1['id'] is None, 'Т6: классный руководитель вошёл ведущим, роль t (%s)' % r1)
        # ревью Opus: шлем общий — учётка, введённая на экране шлема, гаснет с концом сеанса
        h1.evaluate("VR.app.endSession()"); h1.wait_for_timeout(300)
        ok(not h1.evaluate("sessionStorage.getItem('vrl.token')") and not h1.evaluate("sessionStorage.getItem('vrl.vrlogin')"), 'Т6: после конца сеанса токен учётки с экрана шлема стёрт')
        h1.click('#teachBtn'); h1.wait_for_timeout(500)
        ok(h1.is_visible('#tnForm') and not h1.is_visible('#go') and h1.is_visible('#tnForm a[href*="teacher.html"]'), 'Т6: следующий человек видит форму логина и ссылку «Войти через кабинет», не уроки учителя')
        h2 = headset('t.other')
        ids2 = lesson_login(h2, 't.other')
        ok(ids2 == [sidB] and sidA not in ids2, 'Т6: в списке учителя другого класса нет урока чужого класса (%s)' % ids2)
        st, b = adm(tok, 'class.teacher.add', {'class_id': 'cA1', 'user_id': uid3, 'subject': 'Информатика'})
        ok(st == 200, 'Т6: предметник назначен (%s %s)' % (st, b))
        h3 = headset('t.sub')
        ids3 = lesson_login(h3, 't.sub')
        ok(ids3 == [sidA], 'Т6: предметник видит урок класса, где ведёт, и не видит чужой (%s)' % ids3)
        r3 = enter(h3)
        ok(r3['st'] == 'on' and r3['r'] == 'a' and r3['tch'] is True, 'Т6: предметник в чужом уроке — роль a (%s)' % r3)
        h3.evaluate("VR.net.close('end')")
        adm(tok, 'session.close', {'id': sidA})
        st, b = adm(tok3, 'session.open', {'class_id': 'cA1', 'room': 'hall'})
        ok(st == 200 and b.get('id'), 'Т6: предметник открыл свой урок (%s)' % st)
        h3.reload(); h3.wait_for_timeout(1200)
        h3.evaluate(TKJS)
        h3.click('#teachBtn'); h3.wait_for_timeout(1500)
        ids3b = h3.evaluate("[...document.querySelectorAll('#tnList button')].map(b=>b.dataset.sid)")
        ok(ids3b == [b['id']], 'Т6: после перезагрузки вкладки токен жив, список без повторного логина (%s)' % ids3b)
        r3b = enter(h3)
        ok(r3b['st'] == 'on' and r3b['r'] == 't', 'Т6: предметник в уроке, который открыл сам, — роль t (%s)' % r3b)
        # Т7: учитель в VR сам открывает урок с планшета, два ученика входят, кнопки ведущего
        for pg, *_ in pages:
            pg.context.close()
        h3.evaluate("VR.net.close('end')")
        st, lst = adm(tok, 'session.list', {'class_id': 'cA1'})
        for x in lst.get('open') or []:
            adm(tok, 'session.close', {'id': x['id']})
        h7 = headset('t.net')
        ok(lesson_login(h7, 't.net') == [], 'Т7: открытых уроков нет — список пуст')
        if h7.is_visible('#tClass'):
            h7.select_option('#tClass', 'cA1')
        h7.click('#go'); h7.wait_for_timeout(1200)
        TAB = """()=>{window.__tab=(label)=>{const E=VR.app.E,m=E.menu;E.paintPanel(m);const b=m.btns.find(x=>String(x.label).indexOf(label)===0);if(!b)return {ok:false,over:m.over.slice(),labels:m.btns.map(x=>x.label)};b.fn();E.paintPanel(m);return {ok:true,over:m.over.slice()};};
          window.__labels=()=>{const m=VR.app.E.menu;VR.app.E.paintPanel(m);return {labels:m.btns.map(x=>String(x.label)),over:m.over.slice()};};
          window.__cap=null;const sa=VR.Store.sessionAdmin.bind(VR.Store);VR.Store.sessionAdmin=async(a,b)=>{const r=await sa(a,b);if(a==='open'&&r&&r.data&&r.data.code)window.__cap=r.data.code;return r;};}"""
        h7.evaluate(TAB)
        r = h7.evaluate("window.__tab('Урок')")
        ok(r['ok'] and not r['over'], 'Т7: у учителя в VR на планшете есть вкладка «Урок», рендер без выхода за край (%s)' % r)
        lb = h7.evaluate("window.__labels()")
        ok(any(l.startswith('Открыть урок для') for l in lb['labels']) and not lb['over'], 'Т7: урока нет — предлагается «Открыть урок для … здесь» (%s)' % lb['labels'])
        h7.evaluate("window.__tab('Вход из дома')")
        h7.evaluate("window.__tab('Открыть урок для')")
        try:
            h7.wait_for_function("VR.net.status().state==='on'", timeout=20000)
        except Exception:
            pass
        info = h7.evaluate("({st:VR.net.status().state,r:window.__tk&&window.__tk.r,sid:window.__tk&&window.__tk.sid,code:window.__cap})")
        ok(info['st'] == 'on' and info['r'] == 't', 'Т7: урок открыт из VR, учитель вошёл ведущим, роль t (%s)' % {k: v for k, v in info.items() if k != 'code'})
        ok(info['code'] and len(info['code']) >= 4, 'Т7: «Вход из дома» — сервер выдал код (%d зн.)' % len(info['code'] or ''))
        dump = h7.evaluate("JSON.stringify([Object.entries(localStorage),Object.entries(sessionStorage)])")
        ok(info['code'] and info['code'] not in dump, 'Т7: код для дома не попал в localStorage/sessionStorage')
        st, lst = adm(tok, 'session.list', {'class_id': 'cA1'})
        o7 = (lst.get('open') or [{}])[0]
        ok(o7.get('id') == info['sid'] and o7.get('remote') is True and o7.get('room') == 'hall', 'Т7: на сервере открыт урок класса А (комната hall, вход из дома)')
        os.makedirs(os.path.join(ROOT, 'shots'), exist_ok=True)
        lb = h7.evaluate("window.__labels()")
        ok(all(x in lb['labels'] for x in ('Все ко мне', 'За мной', 'Внимание!', 'Все в холл', 'Позвать в мою комнату', 'Убрать')) and not lb['over'], 'Т7: кнопки ведущего на месте, p.over пуст (%s)' % lb['over'])
        import base64
        png = h7.evaluate("(()=>{const E=VR.app.E;E.paintPanel(E.menu);return E.menu.cv.toDataURL()})()")
        open(os.path.join(ROOT, 'shots', 'tablet_lesson.png'), 'wb').write(base64.b64decode(png.split(',')[1]))
        # ученики входят в идущий урок
        spg = []
        for sid, name, pin in (('st1', 'Иван П.', '1111'), ('st2', 'Мария С.', '2222')):
            pg = br.new_context(service_workers='block', viewport={'width': 1000, 'height': 650}).new_page()
            pg.on('pageerror', lambda e, n=sid: errs.append('T7 ' + n + ': ' + str(e)))
            pg.goto(WEB + '/index.html'); pg.wait_for_timeout(600)
            pg.evaluate("""([url,key,studs])=>{const n=Date.now();localStorage.setItem('vrlesson.server',JSON.stringify({url,key}));
              localStorage.setItem('vrlesson.v1',JSON.stringify({v:5,classes:[{id:'cA1',grade:5,letter:'А',created:n,updated:n}],students:studs,results:[],disc:{},tests:[],feedback:[],deleted:{},settings:{}}));}""",
                        [API, DEVKEY, [{'id': q['id'], 'name': q['name'], 'grade': 5, 'classId': 'cA1', 'created': NOW, 'updated': NOW, 'pinHash': q['pinHash']} for q in studs]])
            pg.goto(WEB + '/index.html'); pg.wait_for_timeout(1200)
            pg.select_option('#selClass', 'cA1')
            pg.fill('#selNum', str(pg.evaluate("VR.Store.numOf(VR.Store.student('%s'))" % sid))); pg.fill('#selPin', pin); pg.click('#enterBtn')
            try:
                pg.wait_for_selector('#netGo', state='visible', timeout=10000)
            except Exception:
                pass
            ok(pg.is_visible('#netGo'), 'Т7: %s видит «Урок идёт — войти» (урок открыт из VR)' % sid)
            pg.evaluate("window.__cl=null;VR.net.on('closed',c=>{window.__cl=c&&c.code;})")
            pg.click('#netGo'); pg.wait_for_timeout(800)
            spg.append((pg, sid))
        for pg, sid in spg:
            try:
                pg.wait_for_function("VR.net.status().state==='on'&&VR.app.E.peers.length>=2", timeout=20000)
            except Exception:
                pass
        ok(all(pg.evaluate("VR.net.status().state") == 'on' for pg, _ in spg), 'Т7: оба ученика в уроке')
        # сбор
        h7.evaluate("window.__tab('Все ко мне')")
        DIST = """()=>{const E=VR.app.E,NP=VR.netplay;const t=NP.peerIds().map(s=>({s,r:NP.rosterOf(s)})).find(x=>x.r&&x.r.role==='t');const h=t&&NP.headOf(t.s);const me=E.headWorld().p;return h?Math.hypot(me[0]-h.p[0],me[2]-h.p[2]):-1;}"""
        ds = []
        for pg, sid in spg:
            try:
                pg.wait_for_function("d=>{const f=%s;const v=f();return v>1.2&&v<1.8}" % DIST, timeout=10000)
            except Exception:
                pass
            ds.append(round(pg.evaluate("(" + DIST + ")()"), 2))
        ok(all(1.2 < d < 1.8 for d in ds), 'Т7: «Все ко мне» — оба ученика на кольце около 1,5 м от учителя (%s)' % ds)
        # внимание
        h7.evaluate("window.__tab('Внимание!')")
        for pg, sid in spg:
            try:
                pg.wait_for_function("VR.app.E.frozen===true", timeout=8000)
            except Exception:
                pass
        ok(all(pg.evaluate("VR.app.E.frozen") is True for pg, _ in spg), 'Т7: «Внимание!» — у обоих учеников ввод заморожен')
        ok('Снять «Внимание»' in h7.evaluate("window.__labels()")['labels'], 'Т7: у учителя кнопка стала «Снять «Внимание»»')
        h7.evaluate("window.__tab('Снять')")
        for pg, sid in spg:
            try:
                pg.wait_for_function("VR.app.E.frozen===false", timeout=8000)
            except Exception:
                pass
        ok(all(pg.evaluate("VR.app.E.frozen") is False for pg, _ in spg), 'Т7: «Снять» — заморозка снята')
        # убрать: двойное нажатие
        h7.evaluate("window.__tab('Убрать')")
        lb = h7.evaluate("window.__labels()")
        ok(any('Иван' in l for l in lb['labels']) and not lb['over'], 'Т7: «Убрать» показывает список учеников (%s)' % lb['labels'])
        h7.evaluate("window.__tab('Иван')")
        ok(spg[0][0].evaluate("window.__cl") is None, 'Т7: одно нажатие ученика не убирает')
        h7.evaluate("window.__tab('Ещё раз: Иван')")
        try:
            spg[0][0].wait_for_function("window.__cl===4012", timeout=10000)
        except Exception:
            pass
        ok(spg[0][0].evaluate("window.__cl") == 4012 and spg[1][0].evaluate("window.__cl") is None, 'Т7: «Убрать» (двойное нажатие) — Ивану закрыли соединение 4012, Мария осталась')
        h7.wait_for_timeout(2500)
        st, lst = adm(tok, 'session.list', {'class_id': 'cA1'})
        ok('st1' in ((lst.get('open') or [{}])[0].get('banned_ids') or []), 'Т7: на сервере ученик в списке убранных')
        h7.evaluate("window.__tab('Убраны')"); h7.wait_for_timeout(1500)
        lb = h7.evaluate("window.__labels()")
        ok('Вернуть' in lb['labels'] and not lb['over'], 'Т7: «Убраны» — есть «Вернуть» (%s)' % lb['labels'])
        h7.evaluate("window.__tab('Вернуть')"); h7.wait_for_timeout(1500)
        st, lst = adm(tok, 'session.list', {'class_id': 'cA1'})
        ok(not (lst.get('open') or [{}])[0].get('banned_ids'), 'Т7: «Вернуть» — запрет снят на сервере')
        # закрыть урок: двойное нажатие
        h7.evaluate("window.__tab('← Назад')")
        h7.evaluate("window.__tab('Закрыть урок')")
        st, lst = adm(tok, 'session.list', {'class_id': 'cA1'})
        ok(len(lst.get('open') or []) == 1, 'Т7: одно нажатие «Закрыть урок» урок не закрывает')
        h7.evaluate("window.__tab('Точно закрыть')"); h7.wait_for_timeout(1500)
        st, lst = adm(tok, 'session.list', {'class_id': 'cA1'})
        ok(not lst.get('open'), 'Т7: двойное нажатие — урок закрыт на сервере')
        lb = h7.evaluate("window.__labels()")
        ok(any(l.startswith('Открыть урок для') for l in lb['labels']) and not lb['over'], 'Т7: после закрытия планшет снова предлагает открыть урок')
        # роль a: кнопок ведущего нет
        st, b2 = adm(tok, 'session.open', {'class_id': 'cA1', 'room': 'hall'})
        h8 = headset('t.sub'); lesson_login(h8, 't.sub')
        if h8.is_visible('#tClass'):
            h8.select_option('#tClass', 'cA1')
        r8 = enter(h8)
        h8.evaluate(TAB)
        h8.evaluate("window.__tab('Урок')")
        lb = h8.evaluate("window.__labels()")
        ok(r8['r'] == 'a', 'Т7: предметник в уроке учителя класса — роль a (%s)' % r8)
        ok(not any(x in lb['labels'] for x in ('Все ко мне', 'Внимание!', 'Убрать')) and not lb['over'], 'Т7: у роли a кнопок ведущего нет (%s)' % lb['labels'])
        ok(not errs, 'ошибок JS нет %s' % errs[:3])
        br.close()
except Exception as e:  # noqa: BLE001
    ok(False, 'e2e_net упал: %r' % e)
finally:
    for pr in procs:
        try:
            pr.terminate()
            pr.wait(timeout=5)
        except Exception:
            try:
                pr.kill()
            except Exception:
                pass
    for lg in ('server.log', 'hub.log'):
        try:
            if 'Traceback' in open(os.path.join(tmp, lg)).read():
                print('FAIL: Traceback в ' + lg)
                fails.append(lg)
        except OSError:
            pass
sys.exit(1 if fails else 0)
