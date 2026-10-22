"""Иерархия ролей: суперадмин > региональный администратор > директор > учитель. Права идут вниз, область — регион. Запуск: python3 -I tests/hierarchy.py."""
import json, os, urllib.parse, sqlite3, subprocess, sys, tempfile, time, urllib.error, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
tmp = tempfile.mkdtemp()
PORT = 8798
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
LOGIN = {'sup': 'super.one', 'regA': 'reg.north', 'disA': 'dis.center', 'dirN1': 'dir.n1', 'tN1': 't.n1', 'dirS': 'dir.s', 'tS1': 't.s1'}
PW = {u: 'Pass-%s-2026-Zq' % u for u in LOGIN}
UID = {}
app.init_db()
with app.db() as c:
    for sid, name, reg in (('s-n1', 'Школа С1', 'Север'), ('s-n2', 'Школа С2', 'Север'), ('s-s1', 'Школа Ю1', 'Юг')):
        c.execute("INSERT INTO schools(id, name, region, district, status, network, created, updated) VALUES(?, ?, ?, ?, 'active', '', ?, ?)", (sid, name, reg, 'Центр' if sid == 's-n1' else 'Окраина', NOW, NOW))
    for k, roles in (('sup', [('superadmin', '')]), ('regA', [('region_admin', 'r:Север')]), ('disA', [('district_admin', 'd:Север|Центр')]), ('dirN1', [('director', 's-n1')]), ('tN1', [('teacher', 's-n1')]),
                     ('dirS', [('director', 's-s1')]), ('tS1', [('teacher', 's-s1')])):
        UID[k] = app.user_create(c, LOGIN[k], 'Фамилия %s Имя' % k, PW[k], WHO)
        for r, s in roles:
            app.role_add(c, UID[k], r, s, WHO)
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


try:
    for _ in range(50):
        try:
            if req('GET', '/api/health')[0] == 200:
                break
        except Exception:
            time.sleep(.2)
    TOK = {}
    for k in LOGIN:
        sql('delete from login_fail')
        st, b = req('POST', '/api/auth/login', {'login': LOGIN[k], 'password': PW[k]})
        TOK[k] = b.get('token', '')
    ok(all(TOK.values()), 'фикстура: 6 пользователей вошли, у регионального администратора роль r:Север')
    H = lambda k: {'Authorization': 'Bearer ' + TOK[k]}  # noqa: E731
    adm = lambda k, act, b: req('POST', '/api/admin/' + act, dict(b, password=PW[k]), H(k))  # noqa: E731
    get = lambda k, path: req('GET', path, None, H(k))  # noqa: E731

    st, b = adm('regA', 'invite.create', {'role': 'director', 'school': 's-n2'}); ok(st == 200, 'региональный админ приглашает директора в школу своего региона')
    st, b = adm('regA', 'invite.create', {'role': 'director', 'school': 's-s1'}); ok(st == 403, 'но не в школу чужого региона')
    st, b = adm('regA', 'invite.create', {'role': 'region_admin', 'region': 'Север'}); ok(st == 403, 'региональный админ не создаёт равных себе')
    st, b = adm('dirN1', 'invite.create', {'role': 'region_admin', 'region': 'Север'}); ok(st == 403, 'директор не создаёт региональных админов')
    st, b = adm('sup', 'invite.create', {'role': 'region_admin', 'region': 'Север'}); ok(st == 200, 'суперадмин приглашает регионального администратора')
    st, b = adm('sup', 'invite.create', {'role': 'region_admin', 'region': 'Нигде'}); ok(st == 400, 'региона без школ нет — приглашение не выдаётся')
    st, b = adm('regA', 'class.create', {'grade': 5, 'letter': 'А', 'school_id': 's-n1', 'teacher_id': UID['tN1']}); ok(st == 200, 'региональный админ создаёт класс в школе региона')
    st, b = adm('regA', 'class.create', {'grade': 5, 'letter': 'Б', 'school_id': 's-s1'}); ok(st == 403, 'в школе чужого региона — нет')
    st, b = adm('regA', 'password.reset', {'user_id': UID['tN1']}); ok(st == 200, 'сброс пароля учителя своего региона')
    st, b = adm('regA', 'password.reset', {'user_id': UID['tS1']}); ok(st == 403, 'учителя чужого региона — нет')
    st, b = adm('regA', 'password.reset', {'user_id': UID['sup']}); ok(st == 403, 'суперадмина — нет')
    st, b = adm('dirN1', 'password.reset', {'user_id': UID['dirS']}); ok(st == 403, 'директор не трогает директора')
    st, b = adm('regA', 'role.assign', {'user_id': UID['tN1'], 'role': 'expert', 'school': 's-n1'}); ok(st == 200, 'региональный админ назначает специалиста в школе региона')
    st, b = adm('regA', 'role.assign', {'user_id': UID['tS1'], 'role': 'expert', 'school': 's-s1'}); ok(st == 403, 'в чужом регионе — нет')
    st, b = adm('regA', 'role.assign', {'user_id': UID['tN1'], 'role': 'region_admin', 'region': 'Север'}); ok(st == 403, 'региональным админом его назначает только суперадмин')
    st, b = adm('sup', 'role.assign', {'user_id': UID['tN1'], 'role': 'region_admin', 'region': 'Север'}); ok(st == 200, 'суперадмин назначает регионального админа')
    ok(sql("select count(*) from user_roles where role='region_admin' and school='r:Север' and status='active'")[0][0] == 2, 'в базе роль хранится с ключом области r:Север')
    st, b = adm('sup', 'role.remove', {'user_id': UID['tN1'], 'role': 'region_admin', 'region': 'Север'}); ok(st == 200, 'и снимает')
    # --- администратор района: только школы района
    st, b = adm('disA', 'invite.create', {'role': 'director', 'school': 's-n1'}); ok(st == 200, 'администратор района приглашает директора в школу района')
    st, b = adm('disA', 'invite.create', {'role': 'director', 'school': 's-n2'}); ok(st == 403, 'но не в школу другого района')
    st, b = adm('disA', 'invite.create', {'role': 'district_admin', 'region': 'Север', 'district': 'Центр'}); ok(st == 403, 'равных себе не создаёт')
    st, b = adm('regA', 'role.assign', {'user_id': UID['tN1'], 'role': 'district_admin', 'region': 'Север', 'district': 'Окраина'}); ok(st == 200, 'региональный админ назначает администратора района своего региона')
    st, b = adm('regA', 'role.assign', {'user_id': UID['tS1'], 'role': 'district_admin', 'region': 'Юг', 'district': 'Окраина'}); ok(st == 403, 'в чужом регионе — нет')
    st, b = adm('regA', 'role.assign', {'user_id': UID['tN1'], 'role': 'district_admin', 'region': 'Север', 'district': 'Нет такого'}); ok(st == 400, 'района без школ нет')
    st, b = adm('disA', 'class.create', {'grade': 6, 'letter': 'А', 'school_id': 's-n1'}); ok(st == 200, 'администратор района создаёт класс в школе района')
    st, b = adm('disA', 'class.create', {'grade': 6, 'letter': 'Б', 'school_id': 's-n2'}); ok(st == 403, 'в школе другого района — нет')
    st, b = adm('regA', 'role.remove', {'user_id': UID['tN1'], 'role': 'district_admin', 'region': 'Север', 'district': 'Окраина'}); ok(st == 200, 'и снимает')
    # --- видимость
    st, b = get('regA', '/api/accounts?kind=classes&size=50'); sch = {x['school'] for x in b['items']}
    ok(st == 200 and sch == {'s-n1'}, 'региональный админ видит классы только своего региона: ' + str(sch))
    st, b = get('regA', '/api/options?level=school'); ok(sorted(x['id'] for x in b['items']) == ['s-n1', 's-n2'], 'в списке школ — только регион')
    # --- список администраторов
    st, b = get('sup', '/api/accounts?kind=admins'); ok(st == 200 and b['total'] == 5, 'суперадмин видит всех администраторов (5): ' + str(b.get('total')))
    st, b = get('sup', '/api/accounts?kind=admins&role=director'); ok(b['total'] == 2, 'фильтр по роли: два директора')
    st, b = get('sup', '/api/accounts?kind=admins&region=' + urllib.parse.quote('Север')); ok(b['total'] == 3 and 'dir.n1' in [x['login'] for x in b['items']], 'фильтр по региону: региональный админ, администратор района и директор Севера')
    st, b = get('sup', '/api/accounts?kind=admins&school=s-s1'); ok(b['total'] == 1 and b['items'][0]['login'] == 'dir.s', 'фильтр по школе')
    st, b = get('sup', '/api/accounts?kind=admins&q=reg.north'); ok(b['total'] == 1, 'поиск по логину')
    st, b = get('regA', '/api/accounts?kind=admins'); ok(st == 200 and sorted(x['login'] for x in b['items']) == ['dir.n1', 'dis.center'], 'региональный админ видит директоров и администраторов района своего региона')
    st, b = get('dirN1', '/api/accounts?kind=admins'); ok(st == 403, 'директору список администраторов закрыт')
    st, b = get('tS1', '/api/accounts?kind=admins'); ok(st == 403, 'учителю тоже')
    ok(sql("select count(*) from audit_log where action in ('role.assign','role.remove','invite.create','class.create')")[0][0] >= 6, 'действия в журнале')
finally:
    print(open(os.path.join(tmp, 'server.log')).read()[-1500:]) if fails else None
    srv.terminate()
    srv.wait(timeout=10)
    log.close()
sys.exit(1 if fails else 0)
