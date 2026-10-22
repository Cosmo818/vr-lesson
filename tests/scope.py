"""Шаг 6 PLAN.md: права по поддереву в синхронизации и экспорте. Две школы, директора, учителя, суперадмин; живой сервер.
Запуск: python3 -I tests/scope.py. Печатает «ok  : …» / «FAIL: …»; tests/run.js включает строки в общий счёт."""
import json, os, sqlite3, subprocess, sys, tempfile, time, urllib.error, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
tmp = tempfile.mkdtemp()
PORT = 8796
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
PW = {u: 'Pass-%s-2026-Zq' % u for u in ('dirA', 'tA1', 'tA2', 'dirB', 'tB1', 'sup', 'nobody')}
LOGIN = {'dirA': 'dir.a', 'tA1': 't.a1', 'tA2': 't.a2', 'dirB': 'dir.b', 'tB1': 't.b1', 'sup': 'super.one', 'nobody': 'no.roles'}

app.init_db()
UID = {}
with app.db() as c:
    now = NOW
    for sid, name in (('s-a', 'Школа А'), ('s-b', 'Школа Б')):
        c.execute("INSERT INTO schools(id, name, region, status, network, created, updated) VALUES(?, ?, '', 'active', '', ?, ?)", (sid, name, now, now))
    for k, roles in (('dirA', [('director', 's-a')]), ('tA1', [('teacher', 's-a')]), ('tA2', [('teacher', 's-a')]), ('dirB', [('director', 's-b')]),
                     ('tB1', [('teacher', 's-b')]), ('sup', [('superadmin', '')]), ('nobody', [])):
        UID[k] = app.user_create(c, LOGIN[k], k, PW[k], WHO)
        for r, s in roles:
            app.role_add(c, UID[k], r, s, WHO)
    classes = [('cA1', 's-a', 'tA1', 5, 'А'), ('cA2', 's-a', 'tA2', 5, 'Б'), ('cA0', 's-a', None, 6, 'А'), ('cB1', 's-b', 'tB1', 7, 'А')]
    inc = {'classes': [{'id': i, 'grade': g, 'letter': l, 'created': now, 'updated': now, 'school': sch} for i, sch, t, g, l in classes],
           'students': [], 'results': [], 'disc': {}, 'settings': {'updated': now, 'minutes': 8, 'pinHash': 'legacy-hash-secret'}}
    for i, sch, t, g, l in classes:
        for n in (1, 2):
            sid = 'st-%s-%d' % (i, n)
            inc['students'].append({'id': sid, 'name': 'Ученик %s %d' % (i, n), 'grade': g, 'classId': i, 'created': now, 'updated': now, 'school': sch})
            inc['results'].append({'id': 'r-' + sid, 'sid': sid, 'subj': 'math', 'score': 4, 'total': 5, 'ts': now})
            inc['disc'][sid] = {'math:k': now}
    inc['students'].append({'id': 'st-loose-a', 'name': 'Без класса А', 'grade': 5, 'created': now, 'updated': now, 'school': 's-a'})
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
    for k in ('dirA', 'tA1', 'tA2', 'dirB', 'tB1', 'sup', 'nobody'):
        st, b = req('POST', '/api/auth/login', {'login': LOGIN[k], 'password': PW[k]})
        TOK[k] = b.get('token', '')
    ok(all(TOK.values()), 'фикстура: 7 пользователей двух школ вошли')
    H = lambda k: {'Authorization': 'Bearer ' + TOK[k]}  # noqa: E731
    sync = lambda k, body=None: req('POST', '/api/sync', body if body is not None else {}, H(k))  # noqa: E731

    # --- кто что видит
    st, b = sync('tA1'); S = b['state']
    ok(b['role'] == 'teacher' and b['user'] == 't.a1', 'учитель A1: синхронизация по токену проходит')
    ok(ids(S, 'classes') == ['cA1'], 'учитель A1 видит только свой класс (получено %s)' % ids(S, 'classes'))
    ok(ids(S, 'students') == ['st-cA1-1', 'st-cA1-2'], 'учитель A1 видит только своих учеников')
    ok(sorted(r['sid'] for r in S['results']) == ['st-cA1-1', 'st-cA1-2'] and sorted(S['disc']) == ['st-cA1-1', 'st-cA1-2'], 'учитель A1 видит результаты и открытия только своих учеников')
    ok('pinHash' not in S['settings'] and 'legacy-hash-secret' not in json.dumps(S), 'учитель не получает хэш пароля старой страницы (pinHash)')
    st, b = sync('tA2'); ok(ids(b['state'], 'classes') == ['cA2'] and ids(b['state'], 'students') == ['st-cA2-1', 'st-cA2-2'], 'учитель A2 видит только класс A2')
    st, b = sync('tB1'); ok(ids(b['state'], 'classes') == ['cB1'] and all(s.startswith('st-cB1') for s in ids(b['state'], 'students')), 'учитель другой школы (B1) видит только свой класс')
    st, b = sync('dirA'); S = b['state']
    ok(ids(S, 'classes') == ['cA0', 'cA1', 'cA2'], 'директор A видит все классы своей школы и ни одного чужого (%s)' % ids(S, 'classes'))
    ok(len(S['students']) == 7 and 'st-loose-a' in ids(S, 'students') and not any('cB1' in x for x in ids(S, 'students')), 'директор A видит 7 учеников своей школы (с учеником без класса), чужих нет')
    st, b = sync('dirB'); ok(ids(b['state'], 'classes') == ['cB1'] and len(b['state']['students']) == 2, 'директор B видит только свою школу')
    st, b = sync('sup'); ok(len(b['state']['classes']) == 4 and len(b['state']['students']) == 9 and b['state']['settings'].get('pinHash'), 'суперадмин видит всё')
    st, b = req('POST', '/api/sync', {}, H('nobody')); ok(st == 403, 'пользователь без ролей: 403')
    st, b = req('GET', '/api/export', headers=H('tA1')); ok(st == 200 and ids(b, 'classes') == ['cA1'] and len(b['students']) == 2, 'экспорт учителя содержит только его срез')
    st, b = req('POST', '/api/sync', {}, {'X-Key': 'teach-secret'}); ok(len(b['state']['classes']) == 4 and len(b['state']['students']) == 9 and b['state']['settings'].get('pinHash'), 'старый ключ teacher видит всё, как раньше')
    st, b = req('POST', '/api/sync', {}, {'X-Key': 'dev-secret'}); ok(b['role'] == 'device' and len(b['state']['classes']) == 4 and len(b['state']['students']) == 9, 'ключ шлема видит и работает, как раньше')

    # --- запись
    t2 = NOW + 1000
    st, b = sync('tA1', {'students': [{'id': 'hack1', 'name': 'Подброшенный', 'grade': 5, 'classId': 'cA2', 'created': t2, 'updated': t2}]})
    ok(b['rejected'].get('students') == 1 and not sql("select 1 from students where id='hack1'"), 'учитель A1 не может добавить ученика в чужой класс A2 (rejected=1)')
    st, b = sync('tA1', {'students': [{'id': 'hack2', 'name': 'В чужую школу', 'grade': 5, 'classId': 'cB1', 'created': t2, 'updated': t2}]})
    ok(b['rejected'].get('students') == 1 and not sql("select 1 from students where id='hack2'"), 'учитель A1 не может добавить ученика в класс другой школы')
    st, b = sync('tA1', {'students': [{'id': 'hack3', 'name': 'Без класса', 'grade': 5, 'created': t2, 'updated': t2}]})
    ok(b['rejected'].get('students') == 1, 'учитель не может добавить ученика без класса')
    st, b = sync('tA1', {'students': [{'id': 'st-cA2-1', 'name': 'Переименован чужим', 'grade': 5, 'classId': 'cA2', 'created': NOW, 'updated': t2}]})
    ok(b['rejected'].get('students') == 1 and sql("select json_extract(doc,'$.name') from students where id='st-cA2-1'")[0][0] == 'Ученик cA2 1', 'учитель A1 не может изменить ученика чужого класса')
    st, b = sync('tA1', {'students': [{'id': 'st-cA1-1', 'name': 'Переименован своим', 'grade': 5, 'classId': 'cA1', 'created': NOW, 'updated': t2, 'school': 's-b'}]})
    ok(not b['rejected'] and sql("select json_extract(doc,'$.name'), school from students where id='st-cA1-1'")[0] == ('Переименован своим', 's-a'), 'учитель меняет своего ученика; присланная чужая школа игнорируется')
    st, b = sync('tA1', {'students': [{'id': 'st-cA1-2', 'name': 'Перенос', 'grade': 5, 'classId': 'cA2', 'created': NOW, 'updated': t2}]})
    ok(b['rejected'].get('students') == 1 and sql("select json_extract(doc,'$.classId') from students where id='st-cA1-2'")[0][0] == 'cA1', 'учитель не может перенести своего ученика в чужой класс')
    st, b = sync('tA1', {'students': [{'id': 'new-own', 'name': 'Новичок', 'grade': 5, 'classId': 'cA1', 'created': t2, 'updated': t2}]})
    ok(not b['rejected'] and sql("select school from students where id='new-own'")[0][0] == 's-a', 'учитель добавляет ученика в свой класс')
    st, b = sync('tA1', {'classes': [{'id': 'cA1', 'grade': 5, 'letter': 'А', 'created': NOW, 'updated': t2, 'teacherId': UID['tA2'], 'school': 's-b'}]})
    r = sql("select teacherId, school from classes where id='cA1'")[0]
    ok(r == (UID['tA1'], 's-a'), 'присланные teacherId и школа существующего класса игнорируются (остался %s)' % (r,))
    st, b = sync('tA1', {'classes': [{'id': 'cA2', 'grade': 5, 'letter': 'Х', 'created': NOW, 'updated': t2}]})
    ok(b['rejected'].get('classes') == 1 and sql("select doc from classes where id='cA2'")[0][0].find('"letter": "Х"') < 0, 'учитель не может изменить чужой класс')
    st, b = sync('tA1', {'classes': [{'id': 'cNew1', 'grade': 6, 'letter': 'В', 'created': t2, 'updated': t2, 'school': 's-b', 'teacherId': UID['tA2']}]})
    r = sql("select teacherId, school from classes where id='cNew1'")
    ok(r and r[0] == (UID['tA1'], 's-a'), 'новый класс учителя: teacherId = он, школа = его школа (%s)' % (r,))
    st, b = sync('tA2'); ok('cNew1' not in ids(b['state'], 'classes'), 'другой учитель нового класса не видит')
    st, b = sync('tA1', {'deleted': {'st-cA2-2': t2}})
    ok(b['rejected'].get('deleted') == 1 and sql("select 1 from students where id='st-cA2-2'") and not sql("select 1 from deleted where id='st-cA2-2'"), 'учитель не может удалить ученика чужого класса')
    st, b = sync('tA1', {'deleted': {'no-such-id': t2}})
    ok(b['rejected'].get('deleted') == 1 and not sql("select 1 from deleted where id='no-such-id'"), 'удаление неизвестного id отклонено (надгробие на будущий id запрещено)')
    st, b = sync('tA1', {'results': [{'id': 'rr1', 'sid': 'st-cA2-1', 'subj': 'math', 'score': 5, 'total': 5, 'ts': t2}, {'id': 'rr2', 'sid': 'st-cA1-1', 'subj': 'math', 'score': 5, 'total': 5, 'ts': t2}]})
    ok(b['rejected'].get('results') == 1 and sql("select count(*) from results where id='rr1'")[0][0] == 0 and sql("select count(*) from results where id='rr2'")[0][0] == 1, 'результат чужого ученика отклонён, своего принят')
    st, b = sync('tA1', {'disc': {'st-cA2-1': {'x:y': t2}, 'st-cA1-1': {'x:y': t2}}})
    ok(b['rejected'].get('disc') == 1 and sql("select count(*) from disc where k='x:y'")[0][0] == 1, 'открытие чужого ученика отклонено, своего принято')
    st, b = sync('tA1', {'settings': {'updated': t2, 'minutes': 9}})
    ok(sql("select json_extract(doc,'$.pinHash'), json_extract(doc,'$.minutes') from settings")[0] == ('legacy-hash-secret', 9), 'настройки меняет пользователь, а хэш пароля старой страницы сохраняется на сервере')
    # директор
    st, b = sync('dirA', {'classes': [{'id': 'cDirNew', 'grade': 8, 'letter': 'Г', 'created': t2, 'updated': t2, 'school': 's-b', 'teacherId': UID['dirA']}], 'students': [{'id': 'dir-st', 'name': 'Директорский', 'grade': 8, 'classId': 'cA0', 'created': t2, 'updated': t2}]})
    r = sql("select teacherId, school from classes where id='cDirNew'")
    ok(r and r[0][1] == 's-a' and r[0][0] is None, 'директор создаёт класс только в своей школе, без учителя (%s)' % (r,))
    ok(sql("select school from students where id='dir-st'")[0][0] == 's-a', 'директор добавляет ученика в класс без учителя своей школы')
    st, b = sync('dirA', {'students': [{'id': 'dir-bad', 'name': 'Чужой', 'grade': 8, 'classId': 'cB1', 'created': t2, 'updated': t2}]})
    ok(b['rejected'].get('students') == 1, 'директор A не может писать в школу B')
    st, b = sync('dirA', {'deleted': {'st-cB1-1': t2}})
    ok(b['rejected'].get('deleted') == 1 and not sql("select 1 from deleted where id='st-cB1-1'"), 'директор A не может удалить ученика школы B')
    st, b = sync('dirA', {'deleted': {'st-loose-a': t2}})
    ok(not b['rejected'] and sql("select 1 from deleted where id='st-loose-a'"), 'директор удаляет ученика своей школы')
    st, b = sync('sup', {'students': [{'id': 'sup-st', 'name': 'От суперадмина', 'grade': 5, 'classId': 'cB1', 'created': t2, 'updated': t2}]})
    ok(not b['rejected'] and sql("select 1 from students where id='sup-st'"), 'суперадмин пишет в любую школу')
    # журнал
    acts = sql("select actor_kind, action from audit_log where action = 'sync.rejected'")
    ok(acts and all(a[0] == 'user' for a in acts), 'отклонённые записи попали в журнал (%d записей от user)' % len(acts))
    det = ' '.join(str(x[0]) for x in sql("select detail from audit_log where action = 'sync.rejected'"))
    ok('Подброшенный' not in det and 'hack1' not in det, 'в журнале отклонений нет содержимого, только счётчики')
    ok(sql("select count(*) from audit_log where actor_kind='user' and action in ('student.create','class.create')")[0][0] >= 3, 'создания пользователями записаны в журнал от user')
    # закрытие старого ключа
    app.save_config({'accounts': True, 'legacyTeacher': False, 'sessionMinutes': 15})
    st, b = req('POST', '/api/sync', {}, {'X-Key': 'teach-secret'}); ok(st == 401, 'legacyTeacher=false: старый ключ teacher отключён')
    st, b = req('POST', '/api/sync', {}, {'X-Key': 'dev-secret'}); ok(st == 200 and b['role'] == 'device', 'legacyTeacher=false: ключ шлема работает')
    st, b = sync('tA1'); ok(st == 200 and ids(b['state'], 'classes') == ['cA1', 'cNew1'], 'legacyTeacher=false: учитель по токену работает')
    app.save_config({'accounts': False, 'legacyTeacher': True, 'sessionMinutes': 15})
    st, b = req('POST', '/api/sync', {}, H('tA1')); ok(st == 401, 'accounts=false: токен не принимается, сервер возвращается к ключам')
    st, b = req('POST', '/api/sync', {}, {'X-Key': 'teach-secret'}); ok(st == 200 and len(b['state']['classes']) >= 5, 'accounts=false: старый ключ teacher полностью работает')
finally:
    srv.terminate()
    srv.wait(timeout=10)
    log.close()
sys.exit(1 if fails else 0)
