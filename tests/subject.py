"""Учителя-предметники (закон Б41 в редакции 28.10.2026, ROLES §4.3): владелец класса назначает предметника; предметник видит учеников и статистику
класса и ведёт с ним урок, но не меняет учётки. Живой сервер на реальных (непустых) данных.
Запуск: python3 -I tests/subject.py. Печатает «ok  : …» / «FAIL: …»; tests/run.js включает строки в общий счёт."""
import json, os, sqlite3, subprocess, sys, tempfile, time, urllib.error, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
tmp = tempfile.mkdtemp()
PORT = 8813
fails = 0
os.environ.update(DATA_DIR=tmp)
sys.path.insert(0, os.path.join(ROOT, 'server'))
import app  # noqa: E402


def ok(c, m):
    global fails
    print(('ok  : ' if c else 'FAIL: ') + m, flush=True)
    if not c:
        fails += 1


NOW = int(time.time() * 1000)
WHO = ('cli', 'test', '')
KEYS = ('dirA', 'tA1', 'tA2', 'tA3', 'tB1')
PW = {u: 'Pass-%s-2026-Zq' % u for u in KEYS}
LOGIN = {'dirA': 'dir.a', 'tA1': 't.a1', 'tA2': 't.a2', 'tA3': 't.a3', 'tB1': 't.b1'}

app.init_db()
UID = {}
with app.db() as c:
    for sid, name in (('s-a', 'Школа А'), ('s-b', 'Школа Б')):
        c.execute("INSERT INTO schools(id, name, region, status, network, created, updated) VALUES(?, ?, '', 'active', '', ?, ?)", (sid, name, NOW, NOW))
    for k, roles in (('dirA', [('director', 's-a')]), ('tA1', [('teacher', 's-a')]), ('tA2', [('teacher', 's-a')]), ('tA3', [('teacher', 's-a')]), ('tB1', [('teacher', 's-b')])):
        UID[k] = app.user_create(c, LOGIN[k], k, PW[k], WHO)
        for r, s in roles:
            app.role_add(c, UID[k], r, s, WHO)
    classes = [('cA1', 's-a', 'tA1', 5, 'А'), ('cA2', 's-a', 'tA2', 6, 'Б'), ('cB1', 's-b', 'tB1', 7, 'А')]
    inc = {'classes': [{'id': i, 'grade': g, 'letter': l, 'created': NOW, 'updated': NOW, 'school': sch} for i, sch, t, g, l in classes],
           'students': [], 'results': [], 'disc': {}, 'settings': {'updated': NOW, 'minutes': 8}}
    for i, sch, t, g, l in classes:
        for n in (1, 2, 3):
            sid = 'st-%s-%d' % (i, n)
            inc['students'].append({'id': sid, 'name': 'Ученик %s %d' % (i, n), 'grade': g, 'classId': i, 'created': NOW, 'updated': NOW, 'school': sch,
                                    'pinHash': 'h-' + sid, 'pinView': '12%d4' % n})
            inc['results'].append({'id': 'r-' + sid, 'sid': sid, 'subj': 'inf', 'score': n, 'total': 5, 'ts': NOW})
            inc['disc'][sid] = {'inf:k': NOW}
    app.merge_in(c, inc, 'teacher', '', None)
    for i, sch, t, g, l in classes:
        c.execute("UPDATE classes SET teacherId = ?, doc = json_set(doc, '$.teacherId', ?) WHERE id = ?", (UID[t], UID[t], i))

app.save_config({'accounts': True, 'legacyTeacher': True, 'sessionMinutes': 15, 'net': True, 'hubSecret': 'x' * 48, 'hubUrl': 'wss://hub.example/ws'})
env = dict(os.environ, DATA_DIR=tmp, PORT=str(PORT), TEACHER_KEY='teach-secret', DEVICE_KEY='dev-secret')
log = open(os.path.join(tmp, 'server.log'), 'w')
srv = subprocess.Popen([sys.executable, '-I', os.path.join(ROOT, 'server', 'app.py')], env=env, stdout=log, stderr=log)


def req(method, path, body=None, headers=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request('http://127.0.0.1:%d%s' % (PORT, path), data=data, method=method, headers=dict({'Content-Type': 'application/json'}, **(headers or {})))
    try:
        with urllib.request.urlopen(r, timeout=60) as f:
            return f.status, json.loads(f.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or '{}')


def sql(q, *a):
    c = sqlite3.connect(os.path.join(tmp, 'vrlesson.db'))
    try:
        r = c.execute(q, a).fetchall()
        c.commit()
        return r
    finally:
        c.close()


def ids(st, kind):
    return sorted(x['id'] for x in st[kind])


try:
    for _ in range(50):
        try:
            if req('GET', '/api/health')[0] == 200:
                break
        except Exception:
            time.sleep(.2)
    TOK = {}
    for k in KEYS:
        st, b = req('POST', '/api/auth/login', {'login': LOGIN[k], 'password': PW[k]})
        TOK[k] = b.get('token', '')
    ok(all(TOK.values()), 'фикстура: директор и 4 учителя двух школ вошли')
    H = lambda k: {'Authorization': 'Bearer ' + TOK[k]}  # noqa: E731
    sync = lambda k, body=None: req('POST', '/api/sync', body if body is not None else {}, H(k))  # noqa: E731
    adm = lambda k, act, body=None: req('POST', '/api/admin/' + act, body or {}, H(k))  # noqa: E731

    ok(sql('pragma user_version')[0][0] == 9 and sql("select count(*) from sqlite_master where name = 'class_teachers'")[0][0] == 1, 'миграция v9 (включает v8): user_version = 9, таблица class_teachers есть')

    # --- до назначения
    st, b = sync('tA2'); S = b['state']
    ok(ids(S, 'classes') == ['cA2'] and S.get('sub') == [], 'до назначения учитель A2 видит только свой класс, предметных классов нет')
    st, b = adm('tA2', 'class.teacher.add', {'class_id': 'cA1', 'user_id': UID['tA2'], 'subject': 'Информатика'})
    ok(st == 404, 'учитель не может сам назначить себя в чужой класс (%s)' % st)
    st, b = adm('tA2', 'session.open', {'class_id': 'cA1'})
    ok(st == 404, 'до назначения урок с чужим классом не открыть (%s)' % st)

    st, b = adm('tA1', 'class.teacher.candidates', {'class_id': 'cA1'})
    ok(st == 200 and sorted(x['user_id'] for x in b.get('items', [])) == sorted([UID['tA2'], UID['tA3']]), 'кандидаты: учителя школы класса без владельца и без чужой школы')
    st, b = adm('tA2', 'class.teacher.candidates', {'class_id': 'cA1'})
    ok(st == 404, 'посторонний учитель список кандидатов не получает (%s)' % st)
    # --- назначение
    st, b = adm('tA1', 'class.teacher.add', {'class_id': 'cA1', 'user_id': UID['tA2'], 'subject': '  Информатика  '})
    ok(st == 200 and b.get('ok'), 'классный руководитель назначил предметника')
    ok(sql('select subject, by_user from class_teachers where class_id = ? and user_id = ?', 'cA1', UID['tA2']) == [('Информатика', UID['tA1'])], 'в базе: предмет без лишних пробелов, кто назначил')
    ok(sql("select count(*) from audit_log where action = 'class.teacher.add' and target_id = 'cA1'")[0][0] == 1, 'назначение записано в журнал аудита')
    st, b = adm('tA1', 'class.teacher.add', {'class_id': 'cA1', 'user_id': UID['tB1']})
    ok(st == 400, 'учителя другой школы назначить нельзя (%s)' % st)
    st, b = adm('tA1', 'class.teacher.add', {'class_id': 'cA1', 'user_id': UID['tA1']})
    ok(st == 400, 'классного руководителя предметником своего класса назначить нельзя (%s)' % st)
    st, b = adm('tA1', 'class.teacher.add', {'class_id': 'cA2', 'user_id': UID['tA3']})
    ok(st == 404, 'в чужой класс (A2) классный руководитель A1 назначать не может (%s)' % st)

    # --- что видит предметник
    st, b = sync('tA2'); S = b['state']
    ok(ids(S, 'classes') == ['cA1', 'cA2'] and S.get('sub') == ['cA1'], 'предметник видит свой класс и класс, где ведёт уроки; sub = [cA1]')
    a1 = [s for s in S['students'] if s.get('classId') == 'cA1']
    ok(len(a1) == 3 and all('pinView' not in s and 'pinHash' not in s for s in a1) and 'h-st-cA1' not in json.dumps(S), 'предметник видит 3 учеников класса A1 без кодов входа (ни pinView, ни pinHash)')
    ok(all(s.get('hasPin') is True for s in a1), 'у учеников класса предметника метка hasPin: на его устройстве вход без кода закрыт')
    ok(all('pinView' in s for s in S['students'] if s.get('classId') == 'cA2'), 'в своём классе коды входа видны как раньше')
    ok(sorted(r['sid'] for r in S['results'] if r['sid'].startswith('st-cA1')) == ['st-cA1-1', 'st-cA1-2', 'st-cA1-3'] and 'st-cA1-1' in S['disc'], 'предметник видит результаты и открытия учеников класса (статистика)')
    st, b = sync('tA3'); ok(ids(b['state'], 'classes') == [] and b['state'].get('sub') == [], 'другой учитель школы класса A1 не видит')
    st, b = adm('tA2', 'class.teacher.list', {'class_id': 'cA1'})
    ok(st == 200 and [x['user_id'] for x in b.get('items', [])] == [UID['tA2']] and b['items'][0]['subject'] == 'Информатика', 'предметник видит список учителей класса')

    # --- интерфейс кабинета (Playwright): предметник видит класс только для чтения, владелец — список предметников
    web = subprocess.Popen([sys.executable, '-m', 'http.server', '8814', '--bind', '127.0.0.1'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        from playwright.sync_api import sync_playwright
        time.sleep(.8)
        with sync_playwright() as pw:
            br = pw.chromium.launch()
            def login(k):
                pg = br.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
                pg.goto('http://127.0.0.1:8814/index.html')
                pg.evaluate('()=>{localStorage.clear();sessionStorage.clear();localStorage.setItem("vrlesson.server",JSON.stringify({url:"http://127.0.0.1:%d",key:""}))}' % PORT)
                pg.goto('http://127.0.0.1:8814/teacher.html'); pg.wait_for_timeout(1500)
                pg.fill('#lgn', LOGIN[k]); pg.fill('#lgp', PW[k]); pg.click('#acctForm .btn'); pg.wait_for_timeout(2800)
                pg.click('#tabs .tab[data-t=students]'); pg.wait_for_timeout(800)
                return pg, errs
            pg, errs = login('tA2')
            opts = pg.eval_on_selector_all('#cSel option', 'o=>o.map(x=>x.value+"|"+x.textContent)')
            ok(any(o.startswith('cA1|') and 'предметник' in o for o in opts), 'кабинет предметника: класс A1 в списке с пометкой «предметник» (%s)' % opts)
            pg.select_option('#cSel', 'cA1'); pg.dispatch_event('#cSel', 'change'); pg.wait_for_timeout(600)
            txt = pg.inner_text('#cCard')
            ok('учитель-предметник' in txt and 'Ученик cA1 1' in txt and pg.query_selector('#cCard input.nm') is None and pg.query_selector('#addOpen') is None, 'кабинет предметника: ученики видны, полей правки и «Добавить учеников» нет')
            ok(not errs, 'кабинет предметника: ошибок JS нет (%s)' % errs[:2])
            pg2, errs2 = login('tA1')
            pg2.wait_for_timeout(1500)
            t2 = pg2.inner_text('#cCard')
            ok('Учителя-предметники' in t2 and 'tA2' in t2 and 'Информатика' in t2, 'кабинет классного руководителя: блок предметников со списком')
            ok(not errs2, 'кабинет классного руководителя: ошибок JS нет (%s)' % errs2[:2])
            br.close()
    finally:
        web.terminate()
    for k in ('tA1', 'tA2'):  # вход из браузера мог заменить сессию: берём токены заново
        TOK[k] = req('POST', '/api/auth/login', {'login': LOGIN[k], 'password': PW[k]})[1].get('token', '')

    # --- что ему нельзя
    stu = next(s for s in a1 if s['id'] == 'st-cA1-1')
    bad = dict(stu, name='Подменённое имя', updated=NOW + 5000)
    st, b = sync('tA2', {'students': [bad], 'classes': [], 'results': [], 'disc': {}})
    ok(st == 200, 'синхронизация с правкой чужого ученика проходит, правка отклонена')
    ok(json.loads(sql("select doc from students where id = 'st-cA1-1'")[0][0])['name'] == 'Ученик cA1 1', 'имя ученика класса A1 не изменилось')
    st, b = adm('tA2', 'student.pin', {'student_id': 'st-cA1-1'})
    ok(st == 403, 'предметник не сбрасывает код входа ученика (%s)' % st)
    ok(json.loads(sql("select doc from students where id = 'st-cA1-1'")[0][0]).get('pinHash') == 'h-st-cA1-1', 'код входа ученика на месте')
    st, b = adm('tA2', 'class.teacher.add', {'class_id': 'cA1', 'user_id': UID['tA3']})
    ok(st == 403, 'предметник не назначает других предметников (%s)' % st)
    st, b = adm('tA2', 'class.archive', {'class_id': 'cA1'})
    ok(st == 403 and sql("select status from classes where id = 'cA1'")[0][0] != 'archived', 'предметник не архивирует класс (%s)' % st)
    nr = {'id': 'r-new-1', 'sid': 'st-cA1-2', 'subj': 'inf', 'score': 5, 'total': 5, 'ts': NOW + 10}
    st, b = sync('tA2', {'results': [nr], 'students': [], 'classes': [], 'disc': {}})
    ok(sql("select count(*) from results where id = 'r-new-1'")[0][0] == 0, 'предметник не дописывает результаты ученикам чужого класса')

    # --- урок
    st, b = adm('tA2', 'session.open', {'class_id': 'cA1', 'room': 'hall'})
    ok(st == 200 and b.get('id', '').startswith('rs-'), 'предметник открывает урок с классом A1')
    sid = b.get('id')
    st, b = adm('tA2', 'session.list', {'class_id': 'cA1'})
    ok(st == 200 and [x['id'] for x in b.get('open', [])] == [sid], 'предметник видит свой открытый урок')
    st, b = req('POST', '/api/room/ticket', {'session_id': sid}, H('tA2'))
    ok(st == 200 and b.get('role') == 't' if 'role' in b else st == 200, 'предметник получает билет ведущего на свой урок (%s, %s)' % (st, b.get('role')))
    st, b = req('POST', '/api/room/ticket', {'session_id': sid}, H('tA3'))
    ok(st == 403, 'посторонний учитель билета на урок не получает (%s)' % st)
    st, b = adm('tA1', 'session.list', {'class_id': 'cA1'})
    ok(st == 200 and [x['id'] for x in b.get('open', [])] == [sid], 'классный руководитель видит урок предметника в своём классе')
    st, b = adm('tA2', 'session.close', {'id': sid})
    ok(st == 200, 'предметник закрывает свой урок')

    # --- директор и снятие
    st, b = adm('dirA', 'class.teacher.add', {'class_id': 'cA2', 'user_id': UID['tA3'], 'subject': 'Физика'})
    ok(st == 200, 'директор назначает предметника в любой класс школы')
    st, b = sync('tA3'); ok(b['state'].get('sub') == ['cA2'], 'новый предметник видит класс A2')
    st, b = adm('tA2', 'class.teacher.remove', {'class_id': 'cA2', 'user_id': UID['tA3']})
    ok(st == 200, 'классный руководитель A2 снимает предметника своего класса')
    st, b = sync('tA3'); ok(ids(b['state'], 'classes') == [] and b['state'].get('sub') == [], 'после снятия класс у предметника пропал')
    # --- снятие закрывает открытый урок предметника
    st, b = adm('tA1', 'class.teacher.add', {'class_id': 'cA1', 'user_id': UID['tA3'], 'subject': 'Химия'})
    st, b = adm('tA3', 'session.open', {'class_id': 'cA1', 'room': 'hall'})
    sid3 = b.get('id')
    ok(st == 200 and sid3, 'предметник A3 открыл урок в A1 (%s)' % st)
    st, b = adm('tA1', 'class.teacher.remove', {'class_id': 'cA1', 'user_id': UID['tA3']})
    ok(st == 200 and sql('select status from room_sessions where id = ?', sid3)[0][0] == 'closed', 'снятие предметника закрывает его открытый урок')
    st, b = req('POST', '/api/room/ticket', {'session_id': sid3}, H('tA3'))
    ok(st in (403, 404, 409), 'снятый предметник билета на закрытый урок не получает (%s)' % st)

    # --- комнаты: автор — логин, сервер источник правды
    cur = lambda: json.loads(sql('select doc from settings where id = 1')[0][0])  # noqa: E731
    room = lambda rid, title: {'id': rid, 'title': title, 'created': NOW, 'updated': NOW}  # noqa: E731
    s0 = cur(); s1 = dict(s0, rooms={'rm-a1': dict(room('rm-a1', 'Комната A1'), author='t.a2')}, updated=NOW + 9000)
    sync('tA1', {'settings': s1, 'students': [], 'classes': [], 'results': [], 'disc': {}})
    ok(cur()['rooms']['rm-a1'].get('author') == 't.a1', 'новая комната: автор — логин приславшего, подставленный автор не принят')
    ok(cur()['updated'] > NOW + 9000, 'исправленные настройки новее присланных — клиент заберёт их')
    s2 = dict(cur()); s2['rooms'] = {'rm-a1': dict(room('rm-a1', 'Взлом'), author='t.a2')}; s2['updated'] = cur()['updated'] + 10
    sync('tA2', {'settings': s2, 'students': [], 'classes': [], 'results': [], 'disc': {}})
    ok(cur()['rooms']['rm-a1'].get('title') == 'Комната A1' and cur()['rooms']['rm-a1'].get('author') == 't.a1', 'чужую комнату учитель не меняет и автора не подменяет')
    s3 = dict(cur()); s3['rooms'] = {}; s3['updated'] = cur()['updated'] + 10
    sync('tA2', {'settings': s3, 'students': [], 'classes': [], 'results': [], 'disc': {}})
    ok('rm-a1' in cur().get('rooms', {}), 'чужую комнату учитель не удаляет')
    s4 = dict(cur()); s4['rooms'] = dict(cur()['rooms'], **{'rm-a1': dict(cur()['rooms']['rm-a1'], title='Правка автора')}); s4['updated'] = cur()['updated'] + 10
    sync('tA1', {'settings': s4, 'students': [], 'classes': [], 'results': [], 'disc': {}})
    ok(cur()['rooms']['rm-a1'].get('title') == 'Правка автора', 'автор правит свою комнату')
    s5 = dict(cur()); s5['rooms'] = dict(cur()['rooms'], **{'rm-a1': dict(cur()['rooms']['rm-a1'], title='Директор')}); s5['updated'] = cur()['updated'] + 10
    sync('dirA', {'settings': s5, 'students': [], 'classes': [], 'results': [], 'disc': {}})
    ok(cur()['rooms']['rm-a1'].get('title') == 'Директор' and cur()['rooms']['rm-a1'].get('author') == 't.a1', 'директор правит любую комнату, автор остаётся')
    s6 = cur(); s6['rooms'] = dict(s6['rooms'], **{'rm-old': room('rm-old', 'Старая')}); s6['updated'] = s6['updated'] + 10
    sql('update settings set doc = ?, updated = ?', json.dumps(s6, ensure_ascii=False), s6['updated'])
    s7 = cur(); s7['rooms'] = dict(s7['rooms'], **{'rm-old': dict(room('rm-old', 'Старая, правка'), author='t.b1')}); s7['updated'] = s7['updated'] + 10
    sync('tA2', {'settings': s7, 'students': [], 'classes': [], 'results': [], 'disc': {}})
    ok(cur()['rooms']['rm-old'].get('author') == 't.a2', 'старую комнату без автора забирает первый изменивший учитель')

    # --- «Очистить результаты» (resetAt) — только суперадмин
    for k in ('tA1', 'tA2', 'dirA'):
        r0 = cur().get('resetAt'); s8 = dict(cur(), resetAt=NOW + 99999, updated=cur()['updated'] + 10)
        sync(k, {'settings': s8, 'students': [], 'classes': [], 'results': [], 'disc': {}})
        ok(cur().get('resetAt') == r0 and cur()['updated'] > s8['updated'] - 10, '%s не сдвигает границу «очистить результаты»' % k)
    st, b = sync('tA1'); ok(any(r['id'] == 'r-st-cA1-1' for r in b['state']['results']), 'результаты класса после попыток очистки на месте')

    sql("update classes set status = 'archived', doc = json_set(doc, '$.status', 'archived') where id = 'cA1'")
    st, b = sync('tA2'); ok('cA1' not in (b['state'].get('sub') or []), 'архивный класс предметнику не отдаётся')
    sql("update classes set status = 'active', doc = json_set(doc, '$.status', 'active') where id = 'cA1'")
    sql("update user_roles set status = 'archived' where user_id = ? and role = 'teacher'", UID['tA2'])
    st, b = sync('tA2'); ok(st in (200, 403) and ('cA1' not in ((b.get('state') or {}).get('sub') or [])), 'без роли учителя в школе предметный доступ пропадает')
finally:
    srv.terminate()
    srv.wait(5)
if fails:
    sys.exit(1)
