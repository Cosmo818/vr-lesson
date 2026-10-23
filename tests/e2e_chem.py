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

        # ---- реакции по кнопке-табличке на живом движке
        def clear():
            ev("(()=>{const E=VR.app.E;for(const b of E.bodies.filter(b=>b.data&&b.data.zn))E.removeBody(b);E.S.last=null;E.S.board.dirty=true;})()")
        def press(i):
            return ev("(()=>{const p=VR.app.E.S.tabs[%d],b=p.btns[0];if(!b||b.disabled)return false;b.fn();return true})()" % i)
        def put(z, a, v, n=1):
            for _ in range(n):
                ev("([z,a,v])=>{const E=VR.app.E,L=VR.chemLab,c=v?L.DV:L.FV,b=L.makeBody(E,z,a,[c[0],.95,c[1]]);b.v=[0,0,0];}", [z, a, v]); pg.wait_for_timeout(500)
        clear()
        put(8, 16, 0); put(1, 1, 0)
        pg.wait_for_timeout(900)
        ok(not ev("VR.app.E.S.vs[0].ready") or ev("VR.app.E.S.vs[0].plan.kind") != 'molecule', 'H + O: воды ещё нет, реакция сама не пошла')
        save('S.tabs[0]', 'chem_tab_dim_or_ready.png')
        put(1, 1, 0)
        pg.wait_for_function("VR.app.E.S.vs[0].ready===true", timeout=15000)
        save('S.tabs[0]', 'chem_tab_ready.png'); save('S.tabs[2]', 'chem_tab_dim.png')
        ok(ev("VR.app.E.S.last") is None and ev("VR.app.E.S.vs[0].items.length") == 3, 'три атома лежат в сосуде, реакции нет')
        pg.screenshot(path=os.path.join(shots, 'chem_vessel_ready.png'))
        ok(press(0), 'кнопка «Слияние» активна')
        pg.wait_for_timeout(300)
        ok(ev("VR.app.E.S.last.kind") == 'molecule' and ev("VR.app.E.S.last.mol.key") == 'H2O', 'по кнопке H + H + O → H2O')
        save('S.board', 'chem_board_water.png')
        clear()
        save('S.modeTab', 'chem_mode_chem.png')
        ev("(()=>{const E=VR.app.E,L=VR.chemLab;for(const [z,a,dx] of[[6,12,-.06],[2,4,.06]]){const b=L.makeBody(E,z,a,[L.FV[0]+dx,.95,L.FV[1]]);b.v=[0,0,0];}})()")
        pg.wait_for_timeout(800)
        ok(not ev("VR.app.E.S.vs[0].ready"), 'режим «Химия»: C + He — табличка тусклая')
        ev("()=>{const E=VR.app.E,S=E.S;E.paintPanel(S.board);}")
        save('S.board', 'chem_board_nochem.png')
        ev("()=>VR.chemLab.toggleMode(VR.app.E,VR.app.E.S)")
        save('S.modeTab', 'chem_mode_nuc.png')
        pg.wait_for_function("VR.app.E.S.vs[0].ready===true", timeout=30000)
        ok(ev("VR.app.E.S.last") is None, 'C + He: само не слилось')
        ok(press(0), 'нажатие на табличку слияния')
        pg.wait_for_function("VR.app.E.S.last&&VR.app.E.S.last.kind==='fusion'", timeout=30000)
        pg.wait_for_timeout(300)
        save('S.board', 'chem_board_fusion.png')
        ok(ev("VR.app.E.bodies.some(b=>b.data.zn===8&&b.data.a===16&&VR.app.E.S.slots.includes(b))"), 'после слияния кислород-16 лежит в гнезде склада')
        clear()
        put(92, 238, 1)
        pg.wait_for_function("VR.app.E.S.vs[1].ready===true", timeout=30000)
        ok(press(2), 'нажатие на табличку распада')
        pg.wait_for_function("VR.app.E.S.last&&VR.app.E.S.last.kind==='alpha'", timeout=30000)
        pg.wait_for_timeout(300)
        save('S.board', 'chem_board_alpha.png')
        clear()
        put(1, 1, 1); pg.wait_for_timeout(600)
        ok(not ev("VR.app.E.S.vs[1].ready") and not press(2), 'распад водорода: табличка тусклая, не нажимается')
        clear()
        ev("()=>VR.chemLab.toggleMode(VR.app.E,VR.app.E.S)")
        # ---- «Химия»: вода и разложение
        put(1, 1, 0, 2); put(8, 16, 0)
        pg.wait_for_function("VR.app.E.S.vs[0].ready===true", timeout=15000)
        ok(press(0), 'H + H + O: табличка горит, нажата')
        pg.wait_for_timeout(1200)
        ok(ev("VR.app.E.bodies.some(b=>b.data.mol==='H2O'&&VR.app.E.S.slots.includes(b))"), 'молекула воды лежит в складе')
        ev("()=>{const E=VR.app.E,L=VR.chemLab,b=E.bodies.find(b=>b.data.mol==='H2O');delete b.data.sp;b.p=[L.DV[0],.95,L.DV[1]];b.v=[0,0,0];}")
        pg.wait_for_function("VR.app.E.S.vs[1].ready===true", timeout=15000)
        save('S.tabs[2]', 'chem_tab_decomp.png')
        pg.screenshot(path=os.path.join(shots, 'chem_decomp_ready.png'))
        ok(press(2), 'кнопка «Разложение»')
        pg.wait_for_timeout(1200)
        ok(ev("VR.app.E.bodies.filter(b=>b.data.zn&&VR.app.E.S.slots.includes(b)).map(b=>b.data.zn).sort().join()") == '1,1,8', 'H2O → H, H, O в складе')
        save('S.board', 'chem_board_decomp.png')
        clear()
        # ---- дерево элемента и справка
        ev("()=>{VR.app.E.S.nuclear=true;}")
        for z, nm in ((6, 'C'), (26, 'Fe'), (92, 'U')):
            ev("z=>{const E=VR.app.E,S=E.S;S.cur=null;VR.chemLab.setCur(S,z,VR.nuc.el(z).a);}", z)
            save('S.tree', 'chem_tree_%s.png' % nm)
        ev("()=>{const S=VR.app.E.S;S.nuclear=false;S.cur=null;VR.chemLab.setCur(S,6,12);}")
        save('S.tree', 'chem_tree_C_chemmode.png')
        ev("()=>{VR.app.E.S.nuclear=true;}")
        ok(ev("()=>{const t=VR.chemLab.treeOf(6,12,true),s=t.up.map(u=>VR.nuc.el(u.to.z).sym);return s.includes('O')&&s.includes('N')}"), 'дерево C содержит O и N')
        ev("()=>{const E=VR.app.E,S=E.S;E.paintPanel(S.tree);S.tree.hover=S.tree.btns.findIndex(b=>b.z===8);VR.chemLab.update(E,S,.016);E.paintPanel(S.tip);}")
        pg.wait_for_timeout(100)
        ok(ev('VR.app.E.S.tip.show') and ev('VR.app.E.S.tip.data.z') == 8, 'наведение на O в дереве C показывает справку')
        pg.wait_for_timeout(300)
        save('S.tip', 'chem_tip_O.png')
        ev("()=>{VR.app.E.S.tree.hover=-1;}")
        ev("()=>{VR.app.E.S.nuclear=false;}")
        # ---- карточка: клавиша I
        c0 = ev("VR.app.E.S.cardOff")
        pg.keyboard.press('KeyI'); pg.wait_for_timeout(200)
        ok(ev("VR.app.E.S.cardOff") == (not c0), 'клавиша I переключает карточку')
        pg.keyboard.press('KeyI'); pg.wait_for_timeout(200)
        ok(ev("VR.app.E.S.cardOff") == c0, 'повторное I возвращает')
        clear()
        # ---- скриншоты сцены из точки появления
        ev("(()=>{const E=VR.app.E,L=VR.chemLab;const q=[[26,56,-.5,-2.67],[6,12,-.25,-2.49],[79,197,0,-2.31],[10,20,.25,-2.13],[118,294,.5,-2.67]];"
           "for(const [z,a,x,zz] of q){const b=L.makeBody(E,z,a,[x,.95,zz]);b.v=[0,0,0];}"
           "E.setPose(0,-.9,0);E.deskCam.pitch=.12;})()")
        pg.wait_for_timeout(1500)
        pg.screenshot(path=os.path.join(shots, 'chem_room.png'))
        ev("(()=>{const E=VR.app.E;E.setPose(0,-.9,-1.27);E.deskCam.pitch=-.02;})()"); pg.wait_for_timeout(1200)
        pg.screenshot(path=os.path.join(shots, 'chem_board_view.png'))
        pg.set_viewport_size({'width': 2000, 'height': 560})
        ev("(()=>{const E=VR.app.E;E.setPose(0,-.9,0);E.deskCam.pitch=.05;})()"); pg.wait_for_timeout(1500)
        pg.screenshot(path=os.path.join(shots, 'chem_both_boards.png'))
        pg.set_viewport_size({'width': 1100, 'height': 700})
        ev("(()=>{const E=VR.app.E;E.setPose(0,-.9,0);E.deskCam.pitch=-.5;})()"); pg.wait_for_timeout(1200)
        pg.screenshot(path=os.path.join(shots, 'chem_stand_view.png'))
        ev("(()=>{const E=VR.app.E;E.setPose(0,-1.6,0);E.deskCam.pitch=-.95;})()"); pg.wait_for_timeout(1200)
        pg.screenshot(path=os.path.join(shots, 'chem_stand_top.png'))
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
