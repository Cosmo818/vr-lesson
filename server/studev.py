"""studev.py — привязка устройства к ученику и сеанс ученика (шаг Э1 PLAN-einstein.md, раздел 1.3 и 1.5). Подключается лениво (app.studev_module()), работает при config accounts=true и studentDevices=true.
Функции получают модуль приложения A (app.py) первым аргументом: права (scope), журнал (audit), пауза после ошибок (register_fail), база — оттуда, без копий.
Правила: ничего не удаляется без нужды (А15) — устройство отзывается (status='revoked'), код гасится сроком; после register_fail исключений не бросаем
(откат транзакции стёр бы счётчик) — возвращаем (код, тело). Ключ устройства и токен сеанса — секреты: в базе только sha256, в журнал, ошибки и ответы-ошибки не попадают (А14)."""
import hashlib
import hmac
import json
import re
import secrets
import time

DEV_PREFIX = 'sd-'
DEV_RE = re.compile(r'^sd-[0-9a-f]{12}$')
SID_RE = re.compile(r'^[A-Za-z0-9_-]{1,60}$')
CODE_LEN = 8
CODE_TTL_MS = 15 * 60 * 1000
SESSION_CAP_MS = 8 * 3600 * 1000
KEY_IDLE_MS = 180 * 86400 * 1000
SEEN_STEP_MS = 60000
RATE_PAIR = 30      # неудачных привязок в минуту с одного IP (удачные не считаются)
RATE_LOGIN = 20     # попыток входа в минуту с одного устройства
DENIED = {'error': 'denied'}


def sha(x):
    return hashlib.sha256(str(x).encode()).hexdigest()


# ------------------------------------------------------------------ база

def migrate_v9(A, c):
    """v8 -> v9: привязка устройств к ученикам, сеансы учеников, таблицы «Эйнштейна» (pk: 's' ученик / 't' учитель). Одна явная транзакция, повторяема, ничего не удаляет
    (по образцу netapi.migrate_v7). Копию базы до миграции делает init_db."""
    if c.in_transaction:
        c.commit()
    c.execute('BEGIN IMMEDIATE')
    try:
        c.execute('''CREATE TABLE IF NOT EXISTS student_devices(id TEXT PRIMARY KEY, student_id TEXT NOT NULL, school TEXT NOT NULL, key_hash TEXT NOT NULL UNIQUE, name TEXT,
            created INTEGER, last_seen INTEGER, status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'revoked')), revoked_at INTEGER, revoked_by TEXT)''')
        c.execute('CREATE INDEX IF NOT EXISTS student_devices_st ON student_devices(student_id, status)')
        c.execute('''CREATE TABLE IF NOT EXISTS student_pair_codes(code_hash TEXT PRIMARY KEY, student_id TEXT NOT NULL, school TEXT NOT NULL, created_by TEXT, created INTEGER,
            expires INTEGER, used_at INTEGER)''')
        c.execute('CREATE INDEX IF NOT EXISTS student_pair_codes_st ON student_pair_codes(student_id)')
        c.execute('''CREATE TABLE IF NOT EXISTS student_sessions(token_hash TEXT PRIMARY KEY, student_id TEXT NOT NULL, device_id TEXT NOT NULL, created INTEGER, last_seen INTEGER,
            expires INTEGER)''')
        c.execute('CREATE INDEX IF NOT EXISTS student_sessions_dev ON student_sessions(device_id)')
        c.execute('''CREATE TABLE IF NOT EXISTS ein_issued(pk TEXT NOT NULL DEFAULT 's', pid TEXT NOT NULL, seed INTEGER NOT NULL, issued INTEGER NOT NULL, src TEXT,
            status TEXT NOT NULL DEFAULT 'active', PRIMARY KEY(pk, pid, seed))''')
        if 'status' not in [x[1] for x in c.execute('PRAGMA table_info(ein_issued)')]:   # база с прежним видом таблицы (без статуса): строки остаются действующими
            c.execute("ALTER TABLE ein_issued ADD COLUMN status TEXT NOT NULL DEFAULT 'active'")
        c.execute('CREATE INDEX IF NOT EXISTS ein_issued_act ON ein_issued(pk, pid, status)')
        c.execute('''CREATE TABLE IF NOT EXISTS ein_solves(pk TEXT NOT NULL DEFAULT 's', pid TEXT NOT NULL, seed INTEGER NOT NULL, school TEXT NOT NULL, t INTEGER NOT NULL,
            moves INTEGER NOT NULL DEFAULT 0, helped INTEGER NOT NULL DEFAULT 0, void INTEGER NOT NULL DEFAULT 0, ts INTEGER NOT NULL, src TEXT, PRIMARY KEY(pk, pid, seed))''')
        c.execute('''CREATE TABLE IF NOT EXISTS ein_stats(pk TEXT NOT NULL DEFAULT 's', pid TEXT NOT NULL, school TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0,
            sum_t INTEGER NOT NULL DEFAULT 0, last_ts INTEGER, PRIMARY KEY(pk, pid))''')
        c.execute('CREATE INDEX IF NOT EXISTS ein_stats_school ON ein_stats(pk, school)')
        if c.execute('PRAGMA user_version').fetchone()[0] < 9:
            c.execute('PRAGMA user_version = 9')
        c.execute('COMMIT')
    except BaseException:
        if c.in_transaction:
            c.execute('ROLLBACK')
        raise


def ein_count(c, sid):
    """Сколько строк «Эйнштейна» у ученика (выданные, решения, сводка) — для счётчиков предпросмотра и журнала стирания."""
    return sum(c.execute('SELECT count(*) FROM %s WHERE pk = ? AND pid = ?' % t, ('s', sid)).fetchone()[0] for t in ('ein_issued', 'ein_solves', 'ein_stats'))


def erase_student(c, sid):
    """Стирание строк ученика (вызывает purge_erase_student в той же транзакции): устройства, сеансы, коды привязки, «Эйнштейн»."""
    out = 0
    for q in ('DELETE FROM student_sessions WHERE student_id = ?', 'DELETE FROM student_devices WHERE student_id = ?', 'DELETE FROM student_pair_codes WHERE student_id = ?',
              "DELETE FROM ein_issued WHERE pk = 's' AND pid = ?", "DELETE FROM ein_solves WHERE pk = 's' AND pid = ?", "DELETE FROM ein_stats WHERE pk = 's' AND pid = ?"):
        out += c.execute(q, (sid,)).rowcount
    return out


# ------------------------------------------------------------------ устройство и сеанс

def student_row(c, sid):
    """Ученик из базы: (name, grade, school, status, doc-словарь) или None."""
    r = c.execute('SELECT name, grade, school, status, doc FROM students WHERE id = ?', (sid,)).fetchone()
    return (r[0], r[1], r[2], r[3], _load(r[4])) if r else None


def _load(raw):
    try:
        d = json.loads(raw or '{}')
        return d if isinstance(d, dict) else {}
    except ValueError:
        return {}


def school_alive(c, school):
    r = c.execute('SELECT status FROM schools WHERE id = ?', (school,)).fetchone()
    return bool(r) and r[0] != 'archived'


def device_by_key(A, c, key, now):
    """Строка устройства по ключу или None. Действует, пока: строка active, ученик active, школа ученика = школа устройства (перевод в другую школу отвязывает), школа не в архиве,
    простой < 180 дней. last_seen — не чаще раза в минуту."""
    key = key if isinstance(key, str) else ''
    if not 16 <= len(key) <= 80:
        return None
    r = c.execute("SELECT id, student_id, school, last_seen, created, name FROM student_devices WHERE key_hash = ? AND status = 'active'", (sha(key),)).fetchone()
    if not r:
        return None
    if now - (r[3] or r[4] or 0) > KEY_IDLE_MS:
        return None
    st = c.execute('SELECT school, status FROM students WHERE id = ?', (r[1],)).fetchone()
    if not st or st[1] != 'active' or st[0] != r[2] or not school_alive(c, r[2]):
        return None
    if now - (r[3] or 0) > SEEN_STEP_MS:
        c.execute('UPDATE student_devices SET last_seen = ? WHERE id = ?', (now, r[0]))
    return {'id': r[0], 'student_id': r[1], 'school': r[2], 'name': r[5]}


def principal(A, c, key, token, now):
    """Принципал ученика {'kind':'student','id','school','dev'} или None. Ключ и токен — одного устройства и одного ученика; простой токена > studentSessionMin, возраст > 8 ч — нет."""
    dev = device_by_key(A, c, key, now)
    token = token if isinstance(token, str) else ''
    if not dev or not 16 <= len(token) <= 120:
        return None
    th = sha(token)
    r = c.execute('SELECT student_id, device_id, created, last_seen FROM student_sessions WHERE token_hash = ?', (th,)).fetchone()
    if not r or r[0] != dev['student_id'] or r[1] != dev['id']:
        return None
    idle = int(A.load_config().get('studentSessionMin') or 120) * 60000
    if now - (r[3] or 0) > idle or now - (r[2] or 0) > SESSION_CAP_MS:
        return None
    if now - (r[3] or 0) > SEEN_STEP_MS:
        c.execute('UPDATE student_sessions SET last_seen = ?, expires = ? WHERE token_hash = ?', (now, min(now + idle, (r[2] or now) + SESSION_CAP_MS), th))
    return {'kind': 'student', 'id': dev['student_id'], 'school': dev['school'], 'dev': dev['id']}


def check_pin(A, c, dev, pin_hash, ip, now):
    """Общая проверка кода ученика для login и unpair. → None при успехе или (код, тело) при отказе. Пауза — register_fail('dpin:'+sid), как у входа учётки."""
    sid = dev['student_id']
    wait = A.net_module().locked(c, 'dpin:' + sid, now)
    if wait:
        return (429, {'error': 'too many attempts', 'retry': wait})
    ph = str(pin_hash or '')[:128] if isinstance(pin_hash, str) else ''
    r = student_row(c, sid)
    stored = r[4].get('pinHash') if r else None
    if not stored:
        return (403, {'error': 'Попроси учителя выдать код входа.'})
    if not ph or not hmac.compare_digest(ph.encode(), str(stored).encode()):
        A.register_fail(c, 'dpin:' + sid, ip, now)
        n = c.execute('SELECT n FROM login_fail WHERE k = ?', ('u:dpin:' + sid,)).fetchone()
        if n and n[0] == A.LOGIN_FREE_TRIES:
            A.audit(c, ('device', dev['id'], ip), 'student.login.lockout', 'student', sid, dev['school'], {'dev': dev['id'], 'by': 'student'})
        return (403, DENIED)
    c.execute('DELETE FROM login_fail WHERE k = ?', ('u:dpin:' + sid,))
    return None


def login(A, c, key, pin_hash, ip, now):
    """POST /api/student/login (X-Student + код) → (код, тело): 200 {token, exp}; 401 ключ не действует; 403 denied; 429."""
    dev = device_by_key(A, c, key, now)
    if not dev:
        return 401, {'error': 'bad key'}
    wait = A.net_module().rate(c, 'rt:slogin:' + dev['id'], RATE_LOGIN, now)
    if wait:
        return 429, {'error': 'too many attempts', 'retry': wait}
    err = check_pin(A, c, dev, pin_hash, ip, now)
    if err:
        return err
    token = secrets.token_urlsafe(32)
    idle = int(A.load_config().get('studentSessionMin') or 120) * 60000
    c.execute('DELETE FROM student_sessions WHERE device_id = ? AND (expires < ? OR created < ?)', (dev['id'], now, now - SESSION_CAP_MS))  # просроченные сеансы этого устройства
    c.execute('INSERT INTO student_sessions(token_hash, student_id, device_id, created, last_seen, expires) VALUES(?, ?, ?, ?, ?, ?)',
              (sha(token), dev['student_id'], dev['id'], now, now, now + min(idle, SESSION_CAP_MS)))
    return 200, {'token': token, 'exp': now + min(idle, SESSION_CAP_MS)}


def logout(A, c, key, token, now):
    sp = principal(A, c, key, token, now)
    if not sp:
        return 401, {'error': 'no session'}
    c.execute('DELETE FROM student_sessions WHERE token_hash = ?', (sha(token),))
    return 200, {'ok': True}


def me(A, c, sp):
    """GET /api/student/me → данные из базы (класс и школа — актуальные, не из токена). Имя — «Имя Ф.» (ФИО ученику не показывается)."""
    r = student_row(c, sp['id'])
    if not r:
        return 401, {'error': 'no session'}
    cls = ''
    cid = r[4].get('classId')
    if cid:
        cr = c.execute('SELECT name FROM classes WHERE id = ?', (cid,)).fetchone()
        cls = (cr[0] if cr else '') or ''
    sc = c.execute('SELECT name, district, region FROM schools WHERE id = ?', (r[2],)).fetchone() or ('', '', '')
    return 200, {'id': sp['id'], 'name': A.net_module().short_name(r[0]), 'grade': r[1], 'cls': cls, 'school': r[2], 'schoolName': sc[0] or '', 'district': sc[1] or '', 'region': sc[2] or ''}


def drop_sessions(c, sid):
    """Сеансы ученика гасятся (сброс кода входа, архив, перевод)."""
    return c.execute('DELETE FROM student_sessions WHERE student_id = ?', (sid,)).rowcount


def revoke_all(c, sid, now, by):
    """Перевод в другую школу: устройства отзываются (строки остаются, А15), сеансы удаляются, неиспользованные коды гасятся."""
    n = c.execute("UPDATE student_devices SET status = 'revoked', revoked_at = ?, revoked_by = ? WHERE student_id = ? AND status = 'active'", (now, by, sid)).rowcount
    drop_sessions(c, sid)
    c.execute('UPDATE student_pair_codes SET expires = ? WHERE student_id = ? AND used_at IS NULL AND expires > ?', (now, sid, now))
    return n


def active_count(c, sid):
    return c.execute("SELECT count(*) FROM student_devices WHERE student_id = ? AND status = 'active'", (sid,)).fetchone()[0]


def limit_of(A):
    n = A.load_config().get('studentDeviceLimit')
    return n if isinstance(n, int) and not isinstance(n, bool) and 1 <= n <= 10 else 3


# ------------------------------------------------------------------ права учителя

def can_write_student(A, c, p, doc):
    return A.student_in_scope(c, A.scope(c, p), doc)


def can_read_student(A, c, p, doc):
    if can_write_student(A, c, p, doc):
        return True
    cid = doc.get('classId') if isinstance(doc, dict) else None
    cr = A.class_row(c, cid) if cid else None
    return bool(cr) and A.class_readable(A.scope(c, p), cid, cr[0], cr[1])


def _student_or_fail(A, c, p, sid, write, who, act):
    sid = str(sid or '')[:60]
    r = student_row(c, sid) if SID_RE.match(sid) else None
    if not r:
        raise A.AdminError(404, 'Ученика нет или он вам не подчиняется.')
    if not (can_write_student(A, c, p, r[4]) if write else can_read_student(A, c, p, r[4])):
        A.audit(c, who, 'admin.denied', 'student', sid, r[2], {'why': 'scope', 'action': act})
        raise A.AdminError(403, 'Ученик вам не подчиняется.')
    return sid, r


# ------------------------------------------------------------------ действия кабинета: POST /api/admin/student.device.*

def admin(A, c, p, act, b, ip):
    who = ('user', p['id'], ip)
    now = int(time.time() * 1000)
    if A.my_rank(p) < 2:  # эксперт и ниже — нет; предметник (роль teacher) проходит, но запись ему закрыта правами на ученика
        A.audit(c, who, 'admin.denied', 'admin', act, None, {'why': 'rank'})
        raise A.AdminError(403, 'Недостаточно прав.')
    if act == 'student.device.code':
        sid, r = _student_or_fail(A, c, p, b.get('student_id'), True, who, act)
        return issue_code(A, c, p, sid, r, ip, now)
    if act == 'student.device.list':
        sid, r = _student_or_fail(A, c, p, b.get('student_id'), False, who, act)
        return list_devices(A, c, sid)
    if act == 'student.device.revoke':
        return revoke(A, c, p, b.get('id'), ip, now)
    raise A.AdminError(404, 'Нет такого действия.')


def issue_code(A, c, p, sid, r, ip, now):
    """Код привязки ученику: 8 знаков, 15 мин, одноразовый; прежний неиспользованный код гасится. Показывается один раз, в базе — sha256."""
    if r[3] != 'active':
        raise A.AdminError(400, 'Ученик в архиве: сначала верните его в класс.')
    if active_count(c, sid) >= limit_of(A):
        raise A.AdminError(400, 'Достигнут предел устройств ученика: отвяжите старое.')
    c.execute('UPDATE student_pair_codes SET expires = ? WHERE student_id = ? AND used_at IS NULL AND expires > ?', (now, sid, now))
    code = A.new_code(CODE_LEN)
    c.execute('INSERT INTO student_pair_codes(code_hash, student_id, school, created_by, created, expires, used_at) VALUES(?, ?, ?, ?, ?, ?, NULL)',
              (sha(code), sid, r[2], p['id'], now, now + CODE_TTL_MS))
    A.audit(c, ('user', p['id'], ip), 'student.device.code', 'student', sid, r[2], {'by': p['id']})
    return {'code': code, 'expires': now + CODE_TTL_MS}


def list_devices(A, c, sid):
    rows = c.execute('SELECT id, name, created, last_seen, status FROM student_devices WHERE student_id = ? ORDER BY created DESC LIMIT 50', (sid,)).fetchall()
    return {'items': [{'id': x[0], 'name': x[1] or '', 'created': x[2], 'lastSeen': x[3], 'status': x[4]} for x in rows], 'limit': limit_of(A)}


def revoke(A, c, p, dev_id, ip, now):
    dev_id = str(dev_id or '')[:20]
    row = c.execute('SELECT id, student_id, school, status FROM student_devices WHERE id = ?', (dev_id,)).fetchone() if DEV_RE.match(dev_id) else None
    if not row:
        raise A.AdminError(404, 'Устройства нет или оно вам недоступно.')
    r = student_row(c, row[1])
    who = ('user', p['id'], ip)
    if not r or not can_write_student(A, c, p, r[4]):
        A.audit(c, who, 'admin.denied', 'student', row[1], row[2], {'why': 'scope', 'action': 'student.device.revoke'})
        raise A.AdminError(403, 'Ученик вам не подчиняется.')
    if row[3] == 'active':
        c.execute("UPDATE student_devices SET status = 'revoked', revoked_at = ?, revoked_by = ? WHERE id = ?", (now, p['id'], row[0]))
        c.execute('DELETE FROM student_sessions WHERE device_id = ?', (row[0],))
        A.audit(c, who, 'student.device.revoke', 'student', row[1], row[2], {'dev': row[0], 'by': p['id']})
    return {'ok': True}


# ------------------------------------------------------------------ публичные: привязка и отвязка с устройства

def clean_name(x):
    s = ''.join(ch for ch in str(x or '') if ch.isprintable()).strip()
    return s[:40]


def pair(A, c, code, name, ip, now):
    """POST /api/student/pair → (код, тело). Любая причина отказа — 403 {error:'denied'}; лимит устройств проверяется повторно (код при этом не гасится)."""
    N = A.net_module()
    code = str(code or '').upper().replace('-', '').replace(' ', '')[:20] if isinstance(code, str) else ''
    # Класс за общим IP школы: удачные привязки не считаем, лимит — на ОШИБКИ с IP (RATE_PAIR в минуту; перебор 8 знаков за 15 мин невозможен), пауза — по IP+хэшу кода (повтор одного кода).
    fk = 'spair:' + ip + ':' + sha(code)[:8]
    fr = c.execute('SELECT n, last FROM login_fail WHERE k = ?', ('rt:spairf:' + ip,)).fetchone()
    wait = N.locked(c, fk, now)
    if not wait and fr and now - (fr[1] or 0) <= 60000 and fr[0] >= RATE_PAIR:
        wait = max(1, ((fr[1] or 0) + 60000 - now + 999) // 1000)
    if wait:
        return 429, {'error': 'too many attempts', 'retry': wait}
    row = c.execute('SELECT student_id, school, expires, used_at FROM student_pair_codes WHERE code_hash = ?', (sha(code),)).fetchone() if len(code) == CODE_LEN else None
    r = student_row(c, row[0]) if row else None
    if not row or row[3] is not None or row[2] < now or not r or r[3] != 'active' or r[2] != row[1] or not school_alive(c, row[1]):
        A.register_fail(c, fk, ip, now)
        n, last = (fr[0], fr[1] or 0) if fr else (0, 0)
        if now - last > 60000:
            n, last = 0, now
        c.execute('INSERT OR REPLACE INTO login_fail(k, n, until, last) VALUES(?, ?, 0, ?)', ('rt:spairf:' + ip, n + 1, last))
        return 403, DENIED
    if active_count(c, row[0]) >= limit_of(A):
        return 400, {'error': 'Достигнут предел устройств ученика: отвяжите старое.'}
    key = secrets.token_urlsafe(32)
    did = DEV_PREFIX + secrets.token_hex(6)
    c.execute('INSERT INTO student_devices(id, student_id, school, key_hash, name, created, last_seen, status) VALUES(?, ?, ?, ?, ?, ?, ?, ?)',
              (did, row[0], row[1], sha(key), clean_name(name) or 'Устройство', now, now, 'active'))
    c.execute('UPDATE student_pair_codes SET used_at = ? WHERE code_hash = ?', (now, sha(code)))
    c.execute('DELETE FROM login_fail WHERE k = ?', ('u:' + fk,))
    A.audit(c, ('device', did, ip), 'student.device.pair', 'student', row[0], row[1], {'dev': did, 'by': 'student'})
    cls = ''
    cid = r[4].get('classId')
    if cid:
        cr = c.execute('SELECT name FROM classes WHERE id = ?', (cid,)).fetchone()
        cls = (cr[0] if cr else '') or ''
    sch = c.execute('SELECT name FROM schools WHERE id = ?', (row[1],)).fetchone()
    return 200, {'key': key, 'student': {'id': row[0], 'name': N.short_name(r[0]), 'grade': r[1], 'cls': cls, 'schoolName': sch[0] if sch else ''}}


def unpair_self(A, c, key, pin_hash, ip, now):
    """POST /api/student/unpair: ученик отвязывает это устройство, подтвердив своим кодом."""
    dev = device_by_key(A, c, key, now)
    if not dev:
        return 401, {'error': 'bad key'}
    wait = A.net_module().rate(c, 'rt:slogin:' + dev['id'], RATE_LOGIN, now)
    if wait:
        return 429, {'error': 'too many attempts', 'retry': wait}
    err = check_pin(A, c, dev, pin_hash, ip, now)
    if err:
        return err
    c.execute("UPDATE student_devices SET status = 'revoked', revoked_at = ?, revoked_by = ? WHERE id = ?", (now, 'student', dev['id']))
    c.execute('DELETE FROM student_sessions WHERE device_id = ?', (dev['id'],))
    A.audit(c, ('device', dev['id'], ip), 'student.device.revoke', 'student', dev['student_id'], dev['school'], {'dev': dev['id'], 'by': 'student'})
    return 200, {'ok': True}
