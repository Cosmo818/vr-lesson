"""Химия как дерево комнат (Б65-Д, шаг 33): узел «Химия» в браузере — карта, двери, заглушки разделов, рендер панелей (p.over пуст), картинки shots/chemtree_*.png.
Запуск: flock /tmp/claude-0/vrtest.lock python3 tests/e2e_chemtree.py. Картинки смотреть глазами (CHECKLIST: проверка рендером)."""
import base64, math, os, subprocess, sys
from playwright.sync_api import sync_playwright

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
shots = os.path.join(root, 'shots'); os.makedirs(shots, exist_ok=True)
web = subprocess.Popen([sys.executable, '-m', 'http.server', '8790', '--bind', '127.0.0.1'], cwd=root, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
fails = []


def ok(c, m):
    print(('ok  : ' if c else 'FAIL: ') + m, flush=True)
    if not c:
        fails.append(m)


try:
    with sync_playwright() as p:
        b = p.chromium.launch(args=['--use-gl=swiftshader', '--enable-unsafe-swiftshader'])
        pg = b.new_context(service_workers='block', viewport={'width': 1100, 'height': 700}).new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto('http://127.0.0.1:8790/index.html'); pg.wait_for_timeout(700)
        ev = lambda js, a=None: pg.evaluate(js, a)
        pg.click('#guestBtn'); pg.click('#go'); pg.wait_for_timeout(500)

        def save(expr, name):
            r = ev("(()=>{const E=VR.app.E,S=E.S,p=%s;E.paintPanel(p);return{over:p.over.slice(),url:p.cv.toDataURL(),yaw:p.yaw}})()" % expr)
            with open(os.path.join(shots, name), 'wb') as f:
                f.write(base64.b64decode(r['url'].split(',')[1]))
            ok(not r['over'], '%s: ничего не за краем (%s)' % (name, r['over'][:3]))
            q = (r['yaw'] or 0) / (math.pi / 2)
            ok(abs(q - round(q)) < 1e-6, '%s: панель по осям стены (yaw кратен 90°)' % name)
            return r

        def go(room, grade):
            ev("([r,g])=>{const E=VR.app.E;E.student.grade=g;E.goRoom(r);}", [room, grade]); pg.wait_for_timeout(900)

        # ---- вход из холла: дверь «Химия» ведёт в узел
        ok(ev("VR.entryOf('chem')") == 'chem-hub', 'дверь холла «Химия» ведёт в узел chem-hub')
        # ---- узел, 9 класс: все разделы открыты
        go('chem-hub', 9)
        ok(ev('VR.app.E.roomId') == 'chem-hub', 'узел построен')
        ok(ev('VR.app.E.S.doors') == 6, '9 класс: 6 дверей разделов (%s)' % ev('VR.app.E.S.doors'))
        map_ = "E.panels.find(p=>p.keepTex&&p.W===1280)"
        ok(ev("(()=>{const E=VR.app.E;return !!%s})()" % map_), 'карта химии найдена')
        save(map_, 'chemtree_map9.png')
        doors = ev("VR.app.E.staticTargets.filter(t=>/^door-/.test(t.id)).map(t=>t.id)")
        ok('door-hall' in doors, 'в узле есть дверь в холл')
        # снимки узла
        ev("(()=>{const E=VR.app.E;E.setPose(0,2.4,0);E.deskCam.pitch=.05;})()"); pg.wait_for_timeout(1500)
        pg.screenshot(path=os.path.join(shots, 'chemtree_hub_front.png'))
        ev("(()=>{const E=VR.app.E;E.setPose(0,0,0);E.deskCam.yaw=Math.PI/2;E.deskCam.pitch=0;})()"); pg.wait_for_timeout(1200)
        pg.screenshot(path=os.path.join(shots, 'chemtree_hub_left.png'))
        ev("(()=>{const E=VR.app.E;E.setPose(0,0,0);E.deskCam.yaw=-Math.PI/2;E.deskCam.pitch=0;})()"); pg.wait_for_timeout(1200)
        pg.screenshot(path=os.path.join(shots, 'chemtree_hub_right.png'))

        # ---- 5 класс: только универсальный стенд, подпись на карте другая
        go('chem-hub', 5)
        ok(ev('VR.app.E.S.guest') is True, '5 класс: режим «до 8 класса»')
        save(map_, 'chemtree_map5.png')

        # ---- заглушки разделов
        for sid in ('chem-ion', 'chem-acid', 'chem-inorg', 'chem-org'):
            go(sid, 9)
            ok(ev('VR.app.E.roomId') == sid, '%s: комната построена' % sid)
            ok(ev("VR.app.E.staticTargets.some(t=>t.id==='door-chem-hub')"), '%s: дверь назад в узел' % sid)
            save("E.panels.find(p=>p.accent&&p.w===2.4)", 'chemtree_stub_%s.png' % sid)
        ev("(()=>{const E=VR.app.E;E.setPose(0,-.9,0);E.deskCam.yaw=0;E.deskCam.pitch=.05;})()"); pg.wait_for_timeout(1200)
        pg.screenshot(path=os.path.join(shots, 'chemtree_stub_view.png'))

        # ---- ядерная физика = стенд в режиме «Ядра»
        go('chem-nuc', 9)
        ok(ev('VR.app.E.S.lab') is True and ev('VR.app.E.S.nuclear') is True, 'chem-nuc: стенд в режиме «Ядра»')
        ok(ev("VR.app.E.staticTargets.some(t=>t.id==='door-chem-hub')"), 'chem-nuc: дверь назад в узел')
        go('chem', 9)
        ok(ev('VR.app.E.S.lab') is True and not ev('VR.app.E.S.nuclear'), 'универсальный стенд открывается в режиме «Химия»')
        ok(not errs, 'нет ошибок JS: %s' % errs[:2])
        b.close()
finally:
    web.terminate()
print('\nИТОГО: %s' % ('FAIL %d' % len(fails) if fails else 'всё зелёное'))
sys.exit(1 if fails else 0)
