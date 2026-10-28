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
        tp.click('#lsClose'); tp.wait_for_timeout(300); tp.click('#lsClose'); tp.wait_for_selector('#lsOpen', timeout=10000)
        st, lst = req('POST', '/api/admin/session.list', {'class_id': 'cA1'}, {'Authorization': 'Bearer ' + tok})
        ok(not lst.get('open'), 'кабинет: урок закрыт после двойного нажатия')
        tp.check('#lsRemote'); tp.click('#lsOpen'); tp.wait_for_selector('#lsClose', timeout=10000)
        code = tp.evaluate("(document.querySelector('#lsBox span[style*=letter-spacing]')||{}).textContent||''")
        ok(len(code) >= 4, 'кабинет: урок открыт заново, код для дома показан (%d зн.)' % len(code))
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
