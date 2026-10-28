"""Шаг Э3 PLAN-einstein.md: зачётные решения «Эйнштейна» и рейтинг (server/einrank.py, маршруты /api/ein/*, admin ein.void, пересчёт при переводе ученика).
Живой app.py на свободном порту, реальные данные: 2 региона, 3 района, 4 школы, 40 учеников (у каждого код входа), 285 решений, предметник, архивный ученик.
Расчётные проверки рейтинга идут в самом тесте (независимый подсчёт на Python) через einrank.top в процессе теста; маршруты, права и пауза — по HTTP.
Запуск: python3 -I tests/ein_rating.py. Печатает «ok  : …» / «FAIL: …» (tests/run.js включает строки в общий счёт)."""
import json, os, socket, sqlite3, subprocess, sys, tempfile, time, urllib.error, urllib.request
from fractions import Fraction

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
tmp = tempfile.mkdtemp()
fails = 0
os.environ.update(DATA_DIR=tmp)
sys.path.insert(0, os.path.join(ROOT, 'server'))
import app  # noqa: E402

E = app.einrank_module()
with socket.socket() as _s:
    _s.bind(('127.0.0.1', 0))
    PORT = _s.getsockname()[1]


def ok(c, m):
    global fails
    print(('ok  : ' if c else 'FAIL: ') + m, flush=True)
    if not c:
        fails += 1


NOW = int(time.time() * 1000)
WHO = ('cli', 'test', '')
LOGIN = {'dir1': 'dir.one', 'dir2': 'dir.two', 't1': 't.one', 'tsub': 't.sub', 'sup': 'super.one'}
PW = {k: 'Pass-%s-2026-Zq' % k for k in LOGIN}
SEC = []   # ключи, токены и коды: в журнале и в выводе сервера их быть не должно
SCH = {'s1': ('Школа 1', 'Регион1', 'Район А'), 's2': ('Школа 2', 'Регион1', 'Район Б'), 's3': ('Школа 3', 'Регион2', 'Район А'), 's4': ('Школа 4', 'Регион1', 'Район А')}
CLS = {'s1': 'c1', 's2': 'c2', 's3': 'c3', 's4': 'c4'}
SOF = {}   # ученик → школа
BULK = range(1, 39)   # st1..st38 — с готовыми решениями; st39 и st40 — «чистые», решают по HTTP


def sch_of(i):
    return 's%d' % ((i - 1) // 10 + 1)


app.init_db()
UID = {}
with app.db() as c:
    for sid, (nm, rg, dt) in SCH.items():
        c.execute("INSERT INTO schools(id, name, region, district, status, network, created, updated) VALUES(?, ?, ?, ?, 'active', '', ?, ?)", (sid, nm, rg, dt, NOW, NOW))
    for k, roles in (('dir1', [('director', 's1')]), ('dir2', [('director', 's2')]), ('t1', [('teacher', 's1')]), ('tsub', [('teacher', 's1')]), ('sup', [('superadmin', '')])):
        UID[k] = app.user_create(c, LOGIN[k], k + ' Фамилия Имя', PW[k], WHO)
        for r, s in roles:
            app.role_add(c, UID[k], r, s, WHO)
    inc = {'classes': [{'id': CLS[s], 'grade': 5 + n, 'letter': 'А', 'created': NOW, 'updated': NOW, 'school': s} for n, s in enumerate(SCH)], 'students': [], 'results': [], 'disc': {},
           'settings': {'updated': NOW, 'minutes': 8}}
    for i in range(1, 41):
        sch = sch_of(i)
        SOF['st%d' % i] = sch
        inc['students'].append({'id': 'st%d' % i, 'name': 'Фамилия%d Имя%d Отчество%d' % (i, i, i), 'grade': 5, 'classId': CLS[sch], 'created': NOW, 'updated': NOW, 'school': sch, 'pinHash': 'h-st%d' % i})
    app.merge_in(c, inc, 'teacher', '', None)
    for cid in CLS.values():
        c.execute("UPDATE classes SET teacherId = ?, doc = json_set(doc, '$.teacherId', ?) WHERE id = ?", (UID['t1'], UID['t1'], cid))
    c.execute("INSERT INTO class_teachers(class_id, user_id, subject, since, by_user) VALUES('c1', ?, 'Информатика', ?, ?)", (UID['tsub'], NOW, UID['t1']))
    for sch, key in (('s1', 'devkey-s1-aaaaaaaaaaaaaaaa'), ('s2', 'devkey-s2-aaaaaaaaaaaaaaaa'), ('s4', 'devkey-s4-aaaaaaaaaaaaaaaa')):
        c.execute("INSERT INTO devices(id, school, key_hash, name, status, created, created_by, last_seen) VALUES(?, ?, ?, 'Шлем', 'active', ?, 'test', ?)", ('dv-' + sch, sch, app.thash(key), NOW, NOW))
        SEC.append(key)
DEV = {'s1': 'devkey-s1-aaaaaaaaaaaaaaaa', 's2': 'devkey-s2-aaaaaaaaaaaaaaaa', 's4': 'devkey-s4-aaaaaaaaaaaaaaaa'}

# решения st1..st38: n = 4 + (i//2)%8 (4…11), времена base+k, base = 100 + 2*(i%6); есть точные равенства (i и i+24), равенства среднего при разном n и ученики с n < 5
SOLVES = {}
with app.db() as c:
    for i in BULK:
        n, base = 4 + (i // 2) % 8, 100 + 2 * (i % 6)
        for k in range(n):
            c.execute("INSERT INTO ein_solves(pk, pid, seed, school, t, moves, helped, void, ts, src) VALUES('s', ?, ?, ?, ?, 40, 0, 0, ?, 'test')", ('st%d' % i, 1000 * i + k, SOF['st%d' % i], base + k, NOW - 100000 + i * 10 + k))
        # помощь и аннулированное — в рейтинг не идут
        c.execute("INSERT INTO ein_solves(pk, pid, seed, school, t, moves, helped, void, ts, src) VALUES('s', ?, ?, ?, 5, 40, 1, 0, ?, 'test')", ('st%d' % i, 1000 * i + 900, SOF['st%d' % i], NOW))
        c.execute("INSERT INTO ein_solves(pk, pid, seed, school, t, moves, helped, void, ts, src) VALUES('s', ?, ?, ?, 5, 40, 0, 1, ?, 'test')", ('st%d' % i, 1000 * i + 901, SOF['st%d' % i], NOW))
        E.restat(c, 's', 'st%d' % i)
        SOLVES['st%d' % i] = (n, n * base + n * (n - 1) // 2, NOW - 100000 + i * 10 + n - 1)
N_SOLVES = sum(v[0] for v in SOLVES.values())


def dbq(q, *a):
    c = sqlite3.connect(os.path.join(tmp, 'vrlesson.db'))
    try:
        r = c.execute(q, a).fetchall()
        c.commit()
        return r
    finally:
        c.close()


def sname(i):
    return 'Имя%d Ф.' % i


def expected(schools, order):
    """Независимый подсчёт по сырым решениям (helped=0, void=0): [(место, имя, n, среднее)] для учеников st1…st40 выбранных школ (архивные и n<5 в «avg» отсечены)."""
    rows = []
    for pid, st in dbq('select id, status from students where id like ?', 'st%'):
        n, sm, last = dbq("select count(*), coalesce(sum(t), 0), coalesce(max(ts), 0) from ein_solves where pk = 's' and pid = ? and helped = 0 and void = 0", pid)[0]
        if SOF.get(pid) in schools and st == 'active' and n >= (5 if order == 'avg' else 1):
            rows.append((pid, n, Fraction(sm, n), last))
    rows.sort(key=lambda r: (r[2], -r[1], r[3], r[0]) if order == 'avg' else (-r[1], r[2], r[3], r[0]))
    return [(k + 1, sname(int(r[0][2:])), r[1], round(float(r[2]), 1)) for k, r in enumerate(rows)][:200]


def inproc(who, body):
    """einrank.top в процессе теста (кэш можно сбросить); who — как из viewer."""
    with app.lock, app.db() as c:
        return E.top(app, c, who, body, int(time.time() * 1000))


ST = lambda i: {'pk': 's', 'pid': 'st%d' % i, 'school': sch_of(i), 'roles': []}  # noqa: E731
TCH = lambda sch: {'pk': None, 'pid': 'u', 'school': '', 'roles': [{'role': 'director', 'school': sch}]}  # noqa: E731
SUP = {'pk': None, 'pid': 'u', 'school': '', 'roles': [{'role': 'superadmin', 'school': ''}]}


def lst(out):
    return [(x['rank'], x['name'], x['n'], x['avg']) for x in out['items']]


ok(len(SOLVES) == 38 and N_SOLVES >= 250 and all(dbq('select n from ein_stats where pid = ?', p)[0][0] == v[0] for p, v in SOLVES.items()),
   'фикстура: 4 школы в 3 районах и 2 регионах, 40 учеников, %d зачётных решений; helped и void в ein_stats не идут' % N_SOLVES)

app.save_config({'accounts': True, 'legacyTeacher': True, 'sessionMinutes': 15, 'einRating': False, 'studentDevices': False})
env = dict(os.environ, DATA_DIR=tmp, PORT=str(PORT), TEACHER_KEY='teach-secret', DEVICE_KEY='dev-secret')
log = open(os.path.join(tmp, 'server.log'), 'w')
srv = subprocess.Popen([sys.executable, '-I', os.path.join(ROOT, 'server', 'app.py')], env=env, stdout=log, stderr=log)


def req(path, body=None, headers=None, method='POST'):
    data = json.dumps(body if body is not None else {}).encode() if method == 'POST' else None
    r = urllib.request.Request('http://127.0.0.1:%d%s' % (PORT, path), data=data, method=method, headers=dict({'Content-Type': 'application/json'}, **(headers or {})))
    try:
        with urllib.request.urlopen(r, timeout=60) as f:
            return f.status, json.loads(f.read().decode() or '{}')
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or '{}')


try:
    for _ in range(50):
        try:
            if req('/api/health', method='GET')[0] == 200:
                break
        except Exception:
            time.sleep(.2)
    TOK = {}
    for k in LOGIN:
        dbq('delete from login_fail')
        st, b = req('/api/auth/login', {'login': LOGIN[k], 'password': PW[k]})
        TOK[k] = b.get('token', '')
    ok(all(TOK.values()), 'фикстура: 5 пользователей вошли')
    HB = lambda k: {'Authorization': 'Bearer ' + TOK[k]}  # noqa: E731
    adm = lambda k, a, body=None: req('/api/admin/' + a, body or {}, HB(k))  # noqa: E731
    clear = lambda: dbq('delete from login_fail')  # noqa: E731
    setcfg = lambda **kw: app.save_config(dict(app.load_config(), **kw))  # noqa: E731

    def dk(i, **extra):
        """Тело запроса с шлема: student_id + код ученика."""
        return dict({'student_id': 'st%d' % i, 'pin_hash': 'h-st%d' % i}, **extra)

    KH = lambda sch: {'X-Key': DEV[sch]}  # noqa: E731

    # ---- флаг выключен: 404 везде (А7)
    ok(all(req(p, dk(39), KH('s4'))[0] == 404 for p in ('/api/ein/seed', '/api/ein/solve', '/api/ein/top', '/api/ein/places')) and adm('sup', 'ein.void', {'pid': 'st1'})[0] == 404,
       'einRating=false: seed, solve, top, places и ein.void → 404')
    setcfg(einRating=True, studentDevices=True)

    # ---- кто пришёл
    ok(req('/api/ein/top', {})[0] == 401 and req('/api/ein/top', {}, {'X-Key': 'x' * 30})[0] == 401 and req('/api/ein/top', {}, {'Authorization': 'Bearer nope-nope-nope'})[0] == 401,
       'невошедший (нет данных, чужой ключ шлема, неверный токен) → 401')
    clear()
    r1 = req('/api/ein/top', dk(39), KH('s1'))               # ученик другой школы
    r2 = req('/api/ein/top', {'student_id': 'st-net', 'pin_hash': 'h'}, KH('s4'))   # такого ученика нет
    r3 = req('/api/ein/top', dk(39, pin_hash='h-wrong'), KH('s4'))                  # неверный код
    r4 = req('/api/ein/top', {'student_id': 'st39'}, KH('s4'))                      # кода нет
    ok(r1 == r2 == r3 == r4 and r1[0] == 403 and r1[1] == {'error': 'denied'}, 'чужой шлем, несуществующий ученик, неверный и пустой код → 403 одним и тем же ответом')
    clear()
    for _ in range(5):
        req('/api/ein/top', dk(39, pin_hash='h-wrong'), KH('s4'))
    st, b = req('/api/ein/top', dk(39), KH('s4'))
    ok(st == 429 and b.get('retry', 0) > 0, 'после 5 ошибок кода — пауза, верный код в паузу → 429')
    ok(req('/api/ein/top', dk(39), KH('s4'))[0] == 429 and req('/api/ein/top', dk(31), KH('s4'))[0] == 200, 'пауза только по ученику; другой ученик школы (st31) входит')
    clear()
    st, b = req('/api/ein/top', dk(39), KH('s4'))
    ok(st == 200, 'верный код после очистки паузы → 200')
    ok(dbq("select count(*) from login_fail where k = 'u:epin:st39'")[0][0] == 0, 'успех сбрасывает счётчик ошибок кода')

    # ---- сид и решения (st39 со шлема школы s4)
    st, b = req('/api/ein/seed', dk(39, src='lib'), KH('s4'))
    seed = b.get('seed')
    ok(st == 200 and isinstance(seed, int) and 0 <= seed < 2 ** 32 and abs(b.get('issued', 0) - NOW) < 60000 and dbq("select src from ein_issued where pid='st39' and seed=?", seed)[0][0] == 'lib',
       'seed: номер 0…2^32-1 и время выдачи записаны игроку')
    ok(req('/api/ein/seed', {}, {'Authorization': HB('dir1')['Authorization']})[0] == 403, 'учитель (Bearer) не получает сид — игра учителя в Т1')
    st, b = req('/api/ein/solve', dk(39, seed=seed, time=60, moves=30, helped=0), KH('s4'))
    ok(st == 200 and b['rated'] is False and b['reason'] == 'fast', 'время больше прошедшего с выдачи → fast, не в зачёте')
    dbq("update ein_issued set issued = ? where pid='st39' and seed=?", NOW - 200000, seed)
    st, b = req('/api/ein/solve', dk(39, seed=seed, time=10, moves=30, helped=0), KH('s4'))
    ok(b.get('reason') == 'fast' and not b['rated'], 'быстрее einMinSec → fast')
    st, b = req('/api/ein/solve', dk(39, seed=seed, time=15000, moves=30, helped=0), KH('s4'))
    ok(b.get('reason') == 'slow', 'дольше einMaxSec → slow')
    st, b = req('/api/ein/solve', dk(39, seed=12345, time=60, moves=30, helped=0), KH('s4'))
    ok(b.get('reason') == 'not_issued' and not b['rated'], 'сид не выдавался этому игроку → not_issued')
    ok(dbq("select count(*) from ein_solves where pid='st39'")[0][0] == 0, 'отказы ничего не записали и сид не сожгли')
    badn = 0
    for bad in ({'seed': -1}, {'seed': 2 ** 32}, {'seed': 'x'}, {'seed': True}, {'time': 'x'}, {'time': -5}, {'moves': 0}, {'moves': 10000}, {'moves': 2.5}, {'helped': 2}, {'helped': 'no'}, {'helped': None}):
        body = dk(39, seed=seed, time=60, moves=30, helped=0)
        body.update(bad)
        badn += req('/api/ein/solve', body, KH('s4'))[0] != 400
    ok(badn == 0 and dbq("select count(*) from ein_solves where pid='st39'")[0][0] == 0, 'неверный формат (сид, время, ходы, helped) → 400, ничего не записано')
    st, b = req('/api/ein/solve', dk(39, seed=seed, time=60.4, moves=30, helped=0, src='lib'), KH('s4'))
    ok(st == 200 and b['rated'] is True and b['stats'] == {'n': 1, 'avg': 60.0} and dbq("select t, moves, helped, school from ein_solves where pid='st39'")[0] == (60, 30, 0, 's4'),
       'зачёт: решение записано (время 60, школа s4), stats {n:1, avg:60}')
    st, b = req('/api/ein/solve', dk(39, seed=seed, time=90, moves=5, helped=0), KH('s4'))
    ok(b.get('reason') == 'repeat' and not b['rated'] and dbq("select t, moves from ein_solves where pid='st39'") == [(60, 30)] and dbq("select n, sum_t from ein_stats where pid='st39'")[0] == (1, 60),
       'повтор сида → repeat, время и ходы не перезаписаны, сводка прежняя')
    st, b = req('/api/ein/seed', dk(39), KH('s4'))
    seed2 = b['seed']
    dbq("update ein_issued set issued = ? where pid='st39' and seed=?", NOW - 200000, seed2)
    st, b = req('/api/ein/solve', dk(39, seed=seed2, time=70, moves=30, helped=1), KH('s4'))
    ok(b.get('reason') == 'helped' and not b['rated'] and dbq("select helped, t from ein_solves where pid='st39' and seed=?", seed2)[0] == (1, 70) and dbq("select n from ein_stats where pid='st39'")[0][0] == 1,
       'решение с «Открыть клетку» (helped) → записано, не в зачёте, сводка не изменилась')
    st, b = req('/api/ein/solve', dk(39, seed=seed2, time=70, moves=30, helped=0), KH('s4'))
    ok(b.get('reason') == 'repeat' and dbq("select helped from ein_solves where pid='st39' and seed=?", seed2)[0][0] == 1, 'helped сжигает сид: повтор без помощи по нему уже не зачтётся')
    st, b = req('/api/ein/seed', dk(39), KH('s4'))
    seed3 = b['seed']
    dbq("update ein_issued set issued = ? where pid='st39' and seed=?", NOW - 25 * 3600 * 1000, seed3)
    st, b = req('/api/ein/solve', dk(39, seed=seed3, time=70, moves=30, helped=0), KH('s4'))
    ok(b.get('reason') == 'expired' and dbq("select count(*) from ein_solves where pid='st39' and seed=?", seed3)[0][0] == 0, 'сид старше einIssueTtlH → expired')
    st, b = req('/api/ein/solve', dk(40, seed=seed3, time=70, moves=30, helped=0), KH('s4'))
    ok(b.get('reason') == 'not_issued', 'сид другого игрока (st39) у st40 → not_issued')

    # ---- пункты 1 и 2: один действующий выданный сид на игрока, старые не стираются
    dbq("insert into ein_issued(pk, pid, seed, issued, src, status) values('s', 'st39', 777001, ?, 'old', 'active')", NOW - 8 * 86400 * 1000)
    n_rows = dbq("select count(*) from ein_issued where pid = 'st39'")[0][0]
    st, b = req('/api/ein/seed', dk(39), KH('s4'))
    sA = b['seed']
    ok(dbq("select status from ein_issued where pid = 'st39' and seed = 777001")[0][0] == 'expired' and dbq("select count(*) from ein_issued where pid = 'st39'")[0][0] == n_rows + 1,
       'выданный старше 7 суток помечен expired и не стёрт (А15): строк на одну больше')
    st, b = req('/api/ein/seed', dk(39), KH('s4'))
    sB = b['seed']
    ok(dbq("select status from ein_issued where pid = 'st39' and seed = ?", sA)[0][0] == 'void' and dbq("select seed from ein_issued where pid = 'st39' and status = 'active'") == [(sB,)],
       'новый сид гасит прежний: у игрока ровно один active')
    dbq("update ein_issued set issued = ? where pid='st39' and seed in (?, ?)", NOW - 200000, sA, sB)
    st, b = req('/api/ein/solve', dk(39, seed=sA, time=60, moves=30, helped=0), KH('s4'))
    ok(b.get('reason') == 'superseded' and not b['rated'] and dbq("select count(*) from ein_solves where pid='st39' and seed=?", sA)[0][0] == 0, 'решение по погашенному сиду → superseded, не в зачёте и не записано')
    st, b = req('/api/ein/solve', dk(39, seed=777001, time=60, moves=30, helped=0), KH('s4'))
    ok(b.get('reason') == 'expired' and not b['rated'], 'решение по помеченному expired → expired')
    n_before_st39 = dbq("select n from ein_stats where pid = 'st39'")[0][0]
    st, b = req('/api/ein/solve', dk(39, seed=sB, time=60, moves=30, helped=0), KH('s4'))
    ok(b.get('rated') is True and dbq("select n from ein_stats where pid = 'st39'")[0][0] == n_before_st39 + 1, 'последний выданный сид решается и идёт в зачёт')

    # ---- пункт 7: шлем, как student_check — класс ученика действующий и той же школы
    dbq("update classes set status = 'archived' where id = 'c4'")
    clear()
    ok(req('/api/ein/top', dk(31), KH('s4'))[0] == 403, 'ученик архивного класса со шлема → 403')
    dbq("update classes set status = 'active' where id = 'c4'")
    clear()
    ok(req('/api/ein/top', dk(31), KH('s4'))[0] == 200, 'класс возвращён → 200')
    dbq("update classes set school = 's1' where id = 'c4'")
    clear()
    ok(req('/api/ein/top', dk(31), KH('s4'))[0] == 403, 'класс ученика из другой школы, чем шлем → 403')
    dbq("update classes set school = 's4' where id = 'c4'")
    clear()
    ok(req('/api/ein/top', dk(31), KH('s4'))[0] == 200, 'школа класса возвращена → 200')

    # ---- сеанс ученика (X-Student): тот же зачёт
    st, b = adm('sup', 'student.device.code', {'student_id': 'st40'})
    SEC.append(b.get('code', ''))
    st, b = req('/api/student/pair', {'code': b['code'], 'name': 'Телефон'})
    skey = b['key']
    SEC.append(skey)
    ok(req('/api/ein/seed', {}, {'X-Student': skey})[0] == 401, 'ключ устройства без токена сеанса → 401')
    st, b = req('/api/student/login', {'pin_hash': 'h-st40'}, {'X-Student': skey})
    stok = b['token']
    SEC.append(stok)
    SH = {'X-Student': skey, 'X-Stoken': stok}
    st, b = req('/api/ein/seed', {'src': 'web'}, SH)
    sd = b['seed']
    ok(st == 200 and dbq("select pk, pid from ein_issued where seed = ? and pid = 'st40'", sd) == [('s', 'st40')], 'сеанс ученика: сид выдан ученику st40')
    dbq("update ein_issued set issued = ? where pid='st40' and seed=?", NOW - 100000, sd)
    st, b = req('/api/ein/solve', {'seed': sd, 'time': 45, 'moves': 22, 'helped': 0}, SH)
    ok(st == 200 and b['rated'] is True and b['stats']['n'] == 1, 'сеанс ученика: решение в зачёте')
    ok(req('/api/ein/seed', {'student_id': 'st1', 'pin_hash': 'h-st1'}, SH)[0] == 200 and dbq("select count(*) from ein_issued where pid = 'st1'")[0][0] == 0, 'student_id в теле при сеансе игнорируется: сид выдан своему ученику, не st1')

    # ---- срезы и видимость (расчёты — независимый подсчёт)
    E._CACHE.clear()
    allsch = {'s1', 's2', 's3', 's4'}
    for order in ('avg', 'count'):
        st, out = inproc(ST(1), {'scope': 'school', 'order': order})
        ex = expected({'s1'}, order)
        ok(st == 200 and lst(out) == ex and out['total'] == len(ex), 'школа s1, порядок «%s»: %d строк, места, имена, n и среднее совпали с независимым подсчётом' % (order, len(ex)))
    avg_s1 = inproc(ST(1), {'order': 'avg'})[1]
    ok(all(x['n'] >= 5 for x in avg_s1['items']) and len(avg_s1['items']) < len(expected({'s1'}, 'count')), 'порядок «среднее» отсекает учеников с n < 5; порядок «число» их показывает')
    reg = lst(inproc(ST(1), {'scope': 'region', 'order': 'count'})[1])
    ties = [r for r in reg if r[2] == 7]
    ok(len(ties) >= 2 and [r[3] for r in ties] == sorted(r[3] for r in ties) and len({r[3] for r in ties}) < len(ties) + 1, 'равенства в порядке «число»: при равном n — по среднему времени')
    avgreg = lst(inproc(ST(1), {'scope': 'region', 'order': 'avg'})[1])
    grp = {}
    for r in avgreg:
        grp.setdefault(r[3], []).append(r[2])
    cross = [v for v in grp.values() if len(set(v)) > 1]
    ok(cross and all(v == sorted(v, reverse=True) for v in cross), 'равенства в порядке «среднее»: при равном среднем (разное n) больше решений выше (%d таких групп)' % len(cross))
    for scope, sch, ident in (('district', {'s1', 's4'}, None), ('region', {'s1', 's2', 's4'}, None)):
        for order in ('avg', 'count'):
            st, out = inproc(ST(1), {'scope': scope, 'order': order})
            ok(lst(out) == expected(sch, order), '%s ученика s1, порядок «%s»: совпал с независимым подсчётом' % ('район' if scope == 'district' else 'регион', order))
    ok(inproc(ST(1), {'scope': 'district'})[1]['label'] == 'Район А, Регион1' and inproc(ST(1), {'scope': 'region'})[1]['label'] == 'Регион1', 'подписи среза: «Район А, Регион1», «Регион1»')
    ra = inproc(TCH('s1'), {'scope': 'district', 'id': {'region': 'Регион1', 'district': 'Район А'}, 'order': 'count'})[1]
    rb = inproc(TCH('s1'), {'scope': 'district', 'id': {'region': 'Регион2', 'district': 'Район А'}, 'order': 'count'})[1]
    ok(lst(ra) == expected({'s1', 's4'}, 'count') and lst(rb) == expected({'s3'}, 'count') and ra['total'] != rb['total'], 'район «Район А» в двух регионах — разные срезы (Регион1: s1+s4, Регион2: s3)')
    st, out = inproc(ST(1), {'scope': 'school', 'id': 's3', 'order': 'count'})
    ok(lst(out) == expected({'s1'}, 'count') and out['id'] == 's1', 'ученик с id чужой школы получает свою школу')
    st, out = inproc(TCH('s1'), {'scope': 'school', 'id': 's3', 'order': 'count'})
    ok(lst(out) == expected({'s3'}, 'count') and out['label'] == 'Школа 3', 'учитель получает чужую школу по фильтру')
    ok(lst(inproc(TCH('s1'), {'order': 'count'})[1]) == expected({'s1'}, 'count'), 'учётка без id — своя (первая) школа')
    ok(inproc(SUP, {})[0] == 400 and inproc(SUP, {'scope': 'school', 'id': 'нет-такой'})[0] == 400 and inproc(SUP, {'scope': 'region', 'id': 'Нет'})[0] == 400, 'суперадмин без id → 400 «Выберите школу»; несуществующая школа/регион → 400')
    ok(lst(inproc(SUP, {'scope': 'region', 'id': 'Регион2', 'order': 'count'})[1]) == expected({'s3'}, 'count'), 'суперадмин: регион по имени')
    e1 = inproc(ST(1), {'order': 'count', 'page': 0})[1]
    ok(inproc(ST(1), {'order': 'count', 'page': 9})[1]['items'] == e1['items'], 'номер страницы вне 0…3 заменяется нулевым (А5)')

    # ---- me и ответ без лишнего
    st, out = inproc(ST(2), {'order': 'avg'})
    exa = expected({'s1'}, 'avg')
    mine = [r for r in exa if r[1] == sname(2)]
    ok(out['me'] == {'rank': mine[0][0], 'n': mine[0][2], 'avg': mine[0][3]} if mine else out['me']['rank'] is None, 'me: место зрителя (st2) в школе')
    st, out = inproc(ST(1), {'order': 'avg'})   # st1: n = 4 → в порядке «среднее» места нет
    ok(SOLVES['st1'][0] == 4 and out['me']['rank'] is None and out['me']['n'] == 4, 'me: у ученика с n < 5 места в порядке «среднее» нет, но n и среднее видны')
    ok(inproc(TCH('s1'), {})[1]['me'] is None and inproc(ST(1), {'scope': 'school', 'who': 't'})[0] == 400, 'me пусто у учётки; рейтинг учителей до Т1 — 400 (пункт 10)')
    # пункт 3: место через count(*) тех, кто выше, совпадает с независимым подсчётом для каждого из 40 учеников (школа и регион, оба порядка)
    badme, nme = [], 0
    for i in range(1, 41):
        for scope, schs in (('school', {sch_of(i)}), ('region', {'s3'} if sch_of(i) == 's3' else {'s1', 's2', 's4'})):
            for order in ('avg', 'count'):
                exl = expected(schs, order)
                me = inproc(ST(i), {'scope': scope, 'order': order})[1]['me']
                mine = [r for r in exl if r[1] == sname(i)]
                good = (me == {'rank': mine[0][0], 'n': mine[0][2], 'avg': mine[0][3]}) if mine else (me is None or me['rank'] is None)
                nme += 1
                if not good:
                    badme.append((i, scope, order, me, mine[:1]))
    ok(not badme and nme == 160, 'me: место и n/среднее совпали с независимым подсчётом для 40 учеников × школа/регион × 2 порядка (%d проверок) %s' % (nme, badme[:2]))
    st, raw = req('/api/ein/top', dk(39, scope='district', order='count'), KH('s4'))
    text = json.dumps(raw, ensure_ascii=False)
    ok(set(raw) == {'who', 'scope', 'id', 'label', 'order', 'minN', 'total', 'items', 'me'} and all(set(x) == {'rank', 'name', 'cls', 'school', 'n', 'avg'} for x in raw['items']),
       'ответ top: только разрешённые поля (нет id учеников, кодов, ФИО, учителя, IP)')
    ok('Фамилия' not in text and 'Отчество' not in text and 'st1' not in text and 'h-st' not in text,
       'в ответе нет фамилий, отчеств, id и хэшей кодов; имена — «Имя Ф.»')
    ok(raw['items'] and all(x['cls'] in {r[0] for r in dbq('select name from classes')} for x in raw['items']), 'класс подписан из таблицы классов')
    # пункт 11: класс = grade+letter из карточки класса (как S.className), одним запросом без N+1
    ok(all(x['cls'] == '5А' for x in inproc(ST(1), {'order': 'count'})[1]['items']), 'класс ученика школы s1 — «5А» (grade+letter)')
    dbq("update classes set doc = json_set(doc, '$.letter', 'Б') where id = 'c1'")
    E._CACHE.clear()
    ok(all(x['cls'] == '5Б' for x in inproc(ST(1), {'order': 'count'})[1]['items']), 'класс берётся из grade+letter карточки (name не трогали): «5Б»')
    dbq("update classes set doc = json_set(doc, '$.letter', 'А') where id = 'c1'")
    E._CACHE.clear()
    import inspect
    ok('FROM classes' not in inspect.getsource(E.top) and 'ROW_NUMBER' not in inspect.getsource(E._me), 'top не ходит в classes по ученику (N+1), me без окна ROW_NUMBER')

    # ---- архивный ученик не виден, после возврата виден
    E._CACHE.clear()
    dbq("update students set status = 'archived' where id = 'st5'")
    out = inproc(ST(1), {'order': 'count'})[1]
    ok(sname(5) not in [x['name'] for x in out['items']] and lst(out) == expected({'s1'}, 'count'), 'ученик в архиве в рейтинге не виден')
    dbq("update students set status = 'active' where id = 'st5'")
    E._CACHE.clear()
    out = inproc(ST(1), {'order': 'count'})[1]
    ok(sname(5) in [x['name'] for x in out['items']], 'после «Вернуть» ученик снова в рейтинге (решения сохранились)')

    # ---- пункт 4: срез школы идёт по ein_stats.school; расхождение со школой ученика — в рейтинг не попадает
    dbq("update ein_stats set school = 's3' where pid = 'st2'")
    E._CACHE.clear()
    ok(sname(2) not in [x['name'] for x in inproc(ST(1), {'order': 'count'})[1]['items']] and sname(2) not in [x['name'] for x in inproc(ST(21), {'order': 'count'})[1]['items']],
       'ein_stats.school расходится со школой ученика → строки нет ни в одной школе (срез по e.school)')
    dbq("update ein_stats set school = 's1' where pid = 'st2'")
    E._CACHE.clear()
    ok(sname(2) in [x['name'] for x in inproc(ST(1), {'order': 'count'})[1]['items']], 'школа в сводке исправлена → ученик снова в рейтинге s1')

    # ---- пункт 6: архив и возврат ученика сбрасывают кэш рейтинга школы на сервере; счётчики стирания считают строки «Эйнштейна»
    st, b0 = req('/api/ein/top', {'order': 'count'}, HB('dir1'))
    ok(st == 200 and sname(5) in [x['name'] for x in b0['items']], 'HTTP: st5 в рейтинге s1 (кэш сервера заполнен)')
    ok(adm('dir1', 'student.archive', {'student_id': 'st5'})[0] == 200, 'student.archive st5')
    st, b1 = req('/api/ein/top', {'order': 'count'}, HB('dir1'))
    ok(sname(5) not in [x['name'] for x in b1['items']], 'архив ученика сразу убирает его из рейтинга (кэш школы сброшен)')
    ok(adm('dir1', 'student.restore', {'student_id': 'st5'})[0] == 200, 'student.restore st5')
    st, b2 = req('/api/ein/top', {'order': 'count'}, HB('dir1'))
    ok(sname(5) in [x['name'] for x in b2['items']], 'возврат ученика сразу возвращает его в рейтинг')
    with app.lock, app.db() as c:
        cnt = app.purge_student_counts(c, 'st6')
        none = app.purge_student_counts(c, 'нет-такого')
    rows6 = sum(dbq('select count(*) from %s where pk = ? and pid = ?' % t, 's', 'st6')[0][0] for t in ('ein_issued', 'ein_solves', 'ein_stats'))
    ok(rows6 > 3 and cnt.get('ein') == rows6 and 'ein' not in none, 'purge_student_counts: ein = строки выданных, решений и сводки (%d); у ученика без них ключа нет' % rows6)
    with app.lock, app.db() as c:
        c.execute("INSERT INTO students(id, name, grade, updated, doc, school, status) VALUES('stx', 'Икс Игрек', 5, ?, '{\"classId\":\"c1\",\"school\":\"s1\"}', 's1', 'archived')", (NOW,))
        c.execute("INSERT INTO ein_issued(pk, pid, seed, issued, src, status) VALUES('s', 'stx', 1, ?, 'x', 'active')", (NOW,))
        c.execute("INSERT INTO ein_solves(pk, pid, seed, school, t, moves, helped, void, ts, src) VALUES('s', 'stx', 1, 's1', 90, 20, 0, 0, ?, 'x')", (NOW,))
        E.restat(c, 's', 'stx')
        pre = app.purge_student_counts(c, 'stx')
        res = app.purge_erase_student(c, 'stx', NOW)
    ok(pre.get('ein') == 3 and res.get('ein') == 3 and dbq("select (select count(*) from ein_issued where pid='stx') + (select count(*) from ein_solves where pid='stx') + (select count(*) from ein_stats where pid='stx')")[0][0] == 0,
       'стирание ученика: счётчик ein (3 строки) в предпросмотре и в итоге, строки удалены')

    # ---- пункт 8: перевод ученика без строки ein_stats строку не создаёт
    with app.lock, app.db() as c:
        c.execute("INSERT INTO students(id, name, grade, updated, doc, school, status) VALUES('stn', 'Новый Ученик', 5, ?, '{\"classId\":\"c1\",\"school\":\"s1\"}', 's1', 'active')", (NOW,))
    ok(adm('sup', 'student.move', {'student_id': 'stn', 'class_id': 'c2'})[0] == 200 and dbq("select school from students where id = 'stn'")[0][0] == 's2' and dbq("select count(*) from ein_stats where pid = 'stn'")[0][0] == 0,
       'перевод ученика без решений: школа сменилась, строка ein_stats не создана')

    # ---- places и права по HTTP
    st, pl = req('/api/ein/places', {}, HB('t1'))
    regs = {r['name']: {d['name']: [s['id'] for s in d['schools']] for d in r['districts']} for r in pl.get('regions', [])}
    regs.pop('', None)   # школа по умолчанию (без региона) из init_db
    ok(st == 200 and regs == {'Регион1': {'Район А': ['s1', 's4'], 'Район Б': ['s2']}, 'Регион2': {'Район А': ['s3']}}, 'places: 2 региона, 3 района, 4 школы; идентичное название района — в обоих регионах отдельно')
    ok(req('/api/ein/places', {}, {'X-Student': skey, 'X-Stoken': stok})[0] == 403 and req('/api/ein/places', dk(39), KH('s4'))[0] == 403, 'places ученику → 403')
    st, o1 = req('/api/ein/top', {'scope': 'school', 'id': 's2', 'order': 'count'}, HB('tsub'))
    ok(st == 200 and lst(o1) == expected({'s2'}, 'count'), 'предметник и учитель видят любую школу по фильтру (HTTP)')
    st, o2 = req('/api/ein/top', {'scope': 'school', 'id': 's2', 'order': 'count'}, SH)
    ok(st == 200 and o2['id'] == 's4' and o2['label'] == 'Школа 4', 'ученик по сеансу с id чужой школы получает свою (HTTP)')
    ok(req('/api/ein/top', {'who': 't'}, SH)[0] == 400 and req('/api/ein/top', {'who': 't'}, HB('dir1'))[0] == 400, 'рейтинг учителей до шага Т1: who:"t" → 400 (ученику и учётке)')

    # ---- рейтинг учителей (pk=t): отдельные строки (включаем флаг шага Т1 только в процессе теста)
    with app.lock, app.db() as c:
        for k in range(6):
            c.execute("INSERT INTO ein_solves(pk, pid, seed, school, t, moves, helped, void, ts, src) VALUES('t', ?, ?, 's1', ?, 30, 0, 0, ?, 't')", (UID['t1'], 7000 + k, 80 + k, NOW + k))
        E.restat(c, 't', UID['t1'])
    E._CACHE.clear()
    E.TEACHER_GAME = True
    ts_out = inproc(ST(1), {'who': 't', 'scope': 'school'})[1]
    ok(len(ts_out['items']) == 1 and ts_out['items'][0]['n'] == 6 and ts_out['items'][0]['avg'] == 82.5 and 'cls' not in ts_out['items'][0] and dbq("select school from ein_stats where pk='t'")[0][0] == 's1'
       and all(x['name'] != ts_out['items'][0]['name'] for x in inproc(ST(1), {'order': 'count'})[1]['items']), 'учителя: свой рейтинг (pk=t), школа из роли, ученики и учителя не смешиваются')
    E.TEACHER_GAME = False
    E._CACHE.clear()

    # ---- кэш: счётчик обращений к базе и сброс
    E._CACHE.clear()
    h0 = E.DB_HITS
    inproc(ST(1), {'order': 'avg'})
    inproc(ST(3), {'order': 'avg'})
    inproc(TCH('s2'), {'order': 'avg', 'scope': 'school', 'id': 's1'})
    ok(E.DB_HITS - h0 == 1, 'кэш: три одинаковых запроса среза — одно обращение к базе')
    inproc(ST(1), {'order': 'count'})
    ok(E.DB_HITS - h0 == 2, 'кэш: другой порядок — отдельный ключ')
    nowms = int(time.time() * 1000)
    E._CACHE[('s', 'school', 's1', 'avg', 0)] = (nowms - 61000, E._CACHE[('s', 'school', 's1', 'avg', 0)][1])
    inproc(ST(1), {'order': 'avg'})
    ok(E.DB_HITS - h0 == 3, 'кэш: ответ старше 60 с пересчитывается')
    with app.lock, app.db() as c:
        c.execute("INSERT INTO ein_issued(pk, pid, seed, issued, src) VALUES('s', 'st1', 555000, ?, 'x')", (NOW - 200000,))
        code, res = E.solve(app, c, ST(1), {'seed': 555000, 'time': 50, 'moves': 20, 'helped': 0}, NOW)
    ok(code == 200 and res['rated'], 'решение st1 (в процессе теста) зачтено')
    inproc(ST(1), {'order': 'avg'})
    inproc(ST(21), {'order': 'avg'})
    ok(E.DB_HITS - h0 == 5, 'кэш сбрасывается решением школы s1 и не трогает чужую школу (s3 — одно новое обращение)')

    # ---- ein.void (HTTP) и сброс кэша на сервере
    st, b = req('/api/ein/top', {'order': 'count'}, HB('dir1'))     # в кэше сервера
    n_before = [x for x in b['items'] if x['name'] == sname(3)][0]['n']
    ok(adm('dir2', 'ein.void', {'pid': 'st3'})[0] == 403 and adm('tsub', 'ein.void', {'pid': 'st3'})[0] == 403 and adm('t1', 'ein.void', {'pid': 'st3'})[0] == 403, 'ein.void: директор другой школы и учителя → 403')
    ok(adm('dir1', 'ein.void', {'pid': 'st-net'})[0] == 404 and adm('dir1', 'ein.void', {'pid': 'st3', 'seed': 424242})[0] == 404, 'ein.void: нет игрока или решения → 404')
    st, b = adm('dir1', 'ein.void', {'pid': 'st3', 'seed': 3000})
    ok(st == 200 and dbq("select void from ein_solves where pid='st3' and seed=3000")[0][0] == 1 and dbq("select n from ein_stats where pid='st3'")[0][0] == n_before - 1, 'ein.void директора: решение аннулировано, ein_stats пересчитана')
    st, b = req('/api/ein/top', {'order': 'count'}, HB('dir1'))
    ok([x for x in b['items'] if x['name'] == sname(3)][0]['n'] == n_before - 1, 'ein.void сбросил кэш рейтинга школы (новое n сразу)')
    ok(adm('dir1', 'ein.void', {'pid': 'st3', 'seed': 3000})[0] == 200 and dbq("select n from ein_stats where pid='st3'")[0][0] == n_before - 1, 'повторное аннулирование не ломает сводку')
    ok(adm('sup', 'ein.void', {'pid': 'st13'})[0] == 200 and dbq("select n from ein_stats where pid='st13'")[0][0] == 0 and dbq("select count(*) from ein_solves where pid='st13' and void = 0 and helped = 0")[0][0] == 0,
       'ein.void суперадмина без seed: все решения ученика другой школы аннулированы')
    ok(dbq("select count(*) from audit_log where action = 'ein.void'")[0][0] >= 3, 'ein.void пишется в журнал')

    # пункт 9: админы района и региона — по ключам их ролей; ниже директора — нет
    def void_as(role, key, pid, seed=None):
        p = {'id': 'adm-' + role, 'roles': [{'role': role, 'school': key}]}
        body = {'pid': pid} if seed is None else {'pid': pid, 'seed': seed}
        try:
            with app.lock, app.db() as c:
                return 200, E.admin(app, c, p, 'ein.void', body, '')
        except app.AdminError as e:
            return e.code, None
    ok(void_as('district_admin', 'd:Регион1|Район А', 'st14', 14000)[0] == 403 and void_as('district_admin', 'd:Регион2|Район А', 'st4', 4000)[0] == 403
       and void_as('region_admin', 'r:Регион2', 'st14', 14000)[0] == 403 and void_as('region_admin', 'r:Регион1', 'st24', 24000)[0] == 403, 'ein.void: админ района/региона чужой области → 403')
    ok(void_as('teacher', 's1', 'st4', 4000)[0] == 403 and void_as('expert', 's1', 'st4', 4000)[0] == 403, 'ein.void: учитель и специалист → 403')
    ok(void_as('district_admin', 'd:Регион1|Район А', 'st4', 4000)[0] == 200 and dbq("select void from ein_solves where pid = 'st4' and seed = 4000")[0][0] == 1, 'ein.void: админ района — школа своего района (s1, Район А)')
    ok(void_as('region_admin', 'r:Регион1', 'st14', 14000)[0] == 200 and dbq("select void from ein_solves where pid = 'st14' and seed = 14000")[0][0] == 1, 'ein.void: админ региона — школа другого района своего региона (s2)')

    # ---- перевод ученика в другую школу: рейтинг идёт за ним
    E._CACHE.clear()
    st, b = adm('sup', 'student.move', {'student_id': 'st9', 'class_id': 'c2'})
    ok(st == 200 and dbq("select school from ein_stats where pid='st9'")[0][0] == 's2', 'перевод st9 в школу s2: ein_stats получила новую школу')
    ok(sname(9) in [x['name'] for x in inproc(ST(11), {'order': 'count'})[1]['items']] and sname(9) not in [x['name'] for x in inproc(ST(1), {'order': 'count'})[1]['items']], 'после перевода ученик в рейтинге новой школы, в старой его нет')

    # ---- предел частоты: 60 в час на игрока (st40 со шлема)
    clear()
    codes = []
    for _ in range(62):
        codes.append(req('/api/ein/seed', dk(40), KH('s4'))[0])
    ok(codes[:59].count(200) == 59 and codes[-1] == 429 and 429 in codes, 'seed: лимит 60 в час на игрока → 429 (st40: 1 запрос в сеансе уже был)')
    ok(req('/api/ein/seed', dk(39), KH('s4'))[0] == 200, 'лимит по игроку: st39 не затронут')

    # ---- секреты не в журнале и не в выводе
    blob = json.dumps(dbq('select action, target_kind, target_id, detail from audit_log')) + open(os.path.join(tmp, 'server.log'), errors='replace').read()
    ok(all(s and s not in blob for s in SEC) and all('h-st' not in blob for _ in (0,)), 'ключи шлема и устройства, токен сеанса и коды привязки не попали в журнал и вывод сервера')
finally:
    srv.terminate()
    try:
        srv.wait(5)
    except Exception:
        srv.kill()

# ---- 20 000 учеников и 300 000 решений: top < 0,3 с (данные генерируются здесь, в отдельном регионе)
with app.db() as c:
    c.execute("INSERT INTO schools(id, name, region, district, status, network, created, updated) VALUES('sbig', 'Большая', 'Большой', 'Р', 'active', '', ?, ?)", (NOW, NOW))
    c.executemany("INSERT INTO students(id, name, grade, updated, doc, school, status) VALUES(?, ?, 5, ?, ?, 'sbig', 'active')",
                  [('big%d' % i, 'Ф%d И%d О' % (i, i), NOW, '{"classId":"c1","school":"sbig"}') for i in range(20000)])
    c.executemany("INSERT INTO ein_stats(pk, pid, school, n, sum_t, last_ts) VALUES('s', ?, 'sbig', 15, ?, ?)", [('big%d' % i, 15 * (60 + i % 200), NOW - i) for i in range(20000)])
    c.executemany("INSERT INTO ein_solves(pk, pid, seed, school, t, moves, helped, void, ts, src) VALUES('s', ?, ?, 'sbig', ?, 40, 0, 0, ?, 'g')",
                  [('big%d' % (i // 15), i % 15, 60 + (i // 15) % 200, NOW - i) for i in range(300000)])
E._CACHE.clear()
who = {'pk': 's', 'pid': 'big777', 'school': 'sbig', 'roles': []}
t0 = time.perf_counter()
code, out = inproc(who, {'scope': 'region', 'order': 'avg', 'page': 1})
dt1 = time.perf_counter() - t0
t0 = time.perf_counter()
code2, out2 = inproc(who, {'scope': 'school', 'order': 'count', 'page': 0})
dt2 = time.perf_counter() - t0
ok(code == 200 and out['total'] == 200 and len(out['items']) == 50 and out['items'][0]['rank'] == 51 and out['me'] is not None, 'нагрузка: 20 000 учеников, 300 000 решений — страница 2, total=200 (топ-200), me посчитано')
with app.db() as c:
    mism = 0
    for order, scope in (('avg', 'region'), ('count', 'school')):
        sl, _e = E._slice(app, c, who, {'scope': scope})
        q, _m = E._query('s', sl[2], order, 1)
        t0 = time.perf_counter()
        me = E._me(c, 's', sl[2], sl[3], order, 1, 'big777')
        dt3 = time.perf_counter() - t0
        rk = c.execute('SELECT rk FROM (%s) WHERE pid = ?' % q, [1] + sl[3] + ['big777']).fetchone()[0]
        mism += me['rank'] != rk
ok(mism == 0 and dt3 < 0.1, 'нагрузка: me через count(*) совпал с ROW_NUMBER на 20 000 учеников и быстрее 0,1 с (%.3f с)' % dt3)
ok(dt1 < 0.3 and dt2 < 0.3, 'нагрузка: top на 20 000 учеников < 0,3 с (регион/avg %.3f с, школа/count %.3f с)' % (dt1, dt2))

print('\nИТОГО: %s' % ('всё зелёное' if not fails else 'ПРОВАЛОВ: %d' % fails))
sys.exit(1 if fails else 0)
