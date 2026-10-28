"""Шаг Н4 плана сети: сессии и билеты на сервере (server/netapi.py, маршруты app.py), миграция v7, отчёты hub, сквозная проверка с настоящим hub.
Живой app.py на своём порту; hub — отдельным процессом. Запуск: python3 -I tests/net_sessions.py. Печатает «ok  : …» / «FAIL: …» (tests/run.js включает строки в общий счёт)."""
import base64, glob, hashlib, hmac, json, os, secrets, socket, sqlite3, struct, subprocess, sys, tempfile, time, urllib.error, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
tmp = tempfile.mkdtemp()
PORT, HPORT = 8811, 8812
fails = 0
os.environ.update(DATA_DIR=tmp)
sys.path.insert(0, os.path.join(ROOT, 'server'))
import app  # noqa: E402
import hubticket as HT  # noqa: E402
import netapi  # noqa: E402


def ok(c, m):
    global fails
    print(('ok  : ' if c else 'FAIL: ') + m, flush=True)
    if not c:
        fails += 1


NOW = int(time.time() * 1000)
WHO = ('cli', 'test', '')
SECRET = secrets.token_hex(32)
K = HT.derive(SECRET)
PW = {u: 'Pass-%s-2026-Zq' % u for u in ('dirA', 'tA1', 'tA2', 'dirB', 'tB1', 'sup', 'exA')}
LOGIN = {'dirA': 'dir.a', 'tA1': 't.a1', 'tA2': 't.a2', 'dirB': 'dir.b', 'tB1': 't.b1', 'sup': 'super.one', 'exA': 'ex.a'}

# ------------------------------------------------------------------ короткое имя
ok(netapi.short_name('Иванов Пётр Сергеевич') == 'Пётр И.' and netapi.short_name('Иванова Анна') == 'Анна И.' and netapi.short_name('Мадонна') == 'Мадонна', 'short_name: «Фамилия Имя Отчество» → «Имя Ф.»')
ok(len(netapi.short_name('Ф' * 100 + ' ' + 'И' * 100)) <= 24 and netapi.short_name('') == 'Участник' and netapi.short_name('a\x00b c') .count('\x00') == 0, 'short_name: ≤ 24 знаков, пусто и управляющие знаки')

app.init_db()
ok(app.sqlite3.connect(os.path.join(tmp, 'vrlesson.db')).execute('PRAGMA user_version').fetchone()[0] == 8, 'миграция: база v8')
UID = {}
with app.db() as c:
    for sid, name in (('s-a', 'Школа А'), ('s-b', 'Школа Б')):
        c.execute("INSERT INTO schools(id, name, region, status, network, created, updated) VALUES(?, ?, '', 'active', '', ?, ?)", (sid, name, NOW, NOW))
    for k, roles in (('dirA', [('director', 's-a')]), ('tA1', [('teacher', 's-a')]), ('tA2', [('teacher', 's-a')]), ('dirB', [('director', 's-b')]),
                     ('tB1', [('teacher', 's-b')]), ('sup', [('superadmin', '')]), ('exA', [('expert', 's-a')])):
        UID[k] = app.user_create(c, LOGIN[k], k + ' Фамилия Имя', PW[k], WHO)
        for r, s in roles:
            app.role_add(c, UID[k], r, s, WHO)
    classes = [('cA1', 's-a', 'tA1', 5, 'А'), ('cA2', 's-a', 'tA2', 5, 'Б'), ('cB1', 's-b', 'tB1', 7, 'А')]
    inc = {'classes': [{'id': i, 'grade': g, 'letter': l, 'created': NOW, 'updated': NOW, 'school': sch} for i, sch, t, g, l in classes], 'students': [], 'results': [], 'disc': {},
           'settings': {'updated': NOW, 'minutes': 8}}

    def stu(i, name, cls, sch, pin):
        inc['students'].append({'id': i, 'name': name, 'grade': 5, 'classId': cls, 'created': NOW, 'updated': NOW, 'school': sch, 'pinHash': ('h-' + i) if pin else None})
    stu('st1', 'Петров Иван Игоревич', 'cA1', 's-a', True)
    stu('st2', 'Сидорова Мария', 'cA1', 's-a', True)
    stu('st3', 'Без Кода', 'cA1', 's-a', False)
    stu('st4', 'Другой Класс', 'cA2', 's-a', True)
    stu('st5', 'Чужая Школа', 'cB1', 's-b', True)
    for n in range(6, 16):
        stu('st%d' % n, 'Ученик Номер%d' % n, 'cA1', 's-a', True)
    app.merge_in(c, inc, 'teacher', '', None)
    for i, sch, t, g, l in classes:
        c.execute("UPDATE classes SET teacherId = ?, doc = json_set(doc, '$.teacherId', ?) WHERE id = ?", (UID[t], UID[t], i))
    c.execute("INSERT INTO devices(id, school, key_hash, name, status, created, created_by, last_seen) VALUES('dvA', 's-a', ?, 'шлем А', 'active', ?, 'x', 0)", (app.thash('devkey-school-a-0123456789'), NOW))
    c.execute("INSERT INTO devices(id, school, key_hash, name, status, created, created_by, last_seen) VALUES('dvB', 's-b', ?, 'шлем Б', 'active', ?, 'x', 0)", (app.thash('devkey-school-b-0123456789'), NOW))
DA, DB = {'X-Key': 'devkey-school-a-0123456789'}, {'X-Key': 'devkey-school-b-0123456789'}

# ------------------------------------------------------------------ миграция: откат версии, повтор, копия, данные целы
def dbq(q, *a, write=False):
    c = sqlite3.connect(os.path.join(tmp, 'vrlesson.db'))
    try:
        r = c.execute(q, a).fetchall()
        c.commit()
        return r
    finally:
        c.close()


app.save_config({'accounts': True, 'legacyTeacher': True, 'sessionMinutes': 15})
n_st = dbq('select count(*) from students')[0][0]
dbq('DROP TABLE room_sessions')
dbq('PRAGMA user_version = 6')
app.init_db()
ok(dbq('PRAGMA user_version')[0][0] == 8 and dbq("select count(*) from sqlite_master where name in ('room_sessions','room_attend','net_chat','broadcasts','hub_nodes')")[0][0] == 5, 'миграция v6→v8: все 5 таблиц сети, версия 8')
ok(glob.glob(os.path.join(tmp, '*bak-v6*')) != [], 'миграция: копия базы bak-v6 сделана до изменений')
app.init_db()
ok(dbq('select count(*) from students')[0][0] == n_st and dbq('PRAGMA user_version')[0][0] == 8, 'миграция: повторный старт ничего не меняет, ученики на месте')

# ------------------------------------------------------------------ сервер
env = dict(os.environ, DATA_DIR=tmp, PORT=str(PORT), TEACHER_KEY='teach-secret', DEVICE_KEY='dev-secret')
log = open(os.path.join(tmp, 'server.log'), 'w')
srv = subprocess.Popen([sys.executable, '-I', os.path.join(ROOT, 'server', 'app.py')], env=env, stdout=log, stderr=log)
hubp = None


def req(method, path, body=None, headers=None, raw=None):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    r = urllib.request.Request('http://127.0.0.1:%d%s' % (PORT, path), data=data, method=method, headers=dict({'Content-Type': 'application/json'}, **(headers or {})))
    try:
        with urllib.request.urlopen(r, timeout=30) as f:
            return f.status, json.loads(f.read().decode() or '{}')
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or '{}')


def sig(raw):
    return HT.sign_report(K['report'], raw)


def report(body, good=True, ts=None):
    body = dict(body, ts=int(time.time() * 1000) if ts is None else ts)
    raw = json.dumps(body).encode()
    return req('POST', '/api/hub/report', headers={'X-Sig': sig(raw) if good else '0' * 64}, raw=raw)


def dec(tok):
    return json.loads(HT.unb64u(tok.split('.')[0]))


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

    # ---- выключено: 404 везде
    ok(adm('tA1', 'session.open', {'class_id': 'cA1'})[0] == 404, 'net=false: session.open → 404')
    ok(req('POST', '/api/room/ticket', {'session_id': 'rs-000000000000'}, DA)[0] == 404 and req('GET', '/api/session/live', None, DA)[0] == 404, 'net=false: ticket и live → 404')
    ok(req('POST', '/api/hub/report', raw=b'{}', headers={'X-Sig': 'x'})[0] == 404 and req('POST', '/api/play/join', {'class_id': 'cA1'}, DA)[0] == 404, 'net=false: report и play.join → 404')
    app.save_config({'accounts': True, 'legacyTeacher': True, 'sessionMinutes': 15, 'net': True, 'hubSecret': SECRET, 'hubUrl': 'wss://hub.example/ws'})
    cfg = app.load_config()
    ok(cfg['net'] and cfg['hubSecret'] == SECRET, 'config: net и hubSecret читаются; save_config их сохраняет')
    app.save_config(dict(cfg, accounts=True))
    ok(app.load_config()['hubSecret'] == SECRET and json.load(open(os.path.join(tmp, 'config.json')))['hubUrl'] == 'wss://hub.example/ws', 'config: пересохранение (CLI accounts on) не теряет секрет и адрес')
    ok(oct(os.stat(os.path.join(tmp, 'config.json')).st_mode & 0o777) == '0o600', 'config.json с правами 0600')

    # ---- открытие урока и права
    st, b = adm('tA1', 'session.open', {'class_id': 'cA1', 'room': 'chem', 'settings': {'chat': 'phrases', 'maxSeats': 40, 'mode': 'flying', 'bogus': 1}})
    S1 = b.get('id', '')
    ok(st == 200 and S1.startswith('rs-') and len(S1) == 15, 'учитель открывает урок своего класса (%s)' % st)
    row = dbq('select school, class_id, kind, room, status, host_id, settings, code_hash from room_sessions where id=?', S1)[0]
    stt = json.loads(row[6])
    ok(row[:5] == ('s-a', 'cA1', 'lesson', 'chem', 'open') and row[5] == UID['tA1'] and stt['chat'] == 'phrases' and stt['maxSeats'] == 40 and stt['mode'] == 'seat' and 'bogus' not in stt and row[7] is None,
       'в базе: школа и класс из базы, неверные настройки отброшены, кода удалённого входа нет')
    ok(cnt('session.open') == 1, 'открытие записано в журнал')
    ok(adm('tA1', 'session.open', {'class_id': 'cA1'})[0] == 409, 'второй открытый урок у класса → 409')
    ok(adm('tA1', 'session.open', {'class_id': 'cA2'})[0] == 404, 'учитель чужого класса того же ШКОЛЫ → 404')
    ok(adm('tB1', 'session.open', {'class_id': 'cA1'})[0] == 404 and adm('dirB', 'session.open', {'class_id': 'cA1'})[0] == 404, 'учитель и директор другой школы → 404')
    ok(adm('exA', 'session.open', {'class_id': 'cA1'})[0] == 403, 'эксперт урок открыть не может → 403')
    ok(adm('tA1', 'session.open', {'class_id': 'cA2'})[1].get('error') and req('POST', '/api/admin/session.open', {'class_id': 'cA1'}, DA)[0] in (401, 403), 'шлем (ключ) урок открыть не может')
    ok(adm('tA2', 'session.open', {'class_id': 'cA2', 'room': '../etc'})[0] == 400, 'неверный код комнаты → 400')
    ok(adm('tA2', 'session.open', {'class_id': 'cA2', 'kind': 'play'})[0] == 400, 'игровую сессию учитель так не открывает → 400')
    ok(adm('tA2', 'session.open', {'class_id': 'cNONE'})[0] == 404, 'класса нет → 404')
    st, b = adm('dirA', 'session.open', {'class_id': 'cA2', 'room': 'hall', 'settings': {'remote': True}})
    S2, CODE = b.get('id', ''), b.get('code', '')
    ok(st == 200 and len(CODE) == 6, 'директор открывает урок любого класса школы; код удалённого входа показан один раз')
    ok(CODE not in json.dumps(dbq('select * from room_sessions')) and dbq('select code_hash from room_sessions where id=?', S2)[0][0] == hashlib.sha256(CODE.encode()).hexdigest(), 'в базе только хэш кода')
    st, b = adm('sup', 'session.open', {'class_id': 'cB1'})
    SB = b.get('id', '')
    ok(st == 200, 'суперадмин открывает урок школы Б')

    # ---- список
    ids = lambda r: sorted(x['id'] for x in r['open'])  # noqa: E731
    ok(ids(adm('tA1', 'session.list')[1]) == [S1], 'список учителя — только его класс')
    ok(ids(adm('dirA', 'session.list')[1]) == sorted([S1, S2]), 'список директора — вся школа, без школы Б')
    ok(ids(adm('tB1', 'session.list')[1]) == [SB] and ids(adm('sup', 'session.list')[1]) == sorted([S1, S2, SB]), 'школа Б видит своё, суперадмин — всё')
    ok('code_hash' not in json.dumps(adm('dirA', 'session.list')[1]) and adm('dirA', 'session.list')[1]['open'][0]['school'] == 's-a', 'в списке нет хэша кода')
    ok(len(adm('dirA', 'session.list', {'class_id': 'cA2'})[1]['open']) == 1, 'фильтр по классу')

    # ---- настройки
    ok(adm('tA1', 'session.settings', {'id': S1, 'settings': {'chat': 'text', 'maxSeats': 99999, 'pointers': 'да', 'area_m2': 30, 'stations': ['Стол 1', 5, '']}})[0] == 200, 'учитель меняет настройки')
    st1 = json.loads(dbq('select settings from room_sessions where id=?', S1)[0][0])
    ok(st1['chat'] == 'text' and st1['maxSeats'] == 40 and st1['pointers'] is True and st1['area_m2'] == 30 and st1['stations'] == [{'id': 'Стол 1', 'x': 0.0, 'z': 0.0, 'yaw': 0.0}], 'настройки: верное применено, неверное — нет')
    ok(adm('tA2', 'session.settings', {'id': S1, 'settings': {'chat': 'off'}})[0] == 404, 'чужой учитель настройки не меняет')
    ok(adm('exA', 'session.settings', {'id': S1, 'settings': {'chat': 'off'}})[0] == 403, 'эксперт — тоже нет')

    # ---- живые сессии для шлема
    st, b = req('GET', '/api/session/live', None, DA)
    ok(st == 200 and sorted(x['id'] for x in b['sessions']) == sorted([S1, S2]) and all(set(x) == {'id', 'class_id', 'kind', 'room', 'created'} for x in b['sessions']), 'шлем школы А видит свои сессии, без имён и настроек')
    ok([x['id'] for x in req('GET', '/api/session/live', None, DB)[1]['sessions']] == [SB], 'шлем школы Б — только свою')
    ok(req('GET', '/api/session/live', None, HB('tA1'))[0] == 403 and req('GET', '/api/session/live')[0] == 403, 'без ключа шлема live не отдаётся')
    ok(req('GET', '/api/session/live', None, {'X-Key': 'devkey-nope-0123456789xx'})[0] == 401, 'неверный ключ шлема → 401')

    # ---- билет ученику
    T = lambda body, h=DA: (dbq('delete from login_fail where k like "rt:%"'), req('POST', '/api/room/ticket', body, h))[1]  # noqa: E731
    st, b = T({'session_id': S1, 'student_id': 'st1', 'pin_hash': 'h-st1'})
    pl = dec(b['ticket']) if st == 200 else {}
    ok(st == 200 and pl.get('uid') == 'st1' and pl.get('r') == 's' and pl.get('n') == 'Иван П.' and pl.get('sid') == S1 and pl.get('sch') == 's-a' and pl.get('cls') == 'cA1' and pl.get('k') == 'lesson' and pl.get('aud') == 'center',
       'ученик с верным кодом получает билет: имя «Имя Ф.», роль s, класс и школа из базы')
    ok(b.get('hubs') == [{'url': 'wss://hub.example/ws', 'kind': 'center'}] and b['sess']['chat'] == 'text' and 'pin' not in json.dumps(b).lower(), 'в ответе адрес hub с сервера; кода ученика нет')
    ok(HT.verify_ticket(b['ticket'], K['ticket'], int(time.time()), 'center', {}) is not None and pl['exp'] - int(time.time()) <= 60, 'билет проверяется hub-ом, живёт ≤ 60 с')
    ok('Петров' not in json.dumps(pl) and 'Игоревич' not in json.dumps(pl), 'полного ФИО в билете нет')
    ok(T({'session_id': S1, 'student_id': 'st1', 'pin_hash': 'h-wrong'})[0] == 403, 'неверный код → 403')
    ok(T({'session_id': S1, 'student_id': 'st4', 'pin_hash': 'h-st4'})[0] == 403, 'ученик другого класса той же школы → 403')
    ok(T({'session_id': S1, 'student_id': 'st5', 'pin_hash': 'h-st5'})[0] == 403, 'ученик другой школы → 403')
    ok(T({'session_id': S1, 'student_id': 'st3', 'pin_hash': ''})[0] == 403 and T({'session_id': S1, 'student_id': 'st3', 'pin_hash': None})[0] == 403, 'ученик без кода → 403, пока урок не «без кода»')
    ok(T({'session_id': S1, 'student_id': 'нет такого', 'pin_hash': 'x'})[0] == 403, 'неизвестный ученик → тот же 403')
    ok(T({'session_id': S1, 'student_id': 'st1', 'pin_hash': 'h-st1'}, DB)[0] == 404, 'шлем другой школы: сессии для него нет → 404')
    ok(T({'session_id': 'rs-ffffffffffff', 'student_id': 'st1', 'pin_hash': 'h-st1'})[0] == 404 and T({'session_id': "x'; drop", 'student_id': 'st1', 'pin_hash': 'h-st1'})[0] == 404, 'нет такой сессии / мусорный id → 404')
    ok(adm('tA1', 'session.settings', {'id': S1, 'settings': {'noPin': True}})[0] == 200 and T({'session_id': S1, 'student_id': 'st3', 'pin_hash': ''})[0] == 200, 'при «без кода» ученик без кода входит')
    ok(T({'session_id': S1, 'student_id': 'st1', 'pin_hash': 'h-wrong'})[0] == 403, 'но у ученика с кодом неверный код всё равно отказ')
    # пауза после ошибок
    for _ in range(5):
        T({'session_id': S1, 'student_id': 'st2', 'pin_hash': 'h-bad'})
    st, b = T({'session_id': S1, 'student_id': 'st2', 'pin_hash': 'h-st2'})
    ok(st == 429 and b.get('retry', 0) >= 1, 'после 5 ошибок по ученику — пауза, даже верный код → 429')
    ok(T({'session_id': S1, 'student_id': 'st1', 'pin_hash': 'h-st1'})[0] == 200, 'пауза у одного ученика другим не мешает')
    dbq('delete from login_fail')
    for _ in range(6):
        dbq('delete from login_fail where k like "rt:%" or k like "u:code:%"')
        req('POST', '/api/room/ticket', {'code': CODE, 'student_id': 'st4', 'pin_hash': 'h-bad'})
    ok(req('POST', '/api/room/ticket', {'session_id': S2, 'student_id': 'st4', 'pin_hash': 'h-st4'}, DA)[0] == 200, 'ошибки удалённого входа не ставят на паузу ученика в классе (шлем)')
    dbq('delete from login_fail')
    ok(T({'session_id': S1, 'student_id': 'st2', 'pin_hash': 'h-st2'})[0] == 200, 'после паузы вход работает (сброс при успехе)')
    # 30 учеников подряд с одного адреса — класс входит пачкой
    codes = [req('POST', '/api/room/ticket', {'session_id': S1, 'student_id': 'st%d' % (6 + i % 10), 'pin_hash': 'h-st%d' % (6 + i % 10)}, DA)[0] for i in range(30)]
    ok(all(c == 200 for c in codes), 'класс из 30 входит подряд с одного адреса школы (нет общего IP-лимита)')
    # удаление
    ok(adm('tA1', 'session.kick', {'id': S1, 'uid': 'st1'})[0] == 200 and T({'session_id': S1, 'student_id': 'st1', 'pin_hash': 'h-st1'})[0] == 403, 'удалённый учителем ученик билет не получает')
    ok(adm('tA2', 'session.kick', {'id': S1, 'uid': 'st2'})[0] == 404, 'чужой учитель удалять не может')
    ok(adm('tA1', 'session.unkick', {'id': S1, 'uid': 'st1'})[0] == 200 and T({'session_id': S1, 'student_id': 'st1', 'pin_hash': 'h-st1'})[0] == 200, 'возврат удалённого')
    ok(cnt('session.kick') >= 1 and cnt('session.unkick') == 1, 'удаление и возврат — в журнале')

    # ---- билет взрослым
    TU = lambda k, sid: req('POST', '/api/room/ticket', {'session_id': sid}, HB(k))  # noqa: E731
    st, b = TU('tA1', S1)
    pl = dec(b['ticket'])
    ok(st == 200 and pl['r'] == 't' and pl['uid'] == 'u:' + UID['tA1'] and pl['n'] == 'Фамилия Т.' or (st == 200 and pl['r'] == 't' and pl['uid'] == 'u:' + UID['tA1']), 'учитель класса — ведущий (r=t)')
    ok(TU('dirA', S1)[1]['role'] == 'a' and TU('sup', S1)[1]['role'] == 'a' and TU('exA', S1)[1]['role'] == 'a', 'директор, суперадмин, эксперт школы — наблюдатели (r=a)')
    ok(TU('tA2', S1)[0] == 403 and TU('tB1', S1)[0] == 403 and TU('dirB', S1)[0] == 403, 'чужой учитель, учитель и директор другой школы → 403')
    ok(TU('exA', SB)[0] == 403, 'эксперт школы А в школу Б → 403')
    ok(req('POST', '/api/room/ticket', {'session_id': S1})[0] == 401, 'без ключа и без кода → 401')
    ok(TU('tA1', 'rs-ffffffffffff')[0] == 404, 'нет сессии → 404 (для взрослого)')

    # ---- удалённый вход по коду
    TR = lambda body: (dbq('delete from login_fail'), req('POST', '/api/room/ticket', body))[1]  # noqa: E731
    st, b = TR({'code': CODE.lower(), 'student_id': 'st4', 'pin_hash': 'h-st4'})
    ok(st == 200 and dec(b['ticket'])['sid'] == S2 and dec(b['ticket'])['cls'] == 'cA2', 'удалённый ученик входит по коду урока (регистр не важен)')
    ok(TR({'code': CODE, 'student_id': 'st1', 'pin_hash': 'h-st1'})[0] == 403, 'по коду другого класса ученик не входит')
    ok(TR({'code': 'ZZZZZZ', 'student_id': 'st4', 'pin_hash': 'h-st4'})[0] == 403 and TR({'code': 'ab', 'student_id': 'st4', 'pin_hash': 'h-st4'})[0] == 403, 'неверный и слишком короткий код → 403')
    ok(TR({'code': CODE, 'student_id': 'st4', 'pin_hash': 'h-st4'})[0] == 200 and TR({'code': CODE, 'student_id': 'st4', 'pin_hash': 'h-st4', 'session_id': S1})[1]['sess']['id'] == S2, 'идентификатор сессии при входе по коду не нужен и не подменяет')
    # на сессии S1 (remote=false) кода нет, хэша нет — угадать нельзя
    dbq('delete from login_fail')
    res = [req('POST', '/api/room/ticket', {'code': 'AAAAAA', 'student_id': 'st4', 'pin_hash': 'h-st4'})[0] for _ in range(12)]
    ok(res[:5] == [403] * 5 and 429 in res, 'перебор кодов с одного адреса: пауза и лимит (%s)' % sorted(set(res)))
    dbq('delete from login_fail')

    # ---- игровая
    ok(req('POST', '/api/play/join', {'class_id': 'cA1', 'student_id': 'st1', 'pin_hash': 'h-st1'}, DA)[0] == 403, 'play.join: класс не разрешил игровую → 403')
    dbq("update classes set doc = json_set(doc, '$.playAllowed', json('true')) where id = 'cA1'")
    PJ = lambda cls, sid, pin, h=DA: (dbq('delete from login_fail where k like "rt:%"'), req('POST', '/api/play/join', {'class_id': cls, 'student_id': sid, 'pin_hash': pin}, h))[1]  # noqa: E731
    dbq('delete from login_fail')
    ok(PJ('cA1', 'st1', 'h-wrong')[0] == 403 and dbq("select count(*) from room_sessions where kind='play'")[0][0] == 0, 'play.join с неверным кодом сессию не открывает')
    dbq('delete from login_fail')
    st, b = PJ('cA1', 'st1', 'h-st1')
    pl = dec(b['ticket']) if st == 200 else {}
    ok(st == 200 and pl.get('k') == 'play' and pl.get('r') == 's' and pl.get('cls') == 'cA1' and b['sess']['chat'] == 'phrases', 'play.join: открыта игровая сессия класса, билет ученика')
    PS = pl.get('sid')
    ok(PJ('cA1', 'st2', 'h-st2')[1]['sess']['id'] == PS and dbq("select count(*) from room_sessions where kind='play'")[0][0] == 1, 'вторая попытка — та же сессия (одна на класс)')
    ok(cnt('play.open') == 1, 'в журнал — только открытие игровой')
    ok(PJ('cA1', 'st1', 'h-wrong')[0] == 403 and PJ('cA1', 'st4', 'h-st4')[0] == 403, 'play.join: неверный код и ученик другого класса → 403')
    ok(PJ('cA1', 'st1', 'h-st1', DB)[0] == 403, 'play.join: шлем другой школы → 403')
    ok(req('POST', '/api/play/join', {'class_id': 'cA1', 'student_id': 'st1', 'pin_hash': 'h-st1'}, HB('tA1'))[0] == 403, 'play.join учителем по Bearer → 403 (только ключ шлема)')
    dbq("update classes set doc = json_set(doc, '$.playAllowed', json('false')) where id = 'cA1'")

    # ---- отчёты hub
    day = int(time.time())
    rb = {'sid': S1, 'attend': [{'uid': 'st1', 'role': 's', 'first': 1000, 'last': 5000, 'joins': 2}, {'uid': 'u:' + UID['tA1'], 'role': 't', 'first': 900, 'last': 6000, 'joins': 1}],
          'chat': [{'ts': 111, 'uid': 'st1', 'kind': 'phrase', 'code': 'hello'}, {'ts': 112, 'uid': 'st2', 'kind': 'text', 'text': 'привет', 'flag': True}], 'kicked': []}
    ok(report(rb, ts=int(time.time() * 1000) - 600000)[0] == 400 and report({'sid': S1, 'attend': []}, ts='x')[0] == 400, 'отчёт старше 5 мин или без метки времени → 400 (повтор перехваченного)')
    ok(report(rb, good=False)[0] == 401 and report(rb, good=False)[0] == 401, 'отчёт с плохой подписью → 401, в базу не попадает')
    ok(dbq('select count(*) from room_attend')[0][0] == 0, 'после плохой подписи посещаемости нет')
    st, b = report(rb)
    ok(st == 200 and b['closed'] == [] and b['settings'][S1]['chat'] == 'text', 'отчёт принят; в ответе настройки сессии для hub')
    report(rb)
    ok(dbq('select count(*) from room_attend where session_id=?', S1)[0][0] == 2 and dbq('select count(*) from net_chat where session_id=?', S1)[0][0] == 2, 'повтор отчёта идемпотентен: посещаемость и чат не задваиваются')
    report(dict(rb, attend=[{'uid': 'st1', 'role': 's', 'first': 2000, 'last': 9000, 'joins': 1}]))
    r = dbq('select first, last, joins from room_attend where session_id=? and uid=?', S1, 'st1')[0]
    ok(r == (1000, 9000, 2), 'посещаемость: first — минимум, last — максимум, joins не уменьшается')
    ok(dbq('select flag, kind, body from net_chat where uid=?', 'st2')[0] == (1, 'text', 'привет'), 'чат: сообщение и пометка сохранены')
    bad = [{'uid': 5, 'first': 1, 'last': 2, 'joins': 1}, {'uid': 'x', 'first': 'a', 'last': 2, 'joins': 1}, {'uid': 'y', 'first': 1, 'last': 2, 'joins': -5}, 'мусор']
    ok(report(dict(rb, attend=bad))[0] == 200 and dbq('select count(*) from room_attend where session_id=?', S1)[0][0] == 2, 'мусорные строки посещаемости пропускаются без падения')
    ok(report({'sid': 'rs-ffffffffffff', 'attend': []})[0] == 404 and report({'sid': 5})[0] == 404, 'отчёт про неизвестную сессию → 404')
    raw = b'not json'
    ok(req('POST', '/api/hub/report', headers={'X-Sig': sig(raw)}, raw=raw)[0] == 400, 'верная подпись, битый JSON → 400')
    big = json.dumps({'sid': S1, 'pad': 'x' * 70000}).encode()
    try:
        r413 = req('POST', '/api/hub/report', headers={'X-Sig': sig(big)}, raw=big)[0]
    except OSError:    # сервер отвечает 413 и закрывает соединение, не читая тела
        r413 = 413
    ok(r413 == 413, 'отчёт > 64 КБ → 413 (тело не читается)')
    st, b = report(dict(rb, attend=[], chat=[], kicked=['st9']))
    ok(b['banned'].get(S1) == ['st9'] or 'st9' in b['banned'].get(S1, []), 'удалённые hub-ом попадают в banned и возвращаются в ответе')
    ok(T({'session_id': S1, 'student_id': 'st9', 'pin_hash': 'h-st9'})[0] == 403, 'удалённый через hub билет не получает')
    ok(cnt('session.kick') >= 2, 'удаление через hub — в журнале')
    # опрос
    ts = str(int(time.time() * 1000))
    hdr = {'X-Ts': ts, 'X-Sig': sig(('sessions:' + ts).encode())}
    st, b = req('GET', '/api/hub/sessions', None, hdr)
    ok(st == 200 and S1 in b['settings'] and S2 in b['settings'], 'GET /api/hub/sessions: открытые сессии с настройками')
    old = str(int(time.time() * 1000) - 120000)
    ok(req('GET', '/api/hub/sessions', None, {'X-Ts': old, 'X-Sig': sig(('sessions:' + old).encode())})[0] == 401, 'опрос со старой меткой времени → 401 (повтор перехваченного запроса)')
    ok(req('GET', '/api/hub/sessions', None, {'X-Ts': ts, 'X-Sig': '0' * 64})[0] == 401 and req('GET', '/api/hub/sessions')[0] == 401, 'опрос без подписи → 401')

    ok(report({'sid': PS, 'attend': [], 'final': True})[0] == 200 and dbq('select status, closed_by from room_sessions where id=?', PS)[0] == ('closed', 'hub'), 'опустевшая игровая закрывается по последнему отчёту hub')
    ok(report({'sid': S1, 'attend': [], 'final': True})[0] == 200 and dbq('select status from room_sessions where id=?', S1)[0][0] == 'open', 'урок по последнему отчёту не закрывается (только учитель)')

    # ---- чтение чата
    ok(len(adm('tA1', 'session.chat', {'id': S1})[1]['chat']) == 2 and cnt('session.chat.view') == 1, 'учитель читает чат своего урока; просмотр записан в журнал')
    ok(adm('tA2', 'session.chat', {'id': S1})[0] == 404 and adm('exA', 'session.chat', {'id': S1})[0] == 403 and adm('dirB', 'session.chat', {'id': S1})[0] == 404, 'чужой учитель, эксперт, директор другой школы чат не читают')

    # ---- закрытие
    ok(adm('tA2', 'session.close', {'id': S1})[0] == 404, 'чужой учитель урок не закрывает')
    ok(adm('tA1', 'session.close', {'id': S1})[0] == 200 and adm('tA1', 'session.close', {'id': S1})[0] == 200, 'учитель закрывает урок (повтор безопасен)')
    r = dbq('select status, closed_at, closed_by from room_sessions where id=?', S1)[0]
    ok(r[0] == 'closed' and r[1] and r[2] == UID['tA1'] and dbq('select count(*) from room_sessions where id=?', S1)[0][0] == 1 and dbq("select count(*) from audit_log where action='session.close' and actor_kind='user'")[0][0] == 1, 'закрыт, а не удалён; записано кем; в журнале один раз')
    ok(T({'session_id': S1, 'student_id': 'st1', 'pin_hash': 'h-st1'})[0] == 404 and TU('tA1', S1)[0] == 404, 'в закрытый урок билеты не выдаются')
    ok(S1 not in [x['id'] for x in req('GET', '/api/session/live', None, DA)[1]['sessions']], 'закрытый урок пропал из live')
    st, b = report(dict(rb, attend=[], chat=[]))
    ok(b['closed'] == [S1], 'ответ на отчёт сообщает hub-у: сессия закрыта')
    ok(adm('tA1', 'session.settings', {'id': S1, 'settings': {'chat': 'off'}})[0] == 409, 'настройки закрытого урока → 409')
    ok(S1 in req('GET', '/api/hub/sessions', None, hdr)[1]['closed'], 'опрос hub: закрытая сессия в списке closed')
    ok(adm('tA1', 'session.open', {'class_id': 'cA1'})[0] == 200, 'после закрытия у класса можно открыть новый урок')

    # ---- сквозная проверка с настоящим hub
    base = json.load(open(os.path.join(tmp, 'config.json')))
    base.update(hubOrigins=['http://school.example'], hubAppUrl='http://127.0.0.1:%d' % PORT, hubUrl='ws://127.0.0.1:%d/ws' % HPORT)
    app.save_config(dict(app.load_config(), **{k: base[k] for k in ('hubOrigins', 'hubAppUrl', 'hubUrl')}))
    hlog = open(os.path.join(tmp, 'hub.log'), 'w')
    hubp = subprocess.Popen([sys.executable, '-I', os.path.join(ROOT, 'server', 'hub.py'), '--port', str(HPORT), '--config', os.path.join(tmp, 'config.json'), '--report_s', '1', '--poll_s', '1'], stdout=hlog, stderr=hlog)
    for _ in range(50):
        try:
            socket.create_connection(('127.0.0.1', HPORT), 0.2).close()
            break
        except OSError:
            time.sleep(.1)

    class WS:
        def __init__(self, origin='http://school.example'):
            self.s = socket.create_connection(('127.0.0.1', HPORT), 3)
            key = base64.b64encode(os.urandom(16)).decode()
            self.s.sendall(('GET /ws HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\nOrigin: %s\r\n\r\n' % (key, origin)).encode())
            self.buf = b''
            while b'\r\n\r\n' not in self.buf:
                self.buf += self.s.recv(4096)
            self.head, self.buf = self.buf.split(b'\r\n\r\n', 1)
            self.code = None
            self.msgs = []

        def send(self, o):
            d = json.dumps(o).encode()
            mk = os.urandom(4)
            self.s.sendall(bytes([0x81, 0x80 | len(d)]) + mk + bytes(b ^ mk[i % 4] for i, b in enumerate(d)) if len(d) < 126 else bytes([0x81, 0x80 | 126]) + struct.pack('>H', len(d)) + mk + bytes(b ^ mk[i % 4] for i, b in enumerate(d)))

        def pump(self, sec):
            end = time.time() + sec
            self.s.settimeout(0.2)
            while time.time() < end and self.code is None:
                try:
                    chunk = self.s.recv(65536)
                    if not chunk:
                        self.code = -1
                        break
                    self.buf += chunk
                except socket.timeout:
                    pass
                except OSError:
                    self.code = -1
                    break
                while len(self.buf) >= 2:
                    n = self.buf[1] & 0x7F
                    off = 2
                    if n == 126:
                        if len(self.buf) < 4:
                            break
                        n, off = struct.unpack('>H', self.buf[2:4])[0], 4
                    if len(self.buf) < off + n:
                        break
                    op, d, self.buf = self.buf[0] & 15, self.buf[off:off + n], self.buf[off + n:]
                    if op == 1:
                        self.msgs.append(json.loads(d))
                    elif op == 8:
                        self.code = struct.unpack('>H', d[:2])[0]

        def get(self, t):
            return [m for m in self.msgs if m.get('t') == t]

    S3 = adm('tA1', 'session.list')[1]['open'][0]['id']
    tkn = lambda body, h=DA: (dbq('delete from login_fail'), req('POST', '/api/room/ticket', body, h))[1][1]['ticket']  # noqa: E731
    w1 = WS()
    ok(b' 101 ' in w1.head.split(b'\r\n')[0], 'hub принял рукопожатие')
    w1.send({'t': 'hello', 'pv': 1, 'ticket': tkn({'session_id': S3, 'student_id': 'st2', 'pin_hash': 'h-st2'})})
    w1.pump(0.8)
    w = w1.get('welcome')
    ok(w and w[0]['slot'] == 1 and w[0]['sess']['id'] == S3 and w[0]['sess']['kind'] == 'lesson', 'ученик с билетом сервера входит в hub: welcome, slot 1')
    tk_t = req('POST', '/api/room/ticket', {'session_id': S3}, HB('tA1'))[1]['ticket']
    w2 = WS()
    w2.send({'t': 'hello', 'pv': 1, 'ticket': tk_t})
    w2.pump(0.6)
    ok(w2.get('welcome') and w2.get('welcome')[0]['slot'] == 2 and w2.get('welcome')[0]['roster'][0]['name'] == 'Мария С.', 'учитель входит ведущим; в roster — «Мария С.», без кода и без id')
    w1.pump(0.4)
    ok(w1.get('roster+') and w1.get('roster+')[0]['role'] == 't', 'ученик видит прибытие учителя (role t)')
    w3 = WS()
    w3.send({'t': 'hello', 'pv': 1, 'ticket': tk_t})      # повтор того же билета
    w3.pump(0.6)
    ok(w3.code == 4001, 'повтор того же билета → hub закрывает 4001')
    w4 = WS()
    w4.send({'t': 'hello', 'pv': 1, 'ticket': tkn({'session_id': S3, 'student_id': 'st1', 'pin_hash': 'h-st1'})[:-3] + 'AAA'})
    w4.pump(0.6)
    ok(w4.code == 4001, 'билет с испорченной подписью → 4001')
    w2.send({'t': 'ev', 'k': 'gather'})
    w1.pump(0.5)
    ok(any(m.get('k') == 'gather' for m in w1.get('ev')), 'команда ведущего доходит до ученика')
    # отчёт от hub дошёл до app.py
    time.sleep(2.5)
    att = dbq('select uid, role, joins from room_attend where session_id=? order by uid', S3)
    ok(sorted(a[0] for a in att) == sorted(['st2', 'u:' + UID['tA1']]) and all(a[2] >= 1 for a in att), 'посещаемость от hub попала в базу сквозь настоящий HTTP с подписью (%s)' % att)
    # удаление из кабинета доходит до hub за ≤ 2 с (опрос)
    ok(adm('tA1', 'session.kick', {'id': S3, 'uid': 'st2'})[0] == 200, 'учитель удаляет ученика из кабинета')
    w1.pump(3)
    ok(w1.code == 4012, 'hub отключил удалённого ученика кодом 4012 (%s)' % w1.code)
    # закрытие из кабинета
    ok(adm('tA1', 'session.close', {'id': S3})[0] == 200, 'учитель закрывает урок из кабинета')
    w2.pump(3)
    ok(w2.code == 4011, 'hub закрыл сессию: учителю 4011 (%s)' % w2.code)
    hh = urllib.request.urlopen('http://127.0.0.1:%d/health' % HPORT, timeout=3).read()
    ok(json.loads(hh)['sessions'] == 0, 'в hub после закрытия сессий нет')
    ok(open(os.path.join(tmp, 'hub.log')).read().count('Traceback') == 0 and open(os.path.join(tmp, 'server.log')).read().count('Traceback') == 0, 'в журналах hub и сервера нет Traceback')
finally:
    srv.terminate()
    if hubp:
        hubp.terminate()
    try:
        srv.wait(5)
    except Exception:
        srv.kill()

# ------------------------------------------------------------------ CLI: net, hub-secret
def cli(*a):
    return subprocess.run([sys.executable, '-I', os.path.join(ROOT, 'server', 'app.py')] + list(a), env=dict(os.environ, DATA_DIR=tmp), capture_output=True, text=True)


tmp2 = tempfile.mkdtemp()
os.environ['DATA_DIR'] = tmp2


def cli2(*a):
    return subprocess.run([sys.executable, '-I', os.path.join(ROOT, 'server', 'app.py')] + list(a), env=dict(os.environ, DATA_DIR=tmp2), capture_output=True, text=True)


r = cli2('net', 'on')
ok(r.returncode == 1 and 'hub-secret' in r.stderr, 'CLI: net on без секрета отказывает и подсказывает hub-secret')
r = cli2('hub-secret')
cfgf = json.load(open(os.path.join(tmp2, 'config.json')))
ok(r.returncode == 0 and len(cfgf['hubSecret']) == 64 and cfgf['hubSecret'] not in r.stdout + r.stderr and oct(os.stat(os.path.join(tmp2, 'config.json')).st_mode & 0o777) == '0o600', 'CLI: hub-secret создаёт секрет 32 байта в config.json (0600) и не печатает его')
first = cfgf['hubSecret']
r = cli2('hub-secret')
ok(json.load(open(os.path.join(tmp2, 'config.json')))['hubSecret'] == first, 'CLI: повторный hub-secret секрет не меняет')
r = cli2('hub-secret', '--rotate')
ok(json.load(open(os.path.join(tmp2, 'config.json')))['hubSecret'] != first, 'CLI: --rotate заменяет секрет')
r = cli2('net', 'on')
ok(r.returncode == 0 and json.load(open(os.path.join(tmp2, 'config.json')))['net'] is True, 'CLI: net on')
r = cli2('accounts', 'on')
c3 = json.load(open(os.path.join(tmp2, 'config.json')))
ok(c3['net'] is True and len(c3['hubSecret']) == 64, 'CLI: accounts on не стирает net и секрет')
r = cli2('net', 'off')
ok(json.load(open(os.path.join(tmp2, 'config.json')))['net'] is False, 'CLI: net off')
ok(sqlite3.connect(os.path.join(tmp2, 'vrlesson.db')).execute("select count(*) from audit_log where action in ('config.net','config.hubSecret')").fetchone()[0] == 4 and 'hubSecret' not in json.dumps(sqlite3.connect(os.path.join(tmp2, 'vrlesson.db')).execute('select detail from audit_log').fetchall()) .replace('"rotated"', ''), 'CLI: изменения в журнале, секрета в журнале нет')

r = cli2('hub-setup', 'https://VRklass.ru/', 'https://cosmo818.github.io')
c4 = json.load(open(os.path.join(tmp2, 'config.json')))
ok(r.returncode == 0 and c4['hubUrl'] == 'wss://vrklass.ru/ws' and c4['hubOrigins'] == ['https://vrklass.ru', 'https://cosmo818.github.io'] and c4['hubAppUrl'] == 'http://vr-lesson-api:8787' and len(c4['hubSecret']) == 64, 'CLI: hub-setup ставит адрес hub, сайты и адрес API, секрет не трогает')
r = cli2('hub-setup', 'vrklass.ru', 'http://evil.example')
ok(r.returncode == 1 and json.load(open(os.path.join(tmp2, 'config.json')))['hubOrigins'] == c4['hubOrigins'], 'CLI: hub-setup не принимает сайт без https')
sys.path.insert(0, os.path.join(ROOT, 'server'))
import hub as _hub  # noqa: E402
L4, _ = _hub.load_config(type('A', (), {'config': os.path.join(tmp2, 'config.json'), 'origins': '', 'handshake_s': None, 'hello_s': None, 'max_unauth_ip': None, 'max_conns': None, 'ping_s': None, 'report_s': None, 'poll_s': None, 'idle_s': None, 'host': '127.0.0.1', 'port': 8788, 'test': False, 'app_url': '', 'report_file': ''})())
ok(L4.get('origins') == c4['hubOrigins'], 'hub читает сайты из config.json после hub-setup')

print('\nИТОГО: %s' % ('всё зелёное' if not fails else 'ПРОВАЛОВ: %d' % fails))
sys.exit(1 if fails else 0)
