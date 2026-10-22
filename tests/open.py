"""Открытые комнаты (Б54) и закрытые результаты тестов (Б56): публикация, одобрение, публичный просмотр, права специалиста.
Запуск: python3 tests/open.py (сервер на 8800)."""
import json, os, subprocess, sys, tempfile, time, urllib.request, urllib.error, sqlite3

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
tmp = tempfile.mkdtemp(); PORT = 8800; fails = []
sys.path.insert(0, os.path.join(ROOT, 'server'))
os.environ['DATA_DIR'] = tmp
import app  # noqa: E402

WHO = ('cli', 'test', ''); NOW = int(time.time() * 1000)
app.init_db()
PW = lambda u: 'Pass-%s-2026-Zq' % u  # noqa: E731
with app.db() as c:
    for sid in ('s-a', 's-b'):
        c.execute("INSERT INTO schools(id, name, region, status, network, created, updated) VALUES(?, ?, '', 'active', '', ?, ?)", (sid, sid, NOW, NOW))
    for k, role, sch in (('tA', 'teacher', 's-a'), ('dA', 'director', 's-a'), ('dB', 'director', 's-b'), ('xA', 'expert', 's-a'), ('xB', 'expert', 's-b'), ('sup', 'superadmin', '')):
        u = app.user_create(c, 'u.' + k.lower(), k, PW(k), WHO); app.role_add(c, u, role, sch, WHO)
    inc = {'classes': [{'id': 'cA', 'grade': 5, 'letter': 'А', 'created': NOW, 'updated': NOW, 'school': 's-a'}],
           'students': [{'id': 'stA', 'name': 'Ученик А', 'grade': 5, 'classId': 'cA', 'created': NOW, 'updated': NOW, 'school': 's-a'}],
           'results': [{'id': 'r1', 'sid': 'stA', 'subj': 'gen', 'score': 3, 'total': 5, 'ts': NOW, 'test': 't1', 'testTitle': 'Обычный'},
                       {'id': 'r2', 'sid': 'stA', 'subj': 'gen', 'score': 4, 'total': 5, 'ts': NOW + 1, 'test': 't2', 'testTitle': 'Закрытый', 'closed': 1}],
           'disc': {}, 'settings': {'updated': NOW, 'minutes': 8}}
    app.merge_in(c, inc, 'teacher', '', None)
app.save_config({'accounts': True, 'legacyTeacher': True, 'sessionMinutes': 15, 'openRooms': False})
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
        with urllib.request.urlopen(r, timeout=30) as f:
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


def adm(u, act, b):
    clear(); return call('POST', '/api/admin/' + act, b, H(u))


spec = {'v': 'room/1', 'id': 'c-test', 'title': 'Моя открытая', 'hint': 'Заходи', 'blocks': [{'type': 'text', 'x': 0, 'z': -3, 'title': 'Привет'}]}
try:
    st, b = call('GET', '/api/open/rooms'); ok(st == 404, 'openRooms выключен — публичный список отвечает 404')
    app.save_config({'accounts': True, 'legacyTeacher': True, 'sessionMinutes': 15, 'openRooms': True})
    st, b = call('GET', '/api/open/rooms'); ok(st == 200 and b['items'] == [], 'включён: список пуст, вход без ключа')
    st, b = adm('tA', 'room.publish', {'school': 's-a', 'src': 'c-test', 'spec': spec}); ok(st == 200 and b['status'] == 'pending', 'учитель публикует: комната ждёт одобрения')
    rid = b['id']
    st, b = call('GET', '/api/open/rooms'); ok(b['items'] == [], 'неодобренная комната в публичном списке не видна')
    st, b = call('GET', '/api/open/room/' + rid); ok(st == 404, 'неодобренную комнату по адресу не получить')
    st, b = adm('tA', 'room.approve', {'id': rid}); ok(st == 403, 'учитель сам себя не одобряет')
    st, b = adm('dB', 'room.approve', {'id': rid}); ok(st == 403, 'директор чужой школы не одобряет')
    st, b = adm('dA', 'room.list', {'school': 's-a'}); ok(st == 200 and len(b['items']) == 1 and b['items'][0]['status'] == 'pending', 'директор видит заявку')
    st, b = adm('dA', 'room.approve', {'id': rid}); ok(st == 200, 'директор одобряет')
    st, b = call('GET', '/api/open/rooms'); ok(len(b['items']) == 1 and b['items'][0]['id'] == rid and 'owner' not in b['items'][0], 'одобренная видна всем, без имени автора')
    st, b = call('GET', '/api/open/room/' + rid); ok(st == 200 and b['spec']['title'] == 'Моя открытая', 'описание комнаты отдаётся без входа')
    st, b = call('GET', '/api/open/room/o-000000000000'); ok(st == 404, 'несуществующая комната — 404')
    st, b = call('GET', '/api/open/room/..%2fx'); ok(st == 404, 'обход пути невозможен')
    spec2 = dict(spec, title='Изменено'); st, b = adm('tA', 'room.publish', {'school': 's-a', 'src': 'c-test', 'spec': spec2})
    ok(st == 200 and b['id'] == rid and b['status'] == 'pending', 'правка снова отправляет комнату на одобрение')
    st, b = call('GET', '/api/open/rooms'); ok(b['items'] == [], 'пока правка не одобрена, комната скрыта')
    adm('dA', 'room.approve', {'id': rid})
    st, b = adm('tA', 'room.publish', {'school': 's-a', 'src': 'c-x', 'spec': dict(spec, blocks=[{'type': 'model', 'asset': 'up:0123456789ab'}])}); ok(st == 400 and 'файлы' in b['error'], 'свои файлы в открытой комнате пока запрещены')
    st, b = adm('tA', 'room.publish', {'school': 's-a', 'src': 'c-x', 'spec': {'title': 'x'}}); ok(st == 400, 'не комната — отклонено')
    st, b = adm('tA', 'room.publish', {'school': 's-b', 'src': 'c-x', 'spec': spec}); ok(st == 403, 'в чужую школу публиковать нельзя')
    st, b = adm('tA', 'room.publish', {'school': 's-a', 'src': 'c-big', 'spec': dict(spec, blocks=[{'type': 'text', 'title': 'я' * 100} for _ in range(900)])}); ok(st == 413, 'огромная комната отклонена')
    st, b = adm('dA', 'room.publish', {'school': 's-a', 'src': 'c-d', 'spec': spec}); ok(st == 200 and b['status'] == 'approved', 'директор публикует сразу одобренной')
    st, b = adm('xA', 'room.publish', {'school': 's-a', 'src': 'c-e', 'spec': spec}); ok(st == 403, 'специалист комнаты не публикует')
    st, b = adm('dA', 'room.reject', {'id': rid}); st2, b2 = call('GET', '/api/open/room/' + rid); ok(st == 200 and st2 == 404, 'отклонённая пропадает из открытого доступа')
    st, b = adm('tA', 'room.unpublish', {'id': rid}); ok(st == 200, 'автор снимает свою публикацию')
    for _ in range(61):
        st, b = call('GET', '/api/open/rooms')
    ok(st == 429, 'публичный список ограничен по частоте')
    # ---- закрытые результаты
    app.save_config({'accounts': True, 'legacyTeacher': True, 'sessionMinutes': 15, 'openRooms': True})
    st, b = call('GET', '/api/export', h={'X-Key': 'teach-secret'}); ok(st == 200 and [r['id'] for r in b['results']] == ['r1'], 'в общей выгрузке закрытых результатов нет')
    st, b = call('POST', '/api/sync', {'v': 4, 'classes': [], 'students': [], 'results': [], 'disc': {}, 'tests': [], 'feedback': [], 'deleted': {}, 'settings': {}}, {'X-Key': 'teach-secret'}); ok(st == 200 and all(not r.get('closed') for r in b['state']['results']), 'ответ синхронизации не содержит закрытых результатов')
    st, b = adm('xA', 'closed.list', {'school': 's-a'}); ok(st == 200 and len(b['items']) == 1 and b['items'][0]['student'] == 'Ученик А' and b['items'][0]['test'] == 'Закрытый', 'специалист школы видит закрытый результат')
    st, b = adm('xB', 'closed.list', {'school': 's-a'}); ok(st == 403, 'специалист другой школы — нет')
    st, b = adm('dA', 'closed.list', {'school': 's-a'}); ok(st == 403, 'директор закрытых результатов не видит')
    st, b = adm('tA', 'closed.list', {'school': 's-a'}); ok(st == 403, 'учитель закрытых результатов не видит')
    st, b = adm('sup', 'closed.list', {'school': 's-a'}); ok(st == 200 and len(b['items']) == 1, 'администратор видит')
    st, b = adm('dA', 'invite.create', {'role': 'expert', 'school': 's-a'}); ok(st == 200 and len(b['code']) == 10, 'директор приглашает специалиста своей школы')
    st, b = adm('tA', 'invite.create', {'role': 'expert', 'school': 's-a'}); ok(st == 403, 'учитель специалистов не приглашает')
    with sqlite3.connect(os.path.join(tmp, 'vrlesson.db')) as k:
        acts = {r[0] for r in k.execute('SELECT action FROM audit_log')}
    ok({'closed.view', 'room.publish', 'room.approve', 'admin.denied'} <= acts, 'просмотр закрытых результатов и публикации — в журнале')
finally:
    srv.terminate()
print('\nИТОГО: %s' % ('FAIL %d' % len(fails) if fails else 'всё зелёное'))
sys.exit(1 if fails else 0)
