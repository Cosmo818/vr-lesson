"""Шаги 7–8 PLAN.md: администрирование (роли, архив, сброс пароля, перенос) и поиск/фильтры. Две школы, директора, учителя, суперадмин; живой сервер.
Запуск: python3 -I tests/admin.py. Печатает «ok  : …» / «FAIL: …»; tests/run.js включает строки в общий счёт."""
import json, os, urllib.parse, sqlite3, subprocess, sys, tempfile, time, urllib.error, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
tmp = tempfile.mkdtemp()
PORT = 8797
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
PW = {u: 'Pass-%s-2026-Zq' % u for u in ('dirA', 'tA1', 'tA2', 'dirB', 'tB1', 'sup', 'nobody', 'dirA2')}
LOGIN = {'dirA': 'dir.a', 'tA1': 't.a1', 'tA2': 't.a2', 'dirB': 'dir.b', 'tB1': 't.b1', 'sup': 'super.one', 'nobody': 'no.roles', 'dirA2': 'dir.a2'}

app.init_db()
UID = {}
with app.db() as c:
    now = NOW
    for sid, name in (('s-a', 'Школа А'), ('s-b', 'Школа Б')):
        c.execute("INSERT INTO schools(id, name, region, status, network, created, updated) VALUES(?, ?, '', 'active', '', ?, ?)", (sid, name, now, now))
    for k, roles in (('dirA', [('director', 's-a')]), ('tA1', [('teacher', 's-a')]), ('tA2', [('teacher', 's-a')]), ('dirB', [('director', 's-b')]),
                     ('tB1', [('teacher', 's-b')]), ('sup', [('superadmin', '')]), ('nobody', []), ('dirA2', [])):
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

    def login(k):
        sql('delete from login_fail')
        st, b = req('POST', '/api/auth/login', {'login': LOGIN[k], 'password': PW[k]})
        TOK[k] = b.get('token', '')
        return st

    for k in LOGIN:
        login(k)
    ok(all(TOK.values()), 'фикстура: 8 пользователей вошли')
    H = lambda k: {'Authorization': 'Bearer ' + TOK[k]}  # noqa: E731
    adm = lambda k, act, body=None: (sql('delete from login_fail'), req('POST', '/api/admin/' + act, dict(body or {}, **({'password': PW[k]} if (body or {}).get('role') == 'director' else {})), H(k)))[1]  # noqa: E731
    act = lambda body: (sql('delete from login_fail'), req('POST', '/api/auth/activate', body))[1]  # noqa: E731
    audits = lambda a: sql("select count(*) from audit_log where action=?", a)[0][0]  # noqa: E731

    # --- права на роли
    st, b = adm('tA1', 'role.assign', {'user_id': UID['tA2'], 'role': 'director', 'school': 's-a'}); ok(st == 403, 'учитель не выдаёт роль director другому (%s)' % st)
    st, b = adm('tA1', 'role.assign', {'user_id': UID['tA1'], 'role': 'director', 'school': 's-a'}); ok(st == 403, 'учитель не выдаёт director себе')
    ok(audits('admin.denied') >= 1, 'отказ записан в журнал (admin.denied)')
    st, b = adm('dirA', 'role.assign', {'user_id': UID['dirA2'], 'role': 'superadmin', 'school': ''}); ok(st == 403, 'директор не выдаёт superadmin')
    st, b = adm('dirA', 'role.assign', {'user_id': UID['dirA'], 'role': 'teacher', 'school': 's-a'}); ok(st == 403, 'свои роли менять нельзя')
    st, b = adm('dirA', 'role.assign', {'user_id': UID['dirA2'], 'role': 'teacher', 'school': 's-b'}); ok(st == 403, 'директор А не выдаёт роль в школе Б')
    st, b = adm('dirA', 'role.assign', {'user_id': UID['dirA2'], 'role': 'teacher', 'school': 's-a'}); ok(st == 200, 'директор А делает учителем своей школы')
    st, b = adm('dirA', 'role.assign', {'user_id': UID['dirA2'], 'role': 'director', 'school': 's-a'}); ok(st == 403, 'директор не делает директоров (это суперадмин)')
    st, b = adm('sup', 'role.assign', {'user_id': UID['dirA2'], 'role': 'director', 'school': 's-a'}); ok(st == 200, 'суперадмин назначает второго директора')
    st, b = req('POST', '/api/admin/role.assign', {'user_id': UID['dirA2'], 'role': 'director', 'school': 's-a'}, H('sup')); ok(st == 403, 'смена директора без повторного пароля отклонена')
    st, b = req('POST', '/api/admin/role.assign', {'user_id': UID['dirA2'], 'role': 'director', 'school': 's-a', 'password': 'wrong-password-1'}, H('sup')); ok(st == 403, 'смена директора с чужим паролем отклонена')
    # --- последний директор
    st, b = adm('sup', 'role.remove', {'user_id': UID['dirB'], 'role': 'director', 'school': 's-b'}); ok(st == 400, 'последнего директора школы Б снять нельзя (%s)' % st)
    st, b = adm('sup', 'user.archive', {'user_id': UID['dirB']}); ok(st == 400, 'последнего директора нельзя архивировать')
    st, b = adm('sup', 'role.remove', {'user_id': UID['dirA2'], 'role': 'director', 'school': 's-a'}); ok(st == 200, 'при двух директорах одного снять можно')
    st, b = adm('sup', 'user.archive', {'user_id': UID['sup']}); ok(st == 403, 'суперадмин не архивирует сам себя')
    # --- архив
    st, b = adm('dirA', 'user.archive', {'user_id': UID['tB1']}); ok(st == 403, 'директор А не архивирует учителя школы Б')
    st, b = adm('dirA', 'user.archive', {'user_id': UID['tA2']}); ok(st == 200, 'директор А архивирует учителя своей школы')
    ok(sql('select status from users where id=?', UID['tA2'])[0][0] == 'archived', 'учётка осталась в базе со статусом archived (не удалена)')
    ok(login('tA2') == 401, 'архивный пользователь войти не может')
    ok(sql("select count(*) from sessions where user_id=? and revoked_at is null", UID['tA2'])[0][0] == 0 if 'revoked_at' in [r[1] for r in sql('pragma table_info(sessions)')] else True, 'сессии архивного отозваны')
    st, b = adm('dirA', 'user.restore', {'user_id': UID['tA2']}); ok(st == 200 and login('tA2') == 200, 'восстановление возвращает вход')
    # --- сброс пароля
    old = TOK['tA1']
    st, b = adm('tA1', 'password.reset', {'user_id': UID['tA2']}); ok(st == 403, 'учитель не сбрасывает пароли')
    st, b = adm('dirB', 'password.reset', {'user_id': UID['tA1']}); ok(st == 403, 'директор Б не сбрасывает пароль учителю А')
    st, b = adm('dirA', 'password.reset', {'user_id': UID['tA1']}); code = b.get('code', '')
    ok(st == 200 and len(code) == 10, 'директор А выдаёт код сброса своему учителю (10 знаков)')
    st, _ = req('POST', '/api/sync', {}, {'Authorization': 'Bearer ' + old}); ok(st == 401, 'после сброса старые сессии учителя отозваны')
    ok(sql("select count(*) from audit_log where detail like ?", '%' + code + '%')[0][0] == 0, 'код сброса в журнал не попал')
    ok(sql("select count(*) from invites where code_hash=?", code)[0][0] == 0, 'код в базе только в виде хэша')
    # --- передача класса
    st, b = adm('dirA', 'class.assign', {'class_id': 'cB1', 'teacher_id': UID['tA1']}); ok(st == 403, 'нельзя передать класс чужой школы')
    st, b = adm('dirA', 'class.assign', {'class_id': 'cA2', 'teacher_id': UID['tB1']}); ok(st == 400, 'нельзя передать класс учителю другой школы')
    login('tA2')
    st, b = req('POST', '/api/sync', {}, H('tA2')); ok('cA2' in [x['id'] for x in b['state']['classes']], 'до передачи учитель A2 видит свой класс')
    st, b = adm('dirA', 'class.assign', {'class_id': 'cA2', 'teacher_id': UID['nobody']}); ok(st == 400, 'класс нельзя отдать не-учителю')
    st, b = adm('dirA', 'class.assign', {'class_id': 'cA2', 'teacher_id': UID['tA1']}); ok(st == 200, 'директор передаёт класс другому учителю')
    st, b = req('POST', '/api/sync', {}, H('tA2')); ok('cA2' not in [x['id'] for x in b['state']['classes']], 'бывший учитель класс больше не видит')
    login('tA1')
    st, b = req('POST', '/api/sync', {}, H('tA1')); ok({'cA1', 'cA2'} <= {x['id'] for x in b['state']['classes']}, 'новый учитель видит класс')
    # --- создание и перенос класса с выбором школы (админка)
    st, b = adm('dirA', 'class.create', {'grade': 9, 'letter': 'я', 'school_id': 's-a', 'teacher_id': UID['tA1']}); ok(st == 200 and b.get('id'), 'директор создаёт класс в своей школе с учителем')
    nid = b.get('id')
    ok(sql("select school, teacherId, name from classes where id=?", nid)[0] == ('s-a', UID['tA1'], '9Я'), 'класс записан: школа, учитель, имя 9Я')
    st, b = adm('dirA', 'class.create', {'grade': 9, 'letter': 'Я', 'school_id': 's-a'}); ok(st == 400, 'дубль класса в школе не создаётся')
    st, b = adm('dirA', 'class.create', {'grade': 9, 'letter': 'Ю', 'school_id': 's-b'}); ok(st == 403, 'директор не создаёт класс в чужой школе')
    st, b = adm('tA1', 'class.create', {'grade': 9, 'letter': 'Ю', 'school_id': 's-a'}); ok(st == 403, 'учитель через админку класс не создаёт')
    st, b = adm('sup', 'class.create', {'grade': 9, 'letter': 'Ю', 'school_id': 's-b', 'teacher_id': UID['tA1']}); ok(st == 400, 'учитель должен быть из выбранной школы')
    st, b = adm('sup', 'class.create', {'grade': 9, 'letter': 'Ю', 'school_id': 's-b', 'teacher_id': UID['tB1']}); ok(st == 200, 'суперадмин создаёт класс в любой школе')
    sql("delete from classes where id in (?, ?)", nid, b.get('id'))  # тестовые классы убираем, чтобы не менять счётчики ниже
    # --- ученики
    st, b = adm('tA1', 'student.move', {'student_id': 'st-cA1-1', 'class_id': 'cA2'}); ok(st == 200, 'учитель переносит ученика между своими классами')
    st, b = adm('tA1', 'student.move', {'student_id': 'st-cA1-2', 'class_id': 'cB1'}); ok(st == 403, 'учитель не переносит в чужую школу')
    st, b = adm('tA1', 'student.pin', {'student_id': 'st-cB1-1'}); ok(st in (403, 404), 'учитель не сбрасывает PIN чужого ученика')
    st, b = adm('tA1', 'student.pin', {'student_id': 'st-cA1-2'}); ok(st == 200, 'учитель сбрасывает PIN своего ученика')
    st, b = adm('tA1', 'school.create', {'name': 'X'}); ok(st == 403, 'учитель школу не создаёт')
    st, b = adm('sup', 'school.create', {'name': 'Школа В', 'id': 's-volga', 'region': 'Татарстан'}); ok(st == 200, 'суперадмин создаёт школу')
    st, b = adm('sup', 'school.create', {'name': 'Школа В', 'id': 's-volga'}); ok(st == 400, 'повторный код школы отклонён')
    st, b = req('POST', '/api/admin/nope', {}, H('sup')); ok(st == 404, 'неизвестное действие — 404')
    st, b = req('POST', '/api/admin/user.archive', {'user_id': UID['tB1']}, {'X-Key': 'teach-secret'}); ok(st in (401, 403), 'админ-API ключом не открывается')
    # --- шаг 8: фильтры
    get = lambda k, path: req('GET', urllib.parse.quote(path, safe='/?&=%'), None, H(k))  # noqa: E731
    st, b = get('sup', '/api/options?level=region'); ok(st == 200 and any(i['id'] == 'Татарстан' for i in b['items']), 'options region: суперадмин видит регионы')
    st, b = get('sup', '/api/options?level=school'); ok(len(b['items']) >= 3, 'options school: суперадмин видит все школы')
    st, b = get('dirA', '/api/options?level=school'); ok([i['id'] for i in b['items']] == ['s-a'], 'директор А видит только свою школу')
    st, b = get('dirA', '/api/options?level=class&parent=s-b'); ok(b['items'] == [], 'классы чужой школы не отдаются')
    st, b = get('dirA', '/api/options?level=class&parent=s-a'); ok(len(b['items']) == 3, 'директор А: 3 класса школы')
    st, b = get('tA1', '/api/options?level=class&parent=s-a'); ok(len(b['items']) == 2, 'учитель видит только свои классы (%d)' % len(b['items']))
    st, b = get('tA1', '/api/options?level=teacher&parent=s-a'); ok([i['id'] for i in b['items']] == [UID['tA1']], 'учитель в списке учителей видит только себя')
    st, b = get('dirA', '/api/options?level=teacher&parent=s-a'); ok(UID['tA1'] in [i['id'] for i in b['items']], 'директор видит учителей школы')
    st, b = get('dirA', '/api/accounts?kind=students&size=3&page=1'); ok(st == 200 and len(b['items']) == 3 and b['total'] >= 6, 'students: страница размера 3, total %s' % b.get('total'))
    ok(all(i['school'] == 's-a' for i in b['items']), 'students: только своя школа')
    ok('pinHash' not in json.dumps(b), 'students: хэша PIN в ответе нет')
    st, b = get('dirA', '/api/accounts?kind=students&school=s-b'); ok(b['items'] == [] and b['total'] == 0, 'students: фильтр по чужой школе пуст')
    st, b = get('tA1', '/api/accounts?kind=students'); ok(b['total'] == 4 and all(i['classId'] in ('cA1', 'cA2') for i in b['items']), 'учитель видит учеников только своих классов (%s)' % b.get('total'))
    st, b = get('dirA', '/api/accounts?kind=students&q=%25'); ok(b['total'] == 0, 'знак %% в поиске экранирован')
    st, b = get('dirA', '/api/accounts?kind=students&q=' + urllib.request.quote('Без класса')); ok(b['total'] == 1, 'поиск по имени находит ученика без класса (директору)')
    st, b = get('tA1', '/api/accounts?kind=students&q=' + urllib.request.quote('Без класса')); ok(b['total'] == 0, 'учитель без-классного не видит')
    st, b = get('dirA', '/api/accounts?kind=teachers'); ok(st == 200 and all('hash' not in k for i in b['items'] for k in i), 'teachers: список без хэшей')
    st, b = get('tA1', '/api/accounts?kind=teachers'); ok(st == 403, 'учитель список учителей не получает')
    st, b = get('dirA', '/api/accounts?kind=classes'); ok(st == 200 and b['total'] == 3 and all('students' in i for i in b['items']), 'classes: с числом учеников')
    st, b = get('dirA', '/api/accounts?kind=students&size=5000'); ok(b['size'] == 100, 'size ограничен 100')
    st, b = get('nobody', '/api/accounts?kind=students'); ok(st == 403, 'пользователь без ролей — 403')
    st, b = req('GET', '/api/accounts?kind=students'); ok(st == 401, 'без токена — 401')
    # --- производительность: 2000 учеников
    cc = sqlite3.connect(os.path.join(tmp, 'vrlesson.db'))
    for i in range(2000):
        d = {'id': 'bulk%d' % i, 'name': 'Масс Ученик %04d' % i, 'grade': 5, 'classId': 'cA1', 'school': 's-a', 'created': NOW, 'updated': NOW}
        cc.execute('INSERT INTO students(id, name, grade, school, status, updated, doc) VALUES(?, ?, 5, ?, ?, ?, ?)', (d['id'], d['name'], 's-a', 'active', NOW, json.dumps(d, ensure_ascii=False)))
    cc.commit(); cc.close()
    t0 = time.time(); st, b = get('dirA', '/api/accounts?kind=students&q=' + urllib.request.quote('Масс') + '&size=50&page=3'); dt = time.time() - t0
    ok(st == 200 and b['total'] == 2000 and len(b['items']) == 50 and dt < .3, '2000 учеников: страница за %d мс' % (dt * 1000))
    plan = ' '.join(str(r) for r in sql("explain query plan select id from students where json_extract(doc,'$.classId') in ('cA1')"))
    ok('students_class' in plan, 'фильтр по классу идёт по индексу')
    # --- шаг 11: приглашения и коды сброса
    st, b = adm('tA1', 'invite.create', {'role': 'teacher', 'school': 's-a'}); ok(st == 403, 'учитель не создаёт приглашений')
    st, b = adm('dirA', 'invite.create', {'role': 'teacher', 'school': 's-b'}); ok(st == 403, 'директор А не приглашает в школу Б')
    st, b = adm('dirA', 'invite.create', {'role': 'director', 'school': 's-a'}); ok(st == 403, 'директор не приглашает директора')
    st, b = adm('dirA', 'invite.create', {'role': 'teacher', 'school': 's-a'}); code = b.get('code', '')
    ok(st == 200 and len(code) == 10 and all(ch in app.CODE_ALPHA for ch in code), 'директор приглашает учителя: код 10 знаков без похожих букв')
    ok(sql("select count(*) from audit_log where detail like ? or target_id like ?", '%' + code + '%', '%' + code + '%')[0][0] == 0 and sql("select count(*) from invites where code_hash=?", code)[0][0] == 0, 'код не попал ни в журнал, ни в базу открытым текстом')
    st, b = adm('dirA', 'invite.list', {}); ok(st == 200 and len(b['items']) == 1 and 'code' not in json.dumps(b), 'список приглашений без кодов')
    st, b = act({'code': 'ZZZZZZZZZZ', 'login': 'new.teacher', 'password': 'Good-pass-2026-Qw'}); ok(st == 400, 'неверный код отклонён')
    st, b = act({'code': code, 'login': 'new.teacher', 'password': 'short'}); ok(st == 400, 'слабый пароль отклонён, код не сгорел')
    st, b = act({'code': code[:5] + '-' + code[5:].lower(), 'login': 'new.teacher', 'password': 'Good-pass-2026-Qw', 'name': 'Новый Учитель'})
    ok(st == 200 and b['roles'] == [{'role': 'teacher', 'school': 's-a'}] and b.get('token'), 'активация: учётка создана с ролью учителя школы А, сессия выдана')
    st, b2 = req('POST', '/api/auth/login', {'login': 'new.teacher', 'password': 'Good-pass-2026-Qw'}); ok(st == 200, 'новый учитель входит по логину и паролю')
    st, b = req('POST', '/api/sync', {}, {'Authorization': 'Bearer ' + b2['token']}); ok(st == 200 and b['state']['classes'] == [], 'новый учитель видит только своё: классов пока нет')
    st, b = act({'code': code, 'login': 'other.one', 'password': 'Good-pass-2026-Qw'}); ok(st == 400, 'повторная активация того же кода отклонена')
    st, b = adm('dirA', 'invite.create', {'role': 'teacher', 'school': 's-a'}); c2 = b['code']
    sql("update invites set expires=1 where used_at is null")
    st, b = act({'code': c2, 'login': 'late.one', 'password': 'Good-pass-2026-Qw'}); ok(st == 400, 'просроченный код отклонён')
    st, b = adm('dirA', 'invite.create', {'role': 'teacher', 'school': 's-a'}); c3 = b['code']
    st, b = adm('dirA', 'invite.list', {}); iid = b['items'][0]['id']
    st, b = adm('dirB', 'invite.revoke', {'id': iid}); ok(st == 404, 'директор Б не отзывает приглашение школы А')
    st, b = adm('dirA', 'invite.revoke', {'id': iid}); ok(st == 200, 'директор отзывает своё приглашение')
    st, b = act({'code': c3, 'login': 'revoked.one', 'password': 'Good-pass-2026-Qw'}); ok(st == 400, 'отозванный код не работает')
    st, b = adm('sup', 'invite.create', {'role': 'director', 'school': 's-b'}); dc = b.get('code', ''); ok(st == 200 and dc, 'суперадмин приглашает директора (с подтверждением паролем)')
    st, b = act({'code': dc, 'login': 'dir.b2', 'password': 'Good-pass-2026-Qw'}); ok(st == 200 and b['roles'][0]['role'] == 'director', 'приглашённый директор активирует учётку')
    st, b = adm('dirA', 'password.reset', {'user_id': UID['tA1']}); rc = b['code']
    st, b = act({'code': rc, 'password': 'Brand-new-pass-2027-Xz'}); ok(st == 200, 'код сброса: учитель задаёт новый пароль без логина')
    PW['tA1'] = 'Brand-new-pass-2027-Xz'; ok(login('tA1') == 200, 'после сброса вход по новому паролю')
    st, b = act({'code': rc, 'password': 'Another-pass-2028-Xz'}); ok(st == 400, 'код сброса одноразовый')
    sql("delete from login_fail")
    codes_wrong = [req('POST', '/api/auth/activate', {'code': 'BAD%07d' % i, 'login': 'x.y.z', 'password': 'Good-pass-2026-Qw'})[0] for i in range(8)]
    ok(429 in codes_wrong, 'подбор кодов: после серии ошибок — пауза 429')
    sql("delete from login_fail")
    # --- шаг 12: шлемы школ
    st, b = adm('tA1', 'device.code', {'school': 's-a'}); ok(st == 403, 'учитель не выпускает коды шлемов')
    st, b = adm('dirA', 'device.code', {'school': 's-b'}); ok(st == 403, 'директор А не выпускает код для школы Б')
    st, b = adm('sup', 'school.update', {'id': 's-a', 'device_limit': 1}); ok(st == 200, 'суперадмин задаёт лимит шлемов школы')
    st, b = adm('dirA', 'school.update', {'id': 's-a', 'device_limit': 99}); ok(st == 403, 'директор лимит менять не может')
    st, b = adm('dirA', 'device.code', {'school': 's-a', 'name': 'Шлем 1'}); pc = b.get('code', ''); ok(st == 200 and len(pc) == 8, 'директор выпускает код привязки (8 знаков)')
    st, b = adm('dirA', 'device.code', {'school': 's-a'}); ok(st == 400 and 'Лимит' in b['error'], 'сверх лимита код не выдаётся, текст понятный')
    st, b = req('POST', '/api/device/pair', {'code': 'NOPE2345'}); ok(st == 400, 'неверный код привязки отклонён')
    st, b = req('POST', '/api/device/pair', {'code': pc}); dkey = b.get('key', ''); ok(st == 200 and len(dkey) > 20 and b['school'] == 's-a', 'шлем привязан: ключ выдан')
    st, b = req('POST', '/api/device/pair', {'code': pc}); ok(st == 400, 'код привязки одноразовый')
    ok(sql("select count(*) from audit_log where detail like ? or target_id like ?", '%' + dkey + '%', '%' + dkey + '%')[0][0] == 0 and sql("select count(*) from devices where key_hash=?", dkey)[0][0] == 0, 'ключ шлема не хранится открытым текстом и не в журнале')
    DK = {'X-Key': dkey}
    st, b = req('POST', '/api/sync', {}, DK); S2 = b['state']
    ok(st == 200 and b['role'] == 'device' and {x['school'] for x in S2['students']} == {'s-a'} and S2['students'], 'шлем школы А видит только учеников своей школы (%d)' % len(S2['students']))
    ok(all(r['sid'].startswith('st-') and any(x['id'] == r['sid'] for x in S2['students']) for r in S2['results']), 'шлему приходят результаты только его школы')
    NOW2 = NOW + 5
    inc = {'students': [{'id': 'dev-new1', 'name': 'С шлема', 'grade': 5, 'classId': 'cB1', 'created': NOW2, 'updated': NOW2, 'school': 's-b'}],
           'results': [{'id': 'r-dev1', 'sid': 'dev-new1', 'subj': 'math', 'score': 3, 'total': 5, 'ts': NOW2}, {'id': 'r-dev2', 'sid': 'st-cB1-1', 'subj': 'math', 'score': 5, 'total': 5, 'ts': NOW2}], 'disc': {'st-cB1-1': {'math:z': NOW2}}}
    st, b = req('POST', '/api/sync', inc, DK)
    row = sql("select school, json_extract(doc,'$.classId') from students where id='dev-new1'")[0]
    ok(row == ('s-a', None), 'шлем школы А создаёт ученика только в школе А, чужой класс отброшен (%s)' % (row,))
    ok(sql("select count(*) from results where id='r-dev1'")[0][0] == 1 and sql("select count(*) from results where id='r-dev2'")[0][0] == 0 and sql("select count(*) from disc where sid='st-cB1-1' and k='math:z'")[0][0] == 0, 'результат нового ученика принят, результаты и открытия чужой школы — нет')
    st, b = req('POST', '/api/sync', {}, {'X-Key': 'dev-secret'}); ok(st == 200 and {x['school'] for x in b['state']['students']} >= {'s-a', 's-b'}, 'старый общий ключ шлема работает как раньше (видит всё)')
    st, b = adm('dirA', 'device.list', {'school': 's-a'}); ok(st == 200 and b['active'] == 1 and b['limit'] == 1 and 'key' not in json.dumps(b), 'директор видит шлемы школы и лимит, без ключей')
    st, b = adm('dirB', 'device.list', {'school': 's-a'}); ok(st == 403, 'чужая школа шлемы не видит')
    did = sql("select id from devices")[0][0]
    st, b = adm('dirB', 'device.revoke', {'id': did}); ok(st == 403, 'директор Б не отзывает шлем школы А')
    st, b = adm('dirA', 'device.revoke', {'id': did}); ok(st == 200, 'директор отзывает шлем')
    st, b = req('POST', '/api/sync', {}, DK); ok(st == 401, 'отозванный ключ шлема — 401')
    st, b = adm('dirA', 'device.code', {'school': 's-a'}); pc2 = b.get('code', ''); ok(st == 200, 'после отзыва место снова свободно')
    sql("update pair_codes set expires=1 where used_at is null")
    st, b = req('POST', '/api/device/pair', {'code': pc2}); ok(st == 400, 'просроченный код привязки отклонён')
    sql("delete from login_fail")
    # --- перенос класса в другую школу (в конце: класс cA1 уезжает)
    st, b = adm('dirA', 'class.move', {'class_id': 'cA0', 'school_id': 's-b'}); ok(st == 403, 'директор не переносит класс в чужую школу')
    nst = sql("select count(*) from students where json_extract(doc,'$.classId')='cA1'")[0][0]
    st, b = adm('sup', 'class.move', {'class_id': 'cA1', 'school_id': 's-b', 'teacher_id': UID['tB1']}); ok(st == 200 and b.get('students') == nst and nst > 0, 'суперадмин переносит класс со всеми учениками (%d)' % nst)
    ok(sql("select school, teacherId from classes where id='cA1'")[0] == ('s-b', UID['tB1']), 'у класса новая школа и учитель')
    ok(sql("select count(*) from students where json_extract(doc,'$.classId')='cA1' and school='s-b' and json_extract(doc,'$.school')='s-b'")[0][0] == nst, 'ученики класса переехали в школу класса')
    ok(sql("select count(*) from audit_log where action in ('class.create','class.move')")[0][0] >= 3, 'создание и перенос класса записаны в журнал')
    # --- флаг выключен
    app.save_config({'accounts': False, 'legacyTeacher': True, 'sessionMinutes': 15})
    st, b = req('POST', '/api/admin/school.create', {'name': 'Z'}, H('sup')); ok(st == 404, 'accounts=false: /api/admin — 404')
    st, b = get('sup', '/api/accounts?kind=students'); ok(st == 404, 'accounts=false: /api/accounts — 404')
finally:
    print(open(os.path.join(tmp,'server.log')).read()[-1500:]) if fails else None
    srv.terminate()
    srv.wait(timeout=10)
    log.close()
sys.exit(1 if fails else 0)
