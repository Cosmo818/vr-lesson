"""netapi.py — сессии живого урока на стороне app.py (шаг Н4, PLAN-network.md §5). Подключается лениво (app.net_module()), только при config net=true.
Функции получают модуль приложения A (app.py) первым аргументом: права (scope/class_in_scope), журнал (audit), троттлинг и база — оттуда, без копий.
Правила: ничего не удаляется (А15) — сессия закрывается, участник добавляется в banned; ответ уходит ПОСЛЕ выхода из `with db()` (вызывающий);
после register_fail исключений не бросаем (откат транзакции стёр бы счётчик) — возвращаем (код, тело)."""
import hashlib
import hmac
import json
import os
import re
import secrets
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import hubticket as HT  # noqa: E402

KINDS = ('lesson', 'play')
CHAT_MODES = ('off', 'phrases', 'text')
MOVE_MODES = ('seat', 'stand', 'walk')
ROOM_RE = re.compile(r'^[A-Za-z0-9_]{1,24}$')
SID_RE = re.compile(r'^rs-[0-9a-f]{12}$')
MAX_SEATS_HI = 200
BANNED_MAX = 200
REPORT_MAX = 64 * 1024
SIG_SKEW_MS = 60000
REPORT_SKEW_MS = 300000
CHAT_BODY_MAX = 500


def short_name(full):
    """«Фамилия Имя Отчество» → «Имя Ф.»; одно слово — как есть; ≤ 24 знака. Полное ФИО ученикам не показывается."""
    parts = [x for x in re.split(r'\s+', str(full or '').strip()) if x]
    if not parts:
        return 'Участник'
    out = parts[0] if len(parts) == 1 else '%s %s.' % (parts[1], parts[0][0].upper())
    out = ''.join(ch for ch in out if ord(ch) >= 32)
    return out[:24] or 'Участник'


# ------------------------------------------------------------------ база

def migrate_v7(A, c):
    """v6 -> v7: сессии, посещаемость, чат, трансляции, узлы hub. Одна явная транзакция, повторяема, ничего не удаляет (по образцу migrate_b74)."""
    if c.in_transaction:
        c.commit()
    c.execute('BEGIN IMMEDIATE')
    try:
        c.execute('''CREATE TABLE IF NOT EXISTS room_sessions(id TEXT PRIMARY KEY, school TEXT NOT NULL, class_id TEXT NOT NULL,
            kind TEXT NOT NULL CHECK(kind IN ('lesson', 'play')), room TEXT, host_kind TEXT, host_id TEXT, created INTEGER, closed_at INTEGER, closed_by TEXT,
            status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'closed')), hub TEXT NOT NULL DEFAULT 'center', settings TEXT NOT NULL DEFAULT '{}', code_hash TEXT)''')
        c.execute('CREATE INDEX IF NOT EXISTS room_sessions_cls ON room_sessions(class_id, status)')
        c.execute('''CREATE TABLE IF NOT EXISTS room_attend(session_id TEXT NOT NULL, uid TEXT NOT NULL, role TEXT, first INTEGER, last INTEGER, joins INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY(session_id, uid))''')
        c.execute('''CREATE TABLE IF NOT EXISTS net_chat(id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, ts INTEGER NOT NULL, uid TEXT NOT NULL,
            kind TEXT NOT NULL CHECK(kind IN ('text', 'phrase', 'emoji')), body TEXT, flag INTEGER NOT NULL DEFAULT 0, hidden_by TEXT)''')
        c.execute('CREATE UNIQUE INDEX IF NOT EXISTS net_chat_once ON net_chat(session_id, ts, uid)')  # идемпотентность отчётов hub (ts+uid)
        c.execute('''CREATE TABLE IF NOT EXISTS broadcasts(id TEXT PRIMARY KEY, session_id TEXT NOT NULL, school TEXT NOT NULL, num TEXT UNIQUE, code_hash TEXT,
            level TEXT NOT NULL CHECK(level IN ('class', 'school', 'link')), created INTEGER, ended_at INTEGER, "by" TEXT, record INTEGER NOT NULL DEFAULT 0, assets TEXT)''')
        c.execute('''CREATE TABLE IF NOT EXISTS hub_nodes(id TEXT PRIMARY KEY, school TEXT, name TEXT, kid TEXT UNIQUE, secret_enc TEXT, status TEXT, created INTEGER, last_seen INTEGER)''')
        if c.execute('PRAGMA user_version').fetchone()[0] < 7:
            c.execute('PRAGMA user_version = 7')
        c.execute('COMMIT')
    except BaseException:
        if c.in_transaction:
            c.execute('ROLLBACK')
        raise


def keys(A):
    """Ключи из hubSecret конфигурации; None, если секрета нет или он короток."""
    s = A.load_config().get('hubSecret')
    try:
        return HT.derive(s) if s else None
    except ValueError:
        return None


def sha(x):
    return hashlib.sha256(str(x).encode()).hexdigest()


def clean_settings(b, base=None, allow=('chat', 'mode', 'maxSeats', 'pointers', 'noPin', 'area_m2', 'stations', 'remote')):
    """Разбор настроек сессии: неизвестное и неверного вида отбрасывается молча (остаётся прежнее)."""
    s = dict(base or {})
    if not isinstance(b, dict):
        return s
    if 'chat' in allow and b.get('chat') in CHAT_MODES:
        s['chat'] = b['chat']
    if 'mode' in allow and b.get('mode') in MOVE_MODES:
        s['mode'] = b['mode']
    n = b.get('maxSeats')
    if 'maxSeats' in allow and isinstance(n, int) and not isinstance(n, bool) and 1 <= n <= MAX_SEATS_HI:
        s['maxSeats'] = n
    for k in ('pointers', 'noPin', 'remote'):
        if k in allow and isinstance(b.get(k), bool):
            s[k] = b[k]
    a = b.get('area_m2')
    if 'area_m2' in allow and isinstance(a, (int, float)) and not isinstance(a, bool) and 0 < a <= 1000:
        s['area_m2'] = round(float(a), 1)
    st = b.get('stations')
    if 'stations' in allow and isinstance(st, list):
        s['stations'] = clean_stations(st)
    return s


def _fnum(v, lo, hi):
    if isinstance(v, bool) or not isinstance(v, (int, float)) or v != v or v in (float('inf'), float('-inf')):
        return 0.0
    return round(float(max(lo, min(hi, float(v)))), 3)


def clean_stations(st):
    """Станции калибровки (Н9, PLAN-network.md §7.2): до 4 штук {id, x, z, yaw}; x, z — м в рамке класса (±50), yaw — градусы
    направления A→B. Старый формат Н8 (строка-имя) — станция в начале координат. Неверные элементы отбрасываются."""
    out = []
    for x in st if isinstance(st, list) else []:
        if len(out) >= 4:
            break
        if isinstance(x, str):
            if x.strip():
                out.append({'id': x.strip()[:24], 'x': 0.0, 'z': 0.0, 'yaw': 0.0})
            continue
        if not isinstance(x, dict):
            continue
        name = x.get('id')
        name = name.strip()[:24] if isinstance(name, str) else ''
        out.append({'id': name or 'Станция %d' % (len(out) + 1), 'x': _fnum(x.get('x'), -50, 50), 'z': _fnum(x.get('z'), -50, 50),
                    'yaw': _fnum(x.get('yaw'), -360, 360)})
    return out


def load_settings(raw):
    try:
        d = json.loads(raw or '{}')
        return d if isinstance(d, dict) else {}
    except ValueError:
        return {}


def sess_row(c, sid):
    return c.execute('SELECT id, school, class_id, kind, room, host_kind, host_id, created, closed_at, closed_by, status, hub, settings, code_hash FROM room_sessions WHERE id = ?', (sid,)).fetchone()


def pub_row(r):
    st = load_settings(r[12])
    return {'id': r[0], 'school': r[1], 'class_id': r[2], 'kind': r[3], 'room': r[4], 'host_id': r[6], 'created': r[7], 'closed_at': r[8], 'closed_by': r[9], 'status': r[10],
            'settings': {k: v for k, v in st.items() if k != 'banned'}, 'banned': len(st.get('banned') or []), 'remote': bool(r[13])}


def can_manage(A, c, p, row):
    """Управлять сессией: учитель этого класса, директор школы и выше (class_in_scope). Роль и класс — из базы, не из присланного."""
    cr = A.class_row(c, row[2])
    if not cr:
        return False
    return A.class_readable(A.scope(c, p), row[2], cr[0], cr[1])


# ------------------------------------------------------------------ действия кабинета: POST /api/admin/session.*

def admin(A, c, p, act, b, ip):
    who = ('user', p['id'], ip)
    now = int(time.time() * 1000)
    if A.my_rank(p) < 2:
        A.audit(c, who, 'admin.denied', 'admin', act, None, {'why': 'rank'})
        raise A.AdminError(403, 'Недостаточно прав.')
    sid = str(b.get('id') or '')[:20]
    if act == 'session.open':
        cid = str(b.get('class_id') or '')[:40]
        cr = A.class_row(c, cid)
        st = c.execute('SELECT status FROM classes WHERE id = ?', (cid,)).fetchone() if cr else None
        if not cr or not A.class_readable(A.scope(c, p), cid, cr[0], cr[1]) or st[0] != 'active':
            raise A.AdminError(404, 'Такого класса нет или он вам недоступен.')
        if b.get('kind', 'lesson') != 'lesson':
            raise A.AdminError(400, 'Игровая сессия открывается учеником (play.join).')
        room = str(b.get('room') or 'hall')
        if not ROOM_RE.match(room):
            raise A.AdminError(400, 'Неверный код комнаты.')
        if c.execute("SELECT 1 FROM room_sessions WHERE class_id = ? AND kind = 'lesson' AND status = 'open'", (cid,)).fetchone():
            raise A.AdminError(409, 'У класса уже есть открытый урок.')
        s = clean_settings(b.get('settings'), {'chat': 'off', 'mode': 'seat', 'maxSeats': 60, 'pointers': True, 'noPin': False, 'remote': False})
        code = None
        if s.get('remote'):
            code = A.new_code(6)
        sid = 'rs-' + secrets.token_hex(6)
        s['banned'] = []
        c.execute('INSERT INTO room_sessions(id, school, class_id, kind, room, host_kind, host_id, created, status, hub, settings, code_hash) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                  (sid, cr[0], cid, 'lesson', room, 'user', p['id'], now, 'open', 'center', json.dumps(s, ensure_ascii=False), sha(code) if code else None))
        A.audit(c, who, 'session.open', 'session', sid, cr[0], {'class': cid, 'room': room, 'remote': bool(code)})
        out = {'ok': True, 'id': sid}
        if code:
            out['code'] = code  # показывается один раз; в базе только хэш
        return out
    if act == 'session.list':
        sc = A.scope(c, p)
        q = "SELECT id, school, class_id, kind, room, host_kind, host_id, created, closed_at, closed_by, status, hub, settings, code_hash FROM room_sessions"
        args = []
        if b.get('class_id'):
            q += ' WHERE class_id = ?'
            args.append(str(b['class_id'])[:40])
        q += ' ORDER BY created DESC LIMIT 200'
        rows = [r for r in c.execute(q, args).fetchall() if (lambda cr: bool(cr) and A.class_readable(sc, r[2], cr[0], cr[1]))(A.class_row(c, r[2]))]
        op = [pub_row(r) for r in rows if r[10] == 'open']
        cl = [pub_row(r) for r in rows if r[10] == 'closed'][:20]
        return {'open': op, 'closed': cl}
    row = sess_row(c, sid) if SID_RE.match(sid) else None
    if not row or not can_manage(A, c, p, row):
        raise A.AdminError(404, 'Такого урока нет или он вам недоступен.')
    st = load_settings(row[12])
    if act == 'session.close':
        if row[10] == 'open':
            c.execute("UPDATE room_sessions SET status = 'closed', closed_at = ?, closed_by = ? WHERE id = ?", (now, p['id'], sid))
            A.audit(c, who, 'session.close', 'session', sid, row[1], {'class': row[2]})
        return {'ok': True}
    if row[10] != 'open':
        raise A.AdminError(409, 'Урок уже закрыт.')
    if act == 'session.settings':
        new = clean_settings(b.get('settings'), st, allow=('chat', 'mode', 'maxSeats', 'pointers', 'noPin', 'area_m2', 'stations'))
        if new != st:
            c.execute('UPDATE room_sessions SET settings = ? WHERE id = ?', (json.dumps(new, ensure_ascii=False), sid))
            A.audit(c, who, 'session.settings', 'session', sid, row[1], {k: new[k] for k in new if st.get(k) != new[k] and k != 'banned'})
        return {'ok': True}
    if act in ('session.kick', 'session.unkick'):
        uid = str(b.get('uid') or '')[:40]
        if not uid:
            raise A.AdminError(400, 'Нужен код ученика.')
        ban = list(st.get('banned') or [])
        if act == 'session.kick' and uid not in ban:
            if len(ban) >= BANNED_MAX:
                raise A.AdminError(400, 'Слишком много удалённых.')
            ban.append(uid)
        if act == 'session.unkick' and uid in ban:
            ban.remove(uid)
        st['banned'] = ban
        c.execute('UPDATE room_sessions SET settings = ? WHERE id = ?', (json.dumps(st, ensure_ascii=False), sid))
        A.audit(c, who, act, 'session', sid, row[1], {'uid': uid})
        return {'ok': True}
    if act == 'session.chat':
        A.audit(c, who, 'session.chat.view', 'session', sid, row[1], {})
        rows = c.execute('SELECT id, ts, uid, kind, body, flag, hidden_by FROM net_chat WHERE session_id = ? ORDER BY ts, id LIMIT 500', (sid,)).fetchall()
        return {'chat': [{'id': r[0], 'ts': r[1], 'uid': r[2], 'kind': r[3], 'body': r[4], 'flag': r[5], 'hidden': bool(r[6])} for r in rows]}
    raise A.AdminError(404, 'Нет такого действия.')


# ------------------------------------------------------------------ билеты

RATE_CODE = 10      # удалённый вход по коду, в минуту с одного IP
RATE_TICKET = 120   # билеты с одного шлема школы, в минуту (класс входит пачкой)


def rate(c, key, limit, now):
    """Счётчик «не больше limit за минуту» на таблице login_fail (ключ 'rt:…'). Возвращает секунд ожидания или 0. Вызывать под lock."""
    row = c.execute('SELECT n, last FROM login_fail WHERE k = ?', (key,)).fetchone()
    n, last = (row[0], row[1] or 0) if row else (0, 0)
    if now - last > 60000:
        n, last = 0, now
    n += 1
    c.execute('INSERT OR REPLACE INTO login_fail(k, n, until, last) VALUES(?, ?, 0, ?)', (key, n, last))
    return max(1, (last + 60000 - now + 999) // 1000) if n > limit else 0


def locked(c, key, now):
    row = c.execute('SELECT until FROM login_fail WHERE k = ?', ('u:' + key,)).fetchone()
    return (row[0] - now + 999) // 1000 if row and row[0] > now else 0


def hub_info(A):
    cfg = A.load_config()
    return cfg, keys(A)


def issue(A, c, row, uid, role, name, now, cfg, k):
    st = load_settings(row[12])
    pl = {'aud': cfg.get('hubId') or 'center', 'sid': row[0], 'k': row[3], 'sch': row[1], 'cls': row[2], 'uid': uid, 'r': role, 'n': short_name(name)}
    if cfg.get('hubKid'):
        pl['kid'] = cfg['hubKid']
    out = {'ticket': HT.make_ticket(k['ticket'], pl), 'exp': int(time.time()) + HT.TICKET_TTL, 'role': role,
           'hubs': [{'url': cfg['hubUrl'], 'kind': 'center'}] if cfg.get('hubUrl') else [],
           'sess': {'id': row[0], 'kind': row[3], 'room': row[4], 'chat': st.get('chat', 'off'), 'mode': st.get('mode', 'seat')}}
    return out


def student_check(A, c, row, student_id, pin_hash, ip, now, pfx='pin:'):
    """Ученик допускается в сессию: активен, школа и класс совпадают, код верный (или сессия «без кода»), не удалён. → (None, имя) или (ответ-ошибка, None).
    Общее «denied» на любую причину — чтобы не подсказывать, какого ученика нет в классе. Пауза после ошибок — как у входа (register_fail по ключу pin:<id>)."""
    sid = str(student_id or '')[:40]
    ph = str(pin_hash or '')[:128]
    if not HT._ID.match(sid):
        return (403, {'error': 'denied'}), None
    lock = locked(c, pfx + sid, now)      # пауза по ученику; общего счётчика по IP нет: класс из 30 детей входит за одним адресом школы
    if lock:
        return (429, {'error': 'too many attempts', 'retry': lock}), None
    r = c.execute('SELECT name, school, status, doc FROM students WHERE id = ?', (sid,)).fetchone()
    d = A.load_doc(r[3]) if r else {}
    st = load_settings(row[12])
    good = bool(r) and r[2] == 'active' and r[1] == row[1] and d.get('classId') == row[2] and sid not in (st.get('banned') or [])
    stored = d.get('pinHash') if good else None
    if good and stored:
        good = hmac.compare_digest(ph.encode(), str(stored).encode())
    elif good:
        good = bool(st.get('noPin'))
    if not good:
        A.register_fail(c, pfx + sid, ip, now)
        return (403, {'error': 'denied'}), None
    c.execute('DELETE FROM login_fail WHERE k = ?', ('u:' + pfx + sid,))
    return None, r[0]


def ticket(A, c, dev, user, b, ip, now):
    """POST /api/room/ticket. dev — шлем школы (X-Key) или None; user — принципал с Bearer или None; иначе — удалённый вход по коду.
    → (код, тело). Исключений после записи счётчиков нет."""
    cfg, k = hub_info(A)
    if not k:
        return 503, {'error': 'hub off'}
    sid = str(b.get('session_id') or '')[:20]
    if user is not None:
        row = sess_row(c, sid) if SID_RE.match(sid) else None
        if not row or row[10] != 'open':
            return 404, {'error': 'no session'}
        cr = A.class_row(c, row[2])
        sc = A.scope(c, user)
        mine = bool(cr) and A.class_readable(sc, row[2], cr[0], cr[1])
        expert = any(r['role'] == 'expert' and r['school'] == row[1] for r in user.get('roles') or [])
        if not mine and not expert:
            return 403, {'error': 'denied'}
        lead = bool(cr) and ((cr[1] is not None and cr[1] == user['id']) or row[6] == user['id'])  # ведущий — учитель класса или тот, кто открыл урок (предметник)
        role = 't' if lead else 'a'
        A.audit(c, ('user', user['id'], ip), 'session.ticket', 'session', sid, row[1], {'role': role})
        name = c.execute('SELECT name, login FROM users WHERE id = ?', (user['id'],)).fetchone()
        return 200, issue(A, c, row, 'u:' + user['id'], role, (name[0] or name[1]) if name else 'Учитель', now, cfg, k)
    remote = dev is None
    wait = (rate(c, 'rt:code:' + ip, RATE_CODE, now) or locked(c, 'code:' + ip, now)) if remote else rate(c, 'rt:dev:' + dev['id'], RATE_TICKET, now)
    if wait:
        return 429, {'error': 'too many attempts', 'retry': wait}
    if remote:
        code = str(b.get('code') or '').strip().upper()[:12]
        row = None
        if len(code) >= 4:
            cand = c.execute("SELECT id, school, class_id, kind, room, host_kind, host_id, created, closed_at, closed_by, status, hub, settings, code_hash FROM room_sessions WHERE code_hash = ? AND status = 'open'", (sha(code),)).fetchone()
            if cand and load_settings(cand[12]).get('remote') and hmac.compare_digest(sha(code).encode(), str(cand[13]).encode()):
                row = cand
        if not row:
            A.register_fail(c, 'code:' + ip, ip, now)
            return 403, {'error': 'denied'}
    else:
        row = sess_row(c, sid) if SID_RE.match(sid) else None
        if not row or row[10] != 'open' or row[1] != dev['school']:
            return 404, {'error': 'no session'}
    # удалённый вход считает ошибки отдельно: чужой с кодом урока не должен ставить на паузу ученика в классе
    err, name = student_check(A, c, row, b.get('student_id'), b.get('pin_hash'), ip, now, 'rpin:' if remote else 'pin:')
    if err:
        return err
    return 200, issue(A, c, row, str(b['student_id']), 's', name, now, cfg, k)


def live(A, c, school):
    """GET /api/session/live (ключ шлема): открытые сессии школы шлема — без имён и без настроек."""
    rows = c.execute("SELECT id, class_id, kind, room, created FROM room_sessions WHERE school = ? AND status = 'open' ORDER BY created DESC LIMIT 100", (school,)).fetchall()
    return {'sessions': [{'id': r[0], 'class_id': r[1], 'kind': r[2], 'room': r[3], 'created': r[4]} for r in rows]}


def play_join(A, c, dev, b, ip, now):
    """POST /api/play/join (ключ шлема): найти или открыть игровую сессию класса и выдать билет. Окно времени и кабинет — шаг Н12."""
    cid = str(b.get('class_id') or '')[:40]
    r = c.execute("SELECT school, status, json_extract(doc, '$.playAllowed') FROM classes WHERE id = ?", (cid,)).fetchone()
    if not r or r[0] != dev['school'] or r[1] != 'active' or r[2] not in (1, True):
        return 403, {'error': 'play off'}
    row = c.execute("SELECT id, school, class_id, kind, room, host_kind, host_id, created, closed_at, closed_by, status, hub, settings, code_hash FROM room_sessions WHERE class_id = ? AND kind = 'play' AND status = 'open'", (cid,)).fetchone()
    if not row:
        probe = (None, r[0], cid, 'play', 'play', None, None, None, None, None, 'open', 'center', '{}', None)   # проверка ученика до открытия сессии
        if rate(c, 'rt:dev:' + dev['id'], RATE_TICKET, now):
            return 429, {'error': 'too many attempts'}
        err, _ = student_check(A, c, probe, b.get('student_id'), b.get('pin_hash'), ip, now)
        if err:
            return err
        sid = 'rs-' + secrets.token_hex(6)
        s = {'chat': 'phrases', 'mode': 'seat', 'maxSeats': 60, 'pointers': False, 'noPin': False, 'remote': False, 'banned': []}
        c.execute('INSERT INTO room_sessions(id, school, class_id, kind, room, host_kind, host_id, created, status, hub, settings) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                  (sid, r[0], cid, 'play', 'play', 'system', dev['id'], now, 'open', 'center', json.dumps(s)))
        A.audit(c, ('device', dev['id'], ip), 'play.open', 'session', sid, r[0], {'class': cid})
        row = sess_row(c, sid)
    b = dict(b, session_id=row[0])
    return ticket(A, c, dev, None, b, ip, now)


# ------------------------------------------------------------------ hub ↔ app

def sig_ok(A, body, sig):
    k = keys(A)
    return bool(k) and HT.check_report(k['report'], body, sig)


def control(A, c, sids):
    """Что hub должен узнать: закрытые сессии, удалённые, настройки. sids — только открытые у hub и закрытые недавно."""
    out = {'closed': [], 'banned': {}, 'settings': {}}
    for sid in sids:
        r = sess_row(c, sid) if SID_RE.match(str(sid)) else None
        if not r:
            continue
        st = load_settings(r[12])
        if r[10] == 'closed':
            out['closed'].append(sid)
            continue
        if st.get('banned'):
            out['banned'][sid] = list(st['banned'])
        out['settings'][sid] = {k: st[k] for k in ('chat', 'mode', 'maxSeats', 'pointers', 'stations') if k in st}
    return out


def report(A, c, raw, ip, now):
    """POST /api/hub/report: тело уже проверено подписью. Идемпотентно: посещаемость — first=min, last=max, joins=max; чат — по (сессия, ts, uid)."""
    try:
        b = json.loads(raw.decode('utf-8'))
    except ValueError:
        return 400, {'error': 'bad json'}
    sid = str(b.get('sid') or '') if isinstance(b, dict) else ''
    ts = b.get('ts') if isinstance(b, dict) else None
    if not isinstance(ts, int) or isinstance(ts, bool) or abs(now - ts) > REPORT_SKEW_MS:   # перехваченный старый отчёт повторно не принимается
        return 400, {'error': 'stale report'}
    row = sess_row(c, sid) if SID_RE.match(sid) else None
    if not row:
        return 404, {'error': 'no session'}
    n = 0
    for a in (b.get('attend') or [])[:300]:
        if not isinstance(a, dict) or not isinstance(a.get('uid'), str) or not 0 < len(a['uid']) <= 64:
            continue
        f, l, j = (a.get(x) for x in ('first', 'last', 'joins'))
        if not all(isinstance(x, int) and not isinstance(x, bool) and 0 <= x < 4e12 for x in (f, l)) or not isinstance(j, int) or isinstance(j, bool) or not 0 <= j <= 100000:
            continue
        role = a.get('role') if a.get('role') in ('s', 't', 'a', 'v') else None
        c.execute('''INSERT INTO room_attend(session_id, uid, role, first, last, joins) VALUES(?, ?, ?, ?, ?, ?) ON CONFLICT(session_id, uid) DO UPDATE SET
                     first = MIN(first, excluded.first), last = MAX(last, excluded.last), joins = MAX(joins, excluded.joins), role = COALESCE(excluded.role, role)''', (sid, a['uid'], role, f, l, j))
        n += 1
    for m in (b.get('chat') or [])[:200]:
        if not isinstance(m, dict) or m.get('kind') not in ('text', 'phrase', 'emoji') or not isinstance(m.get('uid'), str) or not isinstance(m.get('ts'), int):
            continue
        body = m.get('text') if m.get('kind') == 'text' else str(m.get('code', ''))
        c.execute('INSERT OR IGNORE INTO net_chat(session_id, ts, uid, kind, body, flag) VALUES(?, ?, ?, ?, ?, ?)',
                  (sid, m['ts'], m['uid'][:64], m['kind'], str(body or '')[:CHAT_BODY_MAX], 1 if m.get('flag') else 0))
    kicked = [u for u in (b.get('kicked') or [])[:50] if isinstance(u, str) and 0 < len(u) <= 40]
    if kicked and row[10] == 'open':
        st = load_settings(row[12])
        ban = list(st.get('banned') or [])
        new = [u for u in kicked if u not in ban][:max(0, BANNED_MAX - len(ban))]
        if new:
            st['banned'] = ban + new
            c.execute('UPDATE room_sessions SET settings = ? WHERE id = ?', (json.dumps(st, ensure_ascii=False), sid))
            A.audit(c, ('cli', 'hub:center', ip), 'session.kick', 'session', sid, row[1], {'uids': new, 'via': 'hub'})
    if b.get('final') and row[3] == 'play' and row[10] == 'open':   # игровая опустела (hub её забыл) — закрываем; урок закрывает только учитель
        c.execute("UPDATE room_sessions SET status = 'closed', closed_at = ?, closed_by = 'hub' WHERE id = ?", (now, sid))
        A.audit(c, ('cli', 'hub:center', ip), 'session.close', 'session', sid, row[1], {'why': 'empty', 'kind': 'play'})
    return 200, control(A, c, [sid])


def hub_sessions(A, c):
    """GET /api/hub/sessions: открытые и закрытые за сутки (hub 'center') — запасной путь узнать о закрытии из кабинета."""
    now = int(time.time() * 1000)
    ids = [r[0] for r in c.execute("SELECT id FROM room_sessions WHERE hub = 'center' AND (status = 'open' OR closed_at > ?) LIMIT 500", (now - 86400000,))]
    return control(A, c, ids)
