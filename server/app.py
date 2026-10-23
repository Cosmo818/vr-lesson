#!/usr/bin/env python3
"""VR-урок: сервер синхронизации. Python 3 без сторонних библиотек, база SQLite (/data/vrlesson.db).

Ключи доступа хранятся в /data/keys.json и создаются при первом запуске:
  teacher — полный доступ (тесты, удаление, настройки);
  device  — для шлемов: ученики, результаты, открытия.
Эндпоинты: GET /api/health, POST /api/sync, GET /api/export (только учитель).
"""
import base64, calendar, getpass, shutil, struct, hashlib, ipaddress, json, os, re, secrets, sqlite3, sys, threading, time, hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

DATA = os.environ.get('DATA_DIR', '/data')
PORT = int(os.environ.get('PORT', '8787'))
DB_PATH = os.path.join(DATA, 'vrlesson.db')
KEYS_PATH = os.path.join(DATA, 'keys.json')
CONFIG_PATH = os.path.join(DATA, 'config.json')
MAX_BODY = 8 * 1024 * 1024
VERSION = '3'
SCHEMA = 4
DB_VERSION = 6  # версия самой базы (PRAGMA user_version); SCHEMA — версия протокола для клиентов, отдельно
DEFAULT_SCHOOL = 'school-default'
PURGE_HOLD_DEFAULT = 30  # дней в архиве до окончательного стирания (config purgeHoldDays, 0-3650)
PURGE_KEEP_YEARS = 5  # копии bak-purge-* хранятся 5 лет; сервер их не удаляет, только показывает, какие устарели
NEW_FIELDS = ('school', 'year', 'status')
AUDIT_DETAIL_MAX = 2048
PW_ITER = 600000  # число итераций PBKDF2; хранится в строке хэша, поднять можно без миграции (перехэш при входе)
SESSION_CAP = 12 * 3600 * 1000  # потолок сессии, не настраивается (решение владельца, PLAN 5.5)
SESSION_MIN_DEFAULT, SESSION_MIN_LO, SESSION_MIN_HI = 15, 5, 300
LOGIN_FREE_TRIES = 5  # ошибок подряд без паузы; дальше пауза 30 с, растёт вдвое до 15 мин
IP_PER_MIN = 20
RESERVED_LOGINS = ('admin', 'root', 'superadmin', 'director', 'teacher')
ROLES = ('superadmin', 'region_admin', 'district_admin', 'director', 'teacher', 'expert')
LOGIN_RE = re.compile(r'^[A-Za-z0-9._-]{3,32}$')
COMMON_PW = frozenset('''1234567890 0123456789 12345678910 1q2w3e4r5t 1qaz2wsx3edc qwertyuiop qwerty1234 qwerty12345 qwertyuiop1 asdfghjkl1 password12 password123 password1234
password12345 passw0rd123 iloveyou123 administrator qazwsxedc12 zaq12wsxcde 9876543210 1234554321 abcdefghij abcd123456 123456789a 1234567890q admin12345 admin123456 adminadmin
teacher1234 teacher12345 school12345 schooluser1 yfcnhjqrf1 qwertyuiopasdfghjkl 11111111111 0000000000 1111111111 vrlesson123 vrlesson1234'''.split())
lock = threading.Lock()


def load_keys():
    os.makedirs(DATA, exist_ok=True)
    keys = {}
    if os.path.exists(KEYS_PATH):
        with open(KEYS_PATH, encoding='utf-8') as f:
            keys = json.load(f)
    changed = False
    for name, n in (('teacher', 18), ('device', 12)):
        env = os.environ.get(name.upper() + '_KEY')
        if env:
            keys[name] = env
        elif not keys.get(name):
            keys[name] = secrets.token_urlsafe(n)
            changed = True
    if changed:
        with open(KEYS_PATH, 'w', encoding='utf-8') as f:
            json.dump(keys, f, ensure_ascii=False, indent=1)
        os.chmod(KEYS_PATH, 0o600)
    return keys


KEYS = load_keys()


def db():
    c = sqlite3.connect(DB_PATH, timeout=10)
    c.execute('PRAGMA journal_mode=WAL')
    return c


def init_db():
    existed = os.path.exists(DB_PATH) and os.path.getsize(DB_PATH) > 0
    with db() as c:
        c.executescript('''
        CREATE TABLE IF NOT EXISTS students(id TEXT PRIMARY KEY, name TEXT, grade INTEGER, updated INTEGER, doc TEXT);
        CREATE TABLE IF NOT EXISTS classes(id TEXT PRIMARY KEY, name TEXT, updated INTEGER, doc TEXT);
        CREATE TABLE IF NOT EXISTS tests(id TEXT PRIMARY KEY, title TEXT, subj TEXT, updated INTEGER, doc TEXT);
        CREATE TABLE IF NOT EXISTS results(id TEXT PRIMARY KEY, sid TEXT, subj TEXT, score INTEGER, total INTEGER, ts INTEGER, doc TEXT);
        CREATE TABLE IF NOT EXISTS disc(sid TEXT, k TEXT, ts INTEGER, PRIMARY KEY(sid, k));
        CREATE TABLE IF NOT EXISTS deleted(id TEXT PRIMARY KEY, ts INTEGER);
        CREATE TABLE IF NOT EXISTS feedback(id TEXT PRIMARY KEY, ts INTEGER, kind TEXT, room TEXT, rating INTEGER, text TEXT, doc TEXT);
        CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY CHECK(id = 1), updated INTEGER, doc TEXT);
        CREATE INDEX IF NOT EXISTS results_sid ON results(sid);
        ''')
        ver = c.execute('PRAGMA user_version').fetchone()[0]
        if ver < DB_VERSION and existed:
            try:
                path = backup_db('v%d' % max(ver, 2))
                print('копия базы перед миграцией: %s' % path, flush=True)
            except Exception as e:
                print('миграция остановлена: не удалось сделать копию базы:', e, flush=True)
                sys.exit(1)
        migrate_v3(c)  # при каждом старте: идемпотентно, дозаполняет строки, записанные прежней версией
        migrate_v4(c)
        migrate_b74(c)
        c.execute("CREATE INDEX IF NOT EXISTS students_class ON students(json_extract(doc, '$.classId'))")  # поиск и фильтр по классу (шаг 8); старому коду индекс не мешает


def num(x, d=0):
    try:
        return int(x)
    except (TypeError, ValueError):
        return d


def acad_year(ts):
    """Начало учебного года по времени создания (мс, UTC): август и позже — этот год, раньше — прошлый; нет времени — None."""
    ts = num(ts)
    if ts <= 0:
        return None
    try:
        t = time.gmtime(ts / 1000)
    except (OverflowError, OSError, ValueError):
        return None
    y = t.tm_year if t.tm_mon >= 8 else t.tm_year - 1
    return y if 2000 <= y <= 2100 else None


def ok_school(v):
    return isinstance(v, str) and 1 <= len(v) <= 40


def ok_year(v):
    if isinstance(v, bool):
        return False
    if isinstance(v, float):
        v = int(v) if v.is_integer() else None
    return isinstance(v, int) and 2000 <= v <= 2100


def ok_status(v):
    return v in ('active', 'archived')


OK_FIELD = {'school': ok_school, 'year': ok_year, 'status': ok_status}


def fill_v3(doc, old=None, device_new=False):
    """Правило слияния v3 (то же, что SC.carry/SC.fill в js/schema.js): перенос недостающих полей из прежней версии, затем значения по умолчанию.
    device_new: ключ шлема не создаёт архивных записей и не пишет в чужую школу."""
    doc = dict(doc)
    if isinstance(old, dict) and not device_new:
        for f in NEW_FIELDS:
            if not OK_FIELD[f](doc.get(f)) and OK_FIELD[f](old.get(f)):
                doc[f] = old[f]
    if device_new:
        doc['status'] = 'active'
        doc['school'] = DEFAULT_SCHOOL
        doc['year'] = acad_year(doc.get('created'))  # шлем не задаёт учебный год сам
    if not ok_school(doc.get('school')):
        doc['school'] = DEFAULT_SCHOOL
    if ok_year(doc.get('year')):
        doc['year'] = int(doc['year'])
    else:
        doc['year'] = acad_year(doc.get('created'))
    if not ok_status(doc.get('status')):
        doc['status'] = 'active'
    return doc


def fill_v4(doc, old=None, kind='students', device_new=False):
    """Правило слияния v4 = v3 + teacherId у классов. Сервер — источник правды этого поля: присланное значение (учитель, шлем, старый клиент) игнорируется,
    остаётся значение из прежней записи сервера; меняется оно только серверным действием «передать класс» (шаг 7 плана учёток)."""
    d = fill_v3(doc, old, device_new)
    if kind == 'students':
        # pinView — код входа для показа учителю (Б42). Шлем его не пишет и не получает; учитель присылает вместе с хэшем.
        # Если присланной записи (старый клиент) код не пришёл, оставляем прежний — но только пока хэш кода тот же.
        pv = d.pop('pinView', None)
        if not device_new:
            if ok_pin(pv):
                d['pinView'] = pv
            elif isinstance(old, dict) and ok_pin(old.get('pinView')) and d.get('pinHash') and old.get('pinHash') == d.get('pinHash'):
                d['pinView'] = old['pinView']
    if kind == 'classes':
        d.pop('teacherId', None)
        t = class_teacher(old)
        if t:
            d['teacherId'] = t
    return d


def fill_test(doc, old=None, uid=None):
    """Автор теста (Б74.8): поле author — id пользователя, сервер источник правды. Присланное игнорируется; остаётся автор прежней записи,
    у нового теста его ставит сервер, если тест создал пользователь (ключ учителя и шлем — без автора). Правило то же в js/store.js (merge, А11)."""
    d = dict(doc)
    d.pop('author', None)
    a = old.get('author') if isinstance(old, dict) else None
    if not (isinstance(a, str) and 0 < len(a) <= 40):
        a = uid if old is None else None
    if a:
        d['author'] = a
    return d


def backup_db(tag):
    """Копия базы средствами SQLite рядом с базой; существующие копии не трогаем."""
    path = '%s.bak-%s-%s' % (DB_PATH, tag, time.strftime('%Y%m%d-%H%M%S', time.gmtime()))
    n = 1
    while os.path.exists(path):  # две копии в одну секунду: вторая не затирает первую
        n += 1
        path = '%s.bak-%s-%s-%d' % (DB_PATH, tag, time.strftime('%Y%m%d-%H%M%S', time.gmtime()), n)
    src = sqlite3.connect(DB_PATH, timeout=10)
    try:
        dst = sqlite3.connect(path)
        try:
            src.backup(dst)
        finally:
            dst.close()
    finally:
        src.close()
    os.chmod(path, 0o600)
    return path


def migrate_v3(c):
    """v2 -> v3: колонки school/year/status (производный индекс, источник правды — doc), дозаполнение, user_version = 3. Повторяемо."""
    # Одна явная транзакция: DDL в sqlite3 (Python 3.13) сам её не открывает. Обрыв -> ROLLBACK, база остаётся v2, повтор безопасен.
    if c.in_transaction:
        c.commit()
    c.execute('BEGIN IMMEDIATE')
    try:
        for t in ('classes', 'students'):
            cols = {r[1] for r in c.execute('PRAGMA table_info(%s)' % t)}
            if 'school' not in cols:
                c.execute('ALTER TABLE %s ADD COLUMN school TEXT' % t)
            if 'year' not in cols:
                c.execute('ALTER TABLE %s ADD COLUMN year INTEGER' % t)
            if 'status' not in cols:
                c.execute("ALTER TABLE %s ADD COLUMN status TEXT NOT NULL DEFAULT 'active'" % t)
            for rid, raw in c.execute('SELECT id, doc FROM %s WHERE school IS NULL' % t).fetchall():
                try:
                    d = json.loads(raw)
                    if not isinstance(d, dict):
                        raise ValueError('не объект')
                except ValueError as e:
                    print('миграция: пропущена запись %s.%s (битый JSON: %s)' % (t, rid, e), flush=True)
                    continue
                d = fill_v3(d)
                c.execute('UPDATE %s SET doc = ?, school = ?, year = ?, status = ? WHERE id = ?' % t,
                          (json.dumps(d, ensure_ascii=False), d['school'], d['year'], d['status'], rid))
        c.execute('CREATE INDEX IF NOT EXISTS students_school ON students(school, status)')
        if c.execute('PRAGMA user_version').fetchone()[0] < 3:  # не понижаем версию, если база уже новее
            c.execute('PRAGMA user_version = 3')
        c.execute('COMMIT')
    except BaseException:
        if c.in_transaction:
            c.execute('ROLLBACK')
        raise


def ok_pin(v):
    return isinstance(v, str) and re.fullmatch(r'[0-9]{4,8}', v) is not None


def class_teacher(doc):
    """Учитель класса из документа класса (источник правды — doc); нет или недопустимо — None."""
    t = doc.get('teacherId') if isinstance(doc, dict) else None
    return t if isinstance(t, str) and 1 <= len(t) <= 40 else None


def migrate_v4(c):
    """v3 -> v4: таблицы учёток и журнала аудита (пока пустые, поведение сервера не меняется), колонка classes.teacherId, школа по умолчанию.
    Ничего не удаляет (А15). Повторяема. Одна явная транзакция: обрыв -> ROLLBACK, база остаётся v3."""
    if c.in_transaction:
        c.commit()
    c.execute('BEGIN IMMEDIATE')
    try:
        c.execute('''CREATE TABLE IF NOT EXISTS schools(id TEXT PRIMARY KEY, name TEXT NOT NULL, region TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('pending', 'active', 'archived')), network TEXT NOT NULL DEFAULT '', created INTEGER, updated INTEGER)''')
        c.execute('''CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, login TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL DEFAULT '', email TEXT,
            pw TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'archived')), pw_changed INTEGER, created INTEGER, updated INTEGER)''')
        c.execute('''CREATE TABLE IF NOT EXISTS user_roles(user_id TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('superadmin', 'region_admin', 'district_admin', 'director', 'teacher', 'expert')),
            school TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'archived')), created INTEGER, created_by TEXT,
            PRIMARY KEY(user_id, role, school))''')
        if 'region_admin' not in (c.execute("SELECT sql FROM sqlite_master WHERE name = 'user_roles'").fetchone()[0] or ''):  # старая таблица: расширяем список ролей пересборкой
            c.execute('ALTER TABLE user_roles RENAME TO user_roles_old')
            c.execute('''CREATE TABLE user_roles(user_id TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('superadmin', 'region_admin', 'district_admin', 'director', 'teacher', 'expert')),
                school TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'archived')), created INTEGER, created_by TEXT,
                PRIMARY KEY(user_id, role, school))''')
            c.execute('INSERT INTO user_roles SELECT user_id, role, school, status, created, created_by FROM user_roles_old')
            c.execute('DROP TABLE user_roles_old')
            c.execute('DROP INDEX IF EXISTS user_roles_school')
        c.execute('''CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, created INTEGER, last_seen INTEGER, expires INTEGER, ip TEXT)''')
        c.execute('''CREATE TABLE IF NOT EXISTS invites(code_hash TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('join', 'reset')), role TEXT, school TEXT, user_id TEXT,
            created_by TEXT, created INTEGER, expires INTEGER, used_at INTEGER, used_by TEXT)''')
        c.execute('''CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY, school TEXT NOT NULL, key_hash TEXT NOT NULL UNIQUE, name TEXT, status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'revoked')),
            created INTEGER, created_by TEXT, last_seen INTEGER)''')
        c.execute('''CREATE TABLE IF NOT EXISTS open_rooms(id TEXT PRIMARY KEY, school TEXT NOT NULL, owner TEXT, src TEXT, title TEXT, spec TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')), created INTEGER, updated INTEGER, decided_by TEXT, decided INTEGER)''')
        c.execute('CREATE INDEX IF NOT EXISTS open_rooms_status ON open_rooms(status)')
        c.execute('''CREATE TABLE IF NOT EXISTS uploads(id TEXT PRIMARY KEY, school TEXT NOT NULL, owner TEXT, kind TEXT NOT NULL, name TEXT, size INTEGER, ext TEXT, sha TEXT,
            status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')), created INTEGER, decided_by TEXT, decided INTEGER)''')
        c.execute('CREATE INDEX IF NOT EXISTS uploads_school ON uploads(school, status)')
        c.execute('''CREATE TABLE IF NOT EXISTS pair_codes(code_hash TEXT PRIMARY KEY, school TEXT NOT NULL, name TEXT, created_by TEXT, created INTEGER, expires INTEGER, used_at INTEGER)''')
        if 'closed' not in {r[1] for r in c.execute('PRAGMA table_info(results)')}:  # закрытые результаты (Б56): отдельная колонка с индексом вместо разбора JSON на каждый запрос
            c.execute('ALTER TABLE results ADD COLUMN closed INTEGER NOT NULL DEFAULT 0')
            c.execute("UPDATE results SET closed = 1 WHERE COALESCE(json_extract(doc, '$.closed'), 0) = 1")
        c.execute('CREATE INDEX IF NOT EXISTS results_closed ON results(closed, ts)')
        c.execute('CREATE INDEX IF NOT EXISTS results_ts ON results(ts)')
        if 'district' not in {r[1] for r in c.execute('PRAGMA table_info(schools)')}:
            c.execute("ALTER TABLE schools ADD COLUMN district TEXT NOT NULL DEFAULT ''")
        if 'device_limit' not in {r[1] for r in c.execute('PRAGMA table_info(schools)')}:
            c.execute('ALTER TABLE schools ADD COLUMN device_limit INTEGER NOT NULL DEFAULT 20')
        c.execute('''CREATE TABLE IF NOT EXISTS login_fail(k TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0, until INTEGER NOT NULL DEFAULT 0, last INTEGER)''')
        c.execute('''CREATE TABLE IF NOT EXISTS audit_log(id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL,
            actor_kind TEXT NOT NULL CHECK(actor_kind IN ('user', 'legacy-teacher', 'device', 'cli')), actor_id TEXT, action TEXT NOT NULL, target_kind TEXT, target_id TEXT,
            school TEXT, detail TEXT, ip TEXT)''')
        cols = {r[1] for r in c.execute('PRAGMA table_info(classes)')}
        if 'teacherId' not in cols:
            c.execute('ALTER TABLE classes ADD COLUMN teacherId TEXT')
        for rid, raw in c.execute('SELECT id, doc FROM classes WHERE teacherId IS NULL').fetchall():
            t = class_teacher(load_doc(raw))
            if t:
                c.execute('UPDATE classes SET teacherId = ? WHERE id = ?', (t, rid))
        now = int(time.time() * 1000)
        c.execute("INSERT OR IGNORE INTO schools(id, name, region, status, network, created, updated) VALUES(?, 'Школа по умолчанию', '', 'active', '', ?, ?)", (DEFAULT_SCHOOL, now, now))
        for ddl in ('CREATE INDEX IF NOT EXISTS schools_region ON schools(region, status)',
                    'CREATE INDEX IF NOT EXISTS schools_district ON schools(region, district)',
                    'CREATE INDEX IF NOT EXISTS user_roles_school ON user_roles(school, role, status)',
                    'CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id)',
                    'CREATE INDEX IF NOT EXISTS invites_school ON invites(school)',
                    'CREATE INDEX IF NOT EXISTS devices_school ON devices(school, status)',
                    'CREATE INDEX IF NOT EXISTS audit_school_ts ON audit_log(school, ts)',
                    'CREATE INDEX IF NOT EXISTS audit_target ON audit_log(target_kind, target_id)',
                    'CREATE INDEX IF NOT EXISTS classes_teacher ON classes(teacherId)',
                    'CREATE INDEX IF NOT EXISTS classes_school ON classes(school, status)'):
            c.execute(ddl)
        if c.execute('PRAGMA user_version').fetchone()[0] < 5:
            c.execute('PRAGMA user_version = 5')
        c.execute('COMMIT')
    except BaseException:
        if c.in_transaction:
            c.execute('ROLLBACK')
        raise


def audit(c, who, action, target_kind=None, target_id=None, school=None, detail=None):
    """Строка в журнал аудита в той же транзакции, что и изменение (А13). Только INSERT: удаления и правки журнала нет (А15).
    В detail — только факты (что изменилось), без секретов: ни паролей, ни хэшей кодов и паролей, ни ключей, ни токенов (А14). Объём detail ограничен."""
    kind, actor_id, ip = who
    raw = json.dumps(detail or {}, ensure_ascii=False, sort_keys=True)
    if len(raw.encode('utf-8')) > AUDIT_DETAIL_MAX:
        raw = json.dumps({'truncated': True})
    c.execute('INSERT INTO audit_log(ts, actor_kind, actor_id, action, target_kind, target_id, school, detail, ip) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)',
              (int(time.time() * 1000), kind, actor_id, action, target_kind, None if target_id is None else str(target_id)[:80], school, raw, str(ip or '')[:64]))


def safe_name(x):
    return re.sub(r'[^A-Za-z0-9_.-]', '_', str(x))[:40]


def changed_keys(old, new):
    """Имена изменившихся настроек (значения не возвращаются: среди них бывают хэш и соль пароля). Флаги — как flags.<имя>."""
    out = []
    for k in sorted(set(old) | set(new)):
        if k == 'updated' or old.get(k) == new.get(k):
            continue
        fo, fn = old.get(k), new.get(k)
        if k == 'flags' and isinstance(fo or {}, dict) and isinstance(fn or {}, dict):
            fo, fn = fo or {}, fn or {}
            out.extend('flags.' + safe_name(f) for f in sorted(set(fo) | set(fn)) if fo.get(f) != fn.get(f))
        else:
            out.append(safe_name(k))
    return out[:30]


def find_record(c, rid):
    """Что за запись удаляют (по её id, до очистки): вид и школа; не нашли — unknown."""
    for kind, table in (('student', 'students'), ('class', 'classes'), ('test', 'tests'), ('feedback', 'feedback'), ('result', 'results')):
        row = c.execute('SELECT doc FROM %s WHERE id = ?' % table, (rid,)).fetchone()
        if row:
            d = load_doc(row[0]) or {}
            return kind, (d.get('school') if kind in ('student', 'class') and ok_school(d.get('school')) else None)
    return 'unknown', None


# ---------- права по поддереву (шаг 6 PLAN.md, А10, А17) ----------
def scope(c, p):
    """Что видит и меняет принципал. legacy-teacher и device (и вызовы без принципала) — как раньше, всё (all). Пользователь: суперадмин — всё; директор — школы,
    где у него роль director; учитель — свои классы (teacherId = он) в школах, где он учитель. Роли берутся из базы на каждом запросе (p['roles']), не из токена."""
    if p and p.get('kind') == 'device' and p.get('school'):  # шлем школы: видит и дополняет только свою школу
        return {'all': False, 'dir': {p['school']}, 'tch': set(), 'uid': None, 'user': False, 'dev': p['school']}
    if not p or p.get('kind') != 'user':
        return {'all': True, 'dir': set(), 'tch': set(), 'uid': None, 'user': False}
    roles = p.get('roles') or []
    if any(r['role'] == 'superadmin' for r in roles):
        return {'all': True, 'dir': set(), 'tch': set(), 'uid': p['id'], 'user': True}
    return {'all': False, 'dir': {r['school'] for r in roles if r['role'] == 'director'},
            'tch': {r['school'] for r in roles if r['role'] == 'teacher'}, 'uid': p['id'], 'user': True}


def can_write(sc):
    return sc['all'] or bool(sc['dir']) or bool(sc['tch'])


def class_in_scope(sc, school, teacher_id):
    return sc['all'] or school in sc['dir'] or (school in sc['tch'] and teacher_id is not None and teacher_id == sc['uid'])


def class_row(c, cid):
    if not cid:
        return None
    return c.execute('SELECT school, teacherId FROM classes WHERE id = ?', (str(cid),)).fetchone()


def student_in_scope(c, sc, doc):
    """Ученик в срезе, если его класс в срезе; ученик без класса — только у директора его школы."""
    if sc['all']:
        return True
    if not isinstance(doc, dict):
        return False
    cid = doc.get('classId')
    if cid:
        r = class_row(c, cid)
        return bool(r) and class_in_scope(sc, r[0], r[1])
    return doc.get('school') in sc['dir']


def sid_in_scope(c, sc, sid, cache):
    if sc['all']:
        return True
    if sid not in cache:
        row = c.execute('SELECT doc FROM students WHERE id = ?', (sid,)).fetchone()
        cache[sid] = bool(row) and student_in_scope(c, sc, load_doc(row[0]))
    return cache[sid]


def record_in_scope(c, sc, rid, cache):
    """Можно ли удалить запись с таким id: только своя. Неизвестный id — нельзя (надгробие на чужой или будущий id запретило бы запись)."""
    if sc['all']:
        return True
    row = c.execute('SELECT doc FROM students WHERE id = ?', (rid,)).fetchone()
    if row:
        return student_in_scope(c, sc, load_doc(row[0]))
    r = class_row(c, rid)
    if r:
        return class_in_scope(sc, r[0], r[1])
    if c.execute('SELECT 1 FROM tests WHERE id = ?', (rid,)).fetchone() or c.execute('SELECT 1 FROM feedback WHERE id = ?', (rid,)).fetchone():
        return can_write(sc)
    row = c.execute('SELECT sid FROM results WHERE id = ?', (rid,)).fetchone()
    return bool(row) and sid_in_scope(c, sc, row[0], cache)


def migrate_b74(c):
    """v5 -> v6 (Б74): жёсткие надгробия purged, корзина trash, архив файлов uploads. Ничего не удаляет, повторяема. Одна явная транзакция: обрыв -> ROLLBACK, база остаётся прежней."""
    if c.in_transaction:
        c.commit()
    c.execute('BEGIN IMMEDIATE')
    try:
        c.execute('CREATE TABLE IF NOT EXISTS purged(id TEXT PRIMARY KEY, ts INTEGER NOT NULL, kind TEXT)')
        c.execute('''CREATE TABLE IF NOT EXISTS trash(kind TEXT NOT NULL, id TEXT NOT NULL, school TEXT, doc TEXT NOT NULL, ts INTEGER NOT NULL, actor_kind TEXT, actor_id TEXT,
            PRIMARY KEY(kind, id))''')
        c.execute('CREATE INDEX IF NOT EXISTS trash_school ON trash(school, ts)')
        c.execute('CREATE TABLE IF NOT EXISTS purge_marks(kind TEXT NOT NULL, id TEXT NOT NULL, school TEXT, "by" TEXT, ts INTEGER NOT NULL, why TEXT, PRIMARY KEY(kind, id))')
        c.execute('CREATE INDEX IF NOT EXISTS purge_marks_school ON purge_marks(school, ts)')
        cols = {r[1] for r in c.execute('PRAGMA table_info(uploads)')}
        if 'archived_at' not in cols:
            c.execute('ALTER TABLE uploads ADD COLUMN archived_at INTEGER')
        if 'archived_by' not in cols:
            c.execute('ALTER TABLE uploads ADD COLUMN archived_by TEXT')
        if 'restored_at' not in {r[1] for r in c.execute('PRAGMA table_info(trash)')}:  # независимо от user_version: база на VPS уже v6
            c.execute('ALTER TABLE trash ADD COLUMN restored_at INTEGER')
        # всё, удалённое до Б74, стёрто физически: это жёсткие надгробия
        if c.execute('PRAGMA user_version').fetchone()[0] < 6:  # только при переходе: позже в deleted лежат мягкие надгробия
            c.execute("INSERT OR IGNORE INTO purged(id, ts, kind) SELECT id, ts, 'legacy' FROM deleted")
            c.execute('PRAGMA user_version = 6')
        c.execute('COMMIT')
    except BaseException:
        if c.in_transaction:
            c.execute('ROLLBACK')
        raise


def to_trash(c, kind, rid, school, doc, who):
    """Кладёт копию записи в корзину (kind: test, feedback, result, room, open_room) перед удалением; повтор не перезаписывает (кроме комнат: последняя версия). who = (вид, id, ip) как в audit."""
    if not isinstance(doc, str):
        doc = json.dumps(doc, ensure_ascii=False)
    c.execute('INSERT OR %s INTO trash(kind, id, school, doc, ts, actor_kind, actor_id) VALUES(?, ?, ?, ?, ?, ?, ?)' % ('REPLACE' if kind == 'room' else 'IGNORE'),
              (kind, str(rid), school or DEFAULT_SCHOOL, doc, int(time.time() * 1000), who[0], who[1]))


def merge_in(c, inc, role, ip='', principal=None):
    """Вносит присланное состояние в базу по тем же правилам, что и js/store.js (merge). Реальные изменения пишутся в журнал аудита (audit) в той же транзакции."""
    teacher = role == 'teacher'
    sc = scope(c, principal)
    user = sc['user']
    dev = sc.get('dev')
    if user and not can_write(sc):
        return {'rejected': {'all': 1}}
    who = ('user', principal['id'], ip) if user else ('device', principal['id'], ip) if dev else ('legacy-teacher' if teacher else 'device', role, ip)  # ключ в журнал не попадает, только его роль
    rej = {}
    cache = {}

    def deny(kind):
        rej[kind] = rej.get(kind, 0) + 1
    hard = {r[0] for r in c.execute('SELECT id FROM purged')}  # жёсткие надгробия: присланное клиентом purged не читаем никогда (Б74.2)
    inc_ids = set()
    tomb = {}  # мягкие надгробия учеников и классов: применяются после lww, как в js/store.js merge (А11)
    if teacher:
        inc_ids = {str(x['id']) for key in ('students', 'classes') for x in (inc.get(key) or []) if isinstance(x, dict) and x.get('id')}
        for k, ts in (inc.get('deleted') or {}).items():
            k = str(k)
            if k in hard:
                continue
            if user and not record_in_scope(c, sc, k, cache):
                deny('deleted')
                continue
            if k in inc_ids or c.execute('SELECT 1 FROM students WHERE id = ?', (k,)).fetchone() or c.execute('SELECT 1 FROM classes WHERE id = ?', (k,)).fetchone():
                tomb[k] = max(tomb.get(k, 0), num(ts))  # ученик или класс: надгробие = правка «в архив», в deleted не пишем
                continue
            if c.execute('SELECT 1 FROM deleted WHERE id = ?', (k,)).fetchone() is None:  # пишем только новое удаление, повтор не дублируем
                kind, school = find_record(c, k)
                audit(c, who, 'delete', kind, k, school, {})
            c.execute('INSERT INTO deleted(id, ts) VALUES(?, ?) ON CONFLICT(id) DO UPDATE SET ts = max(ts, excluded.ts)', (k, num(ts)))
        s = inc.get('settings') or {}
        if s:
            row = c.execute('SELECT updated FROM settings WHERE id = 1').fetchone()
            if not row or num(s.get('updated')) > row[0]:
                if user:  # пользователь не видит и не меняет хэш пароля старой страницы учителя: берём его из текущих настроек сервера
                    s = {k: v for k, v in s.items() if k != 'pinHash'}
                    if 'pinHash' in get_settings(c):
                        s['pinHash'] = get_settings(c)['pinHash']
                old_rooms = get_settings(c).get('rooms')
                new_rooms = s.get('rooms')
                if isinstance(old_rooms, dict):  # комнаты, пропавшие из настроек, уходят в корзину (Б74)
                    for rid, spec in old_rooms.items():
                        if not isinstance(new_rooms, dict) or rid not in new_rooms:
                            to_trash(c, 'room', rid, DEFAULT_SCHOOL, spec, who)
                keys = changed_keys(get_settings(c), s)
                if keys:
                    audit(c, who, 'settings.update', 'settings', None, DEFAULT_SCHOOL, {'keys': keys})  # настройки общие, школа пока одна
                c.execute('INSERT OR REPLACE INTO settings(id, updated, doc) VALUES(1, ?, ?)', (num(s.get('updated')), json.dumps(s, ensure_ascii=False)))
    deleted = {r[0] for r in c.execute('SELECT id FROM deleted')}
    reset = num(get_settings(c).get('resetAt'))

    for s in inc.get('students') or []:
        if not isinstance(s, dict) or not s.get('id') or not s.get('name') or s['id'] in hard:
            continue
        upd = num(s.get('updated') or s.get('created'))
        row = c.execute('SELECT updated, doc FROM students WHERE id = ?', (s['id'],)).fetchone()
        if row and not teacher:
            continue  # ключ шлема может только добавлять новых учеников, но не менять существующих (имя, класс, код входа, архив)
        if not row or upd > row[0]:
            old_d = None if not row else load_doc(row[1])
            if user:
                if row and not student_in_scope(c, sc, old_d):
                    deny('students')
                    continue
                ncl = class_row(c, s.get('classId'))
                if not ncl or not class_in_scope(sc, ncl[0], ncl[1]):
                    deny('students')
                    continue
            d = fill_v4(s, old_d, 'students', device_new=not teacher)
            if user:
                d['school'] = ncl[0]  # школа ученика — школа его класса, присланное значение не берём
            if dev:  # шлем школы создаёт учеников только в своей школе и только в её классах
                d['school'] = dev
                if d.get('classId'):
                    kr0 = class_row(c, d['classId'])
                    if not kr0 or kr0[0] != dev:
                        d['classId'] = None
            if not teacher and d.get('classId'):
                kr = c.execute('SELECT status FROM classes WHERE id = ?', (d['classId'],)).fetchone()
                if kr and kr[0] == 'archived':
                    d['classId'] = None  # шлем не кладёт учеников в архивный класс
            c.execute('INSERT OR REPLACE INTO students(id, name, grade, updated, doc, school, year, status) VALUES(?, ?, ?, ?, ?, ?, ?, ?)',
                      (s['id'], str(s['name'])[:40], num(s.get('grade'), 5), upd, json.dumps(d, ensure_ascii=False), d['school'], d['year'], d['status']))
            if not row:
                audit(c, who, 'student.create', 'student', s['id'], d['school'], {'classId': d.get('classId')})
            else:
                if (old_d or {}).get('pinHash') != d.get('pinHash'):
                    audit(c, who, 'student.pin_change', 'student', s['id'], d['school'])  # только факт, значение кода и хэш не пишем
                if (old_d or {}).get('status') != d['status']:
                    audit(c, who, 'student.archive' if d['status'] == 'archived' else 'student.restore', 'student', s['id'], d['school'])
    if teacher:
        for k in inc.get('classes') or []:
            if not isinstance(k, dict) or not k.get('id') or k['id'] in hard:
                continue
            row = c.execute('SELECT updated, doc FROM classes WHERE id = ?', (k['id'],)).fetchone()
            if not row or num(k.get('updated')) > row[0]:
                old_d = load_doc(row[1]) if row else None
                if user and row:
                    orow = class_row(c, k['id'])
                    if not class_in_scope(sc, orow[0], orow[1]):
                        deny('classes')
                        continue
                d = fill_v4(k, old_d, 'classes')
                if user and row:
                    d['school'] = orow[0]  # класс не переезжает в другую школу
                elif user and not sc['all']:
                    if sc['dir']:
                        d['school'] = d['school'] if d['school'] in sc['dir'] else sorted(sc['dir'])[0]
                        d.pop('teacherId', None)
                    else:
                        d['school'] = d['school'] if d['school'] in sc['tch'] else sorted(sc['tch'])[0]
                        d['teacherId'] = sc['uid']  # новый класс учителя принадлежит ему
                c.execute('INSERT OR REPLACE INTO classes(id, name, updated, doc, school, year, status, teacherId) VALUES(?, ?, ?, ?, ?, ?, ?, ?)',
                          (k['id'], '%s%s' % (num(k.get('grade')), str(k.get('letter', ''))[:4]), num(k.get('updated')), json.dumps(d, ensure_ascii=False), d['school'], d['year'], d['status'], d.get('teacherId')))
                name = '%s%s' % (num(k.get('grade')), str(k.get('letter', ''))[:4])
                if not row:
                    audit(c, who, 'class.create', 'class', k['id'], d['school'], {'name': name})
                elif (old_d or {}).get('status') != d['status']:
                    audit(c, who, 'class.archive' if d['status'] == 'archived' else 'class.restore', 'class', k['id'], d['school'], {'name': name})
        for t in inc.get('tests') or []:
            if not isinstance(t, dict) or not t.get('id') or t['id'] in deleted or t['id'] in hard:
                continue
            row = c.execute('SELECT updated, doc FROM tests WHERE id = ?', (t['id'],)).fetchone()
            if not row or num(t.get('updated')) > row[0]:
                t = fill_test(t, load_doc(row[1]) if row else None, principal['id'] if user else None)
                c.execute('INSERT OR REPLACE INTO tests(id, title, subj, updated, doc) VALUES(?, ?, ?, ?, ?)',
                          (t['id'], str(t.get('title', ''))[:200], str(t.get('subj', '')), num(t.get('updated')), json.dumps(t, ensure_ascii=False)))
    for r in inc.get('results') or []:
        if not isinstance(r, dict) or not r.get('id') or not r.get('sid') or r['sid'] in hard or r['id'] in deleted or r['id'] in hard or num(r.get('ts')) < reset:
            continue
        if (user or dev) and not sid_in_scope(c, sc, r['sid'], cache):
            deny('results')
            continue
        c.execute('INSERT OR IGNORE INTO results(id, sid, subj, score, total, ts, doc, closed) VALUES(?, ?, ?, ?, ?, ?, ?, ?)',
                  (r['id'], r['sid'], str(r.get('subj', '')), num(r.get('score')), num(r.get('total')), num(r.get('ts')), json.dumps(r, ensure_ascii=False), 1 if r.get('closed') else 0))
    for f in inc.get('feedback') or []:
        if not isinstance(f, dict) or not f.get('id') or f['id'] in deleted or f['id'] in hard:
            continue
        c.execute('INSERT OR IGNORE INTO feedback(id, ts, kind, room, rating, text, doc) VALUES(?, ?, ?, ?, ?, ?, ?)',
                  (f['id'], num(f.get('ts')), str(f.get('kind', ''))[:20], str(f.get('room') or '')[:20], num(f.get('rating'), None), str(f.get('text', ''))[:1000], json.dumps(f, ensure_ascii=False)))
    for sid, m in (inc.get('disc') or {}).items():
        if sid in hard or not isinstance(m, dict):
            continue
        if (user or dev) and not sid_in_scope(c, sc, sid, cache):
            deny('disc')
            continue
        for k, ts in m.items():
            if num(ts) >= reset:
                c.execute('INSERT INTO disc(sid, k, ts) VALUES(?, ?, ?) ON CONFLICT(sid, k) DO UPDATE SET ts = CASE WHEN ts < ? THEN excluded.ts ELSE min(ts, excluded.ts) END', (sid, k, num(ts), reset))
    for k in inc_ids:  # запись пришла после надгробия неизвестного id (оно лежит в deleted): то же правило, что у клиента (del[id] > updated -> архив)
        row = c.execute('SELECT ts FROM deleted WHERE id = ?', (k,)).fetchone()
        if row and k not in hard:
            tomb[k] = max(tomb.get(k, 0), num(row[0]))
    for k, ts in tomb.items():  # после lww: надгробие новее победителя и запись не в архиве -> архив с updated = ts
        for table, kind in (('students', 'student'), ('classes', 'class')):
            row = c.execute('SELECT updated, doc, status FROM %s WHERE id = ?' % table, (k,)).fetchone()
            if not row or ts <= row[0] or row[2] == 'archived':
                continue
            d = load_doc(row[1]) or {}
            d['status'] = 'archived'
            d['updated'] = ts
            c.execute('UPDATE %s SET updated = ?, doc = ?, status = ? WHERE id = ?' % table, (ts, json.dumps(d, ensure_ascii=False), 'archived', k))
            audit(c, who, kind + '.archive', kind, k, d.get('school') if ok_school(d.get('school')) else None, {'via': 'tombstone'})
    # подчистить удалённое и сброшенное
    gone = "(SELECT id FROM deleted UNION SELECT id FROM purged)"
    for t, kind in (('tests', 'test'), ('feedback', 'feedback')):  # в корзину и удалить — в одной транзакции со слиянием
        for rid, doc in c.execute('SELECT id, doc FROM %s WHERE id IN %s' % (t, gone)).fetchall():
            to_trash(c, kind, rid, DEFAULT_SCHOOL, doc, who)
    for rid, doc, sch in c.execute('SELECT r.id, r.doc, s.school FROM results r LEFT JOIN students s ON s.id = r.sid WHERE r.id IN %s OR r.sid IN (SELECT id FROM purged)' % gone).fetchall():
        to_trash(c, 'result', rid, sch, doc, who)
    c.execute('DELETE FROM students WHERE id IN (SELECT id FROM purged)')
    c.execute('DELETE FROM tests WHERE id IN %s' % gone)
    c.execute('DELETE FROM classes WHERE id IN (SELECT id FROM purged)')
    c.execute('DELETE FROM results WHERE sid IN (SELECT id FROM purged) OR id IN %s' % gone)
    c.execute('DELETE FROM disc WHERE sid IN (SELECT id FROM purged)')
    c.execute('DELETE FROM feedback WHERE id IN %s' % gone)
    if rej:
        audit(c, who, 'sync.rejected', 'sync', None, None, rej)  # только счётчики по видам, без содержимого (А13)
    return {'rejected': rej}


def load_doc(raw):
    try:
        d = json.loads(raw)
        return d if isinstance(d, dict) else None
    except (TypeError, ValueError):
        return None


def get_settings(c):
    row = c.execute('SELECT doc FROM settings WHERE id = 1').fetchone()
    return json.loads(row[0]) if row else {}


def open_results_sql(c):
    """Условие «не закрытый результат»: по колонке closed, а для базы до миграции — по JSON."""
    if any(r[1] == 'closed' for r in c.execute('PRAGMA table_info(results)')):
        return '+closed = 0'
    return "COALESCE(json_extract(doc, '$.closed'), 0) = 0"


def state(c, hide_pins=False, principal=None):
    """Состояние для ответа. hide_pins: ключ шлема не получает видимые коды учеников (pinView).
    principal-пользователь получает только свой срез (scope): классы, их учеников, результаты и открытия этих учеников; тесты, отзывы, надгробия — общие."""
    sc = scope(c, principal)
    reset = num(get_settings(c).get('resetAt'))  # строки до границы в базе остаются (Б74), клиентам не отдаются
    def stud(raw):
        d = json.loads(raw)
        if hide_pins:
            d.pop('pinView', None)
        return d
    if sc['all']:
        classes = [json.loads(r[0]) for r in c.execute('SELECT doc FROM classes')]
        students = [stud(r[0]) for r in c.execute('SELECT doc FROM students')]
        results = [json.loads(r[0]) for r in c.execute('SELECT doc FROM results WHERE ts >= ? AND %s ORDER BY ts' % open_results_sql(c), (reset,))]
        disc = {}
        for sid, k, ts in c.execute('SELECT sid, k, ts FROM disc WHERE ts >= ?', (reset,)):
            disc.setdefault(sid, {})[k] = ts
        settings = get_settings(c)
    else:
        # выборка по индексам школ пользователя, а не просмотр всей базы (масштаб: десятки тысяч учеников)
        mine = sorted(sc['dir'] | sc['tch'])
        classes, ok_cls, students, ok_st, results, disc = [], set(), [], set(), [], {}
        if mine:
            ph = ','.join('?' * len(mine))
            for cid, school, tid, raw in c.execute('SELECT id, school, teacherId, doc FROM classes WHERE school IN (%s)' % ph, mine):
                if class_in_scope(sc, school, tid):
                    ok_cls.add(cid)
                    classes.append(json.loads(raw))
            seen = set()

            def take(sid, raw):
                if sid in seen:
                    return
                seen.add(sid)
                d = json.loads(raw)
                if (d.get('classId') in ok_cls) if d.get('classId') else (d.get('school') in sc['dir']):
                    ok_st.add(sid)
                    students.append(stud(raw))
            for sid, raw in c.execute('SELECT id, doc FROM students WHERE school IN (%s)' % ph, mine):
                take(sid, raw)
            cl = sorted(ok_cls)
            for n in range(0, len(cl), 500):  # ученик, чья школа в записи не совпала со школой класса
                part = cl[n:n + 500]
                for sid, raw in c.execute("SELECT id, doc FROM students WHERE json_extract(doc, '$.classId') IN (%s)" % ','.join('?' * len(part)), part):
                    take(sid, raw)
            ids = sorted(ok_st)
            rows = []
            for n in range(0, len(ids), 500):
                part = ids[n:n + 500]
                q = ','.join('?' * len(part))
                rows += c.execute('SELECT ts, doc FROM results WHERE sid IN (%s) AND +ts >= ? AND %s' % (q, open_results_sql(c)), part + [reset]).fetchall()
                for sid, k, ts in c.execute('SELECT sid, k, ts FROM disc WHERE sid IN (%s) AND +ts >= ?' % q, part + [reset]):
                    disc.setdefault(sid, {})[k] = ts
            rows.sort(key=lambda r: r[0] or 0)
            results = [json.loads(r[1]) for r in rows]
        settings = {k: v for k, v in get_settings(c).items() if k != 'pinHash'}
    dels = {k: ts for k, ts in c.execute('SELECT id, ts FROM deleted')}
    hardm = {k: ts for k, ts in c.execute('SELECT id, ts FROM purged')} if c.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='purged'").fetchone() else {}  # база до v6 (проверки читают её напрямую)
    for k, ts in hardm.items():
        dels[k] = max(dels.get(k, 0), ts)
    return {
        'v': SCHEMA,
        'classes': classes,
        'students': students,
        'tests': [json.loads(r[0]) for r in c.execute('SELECT doc FROM tests')],
        'results': results,
        'disc': disc,
        'feedback': [json.loads(r[0]) for r in c.execute('SELECT doc FROM feedback ORDER BY ts')],
        'deleted': dels,
        'purged': hardm,
        'settings': settings,
    }


def device_by_key(key):
    """Ключ шлема школы (выдан по коду привязки): ищем по sha256, действует только пока не отозван. Метка last_seen — не чаще раза в минуту."""
    key = key or ''
    if not 16 <= len(key) <= 80:
        return None
    with lock, db() as c:
        r = c.execute("SELECT d.id, d.school, d.last_seen FROM devices d JOIN schools s ON s.id = d.school WHERE d.key_hash = ? AND d.status = 'active' AND s.status != 'archived'", (thash(key),)).fetchone()
        if not r:
            return None
        now = int(time.time() * 1000)
        if now - (r[2] or 0) > 60000:
            c.execute('UPDATE devices SET last_seen = ? WHERE id = ?', (now, r[0]))
    return {'id': r[0], 'school': r[1]}


def role_of(key):
    key = key or ''
    if hmac.compare_digest(key.encode(), KEYS['teacher'].encode()):
        return 'teacher'
    if hmac.compare_digest(key.encode(), KEYS['device'].encode()):
        return 'device'
    return None


# ---------- учётки (шаги 4–5 PLAN.md): пароли, настройки, вход, сессии ----------
_AI = {}


def ai_module():
    """Необязательный модуль помощника грузится по пути рядом с app.py и только при первом обращении: без него сервер работает как раньше."""
    if 'm' not in _AI:
        import importlib.util
        spec = importlib.util.spec_from_file_location('vr_ai', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'ai.py'))
        m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(m)
        _AI['m'] = m
    return _AI['m']


def load_config():
    """/data/config.json: accounts (по умолчанию false — новые эндпоинты отвечают 404), legacyTeacher (true), sessionMinutes (15). Читается на каждый запрос: выключатель действует без перезапуска.
    Это НЕ settings.flags: те синхронизируются и меняются ключом teacher, а флаг безопасности старым ключом включаться не должен."""
    cfg = {'accounts': False, 'legacyTeacher': True, 'sessionMinutes': SESSION_MIN_DEFAULT, 'openRooms': False, 'ai': False, 'aiDaily': 30, 'purge': False, 'purgeHoldDays': PURGE_HOLD_DEFAULT}
    try:
        with open(CONFIG_PATH, encoding='utf-8') as f:
            raw = json.load(f)
        if isinstance(raw, dict):
            if isinstance(raw.get('accounts'), bool):
                cfg['accounts'] = raw['accounts']
            if isinstance(raw.get('openRooms'), bool):
                cfg['openRooms'] = raw['openRooms']
            if isinstance(raw.get('purge'), bool):
                cfg['purge'] = raw['purge']
            h = raw.get('purgeHoldDays')
            if isinstance(h, int) and not isinstance(h, bool) and 0 <= h <= 3650:
                cfg['purgeHoldDays'] = h
            if isinstance(raw.get('ai'), bool):
                cfg['ai'] = raw['ai']
            if isinstance(raw.get('aiDaily'), int) and not isinstance(raw.get('aiDaily'), bool) and 1 <= raw['aiDaily'] <= 500:
                cfg['aiDaily'] = raw['aiDaily']
            if isinstance(raw.get('legacyTeacher'), bool):
                cfg['legacyTeacher'] = raw['legacyTeacher']
            m = raw.get('sessionMinutes')
            if isinstance(m, int) and not isinstance(m, bool) and SESSION_MIN_LO <= m <= SESSION_MIN_HI:
                cfg['sessionMinutes'] = m
    except (OSError, ValueError):
        pass
    return cfg


def save_config(cfg):
    tmp = CONFIG_PATH + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(cfg, f, ensure_ascii=False, indent=1)
    os.chmod(tmp, 0o600)
    os.replace(tmp, CONFIG_PATH)


def hash_pw(pw, iters=None):
    iters = iters or PW_ITER
    salt = secrets.token_bytes(16)
    h = hashlib.pbkdf2_hmac('sha256', pw.encode('utf-8'), salt, iters)
    return 'pbkdf2_sha256$%d$%s$%s' % (iters, base64.b64encode(salt).decode(), base64.b64encode(h).decode())


def parse_hash(stored):
    try:
        alg, it, salt, h = str(stored).split('$')
        it = int(it)
        if alg != 'pbkdf2_sha256' or it < 1 or it > 10_000_000:
            return None
        return it, base64.b64decode(salt, validate=True), base64.b64decode(h, validate=True)
    except (ValueError, TypeError):
        return None


def check_pw(pw, stored):
    """Сравнение за постоянное время; число итераций берётся из строки хэша. Битая или пустая строка — False."""
    p = parse_hash(stored)
    if not p or not isinstance(pw, str):
        return False
    it, salt, h = p
    return hmac.compare_digest(hashlib.pbkdf2_hmac('sha256', pw.encode('utf-8'), salt, it), h)


def needs_rehash(stored):
    p = parse_hash(stored)
    return bool(p) and p[0] < PW_ITER


_dummy = []


def dummy_hash():
    if not _dummy:
        _dummy.append(hash_pw('нет-такого-пользователя'))
    return _dummy[0]


def pw_error(pw, login=''):
    """Правила пароля (PLAN 1.3): 10–128 символов, не равен логину, не из списка частых, не из одного повторяющегося символа. Возвращает текст ошибки или None."""
    if not isinstance(pw, str):
        return 'Пароль не задан.'
    if len(pw) < 10:
        return 'Пароль короче 10 символов. Лучше длинная фраза.'
    if len(pw) > 128:
        return 'Пароль длиннее 128 символов.'
    low = pw.lower()
    if login and low == str(login).lower():
        return 'Пароль не должен совпадать с логином.'
    if low in COMMON_PW or len(set(pw)) == 1:
        return 'Слишком частый пароль. Придумайте другой.'
    return None


def login_error(login):
    if not isinstance(login, str) or not LOGIN_RE.match(login):
        return 'Логин: латиница, цифры, точка, подчёркивание, дефис, 3–32 символа.'
    if login.lower() in RESERVED_LOGINS:
        return 'Этот логин зарезервирован.'
    return None


def user_create(c, login, name, password, who):
    """Создать пользователя (без ролей). Бросает ValueError с понятным текстом. В журнал — без пароля и хэша."""
    err = login_error(login) or pw_error(password, login)
    if err:
        raise ValueError(err)
    if c.execute('SELECT 1 FROM users WHERE login = ?', (login,)).fetchone():
        raise ValueError('Такой логин уже занят.')
    uid = 'u-' + secrets.token_hex(8)
    now = int(time.time() * 1000)
    c.execute('INSERT INTO users(id, login, name, email, pw, status, pw_changed, created, updated) VALUES(?, ?, ?, NULL, ?, ?, ?, ?, ?)',
              (uid, login, str(name or '')[:80], hash_pw(password), 'active', now, now, now))
    audit(c, who, 'user.create', 'user', uid, None, {'login': login})
    return uid


def scope_key(role, region, district=''):
    """Ключ области администратора региона или района; None — если не хватает данных или в названии есть «|»."""
    region, district = str(region or '')[:60], str(district or '')[:60]
    if not region or '|' in region or '|' in district:
        return None
    if role == 'region_admin':
        return 'r:' + region
    return 'd:%s|%s' % (region, district) if role == 'district_admin' and district else None


def key_parts(key):
    """'r:Рег' -> ('Рег', None); 'd:Рег|Рай' -> ('Рег', 'Рай'); иначе None."""
    key = str(key or '')
    if key.startswith('r:') and len(key) > 2:
        return key[2:], None
    if key.startswith('d:') and '|' in key[2:]:
        rg, _, ds = key[2:].partition('|')
        return (rg, ds) if rg and ds else None
    return None


def key_schools(c, key, archived=False):
    kp = key_parts(key)
    if not kp:
        return set()
    q, a = 'SELECT id FROM schools WHERE region = ?', [kp[0]]
    if kp[1] is not None:
        q += ' AND district = ?'
        a.append(kp[1])
    if not archived:
        q += " AND status != 'archived'"
    return {r[0] for r in c.execute(q, a)}


def scope_alive(c, role, school, archived=False):
    """Есть ли куда выдавать роль: для администратора области — хотя бы одна школа в ней, для остальных — школа."""
    if role in SCOPE_ROLES:
        kp = key_parts(school)
        return bool(kp) and (role == 'region_admin') == (kp[1] is None) and bool(key_schools(c, school, archived))
    return bool(c.execute('SELECT 1 FROM schools WHERE id = ?' + ('' if archived else " AND status != 'archived'"), (school,)).fetchone())


def expand_roles(c, roles):
    """Роли для проверок прав: администратор региона/района получает права директора во всех школах своей области (по состоянию базы сейчас, новая школа области подхватывается сама)."""
    out = list(roles)
    have = {(r['role'], r['school']) for r in roles}
    for r in roles:
        if r['role'] in SCOPE_ROLES:
            for sid in sorted(key_schools(c, r['school'])):
                if ('director', sid) not in have:
                    have.add(('director', sid))
                    out.append({'role': 'director', 'school': sid, 'via': r['role']})
    return out


def principal_roles(c, uid):
    return expand_roles(c, user_roles(c, uid))


def role_add(c, user_id, role, school, who, created_by=None):
    if role not in ROLES:
        raise ValueError('Неизвестная роль.')
    school = '' if role == 'superadmin' else str(school or '')
    if role != 'superadmin' and not scope_alive(c, role, school, archived=True):
        raise ValueError('Такой области или школы нет.' if role in SCOPE_ROLES else 'Такой школы нет.')
    if not c.execute('SELECT 1 FROM users WHERE id = ?', (user_id,)).fetchone():
        raise ValueError('Такого пользователя нет.')
    c.execute('INSERT OR IGNORE INTO user_roles(user_id, role, school, status, created, created_by) VALUES(?, ?, ?, ?, ?, ?)',
              (user_id, role, school, 'active', int(time.time() * 1000), created_by or who[1]))
    audit(c, who, 'role.add', 'user', user_id, school or None, {'role': role})


def user_roles(c, user_id):
    return [{'role': r, 'school': s} for r, s in c.execute("SELECT role, school FROM user_roles WHERE user_id = ? AND status = 'active' ORDER BY role, school", (user_id,))]


def revoke_sessions(c, user_id):
    c.execute('DELETE FROM sessions WHERE user_id = ?', (user_id,))


def set_password(c, user_id, password, who, action):
    now = int(time.time() * 1000)
    c.execute('UPDATE users SET pw = ?, pw_changed = ?, updated = ? WHERE id = ?', (hash_pw(password), now, now, user_id))
    revoke_sessions(c, user_id)
    audit(c, who, action, 'user', user_id, None, {})


def client_ip(h):
    """Адрес клиента. За Caddy соединение приходит с частного адреса: тогда берём X-Forwarded-For (последнее значение дописывает наш Caddy)."""
    peer = h.client_address[0]
    try:
        priv = ipaddress.ip_address(peer).is_private
    except ValueError:
        priv = False
    if priv:
        xff = (h.headers.get('X-Forwarded-For') or '').split(',')[-1].strip()
        try:
            return str(ipaddress.ip_address(xff))
        except ValueError:
            pass
    return peer


def thash(token):
    return hashlib.sha256(token.encode()).hexdigest()


def throttle(c, login, ip, now):
    """Пауза после ошибок и лимит по IP (PLAN 4). Возвращает секунды ожидания или 0. Вызывать под lock."""
    row = c.execute('SELECT n, until, last FROM login_fail WHERE k = ?', ('i:' + ip,)).fetchone()
    n, last = (row[0], row[2] or 0) if row else (0, 0)
    if now - last > 60000:
        n, last = 0, now
    n += 1
    until = 0
    if n > IP_PER_MIN:
        until = last + 60000
    c.execute('INSERT OR REPLACE INTO login_fail(k, n, until, last) VALUES(?, ?, ?, ?)', ('i:' + ip, n, until, last))
    if n > IP_PER_MIN:
        return max(1, (until - now + 999) // 1000)
    row = c.execute('SELECT until FROM login_fail WHERE k = ?', ('u:' + login,)).fetchone()
    if row and row[0] > now:
        return (row[0] - now + 999) // 1000
    return 0


def register_fail(c, login, ip, now):
    row = c.execute('SELECT n FROM login_fail WHERE k = ?', ('u:' + login,)).fetchone()
    n = (row[0] if row else 0) + 1
    until = 0
    if n >= LOGIN_FREE_TRIES:
        until = now + min(30000 * 2 ** (n - LOGIN_FREE_TRIES), 900000)
        if n == LOGIN_FREE_TRIES:
            audit(c, ('user', None, ip), 'auth.lockout', 'login', login[:40], None, {})
    c.execute('INSERT OR REPLACE INTO login_fail(k, n, until, last) VALUES(?, ?, ?, ?)', ('u:' + login, n, until, now))
    if n == 1:
        c.execute("DELETE FROM login_fail WHERE last < ? AND until < ?", (now - 86400000, now))


def session_start(c, user_id, ip, now):
    token = secrets.token_urlsafe(32)
    idle = load_config()['sessionMinutes'] * 60000
    c.execute('INSERT INTO sessions(token_hash, user_id, created, last_seen, expires, ip) VALUES(?, ?, ?, ?, ?, ?)',
              (thash(token), user_id, now, now, min(now + idle, now + SESSION_CAP), ip))
    return token, min(now + idle, now + SESSION_CAP)


def session_user(c, token):
    """Пользователь по токену или None. Срок считается от last_seen по текущей настройке (смена настройки действует на открытые сессии), потолок 12 ч от входа.
    Роли здесь не читаются из токена: вызывающий берёт их из базы заново."""
    if not token:
        return None
    now = int(time.time() * 1000)
    th = thash(token)
    row = c.execute('SELECT user_id, created, last_seen FROM sessions WHERE token_hash = ?', (th,)).fetchone()
    if not row:
        return None
    uid, created, seen = row
    idle = load_config()['sessionMinutes'] * 60000
    if now > seen + idle or now > created + SESSION_CAP:
        c.execute('DELETE FROM sessions WHERE token_hash = ?', (th,))
        return None
    u = c.execute("SELECT id, login, name FROM users WHERE id = ? AND status = 'active'", (uid,)).fetchone()
    if not u:
        c.execute('DELETE FROM sessions WHERE token_hash = ?', (th,))
        return None
    c.execute('UPDATE sessions SET last_seen = ?, expires = ? WHERE token_hash = ?', (now, min(now + idle, created + SESSION_CAP), th))
    return {'id': u[0], 'login': u[1], 'name': u[2], 'expires': min(now + idle, created + SESSION_CAP)}


# ---------- администрирование учёток (шаг 7 PLAN.md, ROLES 4.x): все действия через can-правила и журнал в одной транзакции ----------
UPLOAD_DIR = os.path.join(DATA, 'uploads')
UPLOAD_LIM = {'model': 4 * 1024 * 1024, 'sound': 1024 * 1024, 'texture': 1024 * 1024}
UPLOAD_MIME = {'glb': 'model/gltf-binary', 'wav': 'audio/wav', 'png': 'image/png', 'jpg': 'image/jpeg'}
UPLOAD_FILES = 100  # файлов на школу
UPLOAD_BYTES = 100 * 1024 * 1024  # байт на школу
UPLOAD_PER_HOUR = 30  # загрузок в час от одного пользователя
TEX_MAX = 1024  # сторона текстуры, пикселей (бюджет Quest 1)


def check_upload(kind, data):
    """Проверяет содержимое файла по сигнатуре и структуре; возвращает расширение или бросает AdminError. Расширению из имени не верим."""
    if kind not in UPLOAD_LIM:
        raise AdminError(400, 'Тип файла: model, sound или texture.')
    if not data or len(data) > UPLOAD_LIM[kind]:
        raise AdminError(413, 'Файл больше допустимого (%d КБ).' % (UPLOAD_LIM[kind] // 1024))
    if kind == 'model':
        if len(data) < 28 or data[:4] != b'glTF' or struct.unpack('<II', data[4:12]) != (2, len(data)):
            raise AdminError(400, 'Это не файл .glb версии 2.')
        n, typ = struct.unpack('<II', data[12:20])
        if typ != 0x4E4F534A or 20 + n > len(data):
            raise AdminError(400, 'В .glb нет блока описания.')
        try:
            js = json.loads(data[20:20 + n].decode('utf-8'))
        except ValueError:
            raise AdminError(400, 'Описание модели повреждено.')
        if not isinstance(js, dict) or any(str(x.get('uri', 'data:'))[:5] != 'data:' for k in ('buffers', 'images') for x in js.get(k, []) if isinstance(x, dict)):
            raise AdminError(400, 'Модель ссылается на внешние файлы: сохраните как единый .glb.')
        if js.get('extensionsRequired'):
            raise AdminError(400, 'Расширения .glb не поддерживаются.')
        return 'glb'
    if kind == 'sound':
        if len(data) < 44 or data[:4] != b'RIFF' or data[8:12] != b'WAVE':
            raise AdminError(400, 'Это не файл .wav.')
        return 'wav'
    if data[:8] == b'\x89PNG\r\n\x1a\n' and data[12:16] == b'IHDR':
        w, h = struct.unpack('>II', data[16:24])
        ext = 'png'
    elif data[:3] == b'\xff\xd8\xff':
        w = h = 0
        i = 2
        while i + 9 < len(data):
            if data[i] != 0xFF:
                i += 1
                continue
            mk = data[i + 1]
            if mk in (0xD8, 0x01) or 0xD0 <= mk <= 0xD7 or mk == 0xFF:
                i += 1 if mk == 0xFF else 2
                continue
            ln = struct.unpack('>H', data[i + 2:i + 4])[0]
            if 0xC0 <= mk <= 0xCF and mk not in (0xC4, 0xC8, 0xCC):
                h, w = struct.unpack('>HH', data[i + 5:i + 9])
                break
            i += 2 + ln
        ext = 'jpg'
    else:
        raise AdminError(400, 'Текстура: файл PNG или JPEG.')
    if not (0 < w <= TEX_MAX and 0 < h <= TEX_MAX):
        raise AdminError(400, 'Текстура %dx%d: допустимо до %d px по стороне.' % (w, h, TEX_MAX))
    return ext


def upload_schools(p):
    """Школы, куда пользователь может загружать: учитель и директор — свои; суперадмин и старый ключ — любая."""
    if p['kind'] == 'user':
        return None if my_rank(p) >= SUPER else {r['school'] for r in p['roles'] if r['role'] in ('teacher', 'director')}
    return None


def upload_visible(c, p, row, archived=False):
    """row: (school, owner, status, [ext, archived_at]). Одобренное видит вся школа (и её шлемы); неодобренное — автор и директор школы.
    Архивный файл (Б74, archived_at) не виден никому; с archived=True его видят автор, директор школы и суперадмин."""
    school, owner, status = row[:3]
    if len(row) > 4 and row[4] is not None:
        if not archived or p['kind'] != 'user':
            return False
        return my_rank(p) >= SUPER or (my_rank(p) >= 3 and school in dir_schools(p)) or owner == p['id']
    if p['kind'] == 'device':
        return status == 'approved' and (not p.get('school') or p['school'] == school)
    if p['kind'] != 'user':
        return True
    rank = my_rank(p)
    if rank >= SUPER or (rank >= 3 and school in dir_schools(p)):
        return True
    return school in {r['school'] for r in p['roles']} and (status == 'approved' or owner == p['id'])


def upload_create(c, p, kind, name, school, data, ip):
    now = int(time.time() * 1000)
    ext = check_upload(kind, data)
    sch = upload_schools(p)
    if p['kind'] == 'device':
        raise AdminError(403, 'Шлем файлы не загружает.')
    if p['kind'] == 'user':
        if my_rank(p) < 2:
            raise AdminError(403, 'Загружать файлы может учитель.')
        if not school:
            school = sorted(sch)[0] if sch else DEFAULT_SCHOOL
        if sch is not None and school not in sch:
            raise AdminError(403, 'Это чужая школа.')
    else:
        school = school or DEFAULT_SCHOOL
    if not c.execute('SELECT 1 FROM schools WHERE id = ? AND status = ?', (school, 'active')).fetchone():
        raise AdminError(404, 'Школы нет.')
    who = ('user', p['id'], ip) if p['kind'] == 'user' else ('legacy', p.get('id', ''), ip)
    if p['kind'] == 'user' and c.execute('SELECT COUNT(*) FROM uploads WHERE owner = ? AND created > ?', (p['id'], now - 3600000)).fetchone()[0] >= UPLOAD_PER_HOUR:
        raise AdminError(429, 'Слишком много загрузок за час. Попробуйте позже.')
    n, tot = c.execute("SELECT COUNT(*), COALESCE(SUM(size), 0) FROM uploads WHERE school = ? AND status != 'rejected' ", (school,)).fetchone()  # архивные файлы лежат на диске и считаются
    if n >= UPLOAD_FILES or tot + len(data) > UPLOAD_BYTES:
        raise AdminError(413, 'Лимит файлов школы исчерпан: удалите ненужные.')
    uid = secrets.token_hex(6)
    auto = p['kind'] != 'user' or my_rank(p) >= 3  # директор и администратор одобряют сами себя
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    path = os.path.join(UPLOAD_DIR, '%s.%s' % (uid, ext))
    with open(path, 'wb') as f:
        f.write(data)
    try:
        c.execute('INSERT INTO uploads(id, school, owner, kind, name, size, ext, sha, status, created, decided_by, decided) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                  (uid, school, p.get('id') if p['kind'] == 'user' else None, kind, str(name or 'файл')[:60], len(data), ext, hashlib.sha256(data).hexdigest(), 'approved' if auto else 'pending', now, None, now if auto else None))
        audit(c, who, 'upload.create', 'upload', uid, school, {'kind': kind, 'size': len(data), 'name': str(name or '')[:60]})
    except Exception:
        os.remove(path)
        raise
    return {'id': uid, 'status': 'approved' if auto else 'pending', 'kind': kind, 'school': school}



class AdminError(Exception):
    def __init__(self, code, msg):
        Exception.__init__(self, msg)
        self.code, self.msg = code, msg


RANK = {'superadmin': 6, 'region_admin': 5, 'district_admin': 4, 'director': 3, 'teacher': 2, 'expert': 1}
SUPER = 6  # ранг суперадмина: всё и везде
SCOPE_ROLES = ('region_admin', 'district_admin')  # у них в user_roles.school лежит ключ области: r:<регион> или d:<регион>|<район>
CODE_ALPHA = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
SCHOOL_RE = re.compile(r'^s-[a-z0-9-]{2,30}$')
RESET_TTL = 24 * 3600 * 1000
INVITE_TTL = 7 * 24 * 3600 * 1000
PAIR_TTL = 10 * 60 * 1000


def my_rank(p):
    return max([RANK.get(r['role'], 0) for r in p.get('roles') or []] or [0])


def dir_schools(p):
    return {r['school'] for r in p.get('roles') or [] if r['role'] == 'director'}


def device_room(c, school, now):
    """Есть ли у школы свободное место под шлем: действующие шлемы + неистёкшие коды привязки не больше лимита. Иначе — AdminError с понятным текстом."""
    lim = c.execute('SELECT device_limit FROM schools WHERE id = ?', (school,)).fetchone()[0]
    act = c.execute("SELECT count(*) FROM devices WHERE school = ? AND status = 'active'", (school,)).fetchone()[0]
    pend = c.execute('SELECT count(*) FROM pair_codes WHERE school = ? AND used_at IS NULL AND expires > ?', (school, now)).fetchone()[0]
    if act + pend >= lim:
        raise AdminError(400, 'Лимит шлемов школы (%d) исчерпан. Отзовите ненужный шлем или обратитесь к администратору.' % lim)


def new_code(n=10):
    return ''.join(secrets.choice(CODE_ALPHA) for _ in range(n))


def user_row(c, uid):
    r = c.execute('SELECT id, login, name, status FROM users WHERE id = ?', (str(uid or ''),)).fetchone()
    return {'id': r[0], 'login': r[1], 'name': r[2], 'status': r[3]} if r else None


def all_roles(c, uid):
    return [{'role': r, 'school': s, 'status': st} for r, s, st in c.execute('SELECT role, school, status FROM user_roles WHERE user_id = ?', (uid,))]


def manageable(c, p, target):
    """Может ли p управлять учёткой target (архив, сброс пароля). Суперадмин — любой, кроме себя; региональный администратор — учителя, директора и специалисты своего региона; директор — только учителя своей школы."""
    if target['id'] == p['id']:
        return False
    rank = my_rank(p)
    if rank >= SUPER:
        return True
    ds = dir_schools(p)
    roles = [r for r in all_roles(c, target['id']) if r['status'] == 'active']
    allowed = ('teacher', 'director', 'expert') if rank >= RANK['district_admin'] else ('teacher',)
    return bool(ds) and bool(roles) and all(r['role'] in allowed and r['school'] in ds for r in roles)


def region_keys(p):
    return {key_parts(r['school'])[0] for r in p.get('roles') or [] if r['role'] == 'region_admin' and key_parts(r['school'])}


def grant_ok(p, role, school, invite=False):
    """Можно ли p выдать роль role в области school: только ниже своей и только в своих школах. Директор через приглашение зовёт учителя и специалиста, напрямую назначает только учителя."""
    rank = my_rank(p)
    if RANK.get(role, 99) >= rank:
        return False
    if rank >= SUPER:
        return True
    return (school in dir_schools(p) or (role == 'district_admin' and rank >= RANK['region_admin'] and (key_parts(school) or ('',))[0] in region_keys(p))) and (invite or rank >= RANK['district_admin'] or role == 'teacher')


def active_directors(c, school, exclude=None):
    return [r[0] for r in c.execute("SELECT ur.user_id FROM user_roles ur JOIN users u ON u.id = ur.user_id WHERE ur.role = 'director' AND ur.school = ? AND ur.status = 'active' AND u.status = 'active'", (school,)) if r[0] != exclude]


def guard_last_director(c, uid):
    """Нельзя оставить школу без директора (ROLES 4.1): сначала назначьте замену."""
    for r in all_roles(c, uid):
        if r['role'] == 'director' and r['status'] == 'active' and not active_directors(c, r['school'], exclude=uid):
            raise AdminError(400, 'Школа останется без директора: сначала назначьте замену.')


def admin_action(c, p, act, b, ip):
    """Выполняет административное действие; возвращает dict-ответ или бросает AdminError. Вызывать под lock в одной транзакции."""
    who = ('user', p['id'], ip)
    now = int(time.time() * 1000)
    rank = my_rank(p)
    sc = scope(c, p)
    S = lambda k, n=80: str(b.get(k) or '')[:n]  # noqa: E731
    need_dir = act not in ('student.archive', 'student.restore', 'class.archive', 'class.restore', 'trash.list', 'trash.restore', 'student.pin', 'student.move', 'upload.list', 'upload.delete', 'upload.restore', 'room.publish', 'room.list', 'room.unpublish', 'purge.mark', 'purge.unmark', 'purge.marks')
    if rank < (3 if need_dir else 2) and not (act == 'closed.list' and rank >= 1):
        audit(c, who, 'admin.denied', 'admin', act, None, {'why': 'rank'})
        raise AdminError(403, 'Недостаточно прав.')
    if act == 'school.create':
        if rank < SUPER:
            raise AdminError(403, 'Школы создаёт суперадмин.')
        name = S('name').strip()
        sid = S('id') or 's-' + secrets.token_hex(4)
        if not name or not SCHOOL_RE.match(sid):
            raise AdminError(400, 'Нужны название и код школы вида s-xxxx.')
        if c.execute('SELECT 1 FROM schools WHERE id = ?', (sid,)).fetchone():
            raise AdminError(400, 'Такая школа уже есть.')
        c.execute('INSERT INTO schools(id, name, region, district, status, network, created, updated) VALUES(?, ?, ?, ?, ?, ?, ?, ?)', (sid, name, S('region', 60), S('district', 60), 'active', '', now, now))
        audit(c, who, 'school.create', 'school', sid, sid, {'name': name})
        return {'ok': True, 'id': sid}
    if act == 'school.update':
        if rank < SUPER:
            raise AdminError(403, 'Школы меняет суперадмин.')
        row = c.execute('SELECT name, region, status, district FROM schools WHERE id = ?', (S('id'),)).fetchone()
        if not row:
            raise AdminError(404, 'Школы нет.')
        name = S('name').strip() or row[0]
        region = S('region', 60) if 'region' in b else row[1]
        district = S('district', 60) if 'district' in b else row[3]
        status = b.get('status') if b.get('status') in ('pending', 'active', 'archived') else row[2]
        if S('id') == DEFAULT_SCHOOL and status == 'archived':
            raise AdminError(400, 'Школу по умолчанию архивировать нельзя.')
        lim = c.execute('SELECT device_limit FROM schools WHERE id = ?', (S('id'),)).fetchone()[0]
        if 'device_limit' in b:
            try:
                lim = int(b['device_limit'])
            except (TypeError, ValueError):
                raise AdminError(400, 'Лимит шлемов — число.')
            if not 0 <= lim <= 1000:
                raise AdminError(400, 'Лимит шлемов — от 0 до 1000.')
        c.execute('UPDATE schools SET name = ?, region = ?, district = ?, status = ?, updated = ?, device_limit = ? WHERE id = ?', (name, region, district, status, now, lim, S('id')))
        audit(c, who, 'school.update', 'school', S('id'), S('id'), {'status': status, 'device_limit': lim})
        return {'ok': True}
    if act in ('role.assign', 'role.remove'):
        role, school, uid = S('role', 20), S('school', 40), S('user_id', 40)
        if role in SCOPE_ROLES:
            school = scope_key(role, S('region', 60), S('district', 60)) or ''
        t = user_row(c, uid)
        if not t or t['status'] != 'active':
            raise AdminError(404, 'Пользователя нет.')
        if uid == p['id']:
            audit(c, who, 'admin.denied', 'user', uid, None, {'why': 'self', 'action': act})
            raise AdminError(403, 'Свои роли менять нельзя.')
        if role not in ('region_admin', 'district_admin', 'director', 'teacher', 'expert'):
            raise AdminError(403 if role == 'superadmin' else 400, 'Эту роль выдать нельзя.')
        if not grant_ok(p, role, school):
            audit(c, who, 'admin.denied', 'user', uid, school or None, {'why': 'role', 'role': role, 'action': act})
            raise AdminError(403, 'Эту роль вы выдать не можете.')
        if not scope_alive(c, role, school):
            raise AdminError(400, 'Такой области нет.' if role in SCOPE_ROLES else 'Такой школы нет.')
        if act == 'role.assign':
            c.execute("INSERT INTO user_roles(user_id, role, school, status, created, created_by) VALUES(?, ?, ?, 'active', ?, ?) ON CONFLICT(user_id, role, school) DO UPDATE SET status = 'active'", (uid, role, school, now, p['id']))
            audit(c, who, 'role.assign', 'user', uid, school or None, {'role': role})
        else:
            if role == 'director' and not active_directors(c, school, exclude=uid):
                raise AdminError(400, 'Школа останется без директора: сначала назначьте замену.')
            c.execute("UPDATE user_roles SET status = 'archived' WHERE user_id = ? AND role = ? AND school = ?", (uid, role, school))
            revoke_sessions(c, uid)
            audit(c, who, 'role.remove', 'user', uid, school or None, {'role': role})
        return {'ok': True}
    if act in ('user.archive', 'user.restore', 'password.reset'):
        t = user_row(c, S('user_id', 40))
        if not t:
            raise AdminError(404, 'Пользователя нет.')
        if not manageable(c, p, t):
            audit(c, who, 'admin.denied', 'user', t['id'], None, {'why': 'scope', 'action': act})
            raise AdminError(403, 'Эта учётная запись вам не подчиняется.')
        if act == 'user.archive':
            guard_last_director(c, t['id'])
            if any(r['role'] == 'superadmin' for r in all_roles(c, t['id'])) and c.execute("SELECT count(*) FROM user_roles ur JOIN users u ON u.id = ur.user_id WHERE ur.role = 'superadmin' AND ur.status = 'active' AND u.status = 'active'").fetchone()[0] < 2:
                raise AdminError(400, 'Это последний суперадмин.')
            c.execute("UPDATE users SET status = 'archived', updated = ? WHERE id = ?", (now, t['id']))
            revoke_sessions(c, t['id'])
            audit(c, who, 'user.archive', 'user', t['id'], None, {})
            return {'ok': True}
        if act == 'user.restore':
            c.execute("UPDATE users SET status = 'active', updated = ? WHERE id = ?", (now, t['id']))
            audit(c, who, 'user.restore', 'user', t['id'], None, {})
            return {'ok': True}
        code = new_code()
        c.execute("DELETE FROM invites WHERE kind = 'reset' AND user_id = ? AND used_at IS NULL", (t['id'],))
        c.execute('INSERT INTO invites(code_hash, kind, role, school, user_id, created_by, created, expires, used_at, used_by) VALUES(?, ?, NULL, NULL, ?, ?, ?, ?, NULL, NULL)',
                  (thash(code), 'reset', t['id'], p['id'], now, now + RESET_TTL))
        revoke_sessions(c, t['id'])
        audit(c, who, 'password.reset_issue', 'user', t['id'], None, {})  # код в журнал не пишем (А14)
        return {'ok': True, 'code': code, 'expires': now + RESET_TTL}
    if act in ('invite.create', 'invite.list', 'invite.revoke'):
        if act == 'invite.list':
            rows = c.execute("SELECT code_hash, role, school, created, expires FROM invites WHERE kind = 'join' AND used_at IS NULL AND expires > ? ORDER BY created DESC", (now,)).fetchall()
            return {'items': [{'id': h[:12], 'role': r, 'school': sch, 'created': cr, 'expires': ex} for h, r, sch, cr, ex in rows if rank >= SUPER or sch in dir_schools(p)]}
        if act == 'invite.revoke':
            row = next((h for (h, sch) in c.execute("SELECT code_hash, school FROM invites WHERE kind = 'join' AND used_at IS NULL") if h[:12] == S('id', 12) and (rank >= SUPER or sch in dir_schools(p))), None)
            if not row:
                raise AdminError(404, 'Приглашения нет.')
            c.execute('DELETE FROM invites WHERE code_hash = ?', (row,))
            audit(c, who, 'invite.revoke', 'invite', S('id', 12), None, {})
            return {'ok': True}
        role, school = S('role', 20), S('school', 40)
        if role in SCOPE_ROLES:
            school = scope_key(role, S('region', 60), S('district', 60)) or ''
        if role not in ('region_admin', 'district_admin', 'director', 'teacher', 'expert'):
            raise AdminError(400, 'Приглашать можно регионального администратора, директора, учителя или специалиста.')
        if not grant_ok(p, role, school, invite=True):
            audit(c, who, 'admin.denied', 'invite', None, school or None, {'why': 'role', 'role': role, 'action': act})
            raise AdminError(403, 'Эту роль вы выдать не можете.')
        if not scope_alive(c, role, school):
            raise AdminError(400, 'Такой области нет.' if role in SCOPE_ROLES else 'Такой школы нет.')
        code = new_code()
        c.execute('INSERT INTO invites(code_hash, kind, role, school, user_id, created_by, created, expires, used_at, used_by) VALUES(?, ?, ?, ?, NULL, ?, ?, ?, NULL, NULL)',
                  (thash(code), 'join', role, school, p['id'], now, now + INVITE_TTL))
        audit(c, who, 'invite.create', 'invite', thash(code)[:12], school, {'role': role})  # сам код в журнал не пишем (А14)
        return {'ok': True, 'code': code, 'expires': now + INVITE_TTL}
    if act in ('device.code', 'device.list', 'device.revoke'):
        if act == 'device.list':
            sch = S('school', 40)
            if rank < SUPER and sch not in dir_schools(p):
                raise AdminError(403, 'Это шлемы чужой школы.')
            rows = c.execute('SELECT id, name, status, created, last_seen FROM devices WHERE school = ? ORDER BY created', (sch,)).fetchall()
            lim = c.execute('SELECT device_limit FROM schools WHERE id = ?', (sch,)).fetchone()
            return {'items': [{'id': i, 'name': n, 'status': st, 'created': cr, 'lastSeen': ls} for i, n, st, cr, ls in rows], 'limit': lim[0] if lim else 0,
                    'active': sum(1 for r in rows if r[2] == 'active')}
        if act == 'device.revoke':
            row = c.execute('SELECT school FROM devices WHERE id = ?', (S('id', 40),)).fetchone()
            if not row:
                raise AdminError(404, 'Шлема нет.')
            if rank < SUPER and row[0] not in dir_schools(p):
                audit(c, who, 'admin.denied', 'device', S('id', 40), row[0], {'why': 'scope', 'action': act})
                raise AdminError(403, 'Это шлем чужой школы.')
            c.execute("UPDATE devices SET status = 'revoked' WHERE id = ?", (S('id', 40),))
            audit(c, who, 'device.revoke', 'device', S('id', 40), row[0], {})
            return {'ok': True}
        sch = S('school', 40)
        if rank < SUPER and sch not in dir_schools(p):
            audit(c, who, 'admin.denied', 'device', None, sch or None, {'why': 'scope', 'action': act})
            raise AdminError(403, 'Это школа не ваша.')
        if not c.execute("SELECT 1 FROM schools WHERE id = ? AND status != 'archived'", (sch,)).fetchone():
            raise AdminError(400, 'Такой школы нет.')
        device_room(c, sch, now)
        code = new_code(8)
        c.execute('INSERT INTO pair_codes(code_hash, school, name, created_by, created, expires, used_at) VALUES(?, ?, ?, ?, ?, ?, NULL)', (thash(code), sch, S('name', 40), p['id'], now, now + PAIR_TTL))
        audit(c, who, 'device.code', 'school', sch, sch, {})
        return {'ok': True, 'code': code, 'expires': now + PAIR_TTL}
    if act == 'closed.list':
        # закрытые результаты: только специалист (роль expert) своей школы и администратор; директор и учитель их не видят
        sch = S('school', 40)
        if rank < SUPER and not any(r['role'] == 'expert' and r['school'] == sch for r in p['roles']):
            audit(c, who, 'admin.denied', 'closed', sch or None, sch or None, {'why': 'role', 'action': act})
            raise AdminError(403, 'Закрытые результаты видит только специалист школы.')
        studs = {}
        for sid, raw in c.execute('SELECT id, doc FROM students'):
            d = json.loads(raw)
            if rank >= SUPER and not sch or d.get('school') == sch:
                studs[sid] = d
        out = []
        for sid, raw in c.execute("SELECT sid, doc FROM results WHERE closed = 1 AND ts >= ? ORDER BY ts DESC LIMIT 1000", (num(get_settings(c).get('resetAt')),)):
            if sid in studs:
                r = json.loads(raw)
                out.append({'student': studs[sid].get('name', ''), 'grade': studs[sid].get('grade'), 'test': r.get('testTitle') or '', 'score': r.get('score'), 'total': r.get('total'), 'ts': r.get('ts')})
        audit(c, who, 'closed.view', 'closed', sch or None, sch or None, {'count': len(out)})
        return {'items': out}
    if act in ('room.publish', 'room.list', 'room.approve', 'room.reject', 'room.unpublish'):
        if act == 'room.publish':
            sch = S('school', 40)
            spec = b.get('spec')
            if not isinstance(spec, dict) or str(spec.get('schema') or spec.get('v')) != 'room/1' or not isinstance(spec.get('blocks'), list):
                raise AdminError(400, 'Это не описание комнаты.')
            blob = json.dumps(spec, ensure_ascii=False)
            if len(blob) > 60000:
                raise AdminError(413, 'Комната слишком большая для публикации.')
            if 'up:' in blob:
                raise AdminError(400, 'В открытой комнате пока можно использовать только встроенные модели, звуки и текстуры. Уберите свои файлы.')
            if rank < SUPER and sch not in {r['school'] for r in p['roles'] if r['role'] in ('teacher', 'director')}:
                raise AdminError(403, 'Это чужая школа.')
            if not c.execute("SELECT 1 FROM schools WHERE id = ? AND status = 'active'", (sch,)).fetchone():
                raise AdminError(404, 'Школы нет.')
            src = S('src', 60)
            title = str(spec.get('title') or 'Комната')[:80]
            auto = rank >= 3
            if c.execute('SELECT COUNT(*) FROM open_rooms WHERE school = ?', (sch,)).fetchone()[0] >= 50 and not c.execute('SELECT 1 FROM open_rooms WHERE school = ? AND src = ? AND owner = ?', (sch, src, p['id'])).fetchone():
                raise AdminError(413, 'В школе уже 50 открытых комнат: уберите ненужные.')
            row = c.execute('SELECT id FROM open_rooms WHERE school = ? AND src = ? AND owner = ?', (sch, src, p['id'])).fetchone()
            rid = row[0] if row else 'o-' + secrets.token_hex(6)
            c.execute('INSERT OR REPLACE INTO open_rooms(id, school, owner, src, title, spec, status, created, updated, decided_by, decided) VALUES(?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT created FROM open_rooms WHERE id = ?), ?), ?, ?, ?)',
                      (rid, sch, p['id'], src, title, blob, 'approved' if auto else 'pending', rid, now, now, p['id'] if auto else None, now if auto else None))
            audit(c, who, 'room.publish', 'room', rid, sch, {'title': title, 'auto': auto})
            return {'id': rid, 'status': 'approved' if auto else 'pending'}
        if act == 'room.list':
            sch = S('school', 40)
            rows = c.execute('SELECT r.id, r.school, r.owner, r.src, r.title, r.status, r.updated, COALESCE(NULLIF(u.name, \'\'), u.login) FROM open_rooms r LEFT JOIN users u ON u.id = r.owner WHERE (? = \'\' OR r.school = ?) ORDER BY r.updated DESC LIMIT 300', (sch, sch)).fetchall()
            sees = lambda school, owner, st: rank >= SUPER or school in dir_schools(p) or owner == p['id'] or (st == 'approved' and school in {r['school'] for r in p['roles']})  # noqa: E731
            return {'items': [{'id': i, 'school': sc_, 'src': sr, 'title': t, 'status': st, 'updated': up, 'owner': ow or '', 'mine': o == p['id']} for i, sc_, o, sr, t, st, up, ow in rows if sees(sc_, o, st)]}
        row = c.execute('SELECT school, owner FROM open_rooms WHERE id = ?', (S('id', 20),)).fetchone()
        if not row:
            raise AdminError(404, 'Комнаты нет.')
        own = row[1] == p['id'] and act == 'room.unpublish'
        if not own and rank < SUPER and row[0] not in dir_schools(p):
            audit(c, who, 'admin.denied', 'room', S('id', 20), row[0], {'why': 'scope', 'action': act})
            raise AdminError(403, 'Это комната чужой школы.')
        if act == 'room.unpublish':
            orow = c.execute('SELECT id, school, owner, src, title, spec, status, created, updated, decided_by, decided FROM open_rooms WHERE id = ?', (S('id', 20),)).fetchone()
            to_trash(c, 'open_room', orow[0], orow[1], dict(zip(('id', 'school', 'owner', 'src', 'title', 'spec', 'status', 'created', 'updated', 'decided_by', 'decided'), orow)), who)
            c.execute('DELETE FROM open_rooms WHERE id = ?', (S('id', 20),))
        else:
            c.execute('UPDATE open_rooms SET status = ?, decided_by = ?, decided = ? WHERE id = ?', ('approved' if act == 'room.approve' else 'rejected', p['id'], now, S('id', 20)))
        audit(c, who, act, 'room', S('id', 20), row[0], {})
        return {'ok': True}
    if act in ('upload.list', 'upload.approve', 'upload.reject', 'upload.delete', 'upload.restore'):
        if act == 'upload.list':
            sch = S('school', 40)
            arch = bool(b.get('archived')) and p['kind'] == 'user'
            rows = c.execute('SELECT u.id, u.school, u.owner, u.kind, u.name, u.size, u.status, u.created, COALESCE(NULLIF(us.name, \'\'), us.login), u.archived_at FROM uploads u LEFT JOIN users us ON us.id = u.owner '
                             'WHERE (? = \'\' OR u.school = ?) AND u.archived_at IS %s NULL ORDER BY u.created DESC LIMIT 500' % ('NOT' if arch else ''), (sch, sch)).fetchall()
            return {'items': [{'id': i, 'school': sc_, 'kind': k, 'name': n, 'size': z, 'status': st, 'created': cr, 'owner': ow or 'администратор', 'mine': o == p['id'], 'archived': ar is not None}
                              for i, sc_, o, k, n, z, st, cr, ow, ar in rows if upload_visible(c, p, (sc_, o, st, None, ar), arch)]}
        row = c.execute('SELECT school, owner, status, ext, archived_at, archived_by FROM uploads WHERE id = ?', (S('id', 20),)).fetchone()
        if act == 'upload.restore':
            if not row or row[4] is None or not upload_visible(c, p, row, True):
                raise AdminError(404, 'Файла нет в архиве.')
        elif not row or not upload_visible(c, p, row):
            raise AdminError(404, 'Файла нет.')
        own = row[1] == p['id'] and act in ('upload.delete', 'upload.restore')
        if act == 'upload.restore' and own and rank < SUPER and row[0] not in dir_schools(p) and row[5] != p['id']:
            audit(c, who, 'admin.denied', 'upload', S('id', 20), row[0], {'why': 'archived_by', 'action': act})
            raise AdminError(403, 'Файл убрал директор или администратор: вернуть его может только он.')
        if not own and rank < SUPER and row[0] not in dir_schools(p):
            audit(c, who, 'admin.denied', 'upload', S('id', 20), row[0], {'why': 'scope', 'action': act})
            raise AdminError(403, 'Это файл чужой школы.')
        if act == 'upload.delete':
            # Б74: файл остаётся на диске, запись уходит в архив; стереть окончательно может только суперадмин (шаг 25)
            c.execute('UPDATE uploads SET archived_at = ?, archived_by = ? WHERE id = ?', (now, p['id'], S('id', 20)))
            act = 'upload.archive'
        elif act == 'upload.restore':
            c.execute('UPDATE uploads SET archived_at = NULL, archived_by = NULL WHERE id = ?', (S('id', 20),))
        else:
            c.execute('UPDATE uploads SET status = ?, decided_by = ?, decided = ? WHERE id = ?', ('approved' if act == 'upload.approve' else 'rejected', p['id'], now, S('id', 20)))
        audit(c, who, act, 'upload', S('id', 20), row[0], {})
        return {'ok': True}
    if act == 'class.assign':
        row = class_row(c, S('class_id', 60))
        if not row:
            raise AdminError(404, 'Класса нет.')
        if rank < SUPER and row[0] not in dir_schools(p):
            audit(c, who, 'admin.denied', 'class', S('class_id', 60), row[0], {'why': 'scope', 'action': act})
            raise AdminError(403, 'Это класс чужой школы.')
        tid = S('teacher_id', 40) or None
        if tid:
            t = user_row(c, tid)
            if not t or t['status'] != 'active' or not c.execute("SELECT 1 FROM user_roles WHERE user_id = ? AND role = 'teacher' AND school = ? AND status = 'active'", (tid, row[0])).fetchone():
                raise AdminError(400, 'Этот человек не учитель школы класса.')
        raw = c.execute('SELECT doc FROM classes WHERE id = ?', (S('class_id', 60),)).fetchone()[0]
        d = load_doc(raw) or {}
        if tid:
            d['teacherId'] = tid
        else:
            d.pop('teacherId', None)
        d['updated'] = now
        c.execute('UPDATE classes SET teacherId = ?, doc = ?, updated = ? WHERE id = ?', (tid, json.dumps(d, ensure_ascii=False), now, S('class_id', 60)))
        audit(c, who, 'class.assign', 'class', S('class_id', 60), row[0], {'from': row[1], 'to': tid})
        return {'ok': True}
    if act in ('class.create', 'class.move'):
        tid = S('teacher_id', 40) or None
        if act == 'class.create':
            sch, cid = S('school_id', 40), 'c-' + secrets.token_hex(6)
            try:
                grade = int(b.get('grade'))
            except (TypeError, ValueError):
                grade = 0
            letter = S('letter', 4).strip().upper()
            if not 1 <= grade <= 11 or not letter:
                raise AdminError(400, 'Нужны параллель (1–11) и буква класса.')
            src = None
        else:
            cid = S('class_id', 60)
            src = class_row(c, cid)
            if not src:
                raise AdminError(404, 'Класса нет.')
            sch = S('school_id', 40) or src[0]
            row_d = c.execute('SELECT doc FROM classes WHERE id = ?', (cid,)).fetchone()[0]
            grade, letter = num(load_doc(row_d).get('grade')), str(load_doc(row_d).get('letter') or '')
            if rank < SUPER and src[0] not in dir_schools(p):
                audit(c, who, 'admin.denied', 'class', cid, src[0], {'why': 'scope', 'action': act})
                raise AdminError(403, 'Это класс чужой школы.')
        if rank < SUPER and sch not in dir_schools(p):
            audit(c, who, 'admin.denied', 'class', cid, sch or None, {'why': 'scope', 'action': act})
            raise AdminError(403, 'Это школа не ваша.')
        if not c.execute("SELECT 1 FROM schools WHERE id = ? AND status = 'active'", (sch,)).fetchone():
            raise AdminError(400, 'Такой школы нет.')
        if tid:
            t = user_row(c, tid)
            if not t or t['status'] != 'active' or not c.execute("SELECT 1 FROM user_roles WHERE user_id = ? AND role = 'teacher' AND school = ? AND status = 'active'", (tid, sch)).fetchone():
                raise AdminError(400, 'Этот человек не учитель выбранной школы.')
        dup = c.execute("SELECT id FROM classes WHERE school = ? AND name = ? AND status = 'active' AND id != ?", (sch, '%s%s' % (grade, letter), cid)).fetchone()
        if dup:
            raise AdminError(400, 'В этой школе такой класс уже есть.')
        if act == 'class.create':
            d = {'id': cid, 'grade': grade, 'letter': letter, 'created': now, 'updated': now, 'school': sch, 'year': acad_year(now), 'status': 'active'}
            if tid:
                d['teacherId'] = tid
            c.execute('INSERT INTO classes(id, name, updated, doc, school, year, status, teacherId) VALUES(?, ?, ?, ?, ?, ?, ?, ?)',
                      (cid, '%s%s' % (grade, letter), now, json.dumps(d, ensure_ascii=False), sch, d['year'], 'active', tid))
            audit(c, who, 'class.create', 'class', cid, sch, {'name': '%s%s' % (grade, letter), 'by': 'admin'})
            return {'ok': True, 'id': cid}
        d = load_doc(c.execute('SELECT doc FROM classes WHERE id = ?', (cid,)).fetchone()[0]) or {}
        d['school'], d['updated'] = sch, now
        if tid:
            d['teacherId'] = tid
        else:
            d.pop('teacherId', None)
        c.execute('UPDATE classes SET school = ?, teacherId = ?, doc = ?, updated = ? WHERE id = ?', (sch, tid, json.dumps(d, ensure_ascii=False), now, cid))
        moved = 0
        for sid, raw in c.execute("SELECT id, doc FROM students WHERE json_extract(doc, '$.classId') = ?", (cid,)).fetchall():
            sd = load_doc(raw) or {}
            sd['school'], sd['updated'] = sch, now
            c.execute('UPDATE students SET school = ?, doc = ?, updated = ? WHERE id = ?', (sch, json.dumps(sd, ensure_ascii=False), now, sid))
            moved += 1
        audit(c, who, 'class.move', 'class', cid, sch, {'from': src[0], 'to': sch, 'students': moved})
        return {'ok': True, 'students': moved}
    if act in ('student.move', 'student.pin'):
        row = c.execute('SELECT doc FROM students WHERE id = ?', (S('student_id', 60),)).fetchone()
        d = load_doc(row[0]) if row else None
        if not d or not student_in_scope(c, sc, d):
            if d:
                audit(c, who, 'admin.denied', 'student', S('student_id', 60), None, {'why': 'scope', 'action': act})
            raise AdminError(404 if not d else 403, 'Ученика нет или он вам не подчиняется.')
        if act == 'student.pin':
            had = bool(d.get('pinHash'))
            d['pinHash'] = None
            d.pop('pinView', None)
            d['updated'] = now
            c.execute('UPDATE students SET doc = ?, updated = ? WHERE id = ?', (json.dumps(d, ensure_ascii=False), now, S('student_id', 60)))
            audit(c, who, 'student.pin_reset', 'student', S('student_id', 60), d.get('school'), {'had': had})
            return {'ok': True}
        ncl = class_row(c, S('class_id', 60))
        if not ncl or not class_in_scope(sc, ncl[0], ncl[1]):
            audit(c, who, 'admin.denied', 'class', S('class_id', 60), None, {'why': 'scope', 'action': act})
            raise AdminError(403, 'Нельзя перенести в этот класс.')
        old_cl = d.get('classId')
        d['classId'] = S('class_id', 60)
        d['school'] = ncl[0]
        d['updated'] = now
        c.execute('UPDATE students SET doc = ?, updated = ?, school = ? WHERE id = ?', (json.dumps(d, ensure_ascii=False), now, ncl[0], S('student_id', 60)))
        audit(c, who, 'student.move', 'student', S('student_id', 60), ncl[0], {'from': old_cl, 'to': S('class_id', 60)})
        return {'ok': True}
    if act in ('student.archive', 'student.restore'):
        sid = S('student_id', 60)
        row = c.execute('SELECT doc FROM students WHERE id = ?', (sid,)).fetchone()
        d = load_doc(row[0]) if row else None
        if not d:
            raise AdminError(404, 'Ученика нет.')
        if not (student_in_scope(c, sc, d) or (rank < SUPER and d.get('school') in dir_schools(p))):
            audit(c, who, 'admin.denied', 'student', sid, d.get('school') if ok_school(d.get('school')) else None, {'why': 'scope', 'action': act})
            raise AdminError(403, 'Ученик вам не подчиняется.')
        want = 'archived' if act == 'student.archive' else 'active'
        res = {'ok': True}
        if d.get('status', 'active') != want:
            d['status'], d['updated'] = want, max(now, num(d.get('updated')) + 1)
            c.execute('UPDATE students SET status = ?, updated = ?, doc = ? WHERE id = ?', (want, d['updated'], json.dumps(d, ensure_ascii=False), sid))
            audit(c, who, act, 'student', sid, d.get('school') if ok_school(d.get('school')) else None, {'via': 'admin'})
        if want == 'active' and d.get('classId'):
            cr = c.execute('SELECT status FROM classes WHERE id = ?', (d['classId'],)).fetchone()
            if cr and cr[0] == 'archived':
                res['warning'] = 'class_archived'
        return res
    if act in ('class.archive', 'class.restore'):
        cid = S('class_id', 60)
        src = class_row(c, cid)
        if not src:
            raise AdminError(404, 'Класса нет.')
        if not (class_in_scope(sc, src[0], src[1]) or (rank < SUPER and src[0] in dir_schools(p))):
            audit(c, who, 'admin.denied', 'class', cid, src[0], {'why': 'scope', 'action': act})
            raise AdminError(403, 'Это класс чужой школы или не ваш.')
        d = load_doc(c.execute('SELECT doc FROM classes WHERE id = ?', (cid,)).fetchone()[0]) or {}
        want = 'archived' if act == 'class.archive' else 'active'
        if d.get('status', 'active') != want:
            if want == 'active' and c.execute("SELECT 1 FROM classes WHERE school = ? AND name = ? AND status = 'active' AND id != ?", (src[0], '%s%s' % (d.get('grade', ''), d.get('letter', '')), cid)).fetchone():
                raise AdminError(400, 'Такой класс уже есть.')
            d['status'], d['updated'] = want, max(now, num(d.get('updated')) + 1)
            c.execute('UPDATE classes SET status = ?, updated = ?, doc = ? WHERE id = ?', (want, d['updated'], json.dumps(d, ensure_ascii=False), cid))
            audit(c, who, act, 'class', cid, src[0], {'name': '%s%s' % (d.get('grade', ''), d.get('letter', '')), 'via': 'admin'})
        return {'ok': True}
    if act in ('trash.list', 'trash.restore'):
        # директор и выше — вся корзина общего содержимого (тесты, отзывы, комнаты) и свои школы; учитель — только свои тесты (по полю author)
        if p['kind'] != 'user':
            raise AdminError(403, 'Недостаточно прав.')
        mine_only = rank < 3
        if act == 'trash.list':
            kind = S('kind', 12)
            if kind and kind not in TRASH_KINDS:
                raise AdminError(400, 'Нет такого вида.')
            try:
                page = max(1, int(b.get('page', 1)))
                size = min(PAGE_MAX, max(1, int(b.get('size', 50))))
            except (TypeError, ValueError):
                raise AdminError(400, 'page и size — числа.')
            where, args = [], []
            if kind:
                where.append('kind = ?')
                args.append(kind)
            if S('school', 40):
                where.append('school = ?')
                args.append(S('school', 40))
            if mine_only:
                where.append("kind = 'test' AND json_extract(doc, '$.author') = ?")
                args.append(p['id'])
            elif rank < SUPER:
                ds = sorted(dir_schools(p))
                where.append("(kind IN ('test', 'feedback', 'room') OR school IN (%s))" % ','.join('?' * len(ds)))
                args += ds
            rows = c.execute('SELECT kind, id, school, doc, ts, actor_kind, actor_id, restored_at FROM trash' + (' WHERE ' + ' AND '.join(where) if where else '') + ' ORDER BY ts DESC, id LIMIT ? OFFSET ?',
                             args + [size + 1, (page - 1) * size]).fetchall()
            return {'items': [trash_item(*r_) for r_ in rows[:size]], 'page': page, 'size': size, 'more': len(rows) > size}
        kind, rid = S('kind', 12), S('id', 60)
        if kind not in TRASH_RESTORABLE:
            raise AdminError(400, 'Этот вид не возвращается.')
        row = c.execute('SELECT school, doc, restored_at FROM trash WHERE kind = ? AND id = ?', (kind, rid)).fetchone()
        d = load_doc(row[1]) if row else None
        if not d:
            raise AdminError(404, 'В корзине такого нет.')
        if mine_only and not (kind == 'test' and d.get('author') == p['id']):
            audit(c, who, 'admin.denied', 'trash', rid, None, {'why': 'scope', 'action': act})
            raise AdminError(403, 'Вернуть можно только свои тесты.')
        if row[2]:
            raise AdminError(400, 'Уже возвращено.')
        nid = None
        if kind == 'test':
            nid = 't-' + secrets.token_hex(6)
            d['id'], d['updated'] = nid, now
            c.execute('INSERT INTO tests(id, title, subj, updated, doc) VALUES(?, ?, ?, ?, ?)', (nid, str(d.get('title', ''))[:200], str(d.get('subj', '')), now, json.dumps(d, ensure_ascii=False)))
        elif kind == 'feedback':
            nid = 'f-' + secrets.token_hex(6)
            d['id'] = nid
            c.execute('INSERT INTO feedback(id, ts, kind, room, rating, text, doc) VALUES(?, ?, ?, ?, ?, ?, ?)',
                      (nid, num(d.get('ts')), str(d.get('kind', ''))[:20], str(d.get('room') or '')[:20], num(d.get('rating'), None), str(d.get('text', ''))[:1000], json.dumps(d, ensure_ascii=False)))
        else:
            st = get_settings(c)
            rooms = dict(st.get('rooms')) if isinstance(st.get('rooms'), dict) else {}
            if len(rooms) >= ROOMS_MAX:
                raise AdminError(400, 'Комнат уже %d: сначала уберите ненужные.' % ROOMS_MAX)
            nid = 'c-' + secrets.token_hex(6)
            d['id'], d['updated'] = nid, now
            rooms[nid] = d
            ct = dict(st.get('content')) if isinstance(st.get('content'), dict) else {}
            ct['rooms'] = dict(ct.get('rooms') or {}, **{nid: ''})
            st['rooms'], st['content'] = rooms, ct
            st['updated'] = max(now, num(st.get('updated')) + 1)
            c.execute('INSERT OR REPLACE INTO settings(id, updated, doc) VALUES(1, ?, ?)', (st['updated'], json.dumps(st, ensure_ascii=False)))
        c.execute('UPDATE trash SET restored_at = ? WHERE kind = ? AND id = ?', (now, kind, rid))
        audit(c, who, 'trash.restore', kind, nid, row[0], {'from': rid})
        return {'ok': True, 'id': nid}
    if act in ('purge.preview', 'backup.list', 'purge.mark', 'purge.unmark', 'purge.marks'):
        return purge_misc(c, p, sc, rank, act, b, now, who)
    raise AdminError(404, 'Нет такого действия.')


TRASH_KINDS = ('test', 'feedback', 'result', 'room', 'open_room')
TRASH_RESTORABLE = ('test', 'feedback', 'room')
ROOMS_MAX = 30  # RS.LIM.rooms в js/roomspec.js


def trash_item(kind, rid, school, raw, ts, actor_kind, actor_id, restored_at=None):
    """Строка корзины для списка: короткое описание, без самого документа (ни pinHash, ни pinView, ни sid)."""
    d = load_doc(raw) or {}
    if kind == 'test':
        title, extra = d.get('title'), {'author': d.get('author') or ''}
    elif kind == 'feedback':
        title, extra = d.get('text'), {'rating': d.get('rating')}
    elif kind == 'result':
        title, extra = d.get('subj'), {'score': d.get('score'), 'total': d.get('total')}
    else:
        title, extra = d.get('title'), {}
    return dict({'kind': kind, 'id': rid, 'school': school, 'title': str(title or '')[:120], 'ts': ts, 'by': actor_kind, 'restored_at': restored_at}, **extra)


# ---------- поиск и фильтры (шаг 8 PLAN.md): только доступное принципалу, страницы, без хэшей ----------
PAGE_MAX = 100


# ---- Б74 шаг 25: окончательное стирание (только суперадмин), пометки на стирание, список копий ----
PURGE_KINDS = ('student', 'class', 'school', 'upload', 'trash', 'reset')  # вида user нет: стирание учёток владелец ещё не решил (Б74.8)
MARK_KINDS = ('student', 'class', 'school', 'upload', 'trash')
PURGE_MAX_IDS = 50
PURGE_LEFT = {'classes': 'классов', 'students': 'учеников', 'roles': 'ролей', 'devices': 'шлемов', 'uploads': 'файлов', 'open_rooms': 'комнат'}
DAY_MS = 86400000
BAK_RE = re.compile(r'^' + re.escape(os.path.basename(DB_PATH)) + r'\.bak-purge-(\d{8})-(\d{6})(?:-\d+)?$')


def purge_info(c, kind, oid):
    """Что за объект: {'school', 'name', 'archived', 'since' (мс, когда ушёл в архив/корзину), ...} или None, если такого нет. Для проверки прав, пометок и стирания."""
    if kind == 'student':
        r = c.execute('SELECT status, updated, school, name, doc FROM students WHERE id = ?', (oid,)).fetchone()
        if not r:
            return None
        return {'archived': r[0] == 'archived', 'since': num(r[1]), 'school': r[2], 'name': r[3] or '', 'doc': load_doc(r[4]) or {}}
    if kind == 'class':
        r = c.execute('SELECT status, updated, school, teacherId, doc FROM classes WHERE id = ?', (oid,)).fetchone()
        if not r:
            return None
        d = load_doc(r[4]) or {}
        return {'archived': r[0] == 'archived', 'since': num(r[1]), 'school': r[2], 'teacher': r[3], 'name': '%s%s' % (d.get('grade', ''), d.get('letter', ''))}
    if kind == 'school':
        r = c.execute('SELECT status, updated, name FROM schools WHERE id = ?', (oid,)).fetchone()
        if not r:
            return None
        since = None
        if r[0] == 'archived':
            a = c.execute("SELECT MAX(ts) FROM audit_log WHERE action = 'school.update' AND target_kind = 'school' AND target_id = ? AND json_extract(detail, '$.status') = 'archived'", (oid,)).fetchone()[0]
            since = num(a) if a else num(r[1])
        return {'archived': r[0] == 'archived', 'since': since, 'school': oid, 'name': r[2] or ''}
    if kind == 'upload':
        r = c.execute('SELECT school, name, archived_at, owner, ext, size FROM uploads WHERE id = ?', (oid,)).fetchone()
        if not r:
            return None
        return {'archived': r[2] is not None, 'since': r[2], 'school': r[0], 'name': r[1] or '', 'owner': r[3], 'ext': r[4], 'size': num(r[5])}
    if kind == 'trash':
        tk, _, tid = oid.partition(':')
        r = c.execute('SELECT school, doc, ts FROM trash WHERE kind = ? AND id = ?', (tk, tid)).fetchone() if tk in TRASH_KINDS and tid else None
        if not r:
            return None
        d = load_doc(r[1]) or {}
        return {'archived': True, 'since': num(r[2]), 'school': r[0], 'name': str(d.get('title') or tk)[:60], 'tkind': tk, 'tid': tid, 'author': d.get('author')}
    return None


def purge_student_counts(c, sid):
    return {'results': c.execute('SELECT COUNT(*) FROM results WHERE sid = ?', (sid,)).fetchone()[0], 'disc': c.execute('SELECT COUNT(*) FROM disc WHERE sid = ?', (sid,)).fetchone()[0],
            'feedback_anonymized': c.execute("SELECT COUNT(*) FROM feedback WHERE json_extract(doc, '$.sid') = ?", (sid,)).fetchone()[0]}


def purge_plan(c, b, now, hold_days):
    """Разбор запроса стирания без записи в базу (общий для preview и purge: счётчики совпадают). Пакет — один вид, до 50 id.
    Возвращает {'kind', 'items', 'total', 'hold_days'}; у каждого item: err (код, текст) или None, from (мс: с этой даты можно стирать), counts."""
    kind = str(b.get('kind') or '')[:12]
    if kind == 'user':
        raise AdminError(400, 'Стирание учёток пока не предусмотрено.')
    if kind not in PURGE_KINDS:
        raise AdminError(400, 'Вид: ' + ', '.join(PURGE_KINDS) + '.')
    ids = [None] if kind == 'reset' else b.get('ids')
    if not isinstance(ids, list) or not 1 <= len(ids) <= PURGE_MAX_IDS or (kind != 'reset' and not all(isinstance(i, str) and 0 < len(i) <= 80 for i in ids)):
        raise AdminError(400, 'ids: от 1 до %d строк.' % PURGE_MAX_IDS)
    ids = list(dict.fromkeys(ids))
    hold = hold_days * DAY_MS
    items = []
    for oid in ids:
        it = {'id': oid, 'kind': kind, 'counts': {}, 'err': None, 'from': None}
        if kind == 'reset':
            reset = num(get_settings(c).get('resetAt'))
            it['reset'] = reset
            it['counts'] = {'results': c.execute('SELECT COUNT(*) FROM results WHERE ts < ?', (reset,)).fetchone()[0], 'disc': c.execute('SELECT COUNT(*) FROM disc WHERE ts < ?', (reset,)).fetchone()[0]}
            if reset <= 0:
                it['err'] = (400, 'Очистки результатов не было.')
            elif not any(it['counts'].values()):
                it['err'] = (400, 'Стирать нечего.')
            else:
                it['from'] = reset + hold
        else:
            info = purge_info(c, kind, oid)
            if not info:
                it['err'] = (404, 'Объекта нет.')
            elif kind == 'school' and oid == DEFAULT_SCHOOL:
                it['err'] = (400, 'Школу по умолчанию стирать нельзя.')
            elif not info['archived']:
                it['err'] = (400, 'Стирать можно только то, что уже в архиве или в корзине.')
            else:
                it['school'], it['from'] = info['school'], num(info['since']) + hold
                if kind == 'student':
                    it['counts'] = purge_student_counts(c, oid)
                elif kind == 'class':
                    it['name'] = info['name']
                    sts = c.execute("SELECT id, status, updated FROM students WHERE json_extract(doc, '$.classId') = ?", (oid,)).fetchall()
                    live = sum(1 for s_ in sts if s_[1] != 'archived')
                    if live:
                        it['err'] = (400, 'В классе есть действующие ученики: %d.' % live)
                    it['students'] = [s_[0] for s_ in sts]
                    it['counts'] = {'students': len(sts), 'results': 0, 'disc': 0, 'feedback_anonymized': 0}
                    for s_ in sts:
                        for k_, v_ in purge_student_counts(c, s_[0]).items():
                            it['counts'][k_] += v_
                        it['from'] = max(it['from'], num(s_[2]) + hold)
                elif kind == 'school':
                    it['name'] = info['name']
                    cnt = {'classes': c.execute('SELECT COUNT(*) FROM classes WHERE school = ?', (oid,)).fetchone()[0],
                           'students': c.execute('SELECT COUNT(*) FROM students WHERE school = ?', (oid,)).fetchone()[0],
                           'roles': c.execute("SELECT COUNT(*) FROM user_roles WHERE school = ? AND status = 'active'", (oid,)).fetchone()[0],
                           'devices': c.execute("SELECT COUNT(*) FROM devices WHERE school = ? AND status = 'active'", (oid,)).fetchone()[0],
                           'uploads': c.execute('SELECT COUNT(*) FROM uploads WHERE school = ?', (oid,)).fetchone()[0],
                           'open_rooms': c.execute('SELECT COUNT(*) FROM open_rooms WHERE school = ?', (oid,)).fetchone()[0]}
                    left = {k_: v_ for k_, v_ in cnt.items() if v_}
                    if left:
                        it['err'] = (400, 'Школа не пуста: ' + ', '.join('%s %d' % (PURGE_LEFT[k_], v_) for k_, v_ in left.items()) + '.')
                        it['left'] = left
                elif kind == 'upload':
                    it['counts'] = {'bytes': info['size']}
                    ext = str(info['ext'] or '')
                    if re.match(r'^[a-z0-9]{1,6}$', ext) and re.match(r'^[a-z0-9]{1,40}$', oid):
                        it['file'] = os.path.join(UPLOAD_DIR, '%s.%s' % (oid, ext))
                else:
                    it['tkind'], it['tid'] = info['tkind'], info['tid']
        if not it['err'] and it['from'] is not None and it['from'] > now:
            it['err'] = (400, 'Выдержка в архиве: осталось %d дн.' % (-(-(it['from'] - now) // DAY_MS)))
        items.append(it)
    total = {}
    for it in items:
        for k_, v_ in it['counts'].items():
            total[k_] = total.get(k_, 0) + v_
    return {'kind': kind, 'items': items, 'total': total, 'hold_days': hold_days}


def purge_item_public(it):
    out = {'id': it['id'], 'ok': it['err'] is None, 'from': it['from'], 'counts': it['counts']}
    if it['err']:
        out['error'] = it['err'][1]
    if it.get('name') and it['kind'] in ('class', 'school'):
        out['name'] = it['name']
    if it.get('left'):
        out['left'] = it['left']
    return out


def purge_hard(c, oid, kind, now):
    c.execute('INSERT OR IGNORE INTO purged(id, ts, kind) VALUES(?, ?, ?)', (oid, now, kind))
    c.execute('INSERT OR REPLACE INTO deleted(id, ts) VALUES(?, ?)', (oid, now))


def purge_erase_student(c, sid, now):
    """Стирает ученика и всё его: результаты, открытия, корзину результатов; в отзывах (и в корзине отзывов) убирает sid. Возвращает фактические счётчики."""
    out = {'results': c.execute('DELETE FROM results WHERE sid = ?', (sid,)).rowcount, 'disc': c.execute('DELETE FROM disc WHERE sid = ?', (sid,)).rowcount, 'feedback_anonymized': 0}
    c.execute("DELETE FROM trash WHERE kind = 'result' AND json_extract(doc, '$.sid') = ?", (sid,))
    for fid, raw in c.execute("SELECT id, doc FROM feedback WHERE json_extract(doc, '$.sid') = ?", (sid,)).fetchall():
        d = load_doc(raw) or {}
        d.pop('sid', None)
        c.execute('UPDATE feedback SET doc = ? WHERE id = ?', (json.dumps(d, ensure_ascii=False), fid))
        out['feedback_anonymized'] += 1
    for tk, tid, raw in c.execute("SELECT kind, id, doc FROM trash WHERE json_extract(doc, '$.sid') = ?", (sid,)).fetchall():
        d = load_doc(raw) or {}
        d.pop('sid', None)
        c.execute('UPDATE trash SET doc = ? WHERE kind = ? AND id = ?', (json.dumps(d, ensure_ascii=False), tk, tid))
    c.execute('DELETE FROM students WHERE id = ?', (sid,))
    purge_hard(c, sid, 'student', now)
    c.execute("DELETE FROM purge_marks WHERE kind = 'student' AND id = ?", (sid,))
    return out


def purge_run(c, who, plan, backup, now):
    """Само стирание: вызывать под lock в одной транзакции (исключение -> откат). Аудит — по строке на объект, без ФИО. Возвращает фактические суммарные счётчики."""
    total = {}
    kind = plan['kind']
    for it in plan['items']:
        oid, sch = it['id'], it.get('school')
        det = {'backup': backup}
        if kind == 'student':
            det.update(purge_erase_student(c, oid, now))
        elif kind == 'class':
            det.update({'students': 0, 'results': 0, 'disc': 0, 'feedback_anonymized': 0, 'name': it['name']})
            for sid in it['students']:
                r = purge_erase_student(c, sid, now)
                det['students'] += 1
                for k_, v_ in r.items():
                    det[k_] += v_
                audit(c, who, 'purge', 'student', sid, sch, dict(r, via='class', backup=backup))
            c.execute('DELETE FROM classes WHERE id = ?', (oid,))
            purge_hard(c, oid, 'class', now)
            c.execute("DELETE FROM purge_marks WHERE kind = 'class' AND id = ?", (oid,))
        elif kind == 'school':
            det['name'] = it['name']
            c.execute("DELETE FROM devices WHERE school = ? AND status = 'revoked'", (oid,))
            c.execute('DELETE FROM pair_codes WHERE school = ?', (oid,))
            c.execute('DELETE FROM schools WHERE id = ?', (oid,))
            c.execute("DELETE FROM purge_marks WHERE kind = 'school' AND id = ?", (oid,))
        elif kind == 'upload':
            det['bytes'] = it['counts']['bytes']
            if not it.get('file') or not os.path.exists(it['file']):
                det['file'] = 'missing'
            c.execute('DELETE FROM uploads WHERE id = ?', (oid,))
            c.execute("DELETE FROM purge_marks WHERE kind = 'upload' AND id = ?", (oid,))
        elif kind == 'trash':
            c.execute('DELETE FROM trash WHERE kind = ? AND id = ?', (it['tkind'], it['tid']))
            if it['tkind'] in ('test', 'feedback', 'result'):
                purge_hard(c, it['tid'], it['tkind'], now)
            c.execute("DELETE FROM purge_marks WHERE kind = 'trash' AND id = ?", (oid,))
        else:  # reset
            det['results'] = c.execute('DELETE FROM results WHERE ts < ?', (it['reset'],)).rowcount
            det['disc'] = c.execute('DELETE FROM disc WHERE ts < ?', (it['reset'],)).rowcount
        audit(c, who, 'purge', kind, oid if kind != 'reset' else 'reset', sch, det)
        for k_, v_ in det.items():
            if isinstance(v_, int):
                total[k_] = total.get(k_, 0) + v_
    return total


def purge_exec(p, body, ip, now):
    """POST /api/admin/purge после проверки прав и пароля. Под lock: разбор -> проверка места -> копия базы -> одна транзакция стирания -> файлы. Возвращает (код, ответ)."""
    who = ('user', p['id'], ip)
    cfg = load_config()

    def failed(code, msg, why):
        try:
            with db() as c:
                audit(c, who, 'purge.failed', 'purge', str(body.get('kind') or '')[:12], None, {'why': why})
        except sqlite3.Error:
            pass
        return code, {'error': msg}
    with lock:
        try:
            with db() as c:
                c.execute('DELETE FROM login_fail WHERE k = ?', ('u:adm:' + p['login'],))
                plan = purge_plan(c, body, now, cfg['purgeHoldDays'])
        except AdminError as e:
            return e.code, {'error': e.msg}
        except sqlite3.Error:
            return 500, {'error': 'database error'}
        for it in plan['items']:
            if it['err']:
                return it['err'][0], {'error': it['err'][1]}
        try:
            if shutil.disk_usage(DATA).free <= 2 * os.path.getsize(DB_PATH):
                return failed(507, 'Мало места для копии, стирание отменено.', 'space')
        except OSError:
            return failed(500, 'Не удалось проверить место для копии, стирание отменено.', 'space')
        try:
            name = os.path.basename(backup_db('purge'))
        except Exception:
            return failed(500, 'Не удалось сделать копию базы, стирание отменено.', 'backup')
        try:
            with db() as c:
                total = purge_run(c, who, plan, name, now)
        except Exception:
            return failed(500, 'Стирание не выполнено: база не изменена. Копия: ' + name, 'run')
        lost = []
        for it in plan['items']:
            if it.get('file'):
                try:
                    os.remove(it['file'])
                except OSError:
                    lost.append(it['id'])
        if lost:
            try:
                with db() as c:
                    for oid in lost:
                        audit(c, who, 'purge.file_failed', 'upload', oid, None, {'file': 'missing'})
            except sqlite3.Error:
                pass
    return 200, {'ok': True, 'purged': len(plan['items']), 'backup': name, 'total': total}


def purge_mark_ok(c, p, sc, rank, kind, info):
    """Права на пометку = права на сам объект (как у его архивации): учитель — свои классы/ученики и свои тесты, директор — школа, выше — по scope."""
    if rank >= SUPER:
        return True
    sch = info['school']
    if kind == 'student':
        return student_in_scope(c, sc, info['doc']) or sch in dir_schools(p)
    if kind == 'class':
        return class_in_scope(sc, sch, info['teacher']) or sch in dir_schools(p)
    if kind == 'school':
        return sch in sc['dir']
    if kind == 'upload':
        return info['owner'] == p['id'] or sch in sc['dir']
    return (info['tkind'] == 'test' and info['author'] == p['id']) or (rank >= 3 and (info['tkind'] in ('test', 'feedback', 'room') or sch in sc['dir']))


def purge_misc(c, p, sc, rank, act, b, now, who):
    S = lambda k, n=80: str(b.get(k) or '')[:n]  # noqa: E731
    if act in ('purge.preview', 'backup.list'):
        if rank < SUPER or p['kind'] != 'user':
            audit(c, who, 'admin.denied', 'admin', act, None, {'why': 'rank'})
            raise AdminError(403, 'Только суперадмин.')
        if act == 'purge.preview':
            cfg = load_config()
            if not cfg['purge']:
                raise AdminError(404, 'not found')
            plan = purge_plan(c, b, now, cfg['purgeHoldDays'])
            return {'ok': True, 'kind': plan['kind'], 'items': [purge_item_public(it) for it in plan['items']], 'total': plan['total'], 'hold_days': plan['hold_days'],
                    'can': all(it['err'] is None for it in plan['items'])}
        items, old = [], now - int(PURGE_KEEP_YEARS * 365.25 * DAY_MS)
        for fn in os.listdir(DATA):
            m = BAK_RE.match(fn)
            if not m:
                continue
            ts = calendar.timegm(time.strptime(m.group(1) + m.group(2), '%Y%m%d%H%M%S')) * 1000
            try:
                size = os.path.getsize(os.path.join(DATA, fn))
            except OSError:
                size = 0
            items.append({'name': fn, 'ts': ts, 'size': size, 'expired': ts < old})
        items.sort(key=lambda x: (-x['ts'], x['name']))
        return {'ok': True, 'items': items, 'expired': sum(1 for i in items if i['expired'])}
    if act in ('purge.mark', 'purge.unmark'):
        kind, oid = S('kind', 12), S('id')
        if kind not in MARK_KINDS or not oid:
            raise AdminError(400, 'Вид: ' + ', '.join(MARK_KINDS) + '; нужен id.')
        row = c.execute('SELECT school, "by" FROM purge_marks WHERE kind = ? AND id = ?', (kind, oid)).fetchone()
        if act == 'purge.unmark':
            if not row:
                raise AdminError(404, 'Пометки нет.')
            sch = row[0]
            if not (row[1] == p['id'] or rank >= SUPER or (rank >= 3 and sch in sc['dir'])):
                audit(c, who, 'admin.denied', kind, oid, sch, {'why': 'scope', 'action': act})
                raise AdminError(403, 'Снять пометку может тот, кто её поставил, или старший.')
            c.execute('DELETE FROM purge_marks WHERE kind = ? AND id = ?', (kind, oid))
            audit(c, who, 'purge.unmark', kind, oid, sch, {})
            return {'ok': True}
        info = purge_info(c, kind, oid)
        if not info:
            raise AdminError(404, 'Объекта нет.')
        if kind == 'school' and oid == DEFAULT_SCHOOL:
            raise AdminError(400, 'Школу по умолчанию стирать нельзя.')
        if not purge_mark_ok(c, p, sc, rank, kind, info):
            audit(c, who, 'admin.denied', kind, oid, info['school'], {'why': 'scope', 'action': act})
            raise AdminError(403, 'Это не ваш объект.')
        if row:
            return {'ok': True, 'already': True}
        why = S('why', 200).strip()
        c.execute('INSERT INTO purge_marks(kind, id, school, "by", ts, why) VALUES(?, ?, ?, ?, ?, ?)', (kind, oid, info['school'], p['id'], now, why))
        audit(c, who, 'purge.mark', kind, oid, info['school'], {'why': why, 'status': 'archived' if info['archived'] else 'active'})
        return {'ok': True}
    # purge.marks: суперадмин — все, остальные — свои школы; учитель — только свои пометки
    try:
        page = max(1, int(b.get('page', 1)))
        size = min(PAGE_MAX, max(1, int(b.get('size', 50))))
    except (TypeError, ValueError):
        raise AdminError(400, 'page и size — числа.')
    where, args = [], []
    sch = S('school', 40)
    if rank < SUPER:
        allowed = scope_schools(c, sc)
        if sch and sch not in allowed:
            audit(c, who, 'admin.denied', 'school', sch, None, {'why': 'scope', 'action': act})
            raise AdminError(403, 'Это чужая школа.')
        use = [sch] if sch else sorted(allowed)
        where.append('school IN (%s)' % ','.join('?' * len(use)))
        args += use
        if rank < 3:
            where.append('"by" = ?')
            args.append(p['id'])
    elif sch:
        where.append('school = ?')
        args.append(sch)
    rows = c.execute('SELECT kind, id, school, "by", ts, why FROM purge_marks' + (' WHERE ' + ' AND '.join(where) if where else '') + ' ORDER BY ts DESC, id LIMIT ? OFFSET ?',
                     args + [size + 1, (page - 1) * size]).fetchall()
    hold = load_config()['purgeHoldDays'] * DAY_MS
    out = []
    for k, i, s_, by, ts, why in rows[:size]:
        info = purge_info(c, k, i)
        u = c.execute("SELECT COALESCE(NULLIF(name, ''), login) FROM users WHERE id = ?", (by,)).fetchone()
        out.append({'kind': k, 'id': i, 'school': s_, 'by': u[0] if u else '', 'by_id': by, 'ts': ts, 'why': why or '', 'name': info['name'] if info else '',
                    'state': 'gone' if not info else 'archived' if info['archived'] else 'active', 'from': num(info['since']) + hold if info and info['archived'] and info['since'] is not None else None})
    return {'items': out, 'page': page, 'size': size, 'more': len(rows) > size}


def like_esc(q):
    return q.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')


def scope_schools(c, sc):
    """Школы, видимые принципалу: суперадмин — все, директор и учитель — свои."""
    if sc['all']:
        return {r[0] for r in c.execute('SELECT id FROM schools')}
    return set(sc['dir']) | set(sc['tch'])


def visible_classes(c, sc, school=None):
    out = []
    for cid, sch, tid, raw in c.execute('SELECT id, school, teacherId, doc FROM classes'):
        if school and sch != school:
            continue
        if class_in_scope(sc, sch, tid):
            d = load_doc(raw) or {}
            out.append({'id': cid, 'name': '%s%s' % (d.get('grade', ''), d.get('letter', '')), 'school': sch, 'teacherId': tid, 'status': d.get('status', 'active')})
    return out


def options_api(c, p, q):
    sc = scope(c, p)
    level = q.get('level', 'school')
    parent = (q.get('parent') or '')[:60]
    schools = scope_schools(c, sc)
    if level == 'region':
        regs = sorted({r[0] for r in c.execute('SELECT region FROM schools WHERE id IN (%s)' % ','.join('?' * len(schools)), tuple(schools))} if schools else [])
        return {'items': [{'id': r, 'name': r or 'Без региона'} for r in regs]}
    if level == 'district':
        rows = c.execute('SELECT id, region, district FROM schools').fetchall()
        ds = sorted({d for i, rg, d in rows if i in schools and rg == parent})
        return {'items': [{'id': d, 'name': d or 'Без района'} for d in ds]}
    if level == 'school':
        dist = q.get('district')
        dist = None if dist is None else dist[:60]
        rows = c.execute('SELECT id, name, region, status, district FROM schools ORDER BY name').fetchall()
        return {'items': [{'id': i, 'name': n, 'region': rg, 'district': d, 'status': st} for i, n, rg, st, d in rows if i in schools and (not q.get('parent') or rg == parent) and (not dist or d == dist)]}
    if level == 'class':
        if parent not in schools:
            return {'items': []}
        return {'items': sorted(({'id': k['id'], 'name': k['name'], 'teacherId': k['teacherId']} for k in visible_classes(c, sc, parent)), key=lambda x: x['name'])}
    if level == 'teacher':
        if parent not in schools:
            return {'items': []}
        if not (sc['all'] or parent in sc['dir']):  # учитель видит в списке только себя
            u = user_row(c, p['id'])
            return {'items': [{'id': u['id'], 'name': u['name'] or u['login'], 'login': u['login']}]}
        rows = c.execute("SELECT u.id, u.name, u.login FROM users u JOIN user_roles ur ON ur.user_id = u.id WHERE ur.role = 'teacher' AND ur.school = ? AND ur.status = 'active' AND u.status = 'active' ORDER BY u.name", (parent,)).fetchall()
        return {'items': [{'id': i, 'name': n or lg, 'login': lg} for i, n, lg in rows]}
    raise AdminError(400, 'level: region, district, school, class или teacher.')


HISTORY_KINDS = ('all', 'user', 'student', 'class', 'school', 'device', 'upload', 'room')
HISTORY_DETAIL = ('role', 'name', 'from', 'to', 'status', 'students', 'results', 'count', 'keys', 'by', 'via', 'why', 'action', 'classId', 'had', 'title', 'auto', 'device_limit', 'truncated', 'disc', 'feedback_anonymized')


def history_api(c, p, q):
    """GET /api/history (Б74.2, Б74.8): журнал школы. Суперадмин и директор (его школы) — всё; учитель — только student/class из своих классов; остальные 403.
    ip отдаётся только суперадмину; detail — по белому списку."""
    if not p or p.get('kind') != 'user':
        raise AdminError(403, 'История доступна только пользователям с учётной записью.')
    sc = scope(c, p)
    school = (q.get('school') or '')[:60]
    if not school:
        raise AdminError(400, 'Нужен параметр school.')
    kind = q.get('kind') or 'all'
    if kind not in HISTORY_KINDS:
        raise AdminError(400, 'kind: ' + ', '.join(HISTORY_KINDS) + '.')
    try:
        page = max(1, int(q.get('page', 1)))
        size = min(PAGE_MAX, max(1, int(q.get('size', 50))))
        t_from = int(q['from']) if q.get('from') else None
        t_to = int(q['to']) if q.get('to') else None
    except ValueError:
        raise AdminError(400, 'page, size, from и to — числа.')
    if page > 1000 or any(t is not None and not 0 <= t <= 10 ** 14 for t in (t_from, t_to)):
        raise AdminError(400, 'page не больше 1000, from и to — миллисекунды от 0 до 10^14.')
    is_super = sc['all']
    teacher_only = False
    if school == '-':
        if not is_super:
            raise AdminError(403, 'Нет доступа.')
        where, par = "(school IS NULL OR school = '')", []
    else:
        if school not in scope_schools(c, sc):
            raise AdminError(403, 'Нет доступа к этой школе.')
        if is_super or school in sc['dir']:
            where = '(school = ? OR (target_kind = \'user\' AND (school IS NULL OR school = \'\') AND target_id IN (SELECT user_id FROM user_roles WHERE school = ?)))'
            par = [school, school]
        else:  # учитель: только ученики и классы его классов
            teacher_only = True
            mine = '(SELECT id FROM classes WHERE teacherId = ? AND school = ?)'
            where = "school = ? AND ((target_kind = 'class' AND target_id IN %s) OR (target_kind = 'student' AND target_id IN (SELECT id FROM students WHERE json_extract(doc, '$.classId') IN %s)))" % (mine, mine)
            par = [school, p['id'], school, p['id'], school]
    if kind != 'all':
        if teacher_only and kind not in ('student', 'class'):
            return {'items': [], 'page': page, 'size': size, 'more': False}
        where += ' AND target_kind = ?'
        par.append(kind)
    if t_from is not None:
        where += ' AND ts >= ?'
        par.append(t_from)
    if t_to is not None:
        where += ' AND ts <= ?'
        par.append(t_to)
    rows = c.execute('SELECT ts, action, target_kind, target_id, actor_kind, actor_id, detail, ip FROM audit_log WHERE ' + where +
                     ' ORDER BY ts DESC, id DESC LIMIT ? OFFSET ?', par + [size + 1, (page - 1) * size]).fetchall()
    more = len(rows) > size
    rows = rows[:size]

    def names(table, ids, f):
        ids = sorted({i for i in ids if i})
        if not ids:
            return {}
        return {r[0]: f(r) for r in c.execute('SELECT %s FROM %s WHERE id IN (%s)' % ('id, doc' if table in ('students', 'classes') else 'id, name, login' if table == 'users' else 'id, name', table, ','.join('?' * len(ids))), ids)}
    tg = lambda k: [r[3] for r in rows if r[2] == k]  # noqa: E731
    def stu(r):
        return (load_doc(r[1]) or {}).get('name', '')

    def cls_name(r):
        d0 = load_doc(r[1]) or {}
        return '%s%s' % (d0.get('grade', ''), d0.get('letter', ''))
    nm = {'student': names('students', tg('student'), stu), 'class': names('classes', tg('class'), cls_name),
          'user': names('users', tg('user') + [r[5] for r in rows if r[4] == 'user'], lambda r: (r[1], r[2])),
          'school': names('schools', tg('school'), lambda r: r[1])}
    items = []
    for ts, action, tk, tid, ak, aid, det, ip in rows:
        d = load_doc(det) if det else {}
        d = d if isinstance(d, dict) else {}
        if ak == 'user':
            actor = nm['user'].get(aid, ('', ''))
            actor = actor[0] or actor[1]
        else:
            actor = {'legacy-teacher': 'ключ учителя', 'device': 'шлем'}.get(ak, 'сервер')
        it = {'ts': ts, 'action': action, 'kind': tk or '', 'target': tid or '', 'name': (nm.get(tk, {}).get(tid, '') or ('', ''))[0] if tk == 'user' else nm.get(tk, {}).get(tid, ''), 'actor': actor,
              'detail': {k: d[k] for k in HISTORY_DETAIL if k in d}}
        if is_super:
            it['ip'] = ip or ''
        items.append(it)
    return {'items': items, 'page': page, 'size': size, 'more': more}


def role_status_sql(st):
    """Список статусов учётки (users.status) для фильтра status (константы, не ввод): по умолчанию только действующие. user.archive меняет только users.status, роли остаются active."""
    return "'active', 'archived'" if st == 'all' else "'archived'" if st == 'archived' else "'active'"


def accounts_api(c, p, q):
    sc = scope(c, p)
    kind = q.get('kind', 'students')
    try:
        page = max(1, int(q.get('page', 1)))
        size = min(PAGE_MAX, max(1, int(q.get('size', 50))))
    except ValueError:
        raise AdminError(400, 'page и size — числа.')
    text = (q.get('q') or '')[:40].strip()
    st_q = q.get('status')  # Б74: active | archived | all; не задан — как раньше (классы и ученики без фильтра, учителя и администраторы — только действующие)
    if st_q is not None and st_q not in ('active', 'archived', 'all'):
        raise AdminError(400, 'status: active, archived или all.')
    schools = scope_schools(c, sc)
    want_school = q.get('school') or None
    if want_school and want_school not in schools:
        return {'items': [], 'total': 0, 'page': page, 'size': size}
    if q.get('region'):
        rs = {r[0] for r in c.execute('SELECT id FROM schools WHERE region = ?', (q['region'][:60],))}
        schools = schools & rs
    if q.get('district'):
        rs = {r[0] for r in c.execute('SELECT id FROM schools WHERE district = ?', (q['district'][:60],))}
        schools = schools & rs
    if want_school:
        schools = {want_school}
    if kind == 'classes':
        cls = [k for k in visible_classes(c, sc) if k['school'] in schools and (not q.get('teacher') or k['teacherId'] == q['teacher']) and st_q in (None, 'all', k['status'])]
        if text:
            cls = [k for k in cls if text.lower() in k['name'].lower()]
        cls.sort(key=lambda k: (k['school'], k['name']))
        cnt = {}
        for (cid,) in c.execute("SELECT json_extract(doc, '$.classId') FROM students"):
            cnt[cid] = cnt.get(cid, 0) + 1
        tot = len(cls)
        part = cls[(page - 1) * size:page * size]
        tn = {r[0]: r[1] or r[2] for r in c.execute('SELECT id, name, login FROM users WHERE id IN (%s)' % ','.join('?' * len({k['teacherId'] for k in part if k['teacherId']})), tuple({k['teacherId'] for k in part if k['teacherId']}))} if any(k['teacherId'] for k in part) else {}
        return {'items': [dict(k, students=cnt.get(k['id'], 0), teacherName=tn.get(k['teacherId'], '')) for k in part], 'total': tot, 'page': page, 'size': size}
    if kind == 'admins':
        rank = my_rank(p)
        if rank < RANK['district_admin']:
            raise AdminError(403, 'Список администраторов доступен администраторам региона и района и суперадмину.')
        want = q.get('role') or ''
        by_user = {}
        for uid, role, sch in c.execute("SELECT ur.user_id, ur.role, ur.school FROM user_roles ur JOIN users u ON u.id = ur.user_id WHERE ur.status = 'active' AND u.status IN (%s) AND ur.role IN ('superadmin', 'region_admin', 'district_admin', 'director')" % role_status_sql(st_q)):
            if want and role != want:
                continue
            if role == 'director' and sch not in schools:
                continue
            kp = key_parts(sch) if role in SCOPE_ROLES else None
            if role == 'region_admin' and (rank < SUPER or want_school or (q.get('region') and kp[0] != q['region'][:60])):
                continue
            if role == 'district_admin' and (rank < RANK['region_admin'] or want_school or (rank < SUPER and kp[0] not in region_keys(p)) or (q.get('region') and kp[0] != q['region'][:60]) or (q.get('district') and kp[1] != q['district'][:60])):
                continue
            if role == 'superadmin' and (rank < SUPER or want_school or q.get('region')):
                continue
            by_user.setdefault(uid, []).append({'role': role, 'school': sch, 'region': kp[0] if kp else None, 'district': kp[1] if kp else None})
        rows = []
        for uid, rl in by_user.items():
            u = user_row(c, uid)
            if u and (not text or text.lower() in (u['name'] or '').lower() or text.lower() in u['login'].lower()):
                rows.append({'id': uid, 'login': u['login'], 'name': u['name'], 'status': u['status'], 'roles': rl})
        rows.sort(key=lambda r: (-max(RANK[x['role']] for x in r['roles']), r['name'] or r['login']))
        return {'items': rows[(page - 1) * size:page * size], 'total': len(rows), 'page': page, 'size': size}
    if kind == 'teachers':
        if not (sc['all'] or sc['dir']):
            raise AdminError(403, 'Список учителей доступен директору.')
        ok_sch = schools if sc['all'] else schools & sc['dir']
        if not ok_sch:
            return {'items': [], 'total': 0, 'page': page, 'size': size}
        ph = ','.join('?' * len(ok_sch))
        where = "ur.role = 'teacher' AND ur.status = 'active' AND u.status IN (%s) AND ur.school IN (%s)" % (role_status_sql(st_q), ph)
        args = list(ok_sch)
        if text:
            where += " AND (u.name LIKE ? ESCAPE '\\' OR u.login LIKE ? ESCAPE '\\')"
            args += ['%' + like_esc(text) + '%'] * 2
        tot = c.execute('SELECT count(DISTINCT u.id) FROM users u JOIN user_roles ur ON ur.user_id = u.id WHERE ' + where, args).fetchone()[0]
        rows = c.execute('SELECT DISTINCT u.id, u.login, u.name, u.status FROM users u JOIN user_roles ur ON ur.user_id = u.id WHERE ' + where + ' ORDER BY u.name, u.login LIMIT ? OFFSET ?', args + [size, (page - 1) * size]).fetchall()
        return {'items': [{'id': i, 'login': lg, 'name': nm, 'status': st, 'roles': user_roles(c, i)} for i, lg, nm, st in rows], 'total': tot, 'page': page, 'size': size}
    if kind != 'students':
        raise AdminError(400, 'kind: students, teachers, classes или admins.')
    cls = {k['id']: k for k in visible_classes(c, sc) if k['school'] in schools}
    if q.get('class'):
        cls = {k: v for k, v in cls.items() if k == q['class']}
    if q.get('teacher'):
        cls = {k: v for k, v in cls.items() if v['teacherId'] == q['teacher']}
    narrowed = bool(q.get('class') or q.get('teacher'))
    where, args = [], []
    if cls:
        where.append("json_extract(doc, '$.classId') IN (%s)" % ','.join('?' * len(cls)))
        args += list(cls)
    loose = [s_ for s_ in (schools if sc['all'] else schools & sc['dir'])] if not narrowed else []
    if loose:
        where.append("(json_extract(doc, '$.classId') IS NULL AND school IN (%s))" % ','.join('?' * len(loose)))
        args += loose
    if not where:
        return {'items': [], 'total': 0, 'page': page, 'size': size}
    cond = '(' + ' OR '.join(where) + ')'
    if st_q in ('active', 'archived'):
        cond += ' AND status = ?'
        args.append(st_q)
    if text:
        cond += " AND name LIKE ? ESCAPE '\\'"
        args.append('%' + like_esc(text) + '%')
    tot = c.execute('SELECT count(*) FROM students WHERE ' + cond, args).fetchone()[0]
    rows = c.execute("SELECT id, name, grade, school, status, json_extract(doc, '$.classId'), json_extract(doc, '$.pinHash') IS NOT NULL FROM students WHERE " + cond + ' ORDER BY name, id LIMIT ? OFFSET ?', args + [size, (page - 1) * size]).fetchall()
    return {'items': [{'id': i, 'name': n, 'grade': g, 'school': sch, 'status': st, 'classId': cl, 'className': (cls.get(cl) or {}).get('name'), 'hasPin': bool(hp)} for i, n, g, sch, st, cl, hp in rows], 'total': tot, 'page': page, 'size': size}


def cli(argv):
    """Команды суперадмина на сервере: пароль только через getpass (не в аргументах, не в истории оболочки, А14)."""
    cmd = argv[0] if argv else ''
    who = ('cli', 'cli', '')
    init_db()
    if cmd in ('create-superadmin', 'reset-password') and len(argv) == 2:
        login = argv[1]
        p1 = getpass.getpass('Пароль: ')
        p2 = getpass.getpass('Пароль ещё раз: ')
        if p1 != p2:
            print('Пароли не совпали.', file=sys.stderr)
            return 1
        try:
            with lock, db() as c:
                if cmd == 'create-superadmin':
                    uid = user_create(c, login, login, p1, who)
                    role_add(c, uid, 'superadmin', '', who)
                    print('Суперадмин создан: %s' % login)
                else:
                    r = c.execute('SELECT id FROM users WHERE login = ?', (login,)).fetchone()
                    if not r:
                        raise ValueError('Такого логина нет.')
                    err = pw_error(p1, login)
                    if err:
                        raise ValueError(err)
                    set_password(c, r[0], p1, who, 'user.password_reset')
                    print('Пароль заменён, все сессии пользователя закрыты.')
        except ValueError as e:
            print(str(e), file=sys.stderr)
            return 1
        return 0
    if cmd == 'set-session-minutes' and len(argv) == 2:
        try:
            m = int(argv[1])
        except ValueError:
            m = -1
        if not SESSION_MIN_LO <= m <= SESSION_MIN_HI:
            print('Срок простоя — от %d до %d минут.' % (SESSION_MIN_LO, SESSION_MIN_HI), file=sys.stderr)
            return 1
        cfg = load_config()
        old = cfg['sessionMinutes']
        cfg['sessionMinutes'] = m
        with lock, db() as c:
            save_config(cfg)
            audit(c, who, 'config.session_minutes', 'config', 'sessionMinutes', None, {'from': old, 'to': m})
        print('Срок простоя сессии: %d мин (действует на открытые сессии со следующего запроса).' % m)
        return 0
    if cmd == 'accounts' and len(argv) == 2 and argv[1] in ('on', 'off'):
        cfg = load_config()
        old = cfg['accounts']
        cfg['accounts'] = argv[1] == 'on'
        with lock, db() as c:
            save_config(cfg)
            audit(c, who, 'config.accounts', 'config', 'accounts', None, {'from': old, 'to': cfg['accounts']})
        print('Учётки %s.' % ('включены' if cfg['accounts'] else 'выключены'))
        return 0
    if cmd == 'open-rooms' and len(argv) == 2 and argv[1] in ('on', 'off'):
        cfg = load_config()
        old = cfg['openRooms']
        cfg['openRooms'] = argv[1] == 'on'
        with lock, db() as c:
            save_config(cfg)
            audit(c, who, 'config.openRooms', 'config', 'openRooms', None, {'from': old, 'to': cfg['openRooms']})
        print('Открытые комнаты %s.' % ('включены' if cfg['openRooms'] else 'выключены'))
        return 0
    if cmd == 'purge' and len(argv) == 2 and argv[1] in ('on', 'off'):
        cfg = load_config()
        old = cfg['purge']
        cfg['purge'] = argv[1] == 'on'
        with lock, db() as c:
            save_config(cfg)
            audit(c, who, 'config.purge', 'config', 'purge', None, {'from': old, 'to': cfg['purge']})
        print('Окончательное стирание %s.' % ('включено' if cfg['purge'] else 'выключено'))
        return 0
    if cmd == 'set-purge-hold' and len(argv) == 2:
        try:
            m = int(argv[1])
        except ValueError:
            m = -1
        if not 0 <= m <= 3650:
            print('Выдержка в архиве — от 0 до 3650 дней.', file=sys.stderr)
            return 1
        cfg = load_config()
        old = cfg['purgeHoldDays']
        cfg['purgeHoldDays'] = m
        with lock, db() as c:
            save_config(cfg)
            audit(c, who, 'config.purge_hold', 'config', 'purgeHoldDays', None, {'from': old, 'to': m})
        print('Выдержка в архиве перед стиранием: %d дн.' % m)
        return 0
    if cmd == 'ai' and len(argv) in (2, 3) and argv[1] in ('on', 'off', 'status', 'limit'):
        cfg = load_config()
        if argv[1] == 'limit':
            try:
                m = int(argv[2])
            except (IndexError, ValueError):
                m = 0
            if not 1 <= m <= 500:
                print('Лимит запросов на учителя в сутки — от 1 до 500.', file=sys.stderr)
                return 1
            cfg['aiDaily'] = m
        elif argv[1] in ('on', 'off'):
            cfg['ai'] = argv[1] == 'on'
        if argv[1] != 'status':
            with lock, db() as c:
                save_config(cfg)
                audit(c, who, 'config.ai', 'config', 'ai', None, {'ai': cfg['ai'], 'daily': cfg['aiDaily']})
        try:
            key = ai_module().key_set(DATA)
        except Exception:
            key = False
        print('Помощник: %s; запросов на учителя в сутки: %d; ключ %s.' % ('включён' if cfg['ai'] else 'выключен', cfg['aiDaily'], 'есть' if key else 'не задан (файл ai.key в папке данных)'))
        return 0
    if cmd == 'backup' and len(argv) == 2:
        # согласованный снимок базы «на лету» (backup API SQLite, без остановки сервера) + проверка целостности копии
        dst = argv[1]
        tmp = dst + '.part'
        if os.path.exists(dst):
            print('Файл уже есть, ничего не делаю: %s' % dst, file=sys.stderr)
            return 1
        src = sqlite3.connect(DB_PATH, timeout=30)
        out = sqlite3.connect(tmp)
        try:
            src.backup(out)
            out.execute('PRAGMA journal_mode=DELETE')  # копия самодостаточна: без -wal/-shm
            res = out.execute('PRAGMA integrity_check').fetchone()[0]
            n = out.execute('SELECT COUNT(*) FROM students').fetchone()[0]
        finally:
            out.close()
            src.close()
        if res != 'ok':
            os.remove(tmp)
            print('Снимок повреждён: %s' % res, file=sys.stderr)
            return 1
        os.replace(tmp, dst)
        cfgp = os.path.join(DATA, 'config.json')
        if os.path.exists(cfgp):
            with open(cfgp, 'rb') as f, open(dst + '.config', 'wb') as g:
                g.write(f.read())
        print('Снимок готов: %s (учеников %d, целостность ok)' % (dst, n))
        return 0
    if cmd == 'check' and len(argv) == 2:
        out = sqlite3.connect('file:%s?mode=ro' % argv[1], uri=True)
        try:
            res = out.execute('PRAGMA integrity_check').fetchone()[0]
            n = out.execute('SELECT COUNT(*) FROM students').fetchone()[0]
        except sqlite3.DatabaseError as e:
            print('Снимок не читается: %s' % e, file=sys.stderr)
            return 1
        finally:
            out.close()
        print('Целостность %s, учеников %d' % (res, n))
        return 0 if res == 'ok' else 1
    print('Команды: create-superadmin <логин> | reset-password <логин> | set-session-minutes <5..300> | accounts on|off | open-rooms on|off | purge on|off | set-purge-hold <0..3650> | backup <файл> | check <файл> | ai on|off|status|limit <N>', file=sys.stderr)
    return 2


class H(BaseHTTPRequestHandler):
    server_version = 'vr-lesson/' + VERSION

    def log_message(self, fmt, *args):  # без ключей и тел запросов в журнале
        print('%s %s' % (self.address_string(), fmt % args), flush=True)

    def cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, X-Key, Authorization')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Max-Age', '86400')

    def reply(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.cors()
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.cors()
        self.end_headers()

    def auth(self):
        r = role_of(self.headers.get('X-Key'))
        if not r:
            time.sleep(1)
            self.reply(401, {'error': 'bad key'})
        return r

    def principal(self):
        """Кто пришёл: пользователь по Authorization: Bearer (только при accounts=true) или принципал по старому ключу. Ответ об ошибке отправляет сам, возвращает None."""
        cfg = load_config()
        ip = client_ip(self)
        tok = self.bearer()
        if tok and cfg['accounts']:
            with lock, db() as c:
                u = session_user(c, tok)
                roles = principal_roles(c, u['id']) if u else []
            if not u:
                self.reply(401, {'error': 'no session'})
                return None
            if not roles:
                self.reply(403, {'error': 'no roles'})
                return None
            return {'kind': 'user', 'id': u['id'], 'login': u['login'], 'roles': roles, 'ip': ip}
        r = role_of(self.headers.get('X-Key'))
        if r == 'teacher' and not cfg['legacyTeacher']:
            r = None
        if not r:
            dv = device_by_key(self.headers.get('X-Key'))
            if dv:
                return {'kind': 'device', 'id': dv['id'], 'school': dv['school'], 'ip': ip}
        if not r:
            time.sleep(1)
            self.reply(401, {'error': 'bad key'})
            return None
        return {'kind': 'legacy-teacher' if r == 'teacher' else 'device', 'id': r, 'ip': ip}

    def do_GET(self):
        if self.path.startswith('/api/health'):
            return self.reply(200, {'ok': True, 'version': VERSION, 'schema': SCHEMA})
        if self.path.startswith('/api/export'):
            p = self.principal()
            if not p:
                return
            if p['kind'] == 'device':
                return self.reply(403, {'error': 'teacher only'})
            with lock, db() as c:
                st = state(c, False, p)
            return self.reply(200, st)
        if self.path.startswith('/api/ai/'):
            return self.ai_api('GET')
        if self.path.startswith('/api/open/'):
            return self.open_get()
        if self.path.startswith('/api/asset/'):
            return self.asset_get()
        if self.path.startswith('/api/auth/'):
            return self.auth_api('GET')
        if self.path.startswith('/api/options') or self.path.startswith('/api/accounts') or self.path.startswith('/api/history'):
            return self.query_api()
        self.reply(404, {'error': 'not found'})

    def query_api(self):
        """GET /api/options, /api/accounts и /api/history — только пользователь с токеном, только его срез."""
        if not load_config()['accounts']:
            return self.reply(404, {'error': 'not found'})
        from urllib.parse import urlparse, parse_qs
        u = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(u.query[:600]).items()}
        tok = self.bearer()
        with lock, db() as c:
            us = session_user(c, tok) if tok else None
            if us:
                roles = principal_roles(c, us['id'])
                p = {'kind': 'user', 'id': us['id'], 'login': us['login'], 'roles': roles}
                try:
                    fn = options_api if u.path == '/api/options' else history_api if u.path == '/api/history' else accounts_api
                    out = (200, fn(c, p, q)) if roles else (403, {'error': 'no roles'})
                except AdminError as e:
                    out = (e.code, {'error': e.msg})
            else:
                out = (401, {'error': 'no session'})
        self.reply(*out)

    def bearer(self):
        a = self.headers.get('Authorization') or ''
        return a[7:].strip() if a[:7].lower() == 'bearer ' else ''

    def auth_api(self, method):
        """/api/auth/login, logout, me, password. Пока флаг accounts выключен — 404, как будто их нет."""
        if not load_config()['accounts']:
            return self.reply(404, {'error': 'not found'})
        route = self.path.split('?')[0]
        ip = client_ip(self)
        body = {}
        if method == 'POST':
            n = num(self.headers.get('Content-Length'))
            if n <= 0 or n > 4096:
                return self.reply(413, {'error': 'body size'})
            try:
                body = json.loads(self.rfile.read(n).decode('utf-8'))
                if not isinstance(body, dict):
                    raise ValueError
            except ValueError:
                return self.reply(400, {'error': 'bad json'})
        if route == '/api/auth/login' and method == 'POST':
            return self.do_login(body, ip)
        if route == '/api/auth/me' and method == 'GET':
            with lock, db() as c:
                u = session_user(c, self.bearer())
                out = (200, {'user': {'id': u['id'], 'login': u['login'], 'name': u['name']}, 'roles': user_roles(c, u['id']), 'expires': u['expires']}) if u else (401, {'error': 'no session'})
            return self.reply(*out)  # ответ — после фиксации транзакции: клиент сразу использует результат
        if route == '/api/auth/logout' and method == 'POST':
            with lock, db() as c:
                u = session_user(c, self.bearer())
                if u:
                    c.execute('DELETE FROM sessions WHERE token_hash = ?', (thash(self.bearer()),))
                    audit(c, ('user', u['id'], ip), 'auth.logout', 'user', u['id'], None, {})
            return self.reply(200, {'ok': True})
        if route == '/api/auth/password' and method == 'POST':
            return self.do_password(body, ip)
        if route == '/api/auth/activate' and method == 'POST':
            return self.do_activate(body, ip)
        self.reply(404, {'error': 'not found'})

    def code_gate(self, kind, body, ip, now):
        """Общая защита публичных «кодовых» входов: лимит по IP и пауза после ошибок. Возвращает секунды ожидания."""
        with lock, db() as c:
            return throttle(c, kind + ':' + ip, ip, now)

    def do_activate(self, body, ip):
        """Активация приглашения (новый учитель/директор: код + логин + пароль) или кода сброса пароля (код + новый пароль). Код одноразовый, проверка и погашение — в одной транзакции."""
        now = int(time.time() * 1000)
        code = str(body.get('code') or '').upper().replace('-', '').replace(' ', '')[:20]
        login = str(body.get('login') or '').strip().lower()
        password, name = body.get('password'), str(body.get('name') or '')[:80]
        wait = self.code_gate('act', body, ip, now)
        if wait:
            return self.reply(429, {'error': 'too many attempts', 'retry': wait})
        if not isinstance(password, str) or len(password) > 256:
            return self.reply(400, {'error': 'Нужен пароль.'})
        out = None
        with lock, db() as c:
            row = c.execute('SELECT kind, role, school, user_id, expires, used_at FROM invites WHERE code_hash = ?', (thash(code),)).fetchone() if len(code) >= 8 else None
            if not row or row[5] is not None or row[4] < now:
                register_fail(c, 'act:' + ip, ip, now)
                out = (400, {'error': 'Код не подходит: он неверный, уже использован или просрочен.'})
            else:
                kind, role, school, uid, _e, _u = row
                who = ('user', uid, ip) if kind == 'reset' else ('cli', 'activate', ip)
                try:
                    if kind == 'join':
                        if not scope_alive(c, role, school):
                            raise ValueError('Школа или область больше не работает.')
                        uid = user_create(c, login, name or login, password, ('user', None, ip))
                        role_add(c, uid, role, school, ('user', uid, ip), None)
                    else:
                        u = user_row(c, uid)
                        err = pw_error(password, u['login']) if u and u['status'] == 'active' else 'Учётная запись недоступна.'
                        if err:
                            raise ValueError(err)
                        set_password(c, uid, password, who, 'user.password_reset_done')
                    c.execute('UPDATE invites SET used_at = ?, used_by = ? WHERE code_hash = ?', (now, uid, thash(code)))
                    audit(c, ('user', uid, ip), 'invite.activate', 'user', uid, school or None, {'kind': kind})
                    token, exp = session_start(c, uid, ip, now)
                    u = c.execute('SELECT id, login, name FROM users WHERE id = ?', (uid,)).fetchone()
                    out = (200, {'token': token, 'user': {'id': u[0], 'login': u[1], 'name': u[2]}, 'roles': user_roles(c, uid), 'expires': exp})
                except ValueError as e:
                    out = (400, {'error': str(e)})
        return self.reply(*out)

    def do_pair(self, body, ip):
        """Привязка шлема по короткому коду: выдаёт ключ шлема школы один раз. Лимит школы проверяется ещё раз."""
        if not load_config()['accounts']:
            return self.reply(404, {'error': 'not found'})
        now = int(time.time() * 1000)
        code = str(body.get('code') or '').upper().replace('-', '').replace(' ', '')[:20]
        wait = self.code_gate('pair', body, ip, now)
        if wait:
            return self.reply(429, {'error': 'too many attempts', 'retry': wait})
        out = None
        with lock, db() as c:
            row = c.execute('SELECT school, name, expires, used_at FROM pair_codes WHERE code_hash = ?', (thash(code),)).fetchone() if len(code) >= 6 else None
            if not row or row[3] is not None or row[2] < now:
                register_fail(c, 'pair:' + ip, ip, now)
                out = (400, {'error': 'Код не подходит: он неверный, уже использован или просрочен (10 минут).'})
            else:
                lim = c.execute('SELECT device_limit FROM schools WHERE id = ?', (row[0],)).fetchone()[0]
                act = c.execute("SELECT count(*) FROM devices WHERE school = ? AND status = 'active'", (row[0],)).fetchone()[0]
                if act >= lim:
                    out = (400, {'error': 'Лимит шлемов школы исчерпан.'})
                else:
                    key = secrets.token_urlsafe(24)
                    did = 'd-' + secrets.token_hex(6)
                    c.execute('INSERT INTO devices(id, school, key_hash, name, status, created, created_by, last_seen) VALUES(?, ?, ?, ?, ?, ?, ?, ?)',
                              (did, row[0], thash(key), (str(body.get('name') or row[1] or ''))[:40], 'active', now, None, now))
                    c.execute('UPDATE pair_codes SET used_at = ? WHERE code_hash = ?', (now, thash(code)))
                    audit(c, ('device', did, ip), 'device.pair', 'device', did, row[0], {})  # ключ в журнал не пишем
                    out = (200, {'key': key, 'school': row[0], 'id': did})
        return self.reply(*out)

    OPEN_HITS = {}

    def ai_api(self, method):
        """Необязательный помощник учителя (server/ai.py). Выключен — 404, как будто его нет. Любой сбой модуля не касается остального сервера."""
        if not load_config()['ai']:
            return self.reply(404, {'error': 'not found'})
        p = self.principal()
        if not p:
            return
        if p['kind'] != 'user' or not any(r['role'] in ('teacher', 'director', 'superadmin') for r in p['roles']):
            return self.reply(403, {'error': 'Помощник доступен учителю, директору и администратору после входа по логину.'})
        path = self.path.split('?')[0]
        try:
            ai = ai_module()
        except Exception:
            return self.reply(503, {'error': 'Помощник сейчас недоступен. Работайте как обычно.'})
        daily = load_config()['aiDaily']
        today = time.strftime('%Y-%m-%d', time.gmtime())
        try:
            with lock, db() as c:
                c.execute('CREATE TABLE IF NOT EXISTS ai_usage(user_id TEXT NOT NULL, day TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, tokens INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(user_id, day))')
                row = c.execute('SELECT n FROM ai_usage WHERE user_id = ? AND day = ?', (p['id'], today)).fetchone()
                used = row[0] if row else 0
            if method == 'GET' and path == '/api/ai/status':
                return self.reply(200, dict(ai.status(DATA), left=max(0, daily - used), daily=daily))
            if method != 'POST' or path not in ('/api/ai/room', '/api/ai/questions'):
                return self.reply(404, {'error': 'not found'})
            if used >= daily:
                return self.reply(429, {'error': 'На сегодня лимит помощника исчерпан (%d запросов). Завтра он обновится.' % daily})
            if not ai.key_set(DATA):
                return self.reply(503, {'error': 'Помощник не настроен администратором.'})
            n = num(self.headers.get('Content-Length'))
            if n <= 0 or n > 2048:
                return self.reply(413, {'error': 'body size'})
            try:
                body = json.loads(self.rfile.read(n).decode('utf-8'))
                if not isinstance(body, dict):
                    raise ValueError
            except ValueError:
                return self.reply(400, {'error': 'bad json'})
            task = path.rsplit('/', 1)[1]
            with lock, db() as c:  # запрос считается сразу: сбой сети не даёт обойти лимит повторами
                c.execute('INSERT INTO ai_usage(user_id, day, n) VALUES(?, ?, 1) ON CONFLICT(user_id, day) DO UPDATE SET n = n + 1', (p['id'], today))
            try:
                res, tokens = ai.run_task(DATA, task, body)
            except ai.AiError as e:
                return self.reply(e.code, {'error': e.msg})
            with lock, db() as c:
                c.execute('UPDATE ai_usage SET tokens = tokens + ? WHERE user_id = ? AND day = ?', (tokens, p['id'], today))
                schools = sorted({r['school'] for r in p['roles'] if r['school']})
                audit(c, ('user', p['id'], p['ip']), 'ai.' + task, 'ai', None, schools[0] if schools else None, {'topic': ai.clean_topic(body.get('topic'))[:100], 'tokens': tokens})
            return self.reply(200, dict(res, left=max(0, daily - used - 1)))
        except Exception:
            return self.reply(502, {'error': 'Помощник сейчас недоступен. Работайте как обычно.'})

    def open_get(self):
        """Публичные открытые комнаты: без входа и без записи результатов. Только одобренные; лимит 60 запросов в минуту с адреса."""
        if not load_config()['openRooms']:
            return self.reply(404, {'error': 'not found'})
        ip, now = client_ip(self), time.time()
        hits = [t for t in H.OPEN_HITS.get(ip, []) if now - t < 60]
        if len(hits) >= 60:
            return self.reply(429, {'error': 'Слишком часто. Подождите минуту.'})
        hits.append(now)
        H.OPEN_HITS[ip] = hits
        if len(H.OPEN_HITS) > 5000:
            H.OPEN_HITS.clear()
        path = self.path.split('?')[0]
        with lock, db() as c:
            if path == '/api/open/rooms':
                rows = c.execute("SELECT id, title, json_extract(spec, '$.hint'), json_extract(spec, '$.grades') FROM open_rooms WHERE status = 'approved' ORDER BY updated DESC LIMIT 200").fetchall()
                return self.reply(200, {'items': [{'id': i, 'title': t, 'hint': str(h or '')[:200]} for i, t, h, g in rows]})
            rid = path[len('/api/open/room/'):] if path.startswith('/api/open/room/') else ''
            row = c.execute("SELECT spec FROM open_rooms WHERE id = ? AND status = 'approved'", (rid,)).fetchone() if re.fullmatch(r'o-[0-9a-f]{12}', rid) else None
        if not row:
            return self.reply(404, {'error': 'not found'})
        self.reply(200, {'id': rid, 'spec': json.loads(row[0])})

    def asset_get(self):
        """GET /api/asset/<id>: файл, загруженный учителем. Одобренный видит вся школа и её шлемы, неодобренный — автор и директор."""
        uid = self.path.split('?')[0][len('/api/asset/'):]
        if not re.fullmatch(r'[0-9a-f]{12}', uid):
            return self.reply(404, {'error': 'not found'})
        p = self.principal()
        if not p:
            return
        with lock, db() as c:
            row = c.execute('SELECT school, owner, status, ext, archived_at FROM uploads WHERE id = ?', (uid,)).fetchone()
            ok = bool(row) and upload_visible(c, p, row)
        if not ok:
            return self.reply(404, {'error': 'not found'})
        try:
            with open(os.path.join(UPLOAD_DIR, '%s.%s' % (uid, row[3])), 'rb') as f:
                data = f.read()
        except OSError:
            return self.reply(404, {'error': 'not found'})
        self.send_response(200)
        self.cors()
        self.send_header('Content-Type', UPLOAD_MIME.get(row[3], 'application/octet-stream'))
        self.send_header('Content-Length', str(len(data)))
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Content-Disposition', 'attachment')
        self.send_header('Cache-Control', 'private, max-age=600')
        self.end_headers()
        self.wfile.write(data)

    def upload_post(self):
        """POST /api/upload?kind=model|sound|texture&name=...&school=...: тело — сам файл. Учитель: на проверку; директор: сразу."""
        from urllib.parse import urlparse, parse_qs
        q = {k: v[0] for k, v in parse_qs(urlparse(self.path).query[:400]).items()}
        n = num(self.headers.get('Content-Length'))
        if n <= 0 or n > MAX_BODY:
            return self.reply(413, {'error': 'Файл больше допустимого.'})
        p = self.principal()
        if not p:
            return
        if n > UPLOAD_LIM['model']:  # дочитываем и выбрасываем, чтобы клиент получил понятный ответ, а не обрыв связи
            left = n
            while left > 0:
                left -= len(self.rfile.read(min(65536, left)))
            return self.reply(413, {'error': 'Файл больше допустимого (4 МБ).'})
        data = self.rfile.read(n)
        try:
            with lock, db() as c:
                res = upload_create(c, p, q.get('kind', ''), q.get('name', ''), q.get('school', ''), data, p['ip'])
        except AdminError as e:
            return self.reply(e.code, {'error': e.msg})
        self.reply(200, res)

    def admin_api(self):
        """POST /api/admin/<действие>: только пользователь с токеном; legacy-ключи администрировать не могут (PLAN 1.5). Флаг accounts выключен — 404."""
        cfg = load_config()
        if not cfg['accounts']:
            return self.reply(404, {'error': 'not found'})
        ip = client_ip(self)
        if self.path.split('?')[0] in ('/api/admin/purge', '/api/admin/purge.preview') and not cfg['purge']:
            return self.reply(404, {'error': 'not found'})
        n = num(self.headers.get('Content-Length'))
        if n <= 0 or n > (70000 if self.path.endswith('/room.publish') else 8192 if self.path.split('?')[0].endswith('/purge') else 4096):
            return self.reply(413, {'error': 'body size'})
        try:
            body = json.loads(self.rfile.read(n).decode('utf-8'))
            if not isinstance(body, dict):
                raise ValueError
        except ValueError:
            return self.reply(400, {'error': 'bad json'})
        tok = self.bearer()
        if not tok:
            return self.reply(403, {'error': 'Администрировать можно только по учётной записи.'})
        act = self.path.split('?')[0][len('/api/admin/'):]
        now = int(time.time() * 1000)
        stored = None
        need_pw = False
        wait = 0
        denied = False
        is_purge = act == 'purge'
        with lock, db() as c:
            u = session_user(c, tok)
            if u:
                roles = principal_roles(c, u['id'])
                stored = c.execute('SELECT pw FROM users WHERE id = ?', (u['id'],)).fetchone()[0]
                if is_purge and my_rank({'roles': roles}) < SUPER:  # не суперадмин: отказ до пароля, с записью в журнал
                    audit(c, ('user', u['id'], ip), 'admin.denied', 'admin', act, None, {'why': 'rank'})
                    denied = True
                need_pw = is_purge or (act in ('role.assign', 'role.remove', 'invite.create') and body.get('role') in ('director', 'region_admin', 'district_admin'))
                wait = throttle(c, 'adm:' + u['login'], ip, now) if need_pw and not denied else 0
        if not u:
            return self.reply(401, {'error': 'no session'})
        if denied:
            return self.reply(403, {'error': 'Недостаточно прав.'})
        p = {'kind': 'user', 'id': u['id'], 'login': u['login'], 'roles': roles, 'ip': ip}
        if need_pw:  # смена директора — «четыре глаза»: повторный ввод пароля (PLAN 5.1)
            if wait:
                return self.reply(429, {'error': 'too many attempts', 'retry': wait})
            if not isinstance(body.get('password'), str) or not check_pw(body['password'], stored):
                with lock, db() as c:
                    register_fail(c, 'adm:' + u['login'], ip, now)
                return self.reply(403, {'error': 'Подтвердите действие своим паролем.'})
        body.pop('password', None)
        if is_purge:
            return self.reply(*purge_exec(p, body, ip, now))
        try:
            with lock, db() as c:
                if need_pw:
                    c.execute('DELETE FROM login_fail WHERE k = ?', ('u:adm:' + u['login'],))
                try:
                    out = (200, admin_action(c, p, act, body, ip))
                except AdminError as e:
                    out = (e.code, {'error': e.msg})
        except sqlite3.Error:
            out = (500, {'error': 'database error'})
        self.reply(*out)

    def do_login(self, body, ip):
        login = body.get('login')
        pw = body.get('password')
        if not isinstance(login, str) or not isinstance(pw, str) or len(login) > 64 or len(pw) > 256:
            return self.reply(401, {'error': 'bad login'})
        login = login.strip().lower()
        now = int(time.time() * 1000)
        with lock, db() as c:
            wait = throttle(c, login, ip, now)
        if wait:
            return self.reply(429, {'error': 'too many attempts', 'retry': wait})
        with db() as c0:
            row = c0.execute("SELECT id, pw, status FROM users WHERE login = ?", (login,)).fetchone()
        good = bool(row) and row[2] == 'active'
        stored = row[1] if good else dummy_hash()  # для неизвестного логина считаем тот же хэш: одинаковое время ответа
        okp = check_pw(pw, stored) and good
        with lock, db() as c:
            if not okp:
                register_fail(c, login, ip, now)
                out = (401, {'error': 'bad login'})
            else:
                out = None
                c.execute('DELETE FROM login_fail WHERE k = ?', ('u:' + login,))
                if needs_rehash(stored):
                    c.execute('UPDATE users SET pw = ? WHERE id = ?', (hash_pw(pw), row[0]))
                token, exp = session_start(c, row[0], ip, now)
                u = c.execute('SELECT id, login, name FROM users WHERE id = ?', (row[0],)).fetchone()
                audit(c, ('user', row[0], ip), 'auth.login', 'user', row[0], None, {})
                out = (200, {'token': token, 'user': {'id': u[0], 'login': u[1], 'name': u[2]}, 'roles': user_roles(c, row[0]), 'expires': exp})
        return self.reply(*out)

    def do_password(self, body, ip):
        old, new = body.get('old'), body.get('new')
        tok = self.bearer()
        now = int(time.time() * 1000)
        with lock, db() as c:
            u = session_user(c, tok)
            if not u:
                return self.reply(401, {'error': 'no session'})
            wait = throttle(c, 'pw:' + u['login'], ip, now)
            stored = c.execute('SELECT pw FROM users WHERE id = ?', (u['id'],)).fetchone()[0]
        if wait:
            return self.reply(429, {'error': 'too many attempts', 'retry': wait})
        if not isinstance(old, str) or len(old) > 256 or not check_pw(old, stored):
            with lock, db() as c:
                register_fail(c, 'pw:' + u['login'], ip, now)
            return self.reply(403, {'error': 'bad password'})
        err = pw_error(new, u['login'])
        if err:
            return self.reply(400, {'error': err})
        with lock, db() as c:
            c.execute('DELETE FROM login_fail WHERE k = ?', ('u:pw:' + u['login'],))
            set_password(c, u['id'], new, ('user', u['id'], ip), 'user.password_change')
            token, exp = session_start(c, u['id'], ip, now)
        self.reply(200, {'ok': True, 'token': token, 'expires': exp})

    def do_POST(self):
        if self.path.startswith('/api/auth/'):
            return self.auth_api('POST')
        if self.path.startswith('/api/admin/'):
            return self.admin_api()
        if self.path.startswith('/api/ai/'):
            return self.ai_api('POST')
        if self.path.startswith('/api/upload'):
            return self.upload_post()
        if self.path.startswith('/api/device/pair'):
            n = num(self.headers.get('Content-Length'))
            if n <= 0 or n > 1024:
                return self.reply(413, {'error': 'body size'})
            try:
                body = json.loads(self.rfile.read(n).decode('utf-8'))
                if not isinstance(body, dict):
                    raise ValueError
            except ValueError:
                return self.reply(400, {'error': 'bad json'})
            return self.do_pair(body, client_ip(self))
        if not self.path.startswith('/api/sync'):
            return self.reply(404, {'error': 'not found'})
        p = self.principal()
        if not p:
            return
        r = 'device' if p['kind'] == 'device' else 'teacher'  # у пользователя права «учителя» ограничены его срезом (scope)
        n = num(self.headers.get('Content-Length'))
        if n <= 0 or n > MAX_BODY:
            return self.reply(413, {'error': 'body size'})
        try:
            inc = json.loads(self.rfile.read(n).decode('utf-8'))
            if not isinstance(inc, dict):
                raise ValueError
        except ValueError:
            return self.reply(400, {'error': 'bad json'})
        with lock, db() as c:
            res = merge_in(c, inc, r, p['ip'], p)
            st = state(c, r != 'teacher', p)
        out = {'role': r, 'state': st, 'time': int(time.time() * 1000)}
        if p['kind'] == 'user':
            out['user'] = p['login']
            out['rejected'] = (res or {}).get('rejected', {})
        self.reply(200, out)


if __name__ == '__main__':
    if len(sys.argv) > 1:
        sys.exit(cli(sys.argv[1:]))
    init_db()
    print('VR-урок: сервер слушает порт %d, база %s' % (PORT, DB_PATH), flush=True)
    ThreadingHTTPServer(('0.0.0.0', PORT), H).serve_forever()
