#!/usr/bin/env python3
"""VR-урок: сервер синхронизации. Python 3 без сторонних библиотек, база SQLite (/data/vrlesson.db).

Ключи доступа хранятся в /data/keys.json и создаются при первом запуске:
  teacher — полный доступ (тесты, удаление, настройки);
  device  — для шлемов: ученики, результаты, открытия.
Эндпоинты: GET /api/health, POST /api/sync, GET /api/export (только учитель).
"""
import base64, getpass, hashlib, ipaddress, json, os, re, secrets, sqlite3, sys, threading, time, hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

DATA = os.environ.get('DATA_DIR', '/data')
PORT = int(os.environ.get('PORT', '8787'))
DB_PATH = os.path.join(DATA, 'vrlesson.db')
KEYS_PATH = os.path.join(DATA, 'keys.json')
CONFIG_PATH = os.path.join(DATA, 'config.json')
MAX_BODY = 8 * 1024 * 1024
VERSION = '3'
SCHEMA = 4
DEFAULT_SCHOOL = 'school-default'
NEW_FIELDS = ('school', 'year', 'status')
AUDIT_DETAIL_MAX = 2048
PW_ITER = 600000  # число итераций PBKDF2; хранится в строке хэша, поднять можно без миграции (перехэш при входе)
SESSION_CAP = 12 * 3600 * 1000  # потолок сессии, не настраивается (решение владельца, PLAN 5.5)
SESSION_MIN_DEFAULT, SESSION_MIN_LO, SESSION_MIN_HI = 15, 5, 300
LOGIN_FREE_TRIES = 5  # ошибок подряд без паузы; дальше пауза 30 с, растёт вдвое до 15 мин
IP_PER_MIN = 20
RESERVED_LOGINS = ('admin', 'root', 'superadmin', 'director', 'teacher')
ROLES = ('superadmin', 'director', 'teacher', 'expert')
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
        if ver < SCHEMA and existed:
            try:
                path = backup_db('v%d' % max(ver, 2))
                print('копия базы перед миграцией: %s' % path, flush=True)
            except Exception as e:
                print('миграция остановлена: не удалось сделать копию базы:', e, flush=True)
                sys.exit(1)
        migrate_v3(c)  # при каждом старте: идемпотентно, дозаполняет строки, записанные прежней версией
        migrate_v4(c)


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


def backup_db(tag):
    """Копия базы средствами SQLite рядом с базой; существующие копии не трогаем."""
    path = '%s.bak-%s-%s' % (DB_PATH, tag, time.strftime('%Y%m%d-%H%M%S', time.gmtime()))
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
        c.execute('''CREATE TABLE IF NOT EXISTS user_roles(user_id TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('superadmin', 'director', 'teacher', 'expert')),
            school TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'archived')), created INTEGER, created_by TEXT,
            PRIMARY KEY(user_id, role, school))''')
        c.execute('''CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, created INTEGER, last_seen INTEGER, expires INTEGER, ip TEXT)''')
        c.execute('''CREATE TABLE IF NOT EXISTS invites(code_hash TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('join', 'reset')), role TEXT, school TEXT, user_id TEXT,
            created_by TEXT, created INTEGER, expires INTEGER, used_at INTEGER, used_by TEXT)''')
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
                    'CREATE INDEX IF NOT EXISTS user_roles_school ON user_roles(school, role, status)',
                    'CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id)',
                    'CREATE INDEX IF NOT EXISTS invites_school ON invites(school)',
                    'CREATE INDEX IF NOT EXISTS audit_school_ts ON audit_log(school, ts)',
                    'CREATE INDEX IF NOT EXISTS audit_target ON audit_log(target_kind, target_id)',
                    'CREATE INDEX IF NOT EXISTS classes_teacher ON classes(teacherId)',
                    'CREATE INDEX IF NOT EXISTS classes_school ON classes(school, status)'):
            c.execute(ddl)
        if c.execute('PRAGMA user_version').fetchone()[0] < 4:
            c.execute('PRAGMA user_version = 4')
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


def merge_in(c, inc, role, ip=''):
    """Вносит присланное состояние в базу по тем же правилам, что и js/store.js (merge). Реальные изменения пишутся в журнал аудита (audit) в той же транзакции."""
    teacher = role == 'teacher'
    who = ('legacy-teacher' if teacher else 'device', role, ip)  # ключ в журнал не попадает, только его роль
    if teacher:
        for k, ts in (inc.get('deleted') or {}).items():
            k = str(k)
            if c.execute('SELECT 1 FROM deleted WHERE id = ?', (k,)).fetchone() is None:  # пишем только новое удаление, повтор не дублируем
                kind, school = find_record(c, k)
                detail = {}
                if kind == 'student':
                    detail['results'] = c.execute('SELECT count(*) FROM results WHERE sid = ?', (k,)).fetchone()[0]
                audit(c, who, 'delete', kind, k, school, detail)
            c.execute('INSERT INTO deleted(id, ts) VALUES(?, ?) ON CONFLICT(id) DO UPDATE SET ts = max(ts, excluded.ts)', (k, num(ts)))
        s = inc.get('settings') or {}
        if s:
            row = c.execute('SELECT updated FROM settings WHERE id = 1').fetchone()
            if not row or num(s.get('updated')) > row[0]:
                keys = changed_keys(get_settings(c), s)
                if keys:
                    audit(c, who, 'settings.update', 'settings', None, DEFAULT_SCHOOL, {'keys': keys})  # настройки общие, школа пока одна
                c.execute('INSERT OR REPLACE INTO settings(id, updated, doc) VALUES(1, ?, ?)', (num(s.get('updated')), json.dumps(s, ensure_ascii=False)))
    deleted = {r[0] for r in c.execute('SELECT id FROM deleted')}
    reset = num(get_settings(c).get('resetAt'))

    for s in inc.get('students') or []:
        if not isinstance(s, dict) or not s.get('id') or not s.get('name') or s['id'] in deleted:
            continue
        upd = num(s.get('updated') or s.get('created'))
        row = c.execute('SELECT updated, doc FROM students WHERE id = ?', (s['id'],)).fetchone()
        if row and not teacher:
            continue  # ключ шлема может только добавлять новых учеников, но не менять существующих (имя, класс, код входа, архив)
        if not row or upd > row[0]:
            old_d = None if not row else load_doc(row[1])
            d = fill_v4(s, old_d, 'students', device_new=not teacher)
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
            if not isinstance(k, dict) or not k.get('id') or k['id'] in deleted:
                continue
            row = c.execute('SELECT updated, doc FROM classes WHERE id = ?', (k['id'],)).fetchone()
            if not row or num(k.get('updated')) > row[0]:
                old_d = load_doc(row[1]) if row else None
                d = fill_v4(k, old_d, 'classes')
                c.execute('INSERT OR REPLACE INTO classes(id, name, updated, doc, school, year, status, teacherId) VALUES(?, ?, ?, ?, ?, ?, ?, ?)',
                          (k['id'], '%s%s' % (num(k.get('grade')), str(k.get('letter', ''))[:4]), num(k.get('updated')), json.dumps(d, ensure_ascii=False), d['school'], d['year'], d['status'], d.get('teacherId')))
                name = '%s%s' % (num(k.get('grade')), str(k.get('letter', ''))[:4])
                if not row:
                    audit(c, who, 'class.create', 'class', k['id'], d['school'], {'name': name})
                elif (old_d or {}).get('status') != d['status']:
                    audit(c, who, 'class.archive' if d['status'] == 'archived' else 'class.restore', 'class', k['id'], d['school'], {'name': name})
        for t in inc.get('tests') or []:
            if not isinstance(t, dict) or not t.get('id') or t['id'] in deleted:
                continue
            row = c.execute('SELECT updated FROM tests WHERE id = ?', (t['id'],)).fetchone()
            if not row or num(t.get('updated')) > row[0]:
                c.execute('INSERT OR REPLACE INTO tests(id, title, subj, updated, doc) VALUES(?, ?, ?, ?, ?)',
                          (t['id'], str(t.get('title', ''))[:200], str(t.get('subj', '')), num(t.get('updated')), json.dumps(t, ensure_ascii=False)))
    for r in inc.get('results') or []:
        if not isinstance(r, dict) or not r.get('id') or not r.get('sid') or r['sid'] in deleted or num(r.get('ts')) < reset:
            continue
        c.execute('INSERT OR IGNORE INTO results(id, sid, subj, score, total, ts, doc) VALUES(?, ?, ?, ?, ?, ?, ?)',
                  (r['id'], r['sid'], str(r.get('subj', '')), num(r.get('score')), num(r.get('total')), num(r.get('ts')), json.dumps(r, ensure_ascii=False)))
    for f in inc.get('feedback') or []:
        if not isinstance(f, dict) or not f.get('id') or f['id'] in deleted:
            continue
        c.execute('INSERT OR IGNORE INTO feedback(id, ts, kind, room, rating, text, doc) VALUES(?, ?, ?, ?, ?, ?, ?)',
                  (f['id'], num(f.get('ts')), str(f.get('kind', ''))[:20], str(f.get('room') or '')[:20], num(f.get('rating'), None), str(f.get('text', ''))[:1000], json.dumps(f, ensure_ascii=False)))
    for sid, m in (inc.get('disc') or {}).items():
        if sid in deleted or not isinstance(m, dict):
            continue
        for k, ts in m.items():
            if num(ts) >= reset:
                c.execute('INSERT INTO disc(sid, k, ts) VALUES(?, ?, ?) ON CONFLICT(sid, k) DO UPDATE SET ts = min(ts, excluded.ts)', (sid, k, num(ts)))
    # подчистить удалённое и сброшенное
    c.execute('DELETE FROM students WHERE id IN (SELECT id FROM deleted)')
    c.execute('DELETE FROM tests WHERE id IN (SELECT id FROM deleted)')
    c.execute('DELETE FROM classes WHERE id IN (SELECT id FROM deleted)')
    c.execute('DELETE FROM results WHERE sid IN (SELECT id FROM deleted) OR id IN (SELECT id FROM deleted) OR ts < ?', (reset,))
    c.execute('DELETE FROM disc WHERE sid IN (SELECT id FROM deleted) OR ts < ?', (reset,))
    c.execute('DELETE FROM feedback WHERE id IN (SELECT id FROM deleted)')


def load_doc(raw):
    try:
        d = json.loads(raw)
        return d if isinstance(d, dict) else None
    except (TypeError, ValueError):
        return None


def get_settings(c):
    row = c.execute('SELECT doc FROM settings WHERE id = 1').fetchone()
    return json.loads(row[0]) if row else {}


def state(c, hide_pins=False):
    """Состояние для ответа. hide_pins: ключ шлема не получает видимые коды учеников (pinView)."""
    def stud(raw):
        d = json.loads(raw)
        if hide_pins:
            d.pop('pinView', None)
        return d
    disc = {}
    for sid, k, ts in c.execute('SELECT sid, k, ts FROM disc'):
        disc.setdefault(sid, {})[k] = ts
    return {
        'v': SCHEMA,
        'classes': [json.loads(r[0]) for r in c.execute('SELECT doc FROM classes')],
        'students': [stud(r[0]) for r in c.execute('SELECT doc FROM students')],
        'tests': [json.loads(r[0]) for r in c.execute('SELECT doc FROM tests')],
        'results': [json.loads(r[0]) for r in c.execute('SELECT doc FROM results ORDER BY ts')],
        'disc': disc,
        'feedback': [json.loads(r[0]) for r in c.execute('SELECT doc FROM feedback ORDER BY ts')],
        'deleted': {k: ts for k, ts in c.execute('SELECT id, ts FROM deleted')},
        'settings': get_settings(c),
    }


def role_of(key):
    key = key or ''
    if hmac.compare_digest(key.encode(), KEYS['teacher'].encode()):
        return 'teacher'
    if hmac.compare_digest(key.encode(), KEYS['device'].encode()):
        return 'device'
    return None


# ---------- учётки (шаги 4–5 PLAN.md): пароли, настройки, вход, сессии ----------
def load_config():
    """/data/config.json: accounts (по умолчанию false — новые эндпоинты отвечают 404), legacyTeacher (true), sessionMinutes (15). Читается на каждый запрос: выключатель действует без перезапуска.
    Это НЕ settings.flags: те синхронизируются и меняются ключом teacher, а флаг безопасности старым ключом включаться не должен."""
    cfg = {'accounts': False, 'legacyTeacher': True, 'sessionMinutes': SESSION_MIN_DEFAULT}
    try:
        with open(CONFIG_PATH, encoding='utf-8') as f:
            raw = json.load(f)
        if isinstance(raw, dict):
            if isinstance(raw.get('accounts'), bool):
                cfg['accounts'] = raw['accounts']
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


def role_add(c, user_id, role, school, who, created_by=None):
    if role not in ROLES:
        raise ValueError('Неизвестная роль.')
    school = '' if role == 'superadmin' else str(school or '')
    if role != 'superadmin' and not c.execute('SELECT 1 FROM schools WHERE id = ?', (school,)).fetchone():
        raise ValueError('Такой школы нет.')
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
    print('Команды: create-superadmin <логин> | reset-password <логин> | set-session-minutes <5..300> | accounts on|off', file=sys.stderr)
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

    def do_GET(self):
        if self.path.startswith('/api/health'):
            return self.reply(200, {'ok': True, 'version': VERSION, 'schema': SCHEMA})
        if self.path.startswith('/api/export'):
            r = self.auth()
            if not r:
                return
            if r != 'teacher':
                return self.reply(403, {'error': 'teacher only'})
            with lock, db() as c:
                return self.reply(200, state(c))
        if self.path.startswith('/api/auth/'):
            return self.auth_api('GET')
        self.reply(404, {'error': 'not found'})

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
        self.reply(404, {'error': 'not found'})

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
        if not self.path.startswith('/api/sync'):
            return self.reply(404, {'error': 'not found'})
        r = self.auth()
        if not r:
            return
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
            merge_in(c, inc, r, self.client_address[0])
            st = state(c, r != 'teacher')
        self.reply(200, {'role': r, 'state': st, 'time': int(time.time() * 1000)})


if __name__ == '__main__':
    if len(sys.argv) > 1:
        sys.exit(cli(sys.argv[1:]))
    init_db()
    print('VR-урок: сервер слушает порт %d, база %s' % (PORT, DB_PATH), flush=True)
    ThreadingHTTPServer(('0.0.0.0', PORT), H).serve_forever()
