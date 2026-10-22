"""Б51 этап 2: загрузка файлов учителем в конструкторе, одобрение директором, загрузка на шлеме. Запуск: python3 tests/e2e_upload.py"""
import json, os, sqlite3, subprocess, sys, tempfile, time, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from glb import png as mkpng
from playwright.sync_api import sync_playwright

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
tmp = tempfile.mkdtemp(); fails = []
sys.path.insert(0, os.path.join(root, 'server'))
os.environ['DATA_DIR'] = tmp
import app  # noqa: E402

NOW = int(time.time() * 1000); WHO = ('cli', 'test', '')
app.init_db()
with app.db() as c:
    c.execute("INSERT INTO schools(id, name, region, status, network, created, updated) VALUES('s-a', 'Школа А', '', 'active', '', ?, ?)", (NOW, NOW))
    t = app.user_create(c, 'tea.a', 'Учитель А', 'Pass-teaA-2026-Zq', WHO); app.role_add(c, t, 'teacher', 's-a', WHO)
    d = app.user_create(c, 'dir.a', 'Директор А', 'Pass-dirA-2026-Zq', WHO); app.role_add(c, d, 'director', 's-a', WHO)
    c.execute("INSERT INTO devices(id, school, key_hash, name, status, created, created_by, last_seen) VALUES('dv', 's-a', ?, 'шлем', 'active', ?, 'x', 0)", (app.thash('devkey-school-a-0123456789'), NOW))
app.save_config({'accounts': True, 'legacyTeacher': True, 'sessionMinutes': 30})
web = subprocess.Popen([sys.executable, '-m', 'http.server', '8778', '--bind', '127.0.0.1'], cwd=root, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
srv = subprocess.Popen([sys.executable, '-I', os.path.join(root, 'server', 'app.py')], env=dict(os.environ, DATA_DIR=tmp, PORT='8779', TEACHER_KEY='tk', DEVICE_KEY='dk'), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
for port, path in ((8778, ''), (8779, 'api/health')):
    for _ in range(50):
        try:
            urllib.request.urlopen('http://127.0.0.1:%d/%s' % (port, path), timeout=2); break
        except Exception:
            time.sleep(.2)


def ok(c, m):
    print(('ok  : ' if c else 'FAIL: ') + m, flush=True)
    if not c:
        fails.append(m)


def clear():
    k = sqlite3.connect(os.path.join(tmp, 'vrlesson.db')); k.execute('DELETE FROM login_fail'); k.commit(); k.close()


SRV = 'http://127.0.0.1:8779'
files = os.path.join(tmp, 'files'); os.makedirs(files)
open(os.path.join(files, 'дерево.glb'), 'wb').write(open(os.path.join(root, 'assets/models/tree.glb'), 'rb').read())
open(os.path.join(files, 'звон.wav'), 'wb').write(open(os.path.join(root, 'assets/sounds/bell.wav'), 'rb').read())
open(os.path.join(files, 'кирпич.png'), 'wb').write(mkpng())
open(os.path.join(files, 'плохой.glb'), 'wb').write(b'not a model' * 10)


def login(pg, who, pw):
    pg.goto('http://127.0.0.1:8778/index.html')
    pg.evaluate('u=>{localStorage.clear();sessionStorage.clear();localStorage.setItem("vrlesson.server",JSON.stringify({url:u,key:""}))}', SRV)
    pg.goto('http://127.0.0.1:8778/teacher.html'); pg.wait_for_timeout(900); clear()
    pg.fill('#lgn', who); pg.fill('#lgp', pw); pg.click('#acctForm .btn'); pg.wait_for_timeout(2200)
    return {'ok': pg.is_visible('#app')}


try:
    with sync_playwright() as p:
        b = p.chromium.launch(); ctx = b.new_context(service_workers='block'); pg = ctx.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('dialog', lambda d: d.accept())
        ok(login(pg, 'tea.a', 'Pass-teaA-2026-Zq')['ok'], 'учитель вошёл')
        pg.click('[data-t=builder]'); pg.wait_for_timeout(300)
        pg.click('[data-bd=new] >> nth=0'); pg.wait_for_timeout(700)
        pg.click('[data-bd=files]'); pg.wait_for_timeout(600)
        ok(pg.is_visible('#bdFile'), 'панель «Мои файлы» открывается')
        pg.set_input_files('#bdFile', os.path.join(files, 'плохой.glb')); pg.click('[data-bd=fup]'); pg.wait_for_timeout(900)
        ok('не файл .glb' in pg.inner_text('#bdFMsg'), 'испорченный .glb: понятная ошибка (%s)' % pg.inner_text('#bdFMsg'))
        for fn in ('дерево.glb', 'звон.wav', 'кирпич.png'):
            pg.set_input_files('#bdFile', os.path.join(files, fn)); pg.click('[data-bd=fup]'); pg.wait_for_timeout(900)
        ok('на проверке' in pg.inner_text('#bdFMsg') and pg.locator('#bdFiles tr').count() == 4, 'три файла загружены и ждут проверки')
        ok(not pg.is_visible('[data-bd=fok]'), 'учителю кнопок одобрения не видно')
        # блок «Модель» — в списке виден свой файл
        pg.click('[data-bd=add][data-t=model]'); pg.wait_for_timeout(300)
        opts = pg.locator('#bdForm select[data-k=asset] option').all_inner_texts()
        ok(any('дерево' in o and 'на проверке' in o for o in opts), 'свой неодобренный файл доступен в списке моделей')
        val = pg.locator('#bdForm select[data-k=asset] option[value^="up:"]').first.get_attribute('value')
        pg.select_option('#bdForm select[data-k=asset]', val); pg.wait_for_timeout(200)
        ok(pg.evaluate('([v])=>VR.roomspec.UP_RE.test(v)', [val]) and val.startswith('up:'), 'выбрана ссылка up:… (%s)' % val)
        pg.click('[data-bd=save]'); pg.wait_for_timeout(500)
        room = pg.evaluate('()=>VR.Store.settings().rooms[Object.keys(VR.Store.settings().rooms)[0]]||VR.Store.customRooms()')
        saved = json.dumps(room, ensure_ascii=False)
        ok(val in saved, 'комната сохранила ссылку на файл')
        # шлем: пока файл на проверке — не загружается
        r = pg.evaluate("async([u,k,id])=>{const S=VR.Store;S.account.clear();S.setServer(u,k);try{await S.getAsset(id,4e6);return 'got'}catch(e){return e.message}}", [SRV, 'devkey-school-a-0123456789', val])
        ok('не найден' in r, 'шлем не получает файл, пока он на проверке (%s)' % r)
        # директор одобряет через панель
        ctx2 = b.new_context(service_workers='block'); pd = ctx2.new_page(); pd.on('pageerror', lambda e: errs.append(str(e))); pd.on('dialog', lambda d: d.accept())
        ok(login(pd, 'dir.a', 'Pass-dirA-2026-Zq')['ok'], 'директор вошёл')
        pd.click('[data-t=builder]'); pd.wait_for_timeout(300); pd.click('[data-bd=new] >> nth=0'); pd.wait_for_timeout(700)
        pd.click('[data-bd=files]'); pd.wait_for_timeout(700)
        ok(pd.locator('[data-bd=fok]').count() == 3, 'директор видит 3 файла на проверке с кнопкой «Одобрить»')
        for _ in range(3):
            pd.click('[data-bd=fok] >> nth=0'); pd.wait_for_timeout(700)
        ok(pd.locator('[data-bd=fok]').count() == 0, 'все три одобрены')
        n0 = pd.locator('[data-bd=fdel]').count()
        pd.click('[data-bd=fdel] >> nth=0'); pd.wait_for_timeout(800)
        ok(pd.locator('[data-bd=fdel]').count() == n0 - 1, '«В архив»: файл ушёл из списка')
        pd.click('[data-bd=farch]'); pd.wait_for_timeout(800)
        ok(pd.locator('[data-bd=frest]').count() == 1, 'в архиве файлов один, есть «Вернуть»')
        pd.click('[data-bd=frest]'); pd.wait_for_timeout(800)
        pd.click('[data-bd=farch]'); pd.wait_for_timeout(800)
        ok(pd.locator('[data-bd=fdel]').count() == n0, '«Вернуть»: файл снова в списке')
        # шлем получает
        ids = [f['raw'] for f in pd.evaluate('()=>VR.Store.files')]
        r = pg.evaluate("""async([u,k,ids])=>{const S=VR.Store;S.account.clear();S.setServer(u,k);const o={};
          for(const id of ids){const f=(await (await fetch(u+'/api/asset/'+id,{headers:{'X-Key':k}})).arrayBuffer()).byteLength;o[id]=f}return o}""", [SRV, 'devkey-school-a-0123456789', ids])
        ok(all(v > 20 for v in r.values()) and len(r) == 3, 'после одобрения шлем получает все три файла')
        # движок на шлеме: модель, звук и текстура по ссылкам up:
        model = val
        snd = [f for f in pd.evaluate('()=>VR.Store.files') if f['kind'] == 'sound'][0]['id']
        tx = [f for f in pd.evaluate('()=>VR.Store.files') if f['kind'] == 'texture'][0]['id']
        pg.goto('http://127.0.0.1:8778/index.html'); pg.wait_for_timeout(900)
        pg.click('#guestBtn'); pg.click('#go'); pg.wait_for_timeout(600)
        r = pg.evaluate("""async([m,s,t])=>{const E=VR.app.E;const g=await E.loadModel(m);E.audio();const b=await E.loadSound(s);const tx=E.tex(t);
          await new Promise(r=>setTimeout(r,800));return{parts:g.parts.length,tris:g.tris,dur:b.duration,tex:!!tx}}""", [model, snd, tx])
        ok(r['parts'] >= 1 and r['tris'] > 0 and r['dur'] > 0 and r['tex'], 'движок на шлеме: модель, звук и текстура из файлов школы загружены (%s)' % r)
        ok(pg.evaluate("async()=>{try{await VR.Store.getAsset('up:../../etc/passwd',1000);return 'ok'}catch(e){return 'no'}}") == 'no', 'подозрительная ссылка отклонена')
        ok(not errs, 'нет ошибок JS: %s' % errs[:2])
        b.close()
finally:
    web.terminate(); srv.terminate()
print('\nИТОГО: %s' % ('FAIL %d' % len(fails) if fails else 'всё зелёное'))
sys.exit(1 if fails else 0)
