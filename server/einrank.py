"""einrank.py — зачётные решения «Эйнштейна» и рейтинг (шаг Э3 PLAN-einstein.md, разделы 0 Р4–Р6, Р10, Р12 и 1.5). Подключается лениво (app.einrank_module()),
работает при config accounts=true и einRating=true (вход ученика по ключу устройства — ещё и studentDevices=true).
Функции получают модуль приложения A (app.py): права, журнал, пауза после ошибок, база — оттуда. После register_fail исключений не бросаем (откат стёр бы счётчик) — возвращаем (код, тело).
Зачёт — только сид, выданный сервером этому игроку; время не больше прошедшего с выдачи; первое решение без помощи. Рейтинг считает сервер по ein_stats (пересчёт restat в той же транзакции).
Наружу в рейтинге: «Имя Ф.», класс, название школы, n, среднее. Ни id учеников, ни кодов, ни ФИО, ни учителя, ни IP."""
import hmac
import json
import math
import re
import secrets
import time

SID_RE = re.compile(r'^[A-Za-z0-9_-]{1,60}$')
SEED_MAX = 2 ** 32 - 1
MIN_N = 5               # порядок «среднее время»: в рейтинг попадают от 5 зачётных решений
PAGE = 50
PAGES = 4               # топ-200
CACHE_TTL_MS = 60000
CACHE_MAX = 500
RATE_TOP = 60           # top и places: запросов в минуту на игрока
RATE_PLAY = 60          # seed и solve: в час на игрока
ISSUED_KEEP_MS = 7 * 86400 * 1000
TEACHER_GAME = False    # игра учителя и его рейтинг — шаг Т1: до него who:'t' в top → 400, seed/solve учителю → 403
DENIED = {'error': 'denied'}
SCOPES = ('school', 'district', 'region')

_CACHE = {}             # (pk, scope, idkey, order, page) -> (ts, out)
DB_HITS = 0             # сколько раз top ходил в базу (проверка кэша в тестах)


def _s(x, n=60):
    return ''.join(ch for ch in str(x if x is not None else '')[:n] if ord(ch) >= 32)


def _int(x, lo, hi):
    """Целое в пределах или None (bool и дробные не принимаются)."""
    return x if isinstance(x, int) and not isinstance(x, bool) and lo <= x <= hi else None


# ------------------------------------------------------------------ пределы

def hrate(c, key, limit, now):
    """Счётчик «не больше limit в час» на таблице login_fail (ключ 'rt:…', как netapi.rate, но окно час). Секунд ожидания или 0. Под lock."""
    row = c.execute('SELECT n, last FROM login_fail WHERE k = ?', (key,)).fetchone()
    n, last = (row[0], row[1] or 0) if row else (0, 0)
    if now - last > 3600000:
        n, last = 0, now
    n += 1
    c.execute('INSERT OR REPLACE INTO login_fail(k, n, until, last) VALUES(?, ?, 0, ?)', (key, n, last))
    return max(1, (last + 3600000 - now + 999) // 1000) if n > limit else 0


# ------------------------------------------------------------------ кто пришёл

def viewer(A, c, hdr, body, ip, now):
    """→ (who, None) или (None, (код, тело)). who = {'pk': 's'|'t'|None, 'pid', 'school', 'roles'}.
    Порядок: Bearer (учётка: пока только зритель, pk None) → X-Student + X-Stoken (сеанс ученика) → X-Key + student_id + pin_hash (шлем школы, код ученика проверяется на каждом запросе)."""
    cfg = A.load_config()
    a = hdr.get('Authorization') or ''
    tok = a[7:].strip() if a[:7].lower() == 'bearer ' else ''
    if tok:
        u = A.session_user(c, tok) if cfg['accounts'] else None
        if not u:
            return None, (401, {'error': 'no session'})
        roles = A.principal_roles(c, u['id'])
        if not roles:
            return None, (403, {'error': 'no roles'})
        return {'pk': None, 'pid': u['id'], 'school': '', 'roles': roles}, None
    if hdr.get('X-Student'):
        sp = A.studev_module().principal(A, c, hdr.get('X-Student'), hdr.get('X-Stoken') or '', now) if cfg['studentDevices'] else None
        if not sp:
            return None, (401, {'error': 'no session'})
        return {'pk': 's', 'pid': sp['id'], 'school': sp['school'], 'roles': []}, None
    key = hdr.get('X-Key') or ''
    if key:
        dr = c.execute("SELECT d.id, d.school FROM devices d JOIN schools s ON s.id = d.school WHERE d.key_hash = ? AND d.status = 'active' AND s.status != 'archived'",
                       (A.thash(key),)).fetchone() if 16 <= len(key) <= 80 else None
        if not dr:
            return None, (401, {'error': 'bad key'})
        dev = {'id': dr[0], 'school': dr[1]}
        sid = body.get('student_id') if isinstance(body.get('student_id'), str) else ''
        if not SID_RE.match(sid):
            return None, (403, DENIED)
        wait = A.net_module().locked(c, 'epin:' + sid, now)
        if wait:
            return None, (429, {'error': 'too many attempts', 'retry': wait})
        r = c.execute('SELECT school, status, doc FROM students WHERE id = ?', (sid,)).fetchone()
        stored = (A.load_doc(r[2]) or {}).get('pinHash') if r else None
        ph = body.get('pin_hash')
        ph = ph[:128] if isinstance(ph, str) else ''
        good = bool(r) and r[1] == 'active' and r[0] == dev['school'] and bool(stored) and bool(ph)
        if good:   # как netapi.student_check: класс ученика (если есть) — действующий класс этой же школы; бан бывает только в живой сессии, у шлема сессии нет
            cid = (A.load_doc(r[2]) or {}).get('classId')
            cr = c.execute('SELECT school, status FROM classes WHERE id = ?', (cid,)).fetchone() if cid else None
            good = not cid or bool(cr and cr[0] == dev['school'] and cr[1] != 'archived')
        good = good and hmac.compare_digest(ph.encode(), str(stored).encode())
        if not good:
            A.register_fail(c, 'epin:' + sid, ip, now)
            return None, (403, DENIED)
        c.execute('DELETE FROM login_fail WHERE k = ?', ('u:epin:' + sid,))
        return {'pk': 's', 'pid': sid, 'school': r[0], 'roles': []}, None
    return None, (401, {'error': 'no credentials'})


# ------------------------------------------------------------------ сид и решение

def issue_seed(A, c, who, src, now):
    """Номер головоломки игроку: случайный, не совпадающий с уже выданным или решённым им. Действует один выданный номер на игрока: новый гасит прежний (status='void'),
    выданные старше 7 суток помечаются 'expired'. Строки не стираются (А15) и в выборках не участвуют (solve берёт только status='active')."""
    pk, pid = who['pk'], who['pid']
    for _ in range(20):
        seed = secrets.randbelow(2 ** 32)
        if not c.execute('SELECT 1 FROM ein_issued WHERE pk = ? AND pid = ? AND seed = ?', (pk, pid, seed)).fetchone() \
                and not c.execute('SELECT 1 FROM ein_solves WHERE pk = ? AND pid = ? AND seed = ?', (pk, pid, seed)).fetchone():
            c.execute("UPDATE ein_issued SET status = 'expired' WHERE pk = ? AND pid = ? AND status = 'active' AND issued < ?", (pk, pid, now - ISSUED_KEEP_MS))
            c.execute("UPDATE ein_issued SET status = 'void' WHERE pk = ? AND pid = ? AND status = 'active'", (pk, pid))
            c.execute("INSERT INTO ein_issued(pk, pid, seed, issued, src, status) VALUES(?, ?, ?, ?, ?, 'active')", (pk, pid, seed, now, _s(src, 20) or None))
            return {'seed': seed, 'issued': now}
    return None


def _school_of(c, pk, pid):
    if pk == 's':
        r = c.execute('SELECT school FROM students WHERE id = ?', (pid,)).fetchone()
        return r[0] if r else None
    r = c.execute("SELECT school FROM user_roles WHERE user_id = ? AND status = 'active' AND role = 'teacher' ORDER BY school LIMIT 1", (pid,)).fetchone() \
        or c.execute("SELECT school FROM user_roles WHERE user_id = ? AND status = 'active' AND role = 'director' ORDER BY school LIMIT 1", (pid,)).fetchone()
    return r[0] if r else None


def restat(c, pk, pid):
    """Пересчёт строки ein_stats игрока по зачётным решениям (helped=0, void=0); школа — текущая (ученик: students.school; учитель: первая школа роли teacher, иначе director)."""
    n, s, last = c.execute('SELECT count(*), coalesce(sum(t), 0), max(ts) FROM ein_solves WHERE pk = ? AND pid = ? AND helped = 0 AND void = 0', (pk, pid)).fetchone()
    old = c.execute('SELECT school FROM ein_stats WHERE pk = ? AND pid = ?', (pk, pid)).fetchone()
    school = _school_of(c, pk, pid) or (old[0] if old else '')
    c.execute('INSERT OR REPLACE INTO ein_stats(pk, pid, school, n, sum_t, last_ts) VALUES(?, ?, ?, ?, ?, ?)', (pk, pid, school, n, s, last))


def _stats(c, pk, pid):
    r = c.execute('SELECT n, sum_t FROM ein_stats WHERE pk = ? AND pid = ?', (pk, pid)).fetchone()
    n, s = (r[0], r[1]) if r else (0, 0)
    return {'n': n, 'avg': round(s / n, 1) if n else None}


def _num(x, lo, hi):
    return float(x) if isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x) and lo <= x <= hi else None


def solve(A, c, who, b, now):
    """POST /api/ein/solve. Неверный формат — 400. Отказ проверки — 200 {ok:true, rated:false, reason} (клиент не повторяет)."""
    if who['pk'] not in ('s', 't'):
        return 403, DENIED
    seed = _int(b.get('seed'), 0, SEED_MAX)
    tm = _num(b.get('time'), 0, 10 ** 7)
    moves = _int(b.get('moves'), 1, 9999)
    hv = b.get('helped')
    if seed is None or tm is None or moves is None or hv not in (0, 1, True, False) or hv is None:
        return 400, {'error': 'Неверные данные.'}
    helped = 1 if hv else 0
    pk, pid = who['pk'], who['pid']
    cfg = A.load_config()

    def no(reason):
        return 200, {'ok': True, 'rated': False, 'reason': reason, 'stats': _stats(c, pk, pid)}
    iss = c.execute('SELECT issued, status FROM ein_issued WHERE pk = ? AND pid = ? AND seed = ?', (pk, pid, seed)).fetchone()
    if not iss:
        return no('not_issued')
    if c.execute('SELECT 1 FROM ein_solves WHERE pk = ? AND pid = ? AND seed = ?', (pk, pid, seed)).fetchone():
        return no('repeat')          # первое решение остаётся: время не перезаписывается, сжигание (в т.ч. «помощью») необратимо
    if iss[1] == 'void':
        return no('superseded')      # игроку выдан более новый номер: решать можно только последний выданный
    if iss[1] == 'expired':
        return no('expired')
    if now - iss[0] > cfg['einIssueTtlH'] * 3600000:
        return no('expired')
    if tm < cfg['einMinSec']:
        return no('fast')
    if tm > cfg['einMaxSec']:
        return no('slow')
    if tm > (now - iss[0]) / 1000 + 5:
        return no('fast')            # заявленное время больше прошедшего с выдачи
    t = int(round(tm))
    school = _school_of(c, pk, pid) or who.get('school') or ''
    c.execute('INSERT INTO ein_solves(pk, pid, seed, school, t, moves, helped, void, ts, src) VALUES(?, ?, ?, ?, ?, ?, ?, 0, ?, ?)',
              (pk, pid, seed, school, t, moves, helped, now, _s(b.get('src'), 20) or None))
    if helped:
        return no('helped')          # сид сожжён, в рейтинг не идёт
    restat(c, pk, pid)
    drop_cache(c, school)
    return 200, {'ok': True, 'rated': True, 'stats': _stats(c, pk, pid)}


# ------------------------------------------------------------------ кэш рейтинга

def drop_cache(c, school):
    """Сброс ответов top, в срез которых входит школа (сама школа, её район, её регион)."""
    r = c.execute('SELECT region, district FROM schools WHERE id = ?', (school,)).fetchone()
    for k in list(_CACHE):
        pk, scope, idk, _o, _p = k
        if (scope == 'school' and idk == school) or (r and ((scope == 'district' and idk == '%s|%s' % (r[0], r[1])) or (scope == 'region' and idk == r[0]))):
            _CACHE.pop(k, None)


def _cache_put(k, now, out):
    if len(_CACHE) >= CACHE_MAX:
        for kk in [kk for kk, v in _CACHE.items() if now - v[0] > CACHE_TTL_MS]:
            _CACHE.pop(kk, None)
        if len(_CACHE) >= CACHE_MAX:
            _CACHE.clear()
    _CACHE[k] = (now, out)


# ------------------------------------------------------------------ рейтинг

def _default_school(c, roles):
    for r in roles:
        if r['role'] in ('director', 'teacher', 'expert') and r.get('school') and c.execute("SELECT 1 FROM schools WHERE id = ? AND status != 'archived'", (r['school'],)).fetchone():
            return r['school']
    return None


def _slice(A, c, who, b):
    """Срез по Р10 → ((scope, idkey, cond, args, label), None) или (None, (код, тело)). Ученик — всегда свой (id игнорируется); учётка — по id или по умолчанию своя школа."""
    scope = b.get('scope') if b.get('scope') in SCOPES else 'school'
    if who['pk'] == 's' or (who['pk'] and not who['roles']):
        row = c.execute('SELECT id, name, region, district FROM schools WHERE id = ?', (who['school'],)).fetchone()
        ident = None
    else:
        ident = b.get('id')
        row = None
        sid = ident if isinstance(ident, str) else None
        if scope == 'school':
            sid = sid or _default_school(c, who['roles'])
            row = c.execute("SELECT id, name, region, district FROM schools WHERE id = ? AND status != 'archived'", (_s(sid),)).fetchone() if sid else None
            if not row:
                return None, (400, {'error': 'Выберите школу.'})
        else:
            region = district = None
            if isinstance(ident, dict):
                region, district = _s(ident.get('region')), _s(ident.get('district'))
            elif isinstance(ident, str) and ident:
                parts = ident.split('|', 1)
                region, district = _s(parts[0]), (_s(parts[1]) if len(parts) > 1 else '')
            else:
                d = _default_school(c, who['roles'])
                dr = c.execute('SELECT region, district FROM schools WHERE id = ?', (d,)).fetchone() if d else None
                if not dr:
                    return None, (400, {'error': 'Выберите район или регион.'})
                region, district = dr[0], dr[1]
            if scope == 'region':
                district = None
            if not c.execute("SELECT 1 FROM schools WHERE region = ? AND status != 'archived'" + ('' if district is None else ' AND district = ?'), (region,) + (() if district is None else (district,))).fetchone():
                return None, (400, {'error': 'Такого региона или района нет.'})
            row = (None, None, region, district)
    if not row:
        return None, (403, DENIED)
    if scope == 'school':
        return (scope, row[0], 'e.school = ?', [row[0]], row[1]), None    # индекс ein_stats(pk, school)
    if scope == 'district':
        d = row[3] or ''
        return (scope, '%s|%s' % (row[2], d), 'sc.region = ? AND sc.district = ?', [row[2], d], '%s, %s' % (d or 'район не указан', row[2])), None
    return (scope, row[2], 'sc.region = ?', [row[2]], row[2]), None


def _from(pk, cond):
    """FROM … WHERE среза (первый параметр — минимум n). Ученики — действующие, школа в сводке совпадает с текущей школой ученика, школа действующая; учителя — действующие учётки.
    Класс ученика — grade+letter из карточки класса (как S.className на клиенте), одним LEFT JOIN."""
    if pk == 's':
        return ("FROM ein_stats e JOIN students s ON s.id = e.pid AND s.status = 'active' AND s.school = e.school JOIN schools sc ON sc.id = e.school AND sc.status != 'archived' "
                "LEFT JOIN classes cl ON cl.id = json_extract(s.doc, '$.classId') WHERE e.pk = 's' AND e.n >= ? AND " + cond,
                "s.name, COALESCE(json_extract(cl.doc, '$.grade'), '') || COALESCE(json_extract(cl.doc, '$.letter'), '')")
    return ("FROM ein_stats e JOIN users s ON s.id = e.pid AND s.status = 'active' JOIN schools sc ON sc.id = e.school AND sc.status != 'archived' WHERE e.pk = 't' AND e.n >= ? AND " + cond,
            's.name, NULL')


def _query(pk, cond, order, minn):
    """Окно ROW_NUMBER по срезу — только для страницы списка (ответ кэшируется на 60 с)."""
    frm, name = _from(pk, cond)
    avg = '1.0 * e.sum_t / e.n'
    ordr = (avg + ' ASC, e.n DESC, e.last_ts ASC, e.pid ASC') if order == 'avg' else ('e.n DESC, ' + avg + ' ASC, e.last_ts ASC, e.pid ASC')
    return 'SELECT e.pid, %s, sc.name, e.n, e.sum_t, ROW_NUMBER() OVER (ORDER BY %s) AS rk %s' % (name, ordr, frm), minn


def _me(c, pk, cond, args, order, minn, pid):
    """Место зрителя без окна: одна строка его сводки + count(*) тех, кто выше (тот же порядок, что в окне страницы; сравнение средних перемножением — без дробей). → dict или None."""
    frm, _nm = _from(pk, cond)
    r = c.execute('SELECT e.n, e.sum_t, e.last_ts ' + frm + ' AND e.pid = ?', [1] + args + [pid]).fetchone()
    if not r:
        return None
    N, S, L = r[0], r[1], r[2]
    rank = None
    if N >= minn:
        if order == 'avg':
            better = '(e.sum_t * ? < ? * e.n OR (e.sum_t * ? = ? * e.n AND (e.n > ? OR (e.n = ? AND (e.last_ts < ? OR (e.last_ts = ? AND e.pid < ?))))))'
            bp = [N, S, N, S, N, N, L, L, pid]
        else:
            better = '(e.n > ? OR (e.n = ? AND (e.sum_t * ? < ? * e.n OR (e.sum_t * ? = ? * e.n AND (e.last_ts < ? OR (e.last_ts = ? AND e.pid < ?))))))'
            bp = [N, N, N, S, N, S, L, L, pid]
        rank = 1 + c.execute('SELECT count(*) ' + frm + ' AND ' + better, [minn] + args + bp).fetchone()[0]
    return {'rank': rank, 'n': N, 'avg': round(S / N, 1)}


def top(A, c, who, b, now):
    """POST /api/ein/top → (код, тело). Ответ без `me` кэшируется на 60 с; `me` — место зрителя, считается каждый раз."""
    global DB_HITS
    if b.get('who') == 't' and not TEACHER_GAME:
        return 400, {'error': 'Рейтинг учителей пока не открыт.'}
    pk = 't' if b.get('who') == 't' else 's'
    order = b.get('order') if b.get('order') in ('avg', 'count') else 'avg'
    page = _int(b.get('page'), 0, PAGES - 1) or 0
    sl, err = _slice(A, c, who, b)
    if err:
        return err
    scope, idkey, cond, args, label = sl
    minn = MIN_N if order == 'avg' else 1
    key = (pk, scope, idkey, order, page)
    hit = _CACHE.get(key)
    if hit and now - hit[0] <= CACHE_TTL_MS:
        out = dict(hit[1])
    else:
        DB_HITS += 1
        q, _m = _query(pk, cond, order, minn)
        total = c.execute('SELECT count(*) FROM (%s)' % q, [minn] + args).fetchone()[0]
        lo = page * PAGE
        rows = c.execute('SELECT * FROM (%s) WHERE rk > ? AND rk <= ?' % q, [minn] + args + [lo, min(lo + PAGE, PAGE * PAGES)]).fetchall()
        short = A.net_module().short_name
        items = []
        for pid, nm, cname, sname, n, s, rk in rows:
            it = {'rank': rk, 'name': short(nm)}
            if pk == 's':
                it['cls'] = str(cname or '')
            it.update({'school': sname, 'n': n, 'avg': round(s / n, 1)})
            items.append(it)
        out = {'who': pk, 'scope': scope, 'id': idkey, 'label': label, 'order': order, 'minN': MIN_N, 'total': min(total, PAGE * PAGES), 'items': items}
        _cache_put(key, now, out)
        out = dict(out)
    out['me'] = None
    if who['pk'] == pk:
        out['me'] = _me(c, pk, cond, args, order, minn, who['pid'])
    return 200, out


def places(A, c):
    """Регионы → районы → действующие школы (для фильтра учителя)."""
    tree = {}
    for sid, nm, rg, dt in c.execute("SELECT id, name, region, district FROM schools WHERE status != 'archived' ORDER BY region, district, name"):
        tree.setdefault(rg or '', {}).setdefault(dt or '', []).append({'id': sid, 'name': nm})
    return {'regions': [{'name': rg, 'districts': [{'name': dt, 'schools': ss} for dt, ss in ds.items()]} for rg, ds in tree.items()]}


# ------------------------------------------------------------------ вход из app.py

def handle(A, c, hdr, route, body, ip, now):
    """POST /api/ein/{seed,solve,top,places} → (код, тело). Под lock в одной транзакции."""
    who, err = viewer(A, c, hdr, body, ip, now)
    if err:
        return err
    me = who['pk'] or 'u'
    if route in ('/api/ein/seed', '/api/ein/solve'):
        if who['pk'] not in ('s', 't'):
            return 403, DENIED
        wait = hrate(c, 'rt:e%s:%s:%s' % (route[9:], who['pk'], who['pid']), RATE_PLAY, now)
        if wait:
            return 429, {'error': 'too many attempts', 'retry': wait}
        if route == '/api/ein/seed':
            out = issue_seed(A, c, who, body.get('src'), now)
            return (200, out) if out else (503, {'error': 'Попробуйте ещё раз.'})
        return solve(A, c, who, body, now)
    wait = A.net_module().rate(c, 'rt:etop:%s:%s' % (me, who['pid']), RATE_TOP, now)
    if wait:
        return 429, {'error': 'too many attempts', 'retry': wait}
    if route == '/api/ein/top':
        return top(A, c, who, body, now)
    if route == '/api/ein/places':
        return (200, places(A, c)) if who['pk'] is None else (403, DENIED)
    return 404, {'error': 'not found'}


def _admin_covers(A, c, p, rank, school):
    """Школа в зоне действия: суперадмин — любая; директор — свои школы; админ района — школы своего района; админ региона — школы своего региона (ключи ролей 'd:Регион|Район', 'r:Регион')."""
    if rank >= A.SUPER or school in A.dir_schools(p):
        return True
    sr = c.execute('SELECT region, district FROM schools WHERE id = ?', (school,)).fetchone()
    if not sr:
        return False
    for r in p.get('roles') or []:
        kp = A.key_parts(r['school']) if r['role'] in A.SCOPE_ROLES else None
        if kp and kp[0] == (sr[0] or '') and (r['role'] == 'region_admin' or kp[1] == (sr[1] or '')):
            return True
    return False


def admin(A, c, p, act, b, ip):
    """Действия кабинета: ein.void {pk, pid, seed?} — аннулировать решение(я); директор школы игрока и выше (по ролям), суперадмин. Строка остаётся (void=1): сид сожжён, пересчёт restat."""
    who = ('user', p['id'], ip)
    now = int(time.time() * 1000)
    if act != 'ein.void':
        raise A.AdminError(404, 'Нет такого действия.')
    rank = A.my_rank(p)
    if rank < A.RANK['director']:   # как need_dir в admin_action: предметник, учитель и специалист — нет
        A.audit(c, who, 'admin.denied', 'admin', act, None, {'why': 'rank'})
        raise A.AdminError(403, 'Недостаточно прав.')
    pk = b.get('pk') if b.get('pk') in ('s', 't') else 's'
    pid = _s(b.get('pid'))
    school = _school_of(c, pk, pid) if pid else None
    if not school:
        r = c.execute('SELECT school FROM ein_stats WHERE pk = ? AND pid = ?', (pk, pid)).fetchone()
        school = r[0] if r else None
    if not school:
        raise A.AdminError(404, 'Игрока нет.')
    if not _admin_covers(A, c, p, rank, school):
        A.audit(c, who, 'admin.denied', 'ein', pid, school, {'why': 'scope', 'action': act})
        raise A.AdminError(403, 'Игрок не из вашей школы.')
    if 'seed' in b and b.get('seed') is not None:
        seed = _int(b.get('seed'), 0, SEED_MAX)
        if seed is None:
            raise A.AdminError(400, 'Неверный номер головоломки.')
        n = c.execute('UPDATE ein_solves SET void = 1 WHERE pk = ? AND pid = ? AND seed = ?', (pk, pid, seed)).rowcount
    else:
        n = c.execute('UPDATE ein_solves SET void = 1 WHERE pk = ? AND pid = ?', (pk, pid)).rowcount
    if not n:
        raise A.AdminError(404, 'Решений нет.')
    restat(c, pk, pid)
    drop_cache(c, school)
    A.audit(c, who, 'ein.void', 'student' if pk == 's' else 'user', pid, school, {'pk': pk, 'n': n, 'seed': b.get('seed') if 'seed' in b else None})
    return {'ok': True, 'voided': n}
