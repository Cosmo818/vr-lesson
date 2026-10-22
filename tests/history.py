"""Шаг 23 PLAN.md (Б74.2, Б74.8): GET /api/history — права, выборка, белый список detail, ip только суперадмину, страницы, индексы, скорость.
Запуск: python3 -I tests/history.py. Печатает «ok  : …» / «FAIL: …»; tests/run.js включает строки в общий счёт."""
import json, os, sqlite3, subprocess, sys, tempfile, time, urllib.error, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
tmp = tempfile.mkdtemp()
PORT = 8802
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
KEYS = ('dirA', 'tA1', 'tA2', 'dirB', 'sup', 'dirA2')
PW = {u: 'Pass-%s-2026-Zq' % u for u in KEYS}
LOGIN = {'dirA': 'dir.a', 'tA1': 't.a1', 'tA2': 't.a2', 'dirB': 'dir.b', 'sup': 'super.one', 'dirA2': 'dir.a2'}
app.init_db()
UID = {}
with app.db() as c:
    for sid, name in (('s-a', 'Школа А'), ('s-b', 'Школа Б'), ('s-c', 'Школа В')):
        c.execute("INSERT INTO schools(id, name, region, status, network, created, updated) VALUES(?, ?, '', 'active', '', ?, ?)", (sid, name, NOW, NOW))
    for k, roles in (('dirA', [('director', 's-a')]), ('tA1', [('teacher', 's-a')]), ('tA2', [('teacher', 's-a')]), ('dirB', [('director', 's-b')]),
                     ('sup', [('superadmin', '')]), ('dirA2', [])):
        UID[k] = app.user_create(c, LOGIN[k], k, PW[k], WHO)
        for r, s in roles:
            app.role_add(c, UID[k], r, s, WHO)
    UID['multi'] = app.user_create(c, 'multi.one', '', 'Pass-multi-2026-Zq', WHO)
    app.role_add(c, UID['multi'], 'teacher', 's-a', WHO)
    app.role_add(c, UID['multi'], 'teacher', 's-b', WHO)
    classes = [('cA1', 's-a', 'tA1', 5, 'А'), ('cA2', 's-a', 'tA2', 5, 'Б'), ('cB1', 's-b', None, 7, 'А')]
    inc = {'classes': [{'id': i, 'grade': g, 'letter': l, 'created': NOW, 'updated': NOW, 'school': sch} for i, sch, t, g, l in classes],
           'students': [], 'results': [], 'disc': {}, 'settings': {'updated': NOW, 'minutes': 8}}
    for i, sch, t, g, l in classes:
        for n in (1, 2):
            inc['students'].append({'id': 'st-%s-%d' % (i, n), 'name': 'Ученик %s %d' % (i, n), 'grade': g, 'classId': i, 'created': NOW, 'updated': NOW, 'school': sch,
                                    'pinHash': 'secret-hash-%s%d' % (i, n)})
    app.merge_in(c, inc, 'teacher', '', None)
    for i, sch, t, g, l in classes:
        if t:
            c.execute("UPDATE classes SET teacherId = ?, doc = json_set(doc, '$.teacherId', ?) WHERE id = ?", (UID[t], UID[t], i))

app.save_config({'accounts': True, 'legacyTeacher': True, 'sessionMinutes': 15})
env = dict(os.environ, DATA_DIR=tmp, PORT=str(PORT), TEACHER_KEY='teach-secret', DEVICE_KEY='dev-secret')
log = open(os.path.join(tmp, 'server.log'), 'w')
srv = subprocess.Popen([sys.executable, '-I', os.path.join(ROOT, 'server', 'app.py')], env=env, stdout=log, stderr=log)


def req(method, path, body=None, headers=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request('http://127.0.0.1:%d%s' % (PORT, path), data=data, method=method, headers=dict({'Content-Type': 'application/json'}, **(headers or {})))
    try:
        with urllib.request.urlopen(r, timeout=60) as f:
            raw = f.read().decode()
            return f.status, json.loads(raw), raw
    except urllib.error.HTTPError as e:
        raw = e.read().decode() or '{}'
        return e.code, json.loads(raw), raw


def sql(q, *a):
    c = sqlite3.connect(os.path.join(tmp, 'vrlesson.db'))
    try:
        r = c.execute(q, a).fetchall()
        c.commit()
        return r
    finally:
        c.close()


try:
    for _ in range(50):
        try:
            if req('GET', '/api/health')[0] == 200:
                break
        except Exception:
            time.sleep(.2)
    TOK = {}
    for k in KEYS:
        sql('delete from login_fail')
        TOK[k] = req('POST', '/api/auth/login', {'login': LOGIN[k], 'password': PW[k]})[1].get('token', '')
    ok(all(TOK.values()), 'фикстура: пользователи вошли')
    H = lambda k: {'Authorization': 'Bearer ' + TOK[k]}  # noqa: E731
    adm = lambda k, a, body=None: req('POST', '/api/admin/' + a, body or {}, H(k))  # noqa: E731
    hist = lambda k, qs: req('GET', '/api/history?' + qs, None, H(k))  # noqa: E731
    # --- события школы А (по порядку), потом школы Б
    steps = [('sup', 'role.assign', {'user_id': UID['dirA2'], 'role': 'director', 'school': 's-a', 'password': PW['sup']}, 'role.assign'),
             ('sup', 'role.remove', {'user_id': UID['dirA2'], 'role': 'director', 'school': 's-a', 'password': PW['sup']}, 'role.remove'),
             ('dirA', 'invite.create', {'role': 'teacher', 'school': 's-a'}, 'invite.create'),
             ('dirA', 'user.archive', {'user_id': UID['tA2']}, 'user.archive'),
             ('dirA', 'user.restore', {'user_id': UID['tA2']}, 'user.restore'),
             ('dirA', 'class.create', {'grade': 9, 'letter': 'Я', 'school_id': 's-a'}, 'class.create'),
             ('dirA', 'student.pin', {'student_id': 'st-cA2-1'}, 'student.pin_reset'),
             ('dirA', 'student.pin', {'student_id': 'st-cA1-2'}, 'student.pin_reset'),
             ('dirA', 'student.move', {'student_id': 'st-cA1-1', 'class_id': 'cA2'}, 'student.move'),
             ('dirA', 'student.archive', {'student_id': 'st-cA1-1'}, 'student.archive')]
    done = []
    for k, a, body, ev in steps:
        st, b, _ = adm(k, a, body)
        done.append(ev) if st == 200 else ok(False, 'шаг %s вернул %s %s' % (a, st, b))
        time.sleep(.01)
    sql('delete from login_fail')
    TOK['tA2'] = req('POST', '/api/auth/login', {'login': LOGIN['tA2'], 'password': PW['tA2']})[1].get('token', '')
    ok(len(done) == len(steps), 'события школы А созданы (%d из %d)' % (len(done), len(steps)))
    ok(adm('dirB', 'invite.create', {'role': 'teacher', 'school': 's-b'})[0] == 200, 'событие школы Б создано')
    st, b, raw = hist('dirA', 'school=s-a&size=100')
    acts = [i['action'] for i in b.get('items', []) if i['action'] != 'auth.login']
    ok(st == 200 and acts[:len(done)] == done[::-1], 'история школы А: свежие события первыми, все на месте (%s)' % acts[:len(done)])
    ok(any(i['action'] == 'user.archive' and i['name'] == 'tA2' for i in b['items']), 'user.archive с пустой school найден через роли, имя подставлено')
    ok(all(i['target'] != 'cB1' and 'st-cB1' not in i['target'] for i in b['items']) and acts.count('invite.create') == 1, 'в истории А нет событий школы Б')
    st, b2, _ = hist('dirB', 'school=s-b')
    ok(st == 200 and [i['action'] for i in b2['items'] if i['action'] in ('invite.create', 'student.move', 'student.pin_reset')] == ['invite.create'] and not any(i['target'].startswith('st-cA') or i['target'] == 'cA1' for i in b2['items']), 'история школы Б: только её события')
    ok(hist('dirA', 'school=s-b')[0] == 403, 'директор А по school=Б -> 403')
    ok(hist('dirA', 'school=-')[0] == 403, 'директор: school=- -> 403')
    ok(hist('sup', 'school=-')[0] == 200, 'суперадмин: school=- можно')
    ok(hist('dirA', '')[0] == 400, 'без school -> 400')
    ok(hist('dirA', 'school=s-a&kind=zzz')[0] == 400, 'неверный kind -> 400')
    ok(all(i['kind'] == 'student' for i in hist('dirA', 'school=s-a&kind=student')[1]['items']) and hist('dirA', 'school=s-a&kind=student')[1]['items'], 'фильтр kind=student')
    ok(hist('sup', 'school=s-a&from=%d&to=%d' % (NOW + 10 ** 9, NOW + 10 ** 9 + 1))[1]['items'] == [], 'фильтр from/to')
    ok(req('GET', '/api/history?school=s-a', None, {'X-Key': 'teach-secret'})[0] in (401, 403, 404), 'ключ учителя без токена доступа не получает')
    ok(req('GET', '/api/history?school=s-a')[0] in (401, 404), 'без токена -> отказ')
    # --- учитель
    st, bt, rawt = hist('tA1', 'school=s-a&size=100')
    ok(st == 200, 'учитель получает историю (%s)' % st)
    tgt = {(i['kind'], i['target']) for i in bt.get('items', [])}
    ok(tgt and all(k in ('student', 'class') for k, _ in tgt), 'учитель: только student и class')
    ok(('student', 'st-cA1-2') in tgt and ('student', 'st-cA1-1') not in tgt, 'учитель видит события своего ученика, но не перенесённого в чужой класс')
    ok(('student', 'st-cA2-1') not in tgt and ('class', 'cB1') not in tgt, 'учитель не видит учеников чужого класса и чужих классов')
    ok(not any(i['kind'] in ('user', 'invite', 'role') for i in bt['items']), 'учитель не видит события пользователей и приглашений')
    ok(hist('tA1', 'school=s-a&kind=user')[1]['items'] == [], 'учитель: kind=user пусто')
    ok(hist('tA1', 'school=s-b')[0] == 403 and hist('tA1', 'school=-')[0] == 403, 'учитель: чужая школа и "-" -> 403')
    st, bt2, _ = hist('tA2', 'school=s-a&size=100')
    t2 = {(i['kind'], i['target']) for i in bt2['items']}
    ok(('student', 'st-cA2-1') in t2 and ('student', 'st-cA1-1') in t2 and ('student', 'st-cA1-2') not in t2, 'второй учитель видит только свой класс')
    # --- ip и утечки
    st, bs, raws = hist('sup', 'school=s-a&size=100')
    ok(bs['items'] and all('ip' in i for i in bs['items']) and any(i['ip'] for i in bs['items']), 'у суперадмина ip есть')
    ok('"ip"' not in raw and all('ip' not in i for i in b['items']), 'у директора ip нет')
    ok('"ip"' not in rawt and all('ip' not in i for i in bt['items']), 'у учителя ip нет')
    leak = ['secret-hash', 'pinHash', 'hash', PW['dirA'], 'Bearer']
    ok(not any(x in raw + rawt + raws for x in leak), 'в ответах нет хэшей, паролей, токенов')
    sql("insert into audit_log(ts,actor_kind,actor_id,action,target_kind,target_id,school,detail,ip) values(?,?,?,?,?,?,?,?,?)",
        NOW + 600000, 'cli', 'x', 'test.detail', 'class', 'cA1', 's-a', json.dumps({'name': '5А', 'pinHash': 'LEAK', 'token': 'LEAK2', 'count': 3}), '10.1.2.3')
    for k in ('dirA', 'tA1', 'sup'):
        d = hist(k, 'school=s-a&size=1')[1]['items'][0]
        ok(d['action'] == 'test.detail' and d['detail'] == {'name': '5А', 'count': 3}, 'белый список detail (%s)' % k)
    ok(hist('sup', 'school=s-a&size=1')[1]['items'][0]['ip'] == '10.1.2.3' and 'ip' not in hist('dirA', 'school=s-a&size=1')[1]['items'][0], 'ip: суперадмину да, директору нет')
    # --- совместитель A+B: событие школы Б не видно директору А; пустое имя не заменяется логином
    sql("insert into audit_log(ts,actor_kind,actor_id,action,target_kind,target_id,school,detail,ip) values(?,?,?,?,?,?,?,?,?)",
        NOW + 650000, 'cli', 'x', 'role.assign', 'user', UID['multi'], 's-b', '{"role": "teacher"}', '')
    ha = hist('dirA', 'school=s-a&size=100')[1]['items']
    hb = hist('dirB', 'school=s-b&size=100')[1]['items']
    ok(not any(i['action'] == 'role.assign' and i['target'] == UID['multi'] and i['ts'] == NOW + 650000 for i in ha), 'совместитель: событие школы Б не видно директору А')
    ok(any(i['ts'] == NOW + 650000 for i in hb), 'совместитель: директор Б своё событие видит')
    ok(all(i['name'] == '' for i in hb if i['target'] == UID['multi']), 'name пользователя без имени пуст, логин не подставляется')
    ok(hist('sup', 'school=s-a&page=1001')[0] == 400 and hist('sup', 'school=s-a&from=99999999999999999999999')[0] == 400
       and hist('sup', 'school=s-a&to=-5')[0] == 400 and hist('sup', 'school=s-a&from=abc')[0] == 400, 'page > 1000 и дикие from/to -> 400')
    ok(hist('sup', 'school=s-a&page=1000&from=0&to=%d' % 10 ** 14)[0] == 200, 'граничные page, from, to допустимы')
    # --- страницы
    sql("create temp table x(i)") if False else None
    c = sqlite3.connect(os.path.join(tmp, 'vrlesson.db'))
    c.executemany("insert into audit_log(ts,actor_kind,actor_id,action,target_kind,target_id,school,detail,ip) values(?,'cli','x','student.create','student',?,'s-c','{}','')", [(NOW + 700000 + i, 'z%d' % i) for i in range(250)])
    c.commit()
    ok(len(hist('sup', 'school=s-c&size=500')[1]['items']) == 100 and hist('sup', 'school=s-c&size=500')[1]['size'] == 100, 'size=500 -> 100')
    p1, p2, p3 = (hist('sup', 'school=s-c&size=100&page=%d' % n)[1] for n in (1, 2, 3))
    ok((len(p1['items']), p1['more'], len(p2['items']), p2['more'], len(p3['items']), p3['more']) == (100, True, 100, True, 50, False), 'more верный на 250 строках')
    ok(p1['items'][0]['ts'] > p3['items'][-1]['ts'], 'сортировка по ts убыванию')
    # --- индексы и скорость
    c.executemany("insert into audit_log(ts,actor_kind,actor_id,action,target_kind,target_id,school,detail,ip) values(?,'cli','x','student.create',?,?,?,'{}','')",
                  [(NOW + i, 'class' if i % 4 == 1 else 'student', 'cA1' if i % 4 == 1 else 'q%d' % (i % 500), 's-a' if i % 2 else 's-b') for i in range(20000)])
    c.commit()
    c.execute('analyze')
    plans = {
        'директор': c.execute("explain query plan select ts from audit_log where (school = ? or (target_kind = 'user' and (school is null or school = '') and target_id in (select user_id from user_roles where school = ?))) order by ts desc, id desc limit 51", ('s-a', 's-a')).fetchall(),
        'учитель': c.execute("explain query plan select ts from audit_log where school = ? and ((target_kind = 'class' and target_id in (select id from classes where teacherId = ? and school = ?)) or (target_kind = 'student' and target_id in (select id from students where json_extract(doc, '$.classId') in (select id from classes where teacherId = ? and school = ?)))) order by ts desc, id desc limit 51", ('s-a', 'u', 's-a', 'u', 's-a')).fetchall()}
    c.close()
    for n, pl in plans.items():
        txt = ' | '.join(r[3] for r in pl)
        ok(not any(r[3].strip().startswith('SCAN audit_log') for r in pl) and 'audit_' in txt, 'EXPLAIN %s: без SCAN audit_log (%s)' % (n, txt[:160]))
    for k, nm in (('dirA', 'директор'), ('tA1', 'учитель'), ('sup', 'суперадмин')):
        t0 = time.time()
        st, bb, _ = hist(k, 'school=s-a&size=50')
        dt = (time.time() - t0) * 1000
        ok(st == 200 and len(bb['items']) == 50 and dt < 300, '20 000 строк журнала, %s: %d мс < 300' % (nm, dt))
    # --- флаг выключен
    app.save_config({'accounts': False, 'legacyTeacher': True, 'sessionMinutes': 15})
    ok(hist('sup', 'school=s-a')[0] == 404, 'accounts=false: /api/history — 404')
finally:
    print(open(os.path.join(tmp, 'server.log')).read()[-1500:]) if fails else None
    srv.terminate()
    srv.wait(timeout=10)
    log.close()
sys.exit(1 if fails else 0)
