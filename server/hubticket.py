"""hubticket.py — билеты входа в живой урок и подпись отчётов hub (PLAN-network.md §5.3, §4.6). Только stdlib.
Общий модуль: билет выпускает server/app.py (шаг Н4), проверяет server/hub.py. Секрет hubSecret (32 байта, hex или base64)
лежит только в config.json (0600); ключи выводятся из него: k_ticket = HMAC(secret,'ticket'), k_report = HMAC(secret,'report').

Билет: b64url(payload) + '.' + b64url(HMAC-SHA256(k_ticket, payload)[:16]), payload — компактный JSON:
  {v:1, kid, aud, sid, k:'lesson'|'play', sch, cls, uid, r:'s'|'t'|'a', n:'Имя Ф.', exp, j}
Поле k (вид сессии) добавлено к плану: hub создаёт сессию в памяти по первому верному билету и должен знать её вид."""
import base64
import binascii
import hashlib
import hmac
import json
import os
import re
import time

TICKET_TTL = 60
ROLES = ('s', 't', 'a')
KINDS = ('lesson', 'play')
_ID = re.compile(r'^[A-Za-z0-9_.:-]{1,64}$')


def b64u(b):
    return base64.urlsafe_b64encode(b).rstrip(b'=').decode('ascii')


def unb64u(s):
    if not isinstance(s, str) or len(s) > 4096 or not re.fullmatch(r'[A-Za-z0-9_-]*', s):
        raise ValueError('b64')
    return base64.urlsafe_b64decode(s + '=' * (-len(s) % 4))


def secret_bytes(secret):
    """hubSecret из config.json: hex (64 знака) или base64; меньше 32 байт — ошибка."""
    if isinstance(secret, bytes):
        raw = secret
    else:
        s = str(secret or '').strip()
        try:
            raw = bytes.fromhex(s)
        except ValueError:
            try:
                raw = base64.b64decode(s, validate=True)
            except (binascii.Error, ValueError):
                raw = b''
    if len(raw) < 32:
        raise ValueError('hubSecret короче 32 байт')
    return raw


def derive(secret):
    raw = secret_bytes(secret)
    return {'ticket': hmac.new(raw, b'ticket', hashlib.sha256).digest(), 'report': hmac.new(raw, b'report', hashlib.sha256).digest()}


def make_ticket(k_ticket, p, now=None):
    """p — поля билета без exp/j/v (их ставит функция). Возвращает строку билета."""
    now = time.time() if now is None else now
    q = dict(p)
    q.setdefault('v', 1)
    q.setdefault('exp', int(now) + TICKET_TTL)
    q.setdefault('j', b64u(os.urandom(12)))
    raw = json.dumps(q, ensure_ascii=False, separators=(',', ':'), sort_keys=True).encode('utf-8')
    return b64u(raw) + '.' + b64u(hmac.new(k_ticket, raw, hashlib.sha256).digest()[:16])


def verify_ticket(tok, k_ticket, now, aud, used, kid=None):
    """→ dict билета или None. used — dict j→exp одноразовых меток (функция дописывает в него при успехе).
    Проверки: формат, подпись (compare_digest), v, kid, aud, exp (не просрочен и не дальше 10 мин вперёд), поля, повтор j."""
    try:
        if not isinstance(tok, str) or len(tok) > 1200 or tok.count('.') != 1:
            return None
        a, b = tok.split('.')
        raw, sig = unb64u(a), unb64u(b)
        if len(sig) != 16 or not hmac.compare_digest(sig, hmac.new(k_ticket, raw, hashlib.sha256).digest()[:16]):
            return None
        p = json.loads(raw.decode('utf-8'))
    except (ValueError, UnicodeDecodeError):
        return None
    if not isinstance(p, dict) or p.get('v') != 1:
        return None
    if kid is not None and p.get('kid') != kid:
        return None
    if p.get('aud') != aud:
        return None
    exp = p.get('exp')
    if not isinstance(exp, int) or isinstance(exp, bool) or exp < now or exp > now + 600:
        return None
    for f in ('sid', 'sch', 'cls', 'uid'):
        if not isinstance(p.get(f), str) or not _ID.match(p[f]):
            return None
    if p.get('r') not in ROLES or p.get('k') not in KINDS:
        return None
    n = p.get('n')
    if not isinstance(n, str) or not 0 < len(n) <= 24 or any(ord(ch) < 32 for ch in n):
        return None
    j = p.get('j')
    if not isinstance(j, str) or not 8 <= len(j) <= 32 or j in used:
        return None
    used[j] = exp
    return p


def prune_used(used, now):
    for j in [j for j, e in used.items() if e < now]:
        del used[j]


def sign_report(k_report, body):
    """Подпись отчёта hub → app.py: hex HMAC-SHA256 тела (bytes)."""
    return hmac.new(k_report, body, hashlib.sha256).hexdigest()


def check_report(k_report, body, sig):
    return isinstance(sig, str) and hmac.compare_digest(sign_report(k_report, body), sig)
