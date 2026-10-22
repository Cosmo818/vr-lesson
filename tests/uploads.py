"""Загрузка файлов учителей (Б51, этап 2): проверка формата и размера, модерация, видимость по школам, лимиты.
Запуск: python3 tests/uploads.py (сервер на 8799, учётки включены)."""
import json, os, urllib.parse, struct, subprocess, sys, tempfile, time, urllib.request, urllib.error, zlib, sqlite3

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
tmp = tempfile.mkdtemp(); PORT = 8799; fails = []
sys.path.insert(0, os.path.join(ROOT, 'server'))
os.environ['DATA_DIR'] = tmp
import app  # noqa: E402

WHO = ('cli', 'test', ''); NOW = int(time.time() * 1000)
app.init_db()
PW = lambda u: 'Pass-%s-2026-Zq' % u  # noqa: E731
UID = {}
with app.db() as c:
    for sid in ('s-a', 's-b'):
        c.execute("INSERT INTO schools(id, name, region, status, network, created, updated) VALUES(?, ?, '', 'active', '', ?, ?)", (sid, sid, NOW, NOW))
    for k, role, sch in (('tA', 'teacher', 's-a'), ('tA2', 'teacher', 's-a'), ('dA', 'director', 's-a'), ('tB', 'teacher', 's-b'), ('sup', 'superadmin', '')):
        UID[k] = app.user_create(c, 'u.' + k.lower(), k, PW(k), WHO); app.role_add(c, UID[k], role, sch, WHO)
    c.execute("INSERT INTO devices(id, school, key_hash, name, status, created, created_by, last_seen) VALUES('dv-a', 's-a', ?, 'a', 'active', ?, 'x', 0)", (app.thash('devkey-school-a-0123456789'), NOW))
    c.execute("INSERT INTO devices(id, school, key_hash, name, status, created, created_by, last_seen) VALUES('dv-b', 's-b', ?, 'b', 'active', ?, 'x', 0)", (app.thash('devkey-school-b-0123456789'), NOW))
app.save_config({'accounts': True, 'legacyTeacher': True, 'sessionMinutes': 15})
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


def call(method, path, data=None, h=None, js=False):
    hd = dict(h or {})
    if js:
        data = json.dumps(data).encode(); hd['Content-Type'] = 'application/json'
    r = urllib.request.Request('http://127.0.0.1:%d%s' % (PORT, path), data=data, method=method, headers=hd)
    try:
        with urllib.request.urlopen(r, timeout=30) as f:
            raw = f.read(); return f.status, raw, f.headers
    except urllib.error.HTTPError as e:
        return e.code, e.read(), e.headers


def clear():
    k = sqlite3.connect(os.path.join(tmp, 'vrlesson.db')); k.execute('DELETE FROM login_fail'); k.commit(); k.close()


TOK = {}


def H(u):
    if u not in TOK:
        clear(); st, raw, _ = call('POST', '/api/auth/login', {'login': 'u.' + u.lower(), 'password': PW(u)}, js=True); TOK[u] = json.loads(raw)['token']
    return {'Authorization': 'Bearer ' + TOK[u]}


def up(u, kind, data, name='f', school='', h=None):
    st, raw, _ = call('POST', '/api/upload?kind=%s&name=%s&school=%s' % (kind, urllib.parse.quote(name), school), data, h or H(u))
    return st, json.loads(raw or b'{}')


def png(w, h):
    def ch(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    return b'\x89PNG\r\n\x1a\n' + ch(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + ch(b'IDAT', zlib.compress(b'\0' + b'\x80\x40\x20' * w)) + ch(b'IEND', b'')


def jpg(w, h):
    return b'\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00\xff\xc0\x00\x11\x08' + struct.pack('>HH', h, w) + b'\x03\x01\x22\x00\x02\x11\x01\x03\x11\x01' + b'\xff\xd9'


glb = open(os.path.join(ROOT, 'assets/models/tree.glb'), 'rb').read()
wav = open(os.path.join(ROOT, 'assets/sounds/bell.wav'), 'rb').read()
try:
    st, r = up('tA', 'model', glb, 'дерево'); ok(st == 200 and r['status'] == 'pending' and len(r['id']) == 12, 'учитель загружает .glb: статус «на проверке»')
    mid = r['id']
    st, r = up('dA', 'sound', wav, 'колокол'); ok(st == 200 and r['status'] == 'approved', 'директор загружает .wav: одобрено сразу')
    sid = r['id']
    st, r = up('tA', 'texture', png(256, 256), 'кирпич'); ok(st == 200 and r['status'] == 'pending', 'PNG 256×256 принят')
    st, r = up('tA', 'texture', jpg(512, 512), 'дерево'); ok(st == 200, 'JPEG 512×512 принят')
    st, r = up('tA', 'texture', png(2048, 2048), 'большая'); ok(st == 400 and '1024' in r['error'], 'текстура 2048 px отклонена: %s' % r.get('error'))
    st, r = up('tA', 'texture', jpg(4000, 100), 'длинная'); ok(st == 400, 'JPEG 4000×100 отклонён')
    st, r = up('tA', 'model', wav, 'wav-как-glb'); ok(st == 400, 'файл другого типа под видом модели отклонён')
    st, r = up('tA', 'model', b'glTF' + b'\0' * 100, 'мусор'); ok(st == 400, 'повреждённый .glb отклонён')
    st, r = up('tA', 'sound', b'RIFF' + b'\0' * 100, 'не-wav'); ok(st == 400, 'RIFF без WAVE отклонён')
    st, r = up('tA', 'texture', b'<svg onload=alert(1)>' + b' ' * 100, 'svg'); ok(st == 400, 'SVG вместо картинки отклонён')
    big = glb[:12] + glb[12:] + b'\0' * (5 * 1024 * 1024)
    st, r = up('tA', 'model', big, 'огромная'); ok(st == 413, '5 МБ: слишком большой')
    st, r = up('tA', 'exe', glb, 'x'); ok(st == 400, 'неизвестный тип отклонён')
    st, r = up('tA', 'model', glb, 'x', school='s-b'); ok(st == 403, 'учитель не грузит в чужую школу')
    st, r = up('tB', 'model', glb, 'b-дерево'); bid = r['id']
    st, r = up('x', 'model', glb, 'шлем', h={'X-Key': 'devkey-school-a-0123456789'}); ok(st in (401, 403), 'шлем файлы не загружает')
    # чтение
    st, raw, hd = call('GET', '/api/asset/' + mid, h=H('tA')); ok(st == 200 and raw == glb and hd['X-Content-Type-Options'] == 'nosniff' and hd['Content-Type'] == 'model/gltf-binary', 'автор читает свой файл (заголовки безопасные)')
    st, raw, hd = call('GET', '/api/asset/' + mid, h=H('tA2')); ok(st == 404, 'другой учитель школы не видит неодобренное')
    st, raw, hd = call('GET', '/api/asset/' + mid, h=H('dA')); ok(st == 200, 'директор видит неодобренное')
    st, raw, hd = call('GET', '/api/asset/' + mid, h=H('tB')); ok(st == 404, 'учитель другой школы не видит')
    st, raw, hd = call('GET', '/api/asset/' + mid, h={'X-Key': 'devkey-school-a-0123456789'}); ok(st == 404, 'шлем не получает неодобренное')
    st, raw, hd = call('GET', '/api/asset/' + sid, h={'X-Key': 'devkey-school-a-0123456789'}); ok(st == 200 and raw == wav, 'шлем школы получает одобренное')
    st, raw, hd = call('GET', '/api/asset/' + sid, h={'X-Key': 'devkey-school-b-0123456789'}); ok(st == 404, 'шлем другой школы — нет')
    st, raw, hd = call('GET', '/api/asset/' + sid, h=H('tA2')); ok(st == 200, 'учитель школы видит одобренное')
    st, raw, hd = call('GET', '/api/asset/' + sid); ok(st == 401, 'без ключа — 401')
    st, raw, hd = call('GET', '/api/asset/..%2f..%2fkeys', h=H('sup')); ok(st == 404, 'обход пути невозможен')
    # модерация
    def adm(u, act, b): st, raw, _ = call('POST', '/api/admin/' + act, b, H(u), js=True); return st, json.loads(raw or b'{}')
    st, r = adm('tA', 'upload.approve', {'id': mid}); ok(st == 403, 'учитель не одобряет')
    st, r = adm('tB', 'upload.approve', {'id': mid}); ok(st in (403, 404), 'чужой учитель не одобряет')
    st, r = adm('dA', 'upload.list', {'school': 's-a'}); ok(st == 200 and len(r['items']) == 4 and any(i['id'] == mid and i['status'] == 'pending' for i in r['items']), 'директор видит список школы (4 файла)')
    st, r = adm('tA2', 'upload.list', {'school': 's-a'}); ok(st == 200 and [i['id'] for i in r['items']] == [sid], 'другой учитель в списке видит только одобренное')
    st, r = adm('dA', 'upload.approve', {'id': bid}); ok(st in (403, 404), 'директор А не одобряет файл школы Б')
    st, r = adm('dA', 'upload.approve', {'id': mid}); ok(st == 200, 'директор одобряет')
    st, raw, hd = call('GET', '/api/asset/' + mid, h={'X-Key': 'devkey-school-a-0123456789'}); ok(st == 200, 'после одобрения шлем получает модель')
    st, r = adm('dA', 'upload.reject', {'id': mid}); st2, raw, hd = call('GET', '/api/asset/' + mid, h={'X-Key': 'devkey-school-a-0123456789'}); ok(st == 200 and st2 == 404, 'отклонённое шлемам не отдаётся')
    st, r = adm('tA2', 'upload.delete', {'id': sid}); ok(st in (403, 404), 'учитель не удаляет чужой файл')
    st, r = adm('tA', 'upload.delete', {'id': mid}); ok(st == 200 and os.path.exists(os.path.join(tmp, 'uploads', mid + '.glb')), 'автор «удаляет» файл: он в архиве, на диске остаётся (Б74)')
    st, raw, hd = call('GET', '/api/asset/' + mid, h=H('tA')); ok(st == 404, 'архивный файл не отдаётся автору')
    st, raw, hd = call('GET', '/api/asset/' + mid, h=H('dA')); ok(st == 404, 'архивный файл не отдаётся директору')
    st, raw, hd = call('GET', '/api/asset/' + mid, h=H('sup')); ok(st == 404, 'архивный файл не отдаётся суперадмину')
    st, raw, hd = call('GET', '/api/asset/' + mid, h={'X-Key': 'devkey-school-a-0123456789'}); ok(st == 404, 'архивный файл не отдаётся шлему')
    st, r = adm('dA', 'upload.list', {'school': 's-a'}); ok(st == 200 and not any(i['id'] == mid for i in r['items']), 'в обычном списке архивного нет')
    st, r = adm('dA', 'upload.list', {'school': 's-a', 'archived': 1}); ok(st == 200 and [i['id'] for i in r['items']] == [mid], 'директор видит архив школы')
    st, r = adm('tA2', 'upload.list', {'school': 's-a', 'archived': 1}); ok(st == 200 and r['items'] == [], 'чужой учитель архива не видит')
    st, r = adm('tA2', 'upload.restore', {'id': mid}); ok(st in (403, 404), 'учитель не возвращает чужой файл')
    st, r = adm('tB', 'upload.restore', {'id': mid}); ok(st in (403, 404), 'учитель другой школы не возвращает файл')
    st, r = adm('tA', 'upload.delete', {'id': mid}); ok(st == 404, 'повторное «удаление» архивного — 404')
    st, r = adm('tA', 'upload.restore', {'id': mid}); ok(st == 200, 'автор возвращает свой файл')
    st, raw, hd = call('GET', '/api/asset/' + mid, h=H('tA')); ok(st == 200, 'после возврата автор снова читает файл')
    st, r = adm('tA', 'upload.restore', {'id': mid}); ok(st == 404, 'возврат не архивного — 404')
    st, r = adm('dA', 'upload.delete', {'id': mid}); st2, r2 = adm('dA', 'upload.restore', {'id': mid}); ok(st == 200 and st2 == 200, 'директор архивирует и возвращает файл школы')
    st, r = adm('dA', 'upload.delete', {'id': mid}); st2, r2 = adm('tA', 'upload.restore', {'id': mid}); ok(st == 200 and st2 == 403, 'автор не возвращает файл, убранный директором')
    st, r = adm('dA', 'upload.restore', {'id': mid}); ok(st == 200, 'директор возвращает файл')
    with sqlite3.connect(os.path.join(tmp, 'vrlesson.db')) as k:
        k.execute("INSERT INTO uploads(id, school, owner, kind, name, size, ext, sha, status, created, archived_at) VALUES('ffffffffffff', 's-a', NULL, 'model', 'x', ?, 'glb', '', 'approved', 1, 1)", (100 * 1024 * 1024 - 100,))
    st, r = up('dA', 'texture', png(16, 16), 'q'); ok(st == 413, 'архивные файлы занимают место школы: загрузка сверх объёма отклонена (%s)' % st)
    with sqlite3.connect(os.path.join(tmp, 'vrlesson.db')) as k:
        k.execute("DELETE FROM uploads WHERE id = 'ffffffffffff'")
    st, r = adm('sup', 'upload.list', {}); ok(st == 200 and any(i['id'] == bid for i in r['items']), 'суперадмин видит файлы всех школ')
    # лимит в час
    for i in range(31):
        st, r = up('tA2', 'texture', png(16, 16), 't%d' % i)
        if st != 200:
            break
    ok(st == 429, 'лимит загрузок в час срабатывает (остановка на %d, код %d)' % (i, st))
    # аудит
    with sqlite3.connect(os.path.join(tmp, 'vrlesson.db')) as k:
        acts = {r[0] for r in k.execute('SELECT action FROM audit_log')}
    ok({'upload.create', 'upload.approve', 'upload.archive', 'upload.restore', 'admin.denied'} <= acts, 'действия с файлами записаны в журнал')
    ok(not any(open(os.path.join(tmp, 'uploads', f), 'rb').read(8) == b'' for f in os.listdir(os.path.join(tmp, 'uploads'))), 'на диске нет пустых файлов')
finally:
    srv.terminate()
print('\nИТОГО: %s' % ('FAIL %d' % len(fails) if fails else 'всё зелёное'))
sys.exit(1 if fails else 0)
