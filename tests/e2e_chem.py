"""Комната «Химия» (Б65): рендер панелей (p.over пуст), картинки в shots/, хват из таблицы настоящим вводом. Запуск: python3 tests/e2e_chem.py
Картинки shots/chem_*.png нужно открыть и посмотреть глазами (CHECKLIST: проверка рендером)."""
import base64, os, subprocess, sys
from playwright.sync_api import sync_playwright

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
shots = os.path.join(root, 'shots'); os.makedirs(shots, exist_ok=True)
web = subprocess.Popen([sys.executable, '-m', 'http.server', '8783', '--bind', '127.0.0.1'], cwd=root, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
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
        pg.goto('http://127.0.0.1:8783/index.html'); pg.wait_for_timeout(700)
        ev = lambda js, a=None: pg.evaluate(js, a)
        pg.click('#guestBtn'); pg.click('#go'); pg.wait_for_timeout(500)
        ev("VR.app.E.goRoom('chem')"); pg.wait_for_timeout(800)
        ok(ev('VR.app.E.S.lab') is True and ev('VR.app.E.S.pt.btns.length') == 118, 'стенд построен: таблица на 118 ячеек')

        def save(expr, name):
            """нарисовать панель, вернуть p.over, сохранить текстуру в shots/"""
            r = ev("(()=>{const E=VR.app.E,S=E.S,p=%s;E.paintPanel(p);return{over:p.over.slice(),url:p.cv.toDataURL(),W:p.W,H:p.H}})()" % expr)
            with open(os.path.join(shots, name), 'wb') as f:
                f.write(base64.b64decode(r['url'].split(',')[1]))
            ok(not r['over'], '%s: ничего не за краем (%s)' % (name, r['over'][:3]))
            return r

        r = save('S.pt', 'chem_table.png'); ok(r['W'] == 2048 and r['H'] == 1152, 'текстура таблицы 2048x1152')
        ok(ev('VR.app.E.S.pt.btns.length') == 118, 'после рисования по-прежнему 118 областей')
        save('S.board', 'chem_board_empty.png')
        for i in range(3):
            save('S.tabs[%d]' % i, 'chem_tab%d.png' % i)
        for z in (6, 26, 92, 118, 34):
            sym = ev("z=>VR.nuc.el(z).sym", z)
            r = ev("z=>{const E=VR.app.E,S=E.S,p=S.card;S.cardShown=z;S.cardA=VR.nuc.el(z).a;E.paintPanel(p);return{over:p.over.slice(),url:p.cv.toDataURL()}}", z)
            with open(os.path.join(shots, 'chem_card_%s.png' % sym), 'wb') as f:
                f.write(base64.b64decode(r['url'].split(',')[1]))
            ok(not r['over'], 'chem_card_%s.png: ничего не за краем (%s)' % (sym, r['over'][:3]))

        # ---- реакции: слияние и распад на живом движке
        def clear():
            ev("(()=>{const E=VR.app.E;for(const b of E.bodies.filter(b=>b.data&&b.data.zn))E.removeBody(b);E.S.last=null;E.S.board.dirty=true;})()")
        clear()
        ev("(()=>{const E=VR.app.E,L=VR.chemLab;for(const [z,a,dx] of[[6,12,-.06],[2,4,.06]]){const b=L.makeBody(E,z,a,[L.FV[0]+dx,.95,L.FV[1]]);b.v=[0,0,0];}})()")
        pg.wait_for_function("VR.app.E.S.last&&VR.app.E.S.last.kind==='fusion'", timeout=30000)
        pg.wait_for_timeout(300)
        save('S.board', 'chem_board_fusion.png')
        ok(ev("VR.app.E.bodies.some(b=>b.data.zn===8&&b.data.a===16&&b.data.fresh)"), 'после слияния на выходе кислород-16')
        clear()
        ev("(()=>{const E=VR.app.E,L=VR.chemLab;const b=L.makeBody(E,92,238,[L.DV[0],.95,L.DV[1]]);b.v=[0,0,0];})()")
        pg.wait_for_function("VR.app.E.S.last&&VR.app.E.S.last.kind==='alpha'", timeout=30000)
        pg.wait_for_timeout(300)
        save('S.board', 'chem_board_alpha.png')
        ev("(()=>{const E=VR.app.E,L=VR.chemLab;const b=L.makeBody(E,1,1,[L.DV[0],.95,L.DV[1]]);b.v=[0,0,0];})()")
        pg.wait_for_function("VR.app.E.S.last&&VR.app.E.S.last.why==='h'", timeout=30000)
        save('S.board', 'chem_board_refuse.png')
        clear()
        # ---- скриншоты сцены из точки появления
        ev("(()=>{const E=VR.app.E,L=VR.chemLab;const q=[[26,56,-.5,-2.67],[6,12,-.25,-2.49],[79,197,0,-2.31],[10,20,.25,-2.13],[118,294,.5,-2.67]];"
           "for(const [z,a,x,zz] of q){const b=L.makeBody(E,z,a,[x,.95,zz]);b.v=[0,0,0];}"
           "E.setPose(0,-.9,0);E.deskCam.pitch=.12;})()")
        pg.wait_for_timeout(1500)
        pg.screenshot(path=os.path.join(shots, 'chem_room.png'))
        ev("(()=>{const E=VR.app.E;E.setPose(0,-.9,-1.27);E.deskCam.pitch=-.02;})()"); pg.wait_for_timeout(1200)
        pg.screenshot(path=os.path.join(shots, 'chem_board_view.png'))
        ev("(()=>{const E=VR.app.E;E.setPose(0,-.9,0);E.deskCam.pitch=-.5;})()"); pg.wait_for_timeout(1200)
        pg.screenshot(path=os.path.join(shots, 'chem_stand_view.png'))
        clear()

        # ---- хват из таблицы настоящим вводом (E), наведение не перерисовывает таблицу
        aim = """z=>{const E=VR.app.E,L=VR.chemLab,q=L.cellPx(z),c=L.pxToWorld(q.x+q.w/2,q.y+q.h/2),e=E.headPose().pos;
          const dx=c[0]-e[0],dy=c[1]-e[1],dz=L.TP[2]-e[2];E.deskCam.yaw=Math.atan2(-dx,-dz);E.deskCam.pitch=Math.atan2(dy,Math.hypot(dx,dz));}"""
        ev("(()=>{const E=VR.app.E;E.setPose(0,-.9,0);E.gravity=9.8;})()")
        ev("()=>{const p=VR.app.E.S.pt;window._n=0;const o=p.draw;p.draw=(c,q)=>{window._n++;return o(c,q);};}")
        ev(aim, 26); pg.wait_for_timeout(700)
        r = ev("(()=>{const E=VR.app.E,h=E.rayHit(E.H[1]);return h&&h.kind==='panel'&&h.p===E.S.pt&&h.bi>=0?E.S.pt.btns[h.bi].z:0})()")
        ok(r == 26, 'луч из точки появления попадает в ячейку Fe (z=%s)' % r)
        n0 = ev('window._n'); h0 = ev('VR.app.E.S.pt.hover')
        ev(aim, 79); pg.wait_for_timeout(700)
        ok(ev('VR.app.E.S.pt.hover') != h0 and ev('window._n') == n0, 'наведение на другую ячейку не перерисовывает таблицу')
        ev(aim, 26); pg.wait_for_timeout(500)
        pg.keyboard.down('KeyE')
        try:
            pg.wait_for_function("VR.app.E.bodies.some(b=>b.data&&b.data.zn===26&&b.pull===1)", timeout=15000)
        except Exception:
            pass
        r = ev("(()=>{const E=VR.app.E,b=E.bodies.find(b=>b.data&&b.data.zn===26);return b?{held:b.held,a:b.data.a}:null})()")
        ok(r and r['held'] == 1 and r['a'] == 56, 'E по ячейке Fe: железо-56 прилетело в руку (%s)' % r)
        pg.wait_for_timeout(600)
        ok(ev('VR.app.E.S.card.show') and ev('VR.app.E.S.cardShown') == 26, 'карточка показывает железо из руки')
        pg.screenshot(path=os.path.join(shots, 'chem_hand.png'))
        pg.keyboard.press('Enter'); pg.wait_for_timeout(500)
        ok(ev("VR.app.E.bodies.some(b=>b.data&&b.data.zn===26&&b.held===null)"), 'курок при удержании стреляет, хват не ломается')
        pg.keyboard.up('KeyE'); pg.wait_for_timeout(200)
        ok(not errs, 'нет ошибок JS: %s' % errs[:2])
        b.close()
finally:
    web.terminate()
print('\nИТОГО: %s' % ('FAIL %d' % len(fails) if fails else 'всё зелёное'))
sys.exit(1 if fails else 0)
