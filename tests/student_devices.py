"""Шаг Э1 PLAN-einstein.md: привязка устройства к ученику и сеанс ученика (server/studev.py, маршруты /api/student/*, admin student.device.*, миграция v9, CLI).
Живой app.py на своём порту, реальные данные: 2 школы, 3 класса, 8 учеников (у одного нет кода входа), у класса cA1 есть предметник.
Запуск: python3 -I tests/student_devices.py. Печатает «ok  : …» / «FAIL: …» (tests/run.js включает строки в общий счёт)."""
import glob, hashlib, json, os, sqlite3, subprocess, sys, tempfile, time, urllib.error, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
tmp = tempfile.mkdtemp()
PORT = 8815
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
KEYS = ('dirA', 'tA1', 'tA2', 'tSub', 'dirB', 'tB1', 'sup')
PW = {u: 'Pass-%s-2026-Zq' % u for u in KEYS}
LOGIN = {'dirA': 'dir.a', 'tA1': 't.a1', 'tA2': 't.a2', 'tSub': 't.sub', 'dirB': 'dir.b', 'tB1': 't.b1', 'sup': 'super.one'}
SEC = []   # все выданные ключи, токены и коды: в журнале и в выводе сервера их быть не должно

app.init_db()
UID = {}
with app.db() as c:
    for sid, name in (('s-a', 'Школа А'), ('s-b', 'Школа Б')):
        c.execute("INSERT INTO schools(id, name, region, status, network, created, updated) VALUES(?, ?, 'Регион', 'active', '', ?, ?)", (sid, name, NOW, NOW))
    for k, roles in (('dirA', [('director', 's-a')]), ('tA1', [('teacher', 's-a')]), ('tA2', [('teacher', 's-a')]), ('tSub', [('teacher', 's-a')]), ('dirB', [('director', 's-b')]),
                     ('tB1', [('teacher', 's-b')]), ('sup', [('superadmin', '')])):
        UID[k] = app.user_create(c, LOGIN[k], k + ' Фамилия Имя', PW[k], WHO)
        for r, s in roles:
            app.role_add(c, UID[k], r, s, WHO)
    classes = [('cA1', 's-a', 'tA1', 5, 'А'), ('cA2', 's-a', 'tA2', 6, 'Б'), ('cB1', 's-b', 'tB1', 7, 'А')]
    inc = {'classes': [{'id': i, 'grade': g, 'letter': l, 'created': NOW, 'updated': NOW, 'school': sch} for i, sch, t, g, l in classes],
           'students': [], 'results': [], 'disc': {}, 'settings': {'updated': NOW, 'minutes': 8}}
    for n, (cls, sch, g) in enumerate([('cA1', 's-a', 5), ('cA1', 's-a', 5), ('cA1', 's-a', 5), ('cA2', 's-a', 6), ('cA2', 's-a', 6), ('cB1', 's-b', 7), ('cB1', 's-b', 7), ('cB1', 's-b', 7)], 1):
        inc['students'].append({'id': 'st%d' % n, 'name': 'Фамилия%d Имя%d Отчество%d' % (n, n, n), 'grade': g, 'classId': cls, 'created': NOW, 'updated': NOW, 'school': sch,
                                'pinHash': None if n == 8 else 'h-st%d' % n})
        inc['results'].append({'id': 'r-st%d' % n, 'sid': 'st%d' % n, 'subj': 'inf', 'score': n % 5, 'total': 5, 'ts': NOW})
    app.merge_in(c, inc, 'teacher', '', None)
    for i, sch, t, g, l in classes:
        c.execute("UPDATE classes SET teacherId = ?, doc = json_set(doc, '$.teacherId', ?) WHERE id = ?", (UID[t], UID[t], i))
    c.execute("INSERT INTO class_teachers(class_id, user_id, subject, since, by_user) VALUES('cA1', ?, 'Информатика', ?, ?)", (UID['tSub'], NOW, UID['tA1']))


def dbq(q, *a):
    c = sqlite3.connect(os.path.join(tmp, 'vrlesson.db'))
    try:
        r = c.execute(q, a).fetchall()
        c.commit()
        return r
    finally:
        c.close()


ok(dbq('PRAGMA user_version')[0][0] == 9 and dbq("select count(*) from sqlite_master where name in ('student_devices','student_pair_codes','student_sessions','ein_issued','ein_solves','ein_stats')")[0][0] == 6,
   'миграция: user_version = 9, шесть новых таблиц (устройства, коды, сеансы, ein_issued/solves/stats)')
ok({r[1] for r in sqlite3.connect(os.path.join(tmp, 'vrlesson.db')).execute('PRAGMA table_info(ein_stats)')} >= {'pk', 'pid', 'school', 'n', 'sum_t', 'last_ts'}
   and sqlite3.connect(os.path.join(tmp, 'vrlesson.db')).execute("select dflt_value from pragma_table_info('ein_solves') where name = 'pk'").fetchone()[0] == "'s'", 'миграция: поле pk (по умолчанию «s») заложено в таблицах «Эйнштейна»')

app.save_config({'accounts': True, 'legacyTeacher': True, 'sessionMinutes': 15})
env = dict(os.environ, DATA_DIR=tmp, PORT=str(PORT), TEACHER_KEY='teach-secret', DEVICE_KEY='dev-secret')
log = open(os.path.join(tmp, 'server.log'), 'w')
srv = subprocess.Popen([sys.executable, '-I', os.path.join(ROOT, 'server', 'app.py')], env=env, stdout=log, stderr=log)


def req(method, path, body=None, headers=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request('http://127.0.0.1:%d%s' % (PORT, path), data=data, method=method, headers=dict({'Content-Type': 'application/json'}, **(headers or {})))
    try:
        with urllib.request.urlopen(r, timeout=60) as f:
            return f.status, json.loads(f.read().decode() or '{}')
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or '{}')


try:
    for _ in range(50):
        try:
            if req('GET', '/api/health')[0] == 200:
                break
        except Exception:
            time.sleep(.2)
    TOK = {}
    for k in LOGIN:
        dbq('delete from login_fail')
        st, b = req('POST', '/api/auth/login', {'login': LOGIN[k], 'password': PW[k]})
        TOK[k] = b.get('token', '')
    ok(all(TOK.values()), 'фикстура: 7 пользователей вошли')
    HB = lambda k: {'Authorization': 'Bearer ' + TOK[k]}  # noqa: E731
    adm = lambda k, a, body=None: req('POST', '/api/admin/' + a, body or {}, HB(k))  # noqa: E731
    cnt = lambda a: dbq('select count(*) from audit_log where action=?', a)[0][0]  # noqa: E731
    clear = lambda: dbq('delete from login_fail')  # noqa: E731

    def code_for(k, sid):
        st, b = adm(k, 'student.device.code', {'student_id': sid})
        if st == 200:
            SEC.append(b['code'])
        return st, b

    def pair(code, name='Телефон'):
        st, b = req('POST', '/api/student/pair', {'code': code, 'name': name})
        if st == 200:
            SEC.append(b['key'])
        return st, b

    def newdev(k, sid, name='Телефон'):
        st, b = code_for(k, sid)
        assert st == 200, (st, b)
        st, b = pair(b['code'], name)
        assert st == 200, (st, b)
        return b['key']

    def stu_login(key, sid):
        st, b = req('POST', '/api/student/login', {'pin_hash': 'h-' + sid}, {'X-Student': key})
        if st == 200:
            SEC.append(b['token'])
        return st, b

    H = lambda key, tok=None: dict({'X-Student': key}, **({'X-Stoken': tok} if tok else {}))  # noqa: E731

    # ---- флаг выключен: 404 везде (А7)
    ok(req('POST', '/api/student/pair', {'code': 'ABCD2345'})[0] == 404 and req('POST', '/api/student/login', {'pin_hash': 'x'}, {'X-Student': 'k' * 20})[0] == 404, 'studentDevices=false: pair и login → 404')
    ok(req('GET', '/api/student/me', None, H('k' * 20, 't' * 20))[0] == 404 and adm('tA1', 'student.device.code', {'student_id': 'st1'})[0] == 404 and adm('tA1', 'student.device.list', {'student_id': 'st1'})[0] == 404,
       'studentDevices=false: me и admin student.device.* → 404')
    app.save_config(dict(app.load_config(), studentDevices=True))
    ok(app.load_config()['studentDevices'] is True and app.load_config()['studentDeviceLimit'] == 3 and app.load_config()['einRating'] is False, 'конфигурация: studentDevices включён без перезапуска, по умолчанию лимит 3, einRating выключен')

    # ---- права на выдачу кода
    st, b = code_for('tA1', 'st1')
    code1 = b.get('code', '')
    ok(st == 200 and len(code1) == 8 and all(ch in app.CODE_ALPHA for ch in code1) and b['expires'] - NOW > 14 * 60000 and b['expires'] - NOW < 16 * 60000 + 60000, 'владелец класса выдаёт код: 8 знаков из алфавита шлема, 15 минут')
    ok(dbq('select count(*) from student_pair_codes where code_hash = ?', code1)[0][0] == 0 and dbq('select count(*) from student_pair_codes where student_id = ?', 'st1')[0][0] == 1, 'в базе код не хранится (только sha256)')
    st, b = adm('tSub', 'student.device.list', {'student_id': 'st1'})
    ok(st == 200 and b['items'] == [] and b['limit'] == 3, 'предметник видит список устройств ученика своего класса')
    ok(adm('tSub', 'student.device.code', {'student_id': 'st1'})[0] == 403, 'предметник не выдаёт код')
    ok(adm('tA2', 'student.device.code', {'student_id': 'st1'})[0] == 403 and adm('tA2', 'student.device.list', {'student_id': 'st1'})[0] == 403, 'чужой учитель (другой класс той же школы): код и список → 403')
    ok(adm('dirB', 'student.device.code', {'student_id': 'st1'})[0] == 403 and adm('tB1', 'student.device.list', {'student_id': 'st1'})[0] == 403, 'чужая школа (директор и учитель): 403')
    ok(adm('tA1', 'student.device.code', {'student_id': 'st6'})[0] == 403 and adm('tA1', 'student.device.code', {'student_id': 'нет-такого'})[0] == 404, 'учитель: ученик чужой школы → 403, несуществующий → 404')
    st, b = code_for('dirA', 'st1')
    code1 = b.get('code', '')
    ok(st == 200 and cnt('student.device.code') == 2, 'директор школы выдаёт код; выдача пишется в журнал')
    ok(adm('sup', 'student.device.list', {'student_id': 'st6'})[0] == 200, 'суперадмин видит устройства любого ученика')

    # ---- привязка
    clear()
    st, b = pair(code1.lower(), 'Телефон Айрата  ')
    dev1 = b.get('key', '')
    ok(st == 200 and len(dev1) >= 32 and b['student']['id'] == 'st1' and b['student']['cls'] == '5А' and b['student']['schoolName'] == 'Школа А' and b['student']['name'] == 'Имя1 Ф.', 'привязка по коду (регистр не важен): ключ, ученик «Имя Ф.», класс и школа')
    ok('Фамилия1' not in json.dumps(b, ensure_ascii=False) and set(b) == {'key', 'student'}, 'в ответе привязки нет полного ФИО и лишних полей')
    ok(dbq('select count(*) from student_devices where key_hash = ?', dev1)[0][0] == 0 and dbq('select name, status from student_devices')[0] == ('Телефон Айрата', 'active'), 'в базе ключ не хранится (только sha256), имя устройства очищено')
    results = []
    results.append(pair(code1))   # использованный
    st, b = code_for('tA1', 'st2')
    dbq('update student_pair_codes set expires = ? where student_id = ?', NOW - 1000, 'st2')
    results.append(pair(b['code']))   # просроченный
    results.append(pair('ZZZZZZZZ'))   # чужой (не выдавался)
    results.append(pair(''))   # пустой
    ok(all(s == 403 and body == {'error': 'denied'} for s, body in results), 'просроченный, использованный, чужой и пустой код → одинаковый 403 denied')
    clear()
    codes = []
    for i in range(31):
        codes.append(req('POST', '/api/student/pair', {'code': 'QQQQ%04d' % i})[0])
    ok(codes[:30] == [403] * 30 and codes[30] == 429, 'лимит ошибок привязки: 30 неверных кодов в минуту с одного IP, 31-я попытка → 429 (код не перебирается)')
    clear()
    same = [req('POST', '/api/student/pair', {'code': 'RRRRRRRR'})[0] for _ in range(6)]
    ok(same[:5] == [403] * 5 and same[5] == 429, 'пауза по IP+коду: один и тот же неверный код после пяти ошибок → 429')
    clear()
    okp = []
    for sid in ('st6', 'st6', 'st6', 'st7', 'st7', 'st7'):  # класс за общим IP: удачные привязки подряд не упираются в лимит
        st, b = code_for('sup', sid)
        okp.append(pair(b['code'])[0])
    ok(okp == [200] * 6 and dbq("select count(*) from login_fail where k like 'rt:spairf:%'")[0][0] == 0, 'удачные привязки с одного IP не считаются в лимит (6 подряд → 200)')
    clear()

    # ---- лимит устройств, новый код гасит прежний
    key2 = newdev('tA1', 'st1', 'ПК')
    st, b = code_for('tA1', 'st1')
    codeB = b['code']
    dbq("insert into student_devices(id, student_id, school, key_hash, name, created, last_seen, status) values('sd-aaaaaaaaaaaa', 'st1', 's-a', 'fake-hash', 'x', ?, ?, 'active')", NOW, NOW)
    st, b = pair(codeB)
    ok(st == 400 and 'предел' in b['error'] and dbq('select used_at from student_pair_codes where student_id = ? order by created desc', 'st1')[0][0] is None, 'лимит проверяется при привязке повторно, код при этом не сгорает')
    st, b = adm('tA1', 'student.device.code', {'student_id': 'st1'})
    ok(st == 400 and 'предел' in b['error'], 'код при трёх активных устройствах не выдаётся (лимит 3)')
    ok(adm('tSub', 'student.device.revoke', {'id': 'sd-aaaaaaaaaaaa'})[0] == 403 and adm('tA2', 'student.device.revoke', {'id': 'sd-aaaaaaaaaaaa'})[0] == 403, 'отвязать устройство: предметник и чужой учитель → 403')
    ok(dbq("select status from student_devices where id = 'sd-aaaaaaaaaaaa'")[0][0] == 'active' and dbq('select count(*) from student_pair_codes where created_by = ?', UID['tSub'])[0][0] == 0
       and dbq("select count(*) from audit_log where action = 'admin.denied' and actor_id = ?", UID['tSub'])[0][0] >= 2,
       'предметник: после отказов устройство осталось активным, кодов привязки от его имени в базе нет')
    ok(adm('tA1', 'student.device.revoke', {'id': 'sd-aaaaaaaaaaaa'})[0] == 200 and dbq("select status, revoked_by from student_devices where id = 'sd-aaaaaaaaaaaa'")[0] == ('revoked', UID['tA1']), 'владелец класса отвязывает устройство')
    st, b = pair(codeB)
    key3 = b.get('key', '')
    ok(st == 200 and len([1 for r in dbq("select status from student_devices where student_id = 'st1'") if r[0] == 'active']) == 3, 'после отвязки лишнего код ещё действует и привязка проходит (три активных)')
    st, b = adm('tSub', 'student.device.list', {'student_id': 'st1'})
    ok(st == 200 and len(b['items']) == 4 and sorted({i['status'] for i in b['items']}) == ['active', 'revoked'] and all(set(i) == {'id', 'name', 'created', 'lastSeen', 'status'} for i in b['items']), 'список: поля id/name/created/lastSeen/status, отозванные видны со статусом')
    st, b1 = code_for('tA1', 'st2')
    st, b2 = code_for('tA1', 'st2')
    ok(pair(b1['code'])[0] == 403, 'новый код ученику гасит прежний')
    key_st2 = pair(b2['code'])[1].get('key', '')
    ok(len(key_st2) > 30, 'новый код подходит')

    # ---- ключ без токена: только login/unpair
    ok(req('GET', '/api/student/me', None, H(dev1))[0] == 401 and req('POST', '/api/student/logout', {}, H(dev1))[0] == 401, 'ключ без токена: me и logout → 401')
    ok(req('GET', '/api/student/me', None, H('x' * 30, 'y' * 30))[0] == 401 and req('POST', '/api/student/login', {'pin_hash': 'h-st1'}, H('x' * 30))[0] == 401, 'неизвестный ключ: me и login → 401')
    ok(req('POST', '/api/student/sync', {}, H(dev1))[0] == 404, 'student/sync до шага Э10 → 404')
    ok(req('POST', '/api/sync', {}, H(dev1))[0] == 403 and req('POST', '/api/sync', {}, H(dev1, 'z' * 30))[0] == 403 and req('GET', '/api/export', None, H(dev1))[0] == 403, 'ключ ученика (с токеном и без) в /api/sync и /api/export → 403')
    ok(req('POST', '/api/admin/student.device.list', {'student_id': 'st1'}, H(dev1))[0] == 403 and req('POST', '/api/admin/class.archive', {'id': 'cA1'}, H(dev1, 'z' * 30))[0] == 403, 'ключ и токен ученика в /api/admin/* → 403')
    st, b = stu_login(dev1, 'st1')
    tok1 = b.get('token', '')
    ok(st == 200 and len(tok1) >= 32 and b['exp'] - NOW > 100 * 60000 and b['exp'] - NOW <= 121 * 60000, 'вход с верным кодом: токен, срок около двух часов')
    ok(req('POST', '/api/sync', {}, H(dev1, tok1))[0] == 403 and req('POST', '/api/admin/student.device.code', {'student_id': 'st1'}, H(dev1, tok1))[0] == 403, 'токен ученика данные и администрирование не открывает (403)')
    st, b = req('GET', '/api/student/me', None, H(dev1, tok1))
    ok(st == 200 and set(b) == {'id', 'name', 'grade', 'cls', 'school', 'schoolName', 'district', 'region'} and b['id'] == 'st1' and b['name'] == 'Имя1 Ф.' and b['cls'] == '5А' and b['region'] == 'Регион', 'me: id, «Имя Ф.», класс, школа, район, регион')
    ok(req('GET', '/api/student/me', None, H(key2, tok1))[0] == 401, 'токен чужого устройства (того же ученика) не подходит к другому ключу')
    key_other = newdev('tA2', 'st4')
    ok(req('GET', '/api/student/me', None, H(key_other, tok1))[0] == 401, 'токен одного ученика не подходит к ключу другого')
    dbq('update student_sessions set last_seen = ? where token_hash != ?', NOW - 121 * 60000, 'none')
    ok(req('GET', '/api/student/me', None, H(dev1, tok1))[0] == 401, 'простой больше двух часов: токен недействителен')
    st, b = stu_login(dev1, 'st1')
    tok1 = b['token']
    dbq('update student_sessions set created = ? where token_hash != ?', NOW - 9 * 3600 * 1000, 'none')
    ok(req('GET', '/api/student/me', None, H(dev1, tok1))[0] == 401, 'возраст сеанса больше 8 часов: токен недействителен')
    st, b = stu_login(dev1, 'st1')
    tok1 = b['token']
    ok(req('POST', '/api/student/logout', {}, H(dev1, tok1))[0] == 200 and req('GET', '/api/student/me', None, H(dev1, tok1))[0] == 401, 'logout гасит токен')
    st, b = stu_login(dev1, 'st1')
    tok1 = b['token']
    ok(req('POST', '/api/student/logout', None, H(dev1, tok1))[0] == 200 and req('GET', '/api/student/me', None, H(dev1, tok1))[0] == 401, 'logout без тела: 200 (не 413), токен погашен')
    st, b = stu_login(dev1, 'st1')
    tok1 = b['token']

    # ---- неверный код: пауза
    clear()
    r5 = [req('POST', '/api/student/login', {'pin_hash': 'h-wrong'}, H(key_st2))[0] for _ in range(5)]
    st_ok, b_ok = stu_login(key_st2, 'st2')
    ok(r5 == [403] * 5 and st_ok == 429 and b_ok.get('retry', 0) >= 1, 'пять неверных кодов → пауза; верный код в паузу → 429')
    ok(cnt('student.login.lockout') == 1 and 'dev' in dbq("select detail from audit_log where action = 'student.login.lockout'")[0][0], 'пауза записана в журнал (student.login.lockout, без кода)')
    ok(req('POST', '/api/student/login', {'pin_hash': 'h-wrong'}, H(dev1))[0] == 403, 'пауза по ученику: другой ученик входит независимо (st1 — неверный код 403, не 429)')
    dbq("delete from login_fail where k like 'u:dpin:%'")
    st, b = stu_login(key_st2, 'st2')
    ok(st == 200, 'после паузы верный код пускает')
    clear()

    # ---- ученик без кода входа
    key8 = newdev('tB1', 'st8')
    st, b = req('POST', '/api/student/login', {'pin_hash': 'h-st8'}, H(key8))
    ok(st == 403 and 'Попроси' in b['error'], 'у ученика нет кода входа: 403 «Попроси учителя выдать код входа»')

    # ---- сброс кода учителем
    key_st5 = newdev('tA2', 'st5')
    ok(stu_login(key_st5, 'st5')[0] == 200, 'st5 входит со своим кодом')
    tok5 = stu_login(key_st5, 'st5')[1]['token']
    ok(dbq("select count(*) from student_sessions where student_id = 'st5'")[0][0] >= 1, 'у st5 есть сеанс до сброса кода')
    ok(adm('tA2', 'student.pin', {'student_id': 'st5'})[0] == 200, 'учитель выдаёт ученику «Новый код» (сброс)')
    ok(dbq("select count(*) from student_sessions where student_id = 'st5'")[0][0] == 0 and req('GET', '/api/student/me', None, H(key_st5, tok5))[0] == 401, 'сброс кода входа удаляет сеансы ученика (старый токен → 401)')
    st, b = stu_login(key_st5, 'st5')
    ok(st == 403 and 'Попроси' in b['error'], '«Новый код» у учителя: старый код входа больше не подходит')

    # ---- архив и возврат, перевод в классе, в другую школу
    ok(adm('tA1', 'student.archive', {'student_id': 'st1'})[0] == 200, 'учитель архивирует ученика')
    ok(req('GET', '/api/student/me', None, H(dev1, tok1))[0] == 401 and stu_login(dev1, 'st1')[0] == 401, 'ученик в архиве: me и login → 401')
    ok(adm('tA1', 'student.device.code', {'student_id': 'st1'})[0] == 400, 'ученику в архиве код привязки не выдаётся')
    ok(dbq("select count(*) from student_sessions where student_id = 'st1'")[0][0] == 0, 'архивация ученика удаляет его сеансы')
    ok(adm('tA1', 'student.restore', {'student_id': 'st1'})[0] == 200, 'ученик возвращён')
    ok(req('GET', '/api/student/me', None, H(dev1, tok1))[0] == 401, 'после возврата из архива старый токен не оживает (401), устройство осталось привязанным')
    st, b = stu_login(dev1, 'st1')
    tok1 = b.get('token', '')
    ok(st == 200 and req('GET', '/api/student/me', None, H(dev1, tok1))[0] == 200, 'после «Вернуть» устройство снова работает')
    ok(adm('dirA', 'student.move', {'student_id': 'st1', 'class_id': 'cA2'})[0] == 200, 'директор переводит ученика в другой класс той же школы')
    st, b = req('GET', '/api/student/me', None, H(dev1, tok1))
    ok(st == 200 and b['cls'] == '6Б', 'перевод внутри школы: устройство работает, me показывает новый класс')
    ok(adm('dirA', 'student.move', {'student_id': 'st1', 'class_id': 'cA1'})[0] == 200, 'ученик возвращён в свой класс')
    key_st3 = newdev('tA1', 'st3')
    st, b = stu_login(key_st3, 'st3')
    tok3 = b['token']
    ok(adm('sup', 'student.move', {'student_id': 'st3', 'class_id': 'cB1'})[0] == 200, 'суперадмин переводит ученика в другую школу')
    ok(dbq("select count(*) from student_devices where student_id = 'st3'")[0][0] == 1 and dbq("select status, revoked_by from student_devices where student_id = 'st3'")[0] == ('revoked', UID['sup'])
       and dbq("select count(*) from student_sessions where student_id = 'st3'")[0][0] == 0 and app.studev_module().active_count(sqlite3.connect(os.path.join(tmp, 'vrlesson.db')), 'st3') == 0,
       'перевод в другую школу: устройства отозваны (строка осталась), сеансы удалены, активных 0')
    ok(req('GET', '/api/student/me', None, H(key_st3, tok3))[0] == 401 and stu_login(key_st3, 'st3')[0] == 401, 'перевод в другую школу: ключ и токен → 401 (нужна новая привязка)')

    # ---- отвязка учителем гасит сеансы; отвязка самим учеником
    st, b = stu_login(key2, 'st1')
    tok_k2 = b['token']
    dev_row = dbq("select id from student_devices where key_hash = ?", hashlib.sha256(key2.encode()).hexdigest())[0][0]
    ok(dbq('select count(*) from student_sessions where device_id = ?', dev_row)[0][0] == 1, 'у устройства есть сеанс')
    ok(adm('tA1', 'student.device.revoke', {'id': dev_row})[0] == 200, 'учитель отвязывает устройство')
    ok(dbq('select count(*) from student_sessions where device_id = ?', dev_row)[0][0] == 0 and req('GET', '/api/student/me', None, H(key2, tok_k2))[0] == 401 and stu_login(key2, 'st1')[0] == 401, 'отвязка учителем гасит сеансы; ключ и токен → 401')
    st, b = req('POST', '/api/student/unpair', {'pin_hash': 'h-wrong'}, H(key3))
    ok(st == 403, 'самоотвязка с неверным кодом → 403')
    st, b = req('POST', '/api/student/unpair', {'pin_hash': 'h-st1'}, H(key3))
    ok(st == 200 and stu_login(key3, 'st1')[0] == 401 and req('POST', '/api/student/unpair', {'pin_hash': 'h-st1'}, H('q' * 30))[0] == 401, 'самоотвязка с верным кодом: устройство отозвано, вход → 401')
    ok(dbq("select revoked_by from student_devices where status = 'revoked' and revoked_by = 'student'") != [], 'в строке отозванного устройства видно, что отвязал сам ученик')

    # ---- лимит попыток входа с одного устройства
    clear()
    codes = [req('POST', '/api/student/login', {'pin_hash': 'h-st1'}, H(dev1))[0] for _ in range(22)]
    ok(codes[:20] == [200] * 20 and codes[20] == 429, 'не больше 20 попыток входа в минуту с одного устройства → 429')
    clear()

    # ---- журнал: события есть, секретов нет
    ok(cnt('student.device.code') >= 6 and cnt('student.device.pair') >= 5 and cnt('student.device.revoke') >= 3, 'журнал: student.device.code / pair / revoke записаны')
    audit_txt = json.dumps(dbq('select ts, actor_kind, actor_id, action, target_kind, target_id, school, detail, ip from audit_log'), ensure_ascii=False)
    srv_log = open(os.path.join(tmp, 'server.log'), encoding='utf-8', errors='replace').read()
    ok(len(SEC) > 15 and not any(s in audit_txt for s in SEC), 'ни один ключ, токен и код привязки не попал в журнал аудита (%d значений)' % len(SEC))
    ok(not any(s in srv_log for s in SEC), 'ни один ключ, токен и код не попал в вывод сервера')
    ok('Имя1' not in dbq("select group_concat(detail) from audit_log where action like 'student.device.%' or action = 'student.login.lockout'")[0][0] , 'в аудите устройств нет имён')

    # ---- стирание ученика
    with app.db() as c:
        for pk, pid in (('s', 'st1'), ('t', 'st1'), ('s', 'st4')):
            c.execute('INSERT INTO ein_issued(pk, pid, seed, issued, src) VALUES(?, ?, 1, ?, ?)', (pk, pid, NOW, 'x'))
            c.execute('INSERT INTO ein_solves(pk, pid, seed, school, t, moves, helped, void, ts, src) VALUES(?, ?, 1, ?, 60, 10, 0, 0, ?, ?)', (pk, pid, 's-a', NOW, 'x'))
            c.execute('INSERT INTO ein_stats(pk, pid, school, n, sum_t, last_ts) VALUES(?, ?, ?, 1, 60, ?)', (pk, pid, 's-a', NOW))
        before = c.execute('select count(*) from student_devices where student_id = ?', ('st1',)).fetchone()[0]
        ok(before >= 3 and c.execute('select count(*) from student_sessions where student_id = ?', ('st1',)).fetchone()[0] >= 1 and c.execute('select count(*) from student_pair_codes where student_id = ?', ('st1',)).fetchone()[0] >= 1, 'до стирания у st1 есть устройства, сеансы и коды')
        app.purge_erase_student(c, 'st1', NOW)
    left = sum(dbq('select count(*) from %s where student_id = ?' % t, 'st1')[0][0] for t in ('student_devices', 'student_sessions', 'student_pair_codes'))
    left += sum(dbq("select count(*) from %s where pk = 's' and pid = ?" % t, 'st1')[0][0] for t in ('ein_issued', 'ein_solves', 'ein_stats'))
    ok(left == 0, 'purge стирает строки ученика во всех шести таблицах (устройства, сеансы, коды, ein_*)')
    ok(dbq("select count(*) from ein_solves where pk = 't' and pid = 'st1'")[0][0] == 1 and dbq("select count(*) from ein_stats where pk = 's' and pid = 'st4'")[0][0] == 1 and dbq("select count(*) from student_devices where student_id = 'st4'")[0][0] == 1,
       'чужие строки (другой ученик, учитель с тем же pid, устройства st4) остались')

    # ---- повторный старт
    n_st = dbq('select count(*) from students')[0][0]
    n_dev = dbq('select count(*) from student_devices')[0][0]
    app.init_db()
    ok(dbq('PRAGMA user_version')[0][0] == 9 and dbq('select count(*) from students')[0][0] == n_st and dbq('select count(*) from student_devices')[0][0] == n_dev, 'повторный старт: user_version = 9, данные те же')
    dbq('DROP TABLE student_sessions')
    dbq('PRAGMA user_version = 8')
    app.init_db()
    ok(dbq('PRAGMA user_version')[0][0] == 9 and dbq('select count(*) from student_devices')[0][0] == n_dev and dbq("select count(*) from sqlite_master where name = 'student_sessions'")[0][0] == 1 and glob.glob(os.path.join(tmp, '*bak-v8*')) != [],
       'миграция v8→v9 повторяема: таблица восстановлена, устройства целы, копия bak-v8 сделана до изменений')
finally:
    srv.terminate()
    try:
        srv.wait(5)
    except Exception:
        srv.kill()

# ------------------------------------------------------------------ CLI
tmp2 = tempfile.mkdtemp()


def cli(*a):
    return subprocess.run([sys.executable, '-I', os.path.join(ROOT, 'server', 'app.py')] + list(a), env=dict(os.environ, DATA_DIR=tmp2), capture_output=True, text=True)


r = cli('student-devices', 'on')
cf = json.load(open(os.path.join(tmp2, 'config.json')))
ok(r.returncode == 0 and cf['studentDevices'] is True, 'CLI: student-devices on')
r = cli('ein-rating', 'on')
r = cli('teacher-rooms', 'on')
cf = json.load(open(os.path.join(tmp2, 'config.json')))
ok(cf['einRating'] is True and cf['teacherRooms'] is True and cf['studentDevices'] is True, 'CLI: ein-rating on и teacher-rooms on')
ok(cli('set-ein-min', '4').returncode == 1 and cli('set-ein-min', '601').returncode == 1 and cli('set-ein-min', 'x').returncode == 1 and cli('set-student-devices', '0').returncode == 1 and cli('set-student-devices', '11').returncode == 1, 'CLI: значения вне границ (5..600, 1..10) отклоняются')
ok(cli('set-ein-min', '45').returncode == 0 and cli('set-student-devices', '5').returncode == 0, 'CLI: set-ein-min 45, set-student-devices 5')
cf = json.load(open(os.path.join(tmp2, 'config.json')))
ok(cf['einMinSec'] == 45 and cf['studentDeviceLimit'] == 5, 'CLI: значения сохранены в config.json')
r = cli('student-devices', 'off')
cf = json.load(open(os.path.join(tmp2, 'config.json')))
ok(cf['studentDevices'] is False and cf['einRating'] is True and cf['einMinSec'] == 45, 'CLI: student-devices off не трогает остальное')
aud = [x[0] for x in sqlite3.connect(os.path.join(tmp2, 'vrlesson.db')).execute("select action from audit_log where action like 'config.%'")]
ok(sorted(aud) == sorted(['config.studentDevices', 'config.einRating', 'config.teacherRooms', 'config.einMinSec', 'config.studentDeviceLimit', 'config.studentDevices']), 'CLI: каждая команда — строка аудита config.*')
bad = dict(cf, studentDeviceLimit=99, einMinSec=1, studentSessionMin='x', studentDevices='yes')
json.dump(bad, open(os.path.join(tmp, 'config.json'), 'w'))
lc = app.load_config()
ok(lc['studentDeviceLimit'] == 3 and lc['einMinSec'] == 20 and lc['studentSessionMin'] == 120 and lc['studentDevices'] is False, 'load_config: неверные значения заменяются умолчаниями (А5)')

print('\nИТОГО: %s' % ('всё зелёное' if not fails else 'ПРОВАЛОВ: %d' % fails))
sys.exit(1 if fails else 0)
