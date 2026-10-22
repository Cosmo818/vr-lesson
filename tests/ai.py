"""Помощник на GigaChat (Б61): модуль необязательный. Вместо настоящего GigaChat — поддельный сервер на 8802.
Запуск: python3 tests/ai.py (сервер на 8801). Проверяет: выключен → 404, права, лимит, отказ вне темы, мусор в ответе, сбой сети не ломает сервер."""
import json, os, subprocess, sys, tempfile, threading, time, urllib.request, urllib.error, sqlite3
from http.server import BaseHTTPRequestHandler, HTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
tmp = tempfile.mkdtemp(); PORT = 8801; FAKE = 8802; fails = []
sys.path.insert(0, os.path.join(ROOT, 'server'))
os.environ['DATA_DIR'] = tmp
import app  # noqa: E402

WHO = ('cli', 'test', ''); NOW = int(time.time() * 1000)
app.init_db()
PW = lambda u: 'Pass-%s-2026-Zq' % u  # noqa: E731
with app.db() as c:
    c.execute("INSERT INTO schools(id, name, region, status, network, created, updated) VALUES('s-a', 's-a', '', 'active', '', ?, ?)", (NOW, NOW))
    for k, role, sch in (('tA', 'teacher', 's-a'), ('xA', 'expert', 's-a')):
        u = app.user_create(c, 'u.' + k.lower(), k, PW(k), WHO); app.role_add(c, u, role, sch, WHO)
app.save_config({'accounts': True, 'legacyTeacher': True, 'sessionMinutes': 15, 'openRooms': False, 'ai': False, 'aiDaily': 4})
open(os.path.join(tmp, 'ai.json'), 'w').write(json.dumps({'authUrl': 'http://127.0.0.1:%d/oauth' % FAKE, 'apiUrl': 'http://127.0.0.1:%d/chat' % FAKE}))

MODE = {'v': 'good'}; SEEN = []
GOOD_ROOM = {'title': 'Фотосинтез', 'hint': 'Нажми на предметы', 'env': 'forest', 'blocks': [
    {'type': 'text', 'title': 'Что такое фотосинтез', 'text': 'Растения превращают свет в сахар.', 'x': 0, 'z': -5.2},
    {'type': 'item', 'label': 'Лист', 'info': 'Здесь идёт фотосинтез.', 'shape': 'ball', 'color': 'green', 'x': 0, 'z': -3, 'lift': 0.8},
    {'type': 'script', 'code': 'alert(1)'},
    {'type': 'item', 'label': 'Плохой', 'info': '<img src=x onerror=alert(1)>', 'shape': 'EVIL', 'color': 'javascript:1', 'x': 99, 'z': -99},
    {'type': 'question', 'q': 'Что поглощает растение?', 'a0': 'Углекислый газ', 'a1': 'Кислород', 'a2': 'Азот', 'explain': 'CO2 — сырьё для сахара.', 'x': 5.2, 'z': -1}]}
GOOD_Q = {'questions': [{'q': 'Сколько будет 2+2?', 'a0': '4', 'a1': '5', 'a2': '4', 'explain': 'Просто.'}, {'q': 'Сколько будет 3+3?', 'a0': '6', 'a1': '7'}, {'q': 'Без ответа', 'a0': 'x'}]}


class Fake(BaseHTTPRequestHandler):
    def log_message(self, *a): pass

    def do_POST(self):
        n = int(self.headers.get('Content-Length') or 0); body = self.rfile.read(n).decode()
        def out(code, obj):
            b = json.dumps(obj).encode(); self.send_response(code); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b)
        if self.path == '/oauth':
            SEEN.append(('oauth', self.headers.get('Authorization'), self.headers.get('RqUID'), body))
            return out(200, {'access_token': 'tok-1', 'expires_at': int((time.time() + 1800) * 1000)})
        SEEN.append(('chat', self.headers.get('Authorization'), json.loads(body)))
        m = MODE['v']
        if m == 'down':
            return out(500, {'error': 'x'})
        if m == 'refuse':
            text = '{"refuse": true}'
        elif m == 'junk':
            text = 'Конечно! Вот ответ, но не JSON.'
        elif 'вопросов' in json.loads(body)['messages'][1]['content']:
            text = 'Вот:\n' + json.dumps(GOOD_Q, ensure_ascii=False)
        else:
            text = json.dumps(GOOD_ROOM, ensure_ascii=False)
        out(200, {'choices': [{'message': {'role': 'assistant', 'content': text}}], 'usage': {'total_tokens': 321}})


threading.Thread(target=HTTPServer(('127.0.0.1', FAKE), Fake).serve_forever, daemon=True).start()
srv = subprocess.Popen([sys.executable, '-I', os.path.join(ROOT, 'server', 'app.py')], env=dict(os.environ, DATA_DIR=tmp, PORT=str(PORT), TEACHER_KEY='teach-secret', DEVICE_KEY='dev-secret'), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
for _ in range(50):
    try:
        urllib.request.urlopen('http://127.0.0.1:%d/api/health' % PORT, timeout=2); break
    except Exception:
        time.sleep(.2)


def ok(c, m):
    print(('ok  : ' if c else 'FAIL: ') + m, flush=True)
    if not c:
        fails.append(m)


def call(method, path, data=None, h=None):
    hd = dict(h or {}); body = None
    if data is not None:
        body = json.dumps(data).encode(); hd['Content-Type'] = 'application/json'
    r = urllib.request.Request('http://127.0.0.1:%d%s' % (PORT, path), data=body, method=method, headers=hd)
    try:
        with urllib.request.urlopen(r, timeout=60) as f:
            return f.status, json.loads(f.read() or b'{}')
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b'{}')


def clear():
    k = sqlite3.connect(os.path.join(tmp, 'vrlesson.db')); k.execute('DELETE FROM login_fail'); k.commit(); k.close()


TOK = {}


def H(u):
    if u not in TOK:
        clear(); st, b = call('POST', '/api/auth/login', {'login': 'u.' + u.lower(), 'password': PW(u)}); TOK[u] = b['token']
    return {'Authorization': 'Bearer ' + TOK[u]}


def cli(*a):
    return subprocess.run([sys.executable, '-I', os.path.join(ROOT, 'server', 'app.py'), *a], env=dict(os.environ, DATA_DIR=tmp), capture_output=True, text=True)


try:
    st, _ = call('GET', '/api/ai/status', None, H('tA'))
    ok(st == 404, 'помощник выключен: адреса отвечают 404, как будто их нет')
    ok(call('GET', '/api/health')[0] == 200, 'остальной сервер работает')
    r = cli('ai', 'on'); ok('включён' in r.stdout and 'не задан' in r.stdout, 'команда «ai on»: включён, ключ не задан (%s)' % r.stdout.strip())
    st, b = call('POST', '/api/ai/room', {'topic': 'фотосинтез', 'grade': 6}, H('tA'))
    ok(st == 503 and 'не настроен' in b['error'], 'без ключа: понятное сообщение, 503')
    open(os.path.join(tmp, 'ai.key'), 'w').write('QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=')
    st, b = call('GET', '/api/ai/status', None, H('tA')); ok(st == 200 and b['keySet'] and b['left'] == 4, 'статус: ключ есть, осталось 4 запроса (%s)' % b)
    ok(call('GET', '/api/ai/status', None, H('xA'))[0] == 403, 'специалисту помощник недоступен')
    ok(call('GET', '/api/ai/status', None, {'X-Key': 'dev-secret'})[0] in (401, 403), 'шлему и старому ключу недоступен')
    ok(call('POST', '/api/ai/room', {'topic': 'x'})[0] in (401, 403), 'без входа недоступен')
    st, b = call('POST', '/api/ai/room', {'topic': 'фотосинтез', 'grade': 6, 'subj': 'bio'}, H('tA'))
    ok(st == 200 and b['left'] == 3, 'черновик комнаты получен')
    sp = b.get('spec', {})
    types = [x['type'] for x in sp.get('blocks', [])]
    ok(sp.get('title') == 'Фотосинтез' and 'script' not in types and types.count('item') == 2 and 'question' in types, 'лишний тип блока отброшен (%s)' % types)
    bad = [x for x in sp['blocks'] if x.get('label') == 'Плохой'][0]
    ok(bad['shape'] == 'cube' and bad['color'] == 'orange' and bad['x'] == 5.4 and bad['z'] == -5.4, 'неверные форма, цвет и координаты исправлены (%s)' % bad)
    ok(all(k in ('type', 'x', 'z', 'y', 'w', 'title', 'text', 'accent', 'label', 'info', 'shape', 'color', 'size', 'lift', 'spin', 'discover', 'q', 'a0', 'a1', 'a2', 'a3', 'explain', 'd', 'h', 'asset') for x in sp['blocks'] for k in x), 'в блоках только известные поля')
    chat = [s for s in SEEN if s[0] == 'chat'][-1]
    ok(chat[1] == 'Bearer tok-1' and chat[2]['messages'][0]['role'] == 'system' and 'refuse' in chat[2]['messages'][0]['content'], 'запрос ушёл с токеном и системным промптом об ограничении темы')
    ok('фотосинтез' in chat[2]['messages'][1]['content'] and 'u.ta' not in json.dumps(chat[2], ensure_ascii=False), 'в запросе тема и класс, без логина и имён')
    oa = [s for s in SEEN if s[0] == 'oauth'][0]
    ok(oa[1] == 'Basic QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=' and len(oa[2]) == 36 and 'GIGACHAT_API_PERS' in oa[3], 'токен запрошен по документации: Basic, RqUID, scope')
    st, b = call('POST', '/api/ai/questions', {'topic': 'сложение', 'grade': 2, 'count': 5}, H('tA'))
    ok(st == 200 and len(b['questions']) == 2 and b['questions'][0]['a2'] == '', 'вопросы: дубль ответа убран, вопрос с одним ответом отброшен (%s)' % b)
    MODE['v'] = 'refuse'
    st, b = call('POST', '/api/ai/room', {'topic': 'расскажи анекдот про политику', 'grade': 6}, H('tA'))
    ok(st == 422 and 'школьн' in b['error'], 'вне темы: отказ модели превращён в понятное сообщение')
    MODE['v'] = 'junk'
    st, b = call('POST', '/api/ai/room', {'topic': 'фотосинтез', 'grade': 6}, H('tA')); ok(st == 502 and 'ещё раз' in b['error'], 'не-JSON в ответе: ошибка, ничего не сломалось')
    ok(call('GET', '/api/ai/status', None, H('tA'))[1]['left'] == 0, 'лимит 4 в сутки: все попытки посчитаны')
    st, b = call('POST', '/api/ai/room', {'topic': 'фотосинтез', 'grade': 6}, H('tA')); ok(st == 429 and 'лимит' in b['error'], 'лимит исчерпан: 429')
    r = cli('ai', 'limit', '10'); st, b = call('GET', '/api/ai/status', None, H('tA')); ok(b['left'] == 6, 'лимит поднят командой: осталось 6')
    MODE['v'] = 'down'
    st, b = call('POST', '/api/ai/room', {'topic': 'фотосинтез', 'grade': 6}, H('tA')); ok(st == 502 and 'недоступен' in b['error'], 'GigaChat лёг: 502 с понятным текстом')
    ok(call('GET', '/api/health')[0] == 200 and call('POST', '/api/sync', {}, H('tA'))[0] == 200, 'после сбоя помощника обычная синхронизация работает')
    st, b = call('POST', '/api/ai/room', {'topic': '  ', 'grade': 6}, H('tA')); ok(st == 400, 'пустая тема отклонена до обращения к модели')
    st, b = call('POST', '/api/ai/room', {'topic': '<script>alert(1)</script>', 'grade': 6}, H('tA'))
    k = sqlite3.connect(os.path.join(tmp, 'vrlesson.db')); au = k.execute("SELECT action, detail FROM audit_log WHERE action LIKE 'ai.%'").fetchall(); k.close()
    ok(len(au) == 2 and all('QUJD' not in (d or '') for a, d in au), 'в журнале два успешных запроса, ключа там нет (%s)' % [a for a, d in au])
    cli('ai', 'off'); ok(call('GET', '/api/ai/status', None, H('tA'))[0] == 404, 'выключили командой — снова 404')
finally:
    srv.terminate()
print('\nИТОГО: %s' % ('FAIL %d' % len(fails) if fails else 'всё зелёное'))
sys.exit(1 if fails else 0)
