#!/usr/bin/env python3
"""VR-урок: сервер синхронизации. Python 3 без сторонних библиотек, база SQLite (/data/vrlesson.db).

Ключи доступа хранятся в /data/keys.json и создаются при первом запуске:
  teacher — полный доступ (тесты, удаление, настройки);
  device  — для шлемов: ученики, результаты, открытия.
Эндпоинты: GET /api/health, POST /api/sync, GET /api/export (только учитель).
"""
import json, os, secrets, sqlite3, threading, time, hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

DATA = os.environ.get('DATA_DIR', '/data')
PORT = int(os.environ.get('PORT', '8787'))
DB_PATH = os.path.join(DATA, 'vrlesson.db')
KEYS_PATH = os.path.join(DATA, 'keys.json')
MAX_BODY = 8 * 1024 * 1024
VERSION = '3'
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


def num(x, d=0):
    try:
        return int(x)
    except (TypeError, ValueError):
        return d


def merge_in(c, inc, role):
    """Вносит присланное состояние в базу по тем же правилам, что и js/store.js (merge)."""
    teacher = role == 'teacher'
    if teacher:
        for k, ts in (inc.get('deleted') or {}).items():
            c.execute('INSERT INTO deleted(id, ts) VALUES(?, ?) ON CONFLICT(id) DO UPDATE SET ts = max(ts, excluded.ts)', (str(k), num(ts)))
        s = inc.get('settings') or {}
        if s:
            row = c.execute('SELECT updated FROM settings WHERE id = 1').fetchone()
            if not row or num(s.get('updated')) > row[0]:
                c.execute('INSERT OR REPLACE INTO settings(id, updated, doc) VALUES(1, ?, ?)', (num(s.get('updated')), json.dumps(s, ensure_ascii=False)))
    deleted = {r[0] for r in c.execute('SELECT id FROM deleted')}
    reset = num(get_settings(c).get('resetAt'))

    for s in inc.get('students') or []:
        if not isinstance(s, dict) or not s.get('id') or not s.get('name') or s['id'] in deleted:
            continue
        upd = num(s.get('updated') or s.get('created'))
        row = c.execute('SELECT updated FROM students WHERE id = ?', (s['id'],)).fetchone()
        if row and not teacher:
            continue  # ключ шлема может только добавлять новых учеников, но не менять существующих (имя, класс, код входа)
        if not row or upd > row[0]:
            c.execute('INSERT OR REPLACE INTO students(id, name, grade, updated, doc) VALUES(?, ?, ?, ?, ?)',
                      (s['id'], str(s['name'])[:40], num(s.get('grade'), 5), upd, json.dumps(s, ensure_ascii=False)))
    if teacher:
        for k in inc.get('classes') or []:
            if not isinstance(k, dict) or not k.get('id') or k['id'] in deleted:
                continue
            row = c.execute('SELECT updated FROM classes WHERE id = ?', (k['id'],)).fetchone()
            if not row or num(k.get('updated')) > row[0]:
                c.execute('INSERT OR REPLACE INTO classes(id, name, updated, doc) VALUES(?, ?, ?, ?)',
                          (k['id'], '%s%s' % (num(k.get('grade')), str(k.get('letter', ''))[:4]), num(k.get('updated')), json.dumps(k, ensure_ascii=False)))
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


def get_settings(c):
    row = c.execute('SELECT doc FROM settings WHERE id = 1').fetchone()
    return json.loads(row[0]) if row else {}


def state(c):
    disc = {}
    for sid, k, ts in c.execute('SELECT sid, k, ts FROM disc'):
        disc.setdefault(sid, {})[k] = ts
    return {
        'v': 2,
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
            return self.reply(200, {'ok': True, 'version': VERSION})
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
            merge_in(c, inc, r)
            st = state(c)
        self.reply(200, {'role': r, 'state': st, 'time': int(time.time() * 1000)})


if __name__ == '__main__':
    init_db()
    print('VR-урок: сервер слушает порт %d, база %s' % (PORT, DB_PATH), flush=True)
    ThreadingHTTPServer(('0.0.0.0', PORT), H).serve_forever()
