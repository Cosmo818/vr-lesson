#!/usr/bin/env python3
"""VR-урок: сервер синхронизации. Python 3 без сторонних библиотек, база SQLite (/data/vrlesson.db).

Ключи доступа хранятся в /data/keys.json и создаются при первом запуске:
  teacher — полный доступ (тесты, удаление, настройки);
  device  — для шлемов: ученики, результаты, открытия.
Эндпоинты: GET /api/health, POST /api/sync, GET /api/export (только учитель).
"""
import json, os, re, secrets, sqlite3, sys, threading, time, hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

DATA = os.environ.get('DATA_DIR', '/data')
PORT = int(os.environ.get('PORT', '8787'))
DB_PATH = os.path.join(DATA, 'vrlesson.db')
KEYS_PATH = os.path.join(DATA, 'keys.json')
MAX_BODY = 8 * 1024 * 1024
VERSION = '3'
SCHEMA = 4
DEFAULT_SCHOOL = 'school-default'
NEW_FIELDS = ('school', 'year', 'status')
AUDIT_DETAIL_MAX = 2048
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
            d = fill_v3(s, old_d, device_new=not teacher)
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


def state(c):
    disc = {}
    for sid, k, ts in c.execute('SELECT sid, k, ts FROM disc'):
        disc.setdefault(sid, {})[k] = ts
    return {
        'v': SCHEMA,
        'classes': [json.loads(r[0]) for r in c.execute('SELECT doc FROM classes')],
        'students': [json.loads(r[0]) for r in c.execute('SELECT doc FROM students')],
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


class H(BaseHTTPRequestHandler):
    server_version = 'vr-lesson/' + VERSION

    def log_message(self, fmt, *args):  # без ключей и тел запросов в журнале
        print('%s %s' % (self.address_string(), fmt % args), flush=True)

    def cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, X-Key')
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
        self.reply(404, {'error': 'not found'})

    def do_POST(self):
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
            st = state(c)
        self.reply(200, {'role': r, 'state': st, 'time': int(time.time() * 1000)})


if __name__ == '__main__':
    init_db()
    print('VR-урок: сервер слушает порт %d, база %s' % (PORT, DB_PATH), flush=True)
    ThreadingHTTPServer(('0.0.0.0', PORT), H).serve_forever()
