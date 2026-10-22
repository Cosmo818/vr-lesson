"""Проверки шагов 4–5 PLAN.md: пароли, настройки, команды суперадмина, вход и сессии. Запуск: python3 -I tests/accounts.py (из корня репозитория).
Печатает строки «ok  : …» и «FAIL: …»; tests/run.js включает их в общий счёт. Настоящий сервер во временной папке, настоящий PBKDF2 (600 000 итераций)."""
import json, os, sqlite3, subprocess, sys, tempfile, time, urllib.error, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = os.path.join(ROOT, 'server', 'app.py')
tmp = tempfile.mkdtemp()
PORT = 8797
fails = 0
SECRET = 'Strong-Pass-2026-xQ'
NEWPW = 'Другая-длинная-фраза-77'


def ok(c, m):
    global fails
    print(('ok  : ' if c else 'FAIL: ') + m, flush=True)
    if not c:
        fails += 1


env = dict(os.environ, DATA_DIR=tmp, PORT=str(PORT), TEACHER_KEY='teach-secret', DEVICE_KEY='dev-secret')


def cli(*args, stdin=''):
    return subprocess.run([sys.executable, '-I', APP, *args], input=stdin, capture_output=True, text=True, env=env, timeout=120)


def sql(q, *a):
    c = sqlite3.connect(os.path.join(tmp, 'vrlesson.db'))
    try:
        r = c.execute(q, a).fetchall()
        c.commit()
        return r
    finally:
        c.close()


def req(method, path, body=None, headers=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request('http://127.0.0.1:%d%s' % (PORT, path), data=data, method=method, headers=dict({'Content-Type': 'application/json'}, **(headers or {})))
    try:
        with urllib.request.urlopen(r, timeout=60) as f:
            return f.status, json.loads(f.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or '{}')


def bearer(t):
    return {'Authorization': 'Bearer ' + t}


# ---- чистые функции (без сервера)
sys.path.insert(0, os.path.join(ROOT, 'server'))
os.environ.update(DATA_DIR=tmp)
import app  # noqa: E402

h1, h2 = app.hash_pw(SECRET), app.hash_pw(SECRET)
ok(SECRET not in h1 and h1.startswith('pbkdf2_sha256$600000$'), 'пароли: хэш не равен паролю, параметры в строке')
ok(h1 != h2, 'пароли: у одинаковых паролей разная соль')
ok(app.check_pw(SECRET, h1) and not app.check_pw(SECRET + 'x', h1) and not app.check_pw('', h1), 'пароли: верный проходит, неверный нет')
ok(app.parse_hash(h1)[0] == 600000 and app.parse_hash('мусор') is None and not app.check_pw(SECRET, '') and not app.check_pw(SECRET, 'a$b$c$d'), 'пароли: строка хэша разбирается, битая и пустая не пускают')
old = app.hash_pw(SECRET, iters=1000)
ok(app.check_pw(SECRET, old) and app.needs_rehash(old) and not app.needs_rehash(h1), 'пароли: хэш со старым числом итераций работает и помечен на перехэш')
ok(app.pw_error('коротко') and app.pw_error('boss.one.1', 'boss.one.1') and app.pw_error('1234567890') and app.pw_error('a' * 12) and app.pw_error('x' * 129), 'пароли: короткий, равный логину, частый, из одного символа, слишком длинный — отклонены')
ok(app.pw_error(SECRET, 'boss') is None and app.pw_error('Длинная фраза про урок', 'x') is None, 'пароли: длинная фраза с пробелами принимается')
ok(app.login_error('ab') and app.login_error('Иванов') and app.login_error('admin') and app.login_error('a b c') and app.login_error('boss.one') is None, 'логин: кириллица, короткий, зарезервированный и с пробелом отклонены')

# ---- команды суперадмина
r = cli('create-superadmin', 'boss.one', stdin=SECRET + '\n' + SECRET + '\n')
ok(r.returncode == 0 and 'создан' in r.stdout, 'CLI: суперадмин создан')
ok(cli('create-superadmin', 'boss.two', stdin=SECRET + '\nдругое\n').returncode == 1, 'CLI: разные пароли при вводе — отказ')
ok(cli('create-superadmin', 'admin', stdin=SECRET + '\n' + SECRET + '\n').returncode == 1, 'CLI: зарезервированный логин — отказ')
ok(cli('create-superadmin', 'boss.three', stdin='short\nshort\n').returncode == 1, 'CLI: слабый пароль — отказ')
ok(cli('create-superadmin', 'BOSS.ONE', stdin=SECRET + '\n' + SECRET + '\n').returncode == 1, 'CLI: логин занят (без учёта регистра)')
au = sql("select actor_kind, action, target_kind from audit_log where action in ('user.create','role.add')")
ok(('cli', 'user.create', 'user') in au and ('cli', 'role.add', 'user') in au, 'CLI: в журнале user.create и role.add от cli')
ok(sql("select count(*) from user_roles where role='superadmin' and school=''")[0][0] == 1, 'CLI: роль суперадмина записана')
ok(sql('select pw from users')[0][0] != SECRET and SECRET not in ' '.join(str(x) for x in sql('select detail from audit_log')), 'CLI: пароля нет в журнале, в базе только хэш')
ok(cli('set-session-minutes', '4').returncode == 1 and cli('set-session-minutes', '301').returncode == 1 and cli('set-session-minutes', 'x').returncode == 1, 'CLI: срок сессии вне 5–300 минут отклонён')

# ---- сервер
log = open(os.path.join(tmp, 'server.log'), 'w')
srv = subprocess.Popen([sys.executable, '-I', APP], env=env, stdout=log, stderr=log)
try:
    for _ in range(50):
        try:
            if req('GET', '/api/health')[0] == 200:
                break
        except Exception:
            time.sleep(.2)
    st, b = req('POST', '/api/auth/login', {'login': 'boss.one', 'password': SECRET})
    ok(st == 404, 'флаг выключен: вход отвечает 404')
    ok(req('GET', '/api/auth/me')[0] == 404 and req('POST', '/api/auth/password', {})[0] == 404, 'флаг выключен: me и password тоже 404')
    st, b = req('POST', '/api/sync', {}, {'X-Key': 'teach-secret'})
    ok(st == 200 and b['role'] == 'teacher', 'флаг выключен: синхронизация по ключу работает как прежде')
    cli('accounts', 'on')
    ok(json.load(open(os.path.join(tmp, 'config.json')))['accounts'] is True, 'флаг: config.json включён командой, перезапуск не нужен')
    ok(req('POST', '/api/auth/login', {'login': 'boss.one', 'password': SECRET})[0] == 200, 'флаг включён: вход заработал без перезапуска')

    st, b = req('POST', '/api/auth/login', {'login': 'Boss.One', 'password': SECRET})
    tok = b.get('token', '')
    ok(st == 200 and len(tok) >= 40 and b['roles'] == [{'role': 'superadmin', 'school': ''}] and b['user']['login'] == 'boss.one', 'вход: токен и роли (логин без учёта регистра)')
    ok('pw' not in json.dumps(b) and SECRET not in json.dumps(b), 'вход: в ответе нет хэша и пароля')
    ok(sql('select count(*) from sessions where token_hash = ?', tok)[0][0] == 0 and sql('select count(*) from sessions')[0][0] >= 1, 'вход: в базе не токен, а его хэш')
    st, b = req('GET', '/api/auth/me', headers=bearer(tok))
    ok(st == 200 and b['roles'][0]['role'] == 'superadmin', 'me: роли читаются из базы')
    ok(req('GET', '/api/auth/me')[0] == 401 and req('GET', '/api/auth/me', headers=bearer('foreign-token'))[0] == 401, 'me: без токена и с чужим токеном — 401')
    st, b = req('POST', '/api/sync', {}, {'X-Key': 'teach-secret'})
    ok(st == 200, 'флаг включён: старый ключ teacher продолжает работать')

    # одинаковый ответ на неверный пароль и неизвестный логин
    s1, b1 = req('POST', '/api/auth/login', {'login': 'boss.one', 'password': 'неверный-пароль-1'})
    s2, b2 = req('POST', '/api/auth/login', {'login': 'nobody.here', 'password': 'неверный-пароль-1'})
    ok(s1 == s2 == 401 and b1 == b2, 'вход: неверный пароль и неизвестный логин дают одинаковый ответ')
    # пауза после 5 ошибок
    for _ in range(3):
        req('POST', '/api/auth/login', {'login': 'boss.one', 'password': 'неверный-пароль-2'})
    s5, _ = req('POST', '/api/auth/login', {'login': 'boss.one', 'password': 'неверный-пароль-3'})
    st, b = req('POST', '/api/auth/login', {'login': 'boss.one', 'password': SECRET})
    ok(s5 == 401 and st == 429 and 1 <= b['retry'] <= 30, 'подбор: после 5 ошибок даже верный пароль ждёт (429, пауза %s с)' % b.get('retry'))
    st, b = req('POST', '/api/auth/login', {'login': 'nobody.here', 'password': 'x'})
    ok(sql("select n from login_fail where k='u:boss.one'")[0][0] == 5, 'подбор: счётчик по логину = 5')
    sql("update login_fail set until = ? where k = 'u:boss.one'", int(time.time() * 1000) - 1)
    st, b = req('POST', '/api/auth/login', {'login': 'boss.one', 'password': SECRET})
    ok(st == 200 and sql("select count(*) from login_fail where k='u:boss.one'")[0][0] == 0, 'подбор: после паузы вход проходит и счётчик сброшен (%s %s)' % (st, sql('select * from login_fail')))
    tok = b['token']
    # рост паузы
    sql("insert or replace into login_fail(k,n,until,last) values('u:slow.one',7,0,0)")
    for _ in range(1):
        req('POST', '/api/auth/login', {'login': 'slow.one', 'password': 'неверный-пароль-4'})
    st, b = req('POST', '/api/auth/login', {'login': 'slow.one', 'password': 'неверный-пароль-4'})
    ok(st == 429 and 200 < b['retry'] <= 240, 'подбор: пауза растёт вдвое (8-я ошибка → 240 с, получено %s)' % b.get('retry'))
    # лимит по IP
    sql("insert or replace into login_fail(k,n,until,last) values('i:127.0.0.1',20,0,?)", int(time.time() * 1000))
    st, b = req('POST', '/api/auth/login', {'login': 'boss.one', 'password': SECRET})
    ok(st == 429 and b['retry'] <= 60, 'подбор: больше 20 попыток в минуту с одного адреса — 429')
    sql("delete from login_fail where k like 'i:%'")

    # срок сессии
    now = int(time.time() * 1000)
    sql('update sessions set last_seen = ?', now - 16 * 60000)
    ok(req('GET', '/api/auth/me', headers=bearer(tok))[0] == 401, 'сессия: простой дольше 15 минут — 401')
    st, b = req('POST', '/api/auth/login', {'login': 'boss.one', 'password': SECRET})
    tok = b['token']
    sql('update sessions set last_seen = ?', now - 10 * 60000)
    ok(req('GET', '/api/auth/me', headers=bearer(tok))[0] == 200, 'сессия: 10 минут простоя — ещё жива и продлевается')
    cli('set-session-minutes', '5')
    sql('update sessions set last_seen = ?', int(time.time() * 1000) - 6 * 60000)
    ok(req('GET', '/api/auth/me', headers=bearer(tok))[0] == 401, 'сессия: смена срока на 5 минут действует на открытые сессии')
    ok(sql("select count(*) from audit_log where action = 'config.session_minutes'")[0][0] == 1, 'сессия: смена срока записана в журнал')
    cli('set-session-minutes', '15')
    st, b = req('POST', '/api/auth/login', {'login': 'boss.one', 'password': SECRET})
    tok = b['token']
    sql('update sessions set created = ?, last_seen = ?', int(time.time() * 1000) - 13 * 3600000, int(time.time() * 1000))
    ok(req('GET', '/api/auth/me', headers=bearer(tok))[0] == 401, 'сессия: потолок 12 часов от входа')

    # выход
    st, b = req('POST', '/api/auth/login', {'login': 'boss.one', 'password': SECRET})
    tok = b['token']
    ok(req('POST', '/api/auth/logout', {}, bearer(tok))[0] == 200 and req('GET', '/api/auth/me', headers=bearer(tok))[0] == 401, 'выход: токен перестаёт работать')

    # смена пароля
    st, b = req('POST', '/api/auth/login', {'login': 'boss.one', 'password': SECRET})
    t1 = b['token']
    st, b = req('POST', '/api/auth/login', {'login': 'boss.one', 'password': SECRET})
    t2 = b['token']
    ok(req('POST', '/api/auth/password', {'old': 'не-тот-пароль-1', 'new': NEWPW}, bearer(t1))[0] == 403, 'пароль: неверный старый — 403')
    ok(req('POST', '/api/auth/password', {'old': SECRET, 'new': 'короткий'}, bearer(t1))[0] == 400, 'пароль: слабый новый — 400')
    st, b = req('POST', '/api/auth/password', {'old': SECRET, 'new': NEWPW}, bearer(t1))
    t3 = b.get('token', '')
    ok(st == 200 and req('GET', '/api/auth/me', headers=bearer(t1))[0] == 401 and req('GET', '/api/auth/me', headers=bearer(t2))[0] == 401, 'пароль: после смены все прежние сессии отозваны')
    ok(req('GET', '/api/auth/me', headers=bearer(t3))[0] == 200, 'пароль: новая сессия работает')
    sql("delete from login_fail")
    ok(req('POST', '/api/auth/login', {'login': 'boss.one', 'password': NEWPW})[0] == 200 and req('POST', '/api/auth/login', {'login': 'boss.one', 'password': SECRET})[0] == 401, 'пароль: входит новый, старый нет')

    # сброс через CLI отзывает сессии
    st, b = req('POST', '/api/auth/login', {'login': 'boss.one', 'password': NEWPW})
    tr = b['token']
    sql("delete from login_fail")
    r = cli('reset-password', 'boss.one', stdin=SECRET + '\n' + SECRET + '\n')
    ok(r.returncode == 0 and req('GET', '/api/auth/me', headers=bearer(tr))[0] == 401, 'сброс: команда меняет пароль и закрывает сессии')
    ok(cli('reset-password', 'no.such', stdin=SECRET + '\n' + SECRET + '\n').returncode == 1, 'сброс: неизвестный логин — отказ')
    st, b = req('POST', '/api/auth/login', {'login': 'boss.one', 'password': SECRET})
    ta = b['token']

    # архивный пользователь
    sql("update users set status = 'archived'")
    ok(req('GET', '/api/auth/me', headers=bearer(ta))[0] == 401, 'архив: открытая сессия архивного пользователя не работает')
    sql("delete from login_fail")
    s3, b3 = req('POST', '/api/auth/login', {'login': 'boss.one', 'password': SECRET})
    ok(s3 == 401 and b3 == b1, 'архив: вход отклонён тем же ответом, что и неверный пароль')
    sql("update users set status = 'active'")

    # плохие запросы
    ok(req('POST', '/api/auth/login', {'login': 5, 'password': []})[0] == 401, 'вход: нестроковые поля — 401, не сбой сервера')
    ok(req('GET', '/api/health')[0] == 200, 'сервер жив после всех проверок')
finally:
    srv.terminate()
    srv.wait(timeout=10)
    log.close()

lg = open(os.path.join(tmp, 'server.log'), encoding='utf-8').read()
ok(SECRET not in lg and NEWPW not in lg and 'Authorization' not in lg, 'журнал сервера: нет паролей и заголовков')
allq = ' '.join(str(x) for x in sql('select detail, actor_id, target_id, ip from audit_log'))
ok(SECRET not in allq and NEWPW not in allq and 'pbkdf2' not in allq, 'аудит: нет паролей и хэшей')
acts = {r[0] for r in sql('select action from audit_log')}
ok({'auth.login', 'auth.logout', 'auth.lockout', 'user.password_change', 'user.password_reset', 'config.accounts'} <= acts, 'аудит: вход, выход, блокировка, смена и сброс пароля, переключение флага записаны (%s)' % sorted(acts))
ok(sql("select count(*) from audit_log where actor_kind='user' and action='auth.login'")[0][0] >= 5, 'аудит: входы записаны от user')
sys.exit(1 if fails else 0)
