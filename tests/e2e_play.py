"""Комната «Игровая»: настоящая страница в браузере, панели без вылезающего текста (p.over пуст), картинки shots/play_*.png
(нужно открыть и посмотреть глазами), партия идёт без ошибок страницы."""
import base64, os, subprocess, sys
from playwright.sync_api import sync_playwright

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
shots = os.path.join(root, 'shots'); os.makedirs(shots, exist_ok=True)
web = subprocess.Popen([sys.executable, '-m', 'http.server', '8784', '--bind', '127.0.0.1'], cwd=root, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
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
        pg.goto('http://127.0.0.1:8784/index.html'); pg.wait_for_timeout(700)
        ev = lambda js, a=None: pg.evaluate(js, a)
        pg.click('#guestBtn'); pg.click('#go'); pg.wait_for_timeout(600)
        pg.screenshot(path=os.path.join(shots, 'play_hall.png'))

        def save(expr, name):
            r = ev("(()=>{const E=VR.app.E,S=E.S,p=%s;E.paintPanel(p);return{over:p.over.slice(),url:p.cv.toDataURL()}})()" % expr)
            with open(os.path.join(shots, name), 'wb') as f:
                f.write(base64.b64decode(r['url'].split(',')[1]))
            ok(not r['over'], '%s: ничего не за краем (%s)' % (name, r['over'][:3]))

        ev("VR.app.E.loadRoom('hall')"); pg.wait_for_timeout(500); pg.screenshot(path=os.path.join(shots, 'play_hall_front.png')); ev("VR.app.E.goRoom('play')"); pg.wait_for_timeout(800)
        pg.screenshot(path=os.path.join(shots, 'play_room_white.png'))
        ev("()=>{const E=VR.app.E;E.targets.find(t=>t.id==='c12').sel({});}")
        pg.wait_for_timeout(300)
        pg.screenshot(path=os.path.join(shots, 'play_select.png'))
        ev("()=>{const E=VR.app.E;E.targets.find(t=>t.id==='c28').sel({});}")
        pg.wait_for_timeout(3000)
        ok(ev('VR.app.E.S.hist.length') == 2, 'после хода e4 компьютер ответил')
        for i in range(6):
            mv = ev("()=>{const S=VR.app.E.S;return S.moves.length?S.moves[0]:null}")
            if mv: ev("m=>{const E=VR.app.E;E.targets.find(t=>t.id==='c'+m.f).sel({});E.targets.find(t=>t.id==='c'+m.t).sel({});}", mv)
            pg.wait_for_timeout(1800)
        ev("()=>{const S=VR.app.E.S;S.cfg=true;S.cpanel.show=true;S.cpanel.dirty=true;S.panel.dirty=true}")
        pg.wait_for_timeout(300)
        save('S.panel', 'play_panel.png'); save('S.cpanel', 'play_cfg.png')
        pg.screenshot(path=os.path.join(shots, 'play_room_game.png'))
        ev("()=>{const E=VR.app.E,S=E.S;S.me=-1;S.flip=true;}")
        pg.wait_for_timeout(300)
        pg.screenshot(path=os.path.join(shots, 'play_room_black.png'))
        ev("VR.app.E.goRoom('ein')"); pg.wait_for_timeout(900)
        pg.screenshot(path=os.path.join(shots, 'ein_room.png'))
        save('S.field', 'ein_field.png'); save('S.hints', 'ein_hints.png'); save('S.ctl', 'ein_ctl.png')
        ev("()=>{const S=VR.app.E.S;S.mode='pick';const g=S.g,sol=g.pz.sol;for(let r=0;r<6;r++)for(let c=0;c<6;c++)if(!g.P.defined(c,r)&&(r+c)%3)VR.einstein.click(g,c,r,sol[r][c],1);S.field.dirty=true;S.ctl.dirty=true}")
        pg.wait_for_timeout(300)
        save('S.field', 'ein_field_half.png')
        ok(not errs, 'ошибок страницы нет: %s' % errs[:2])
        b.close()
finally:
    web.terminate()
print('FAILS:', fails)
sys.exit(1 if fails else 0)
