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
        save('S.field', 'ein_menu.png'); save('S.ctl', 'ein_ctl.png')
        ev("()=>{const E=VR.app.E,S=E.S;VR.einplay.begin(E,S);const g=S.g,sol=g.pz.sol;for(let r=0;r<6;r++)for(let c=0;c<6;c++)if(!g.P.defined(c,r)&&(r+c)%3)VR.einstein.click(g,c,r,sol[r][c],1);S.field.dirty=true;S.ctl.dirty=true}")
        pg.wait_for_timeout(300)
        save('S.field', 'ein_layout.png')
        ev("()=>{const E=VR.app.E,S=E.S,g=S.g;for(let r=0;r<6;r++)for(let c=0;c<6;c++)if(!g.P.defined(c,r))VR.einplay.click(E,S,null,c,r,g.pz.sol[r][c]);S.field.dirty=true;S.ctl.dirty=true}")
        pg.wait_for_timeout(300)
        ok(ev("()=>VR.app.E.S.g.status") == 'win', 'эйнштейн: партия решена для снимка победы')
        save('S.ctl', 'ein_win.png')
        ev("()=>{VR.einplay.fresh(VR.app.E,VR.app.E.S)}"); pg.wait_for_timeout(300)
        ev("()=>{const E=VR.app.E,S=E.S;VR.einplay.begin(E,S);const g=S.g,sol=g.pz.sol;for(let r=0;r<6;r++)for(let c=0;c<6;c++)if(!g.P.defined(c,r)&&(r+c)%3)VR.einstein.click(g,c,r,sol[r][c],1);S.field.dirty=true;S.ctl.dirty=true}")
        ev("()=>{const S=VR.app.E.S;S.win='tut';S.tut={i:4};S.field.dirty=true}"); save('S.field', 'ein_tutorial.png')
        ev("()=>{const S=VR.app.E.S;S.tut={i:9};S.field.dirty=true}"); save('S.field', 'ein_tutorial2.png')
        ev("()=>{const S=VR.app.E.S;S.win='rules';S.field.dirty=true}"); save('S.field', 'ein_rules.png')
        ev("()=>{const E=VR.app.E,S=E.S;S.win=null;VR.einplay.setPause(S,true);}"); save('S.field', 'ein_menu_pause.png')
        ev("()=>{const E=VR.app.E,S=E.S;VR.einplay.resume(S);}")
        ev("()=>{const E=VR.app.E,S=E.S;S.view='term';S.term.onToggle(S.term);S.term.onToggle(S.term);}")
        ev("()=>{const E=VR.app.E,S=E.S;VR.einplay.begin(E,S);const g=S.g,sol=g.pz.sol;for(let r=0;r<6;r++)for(let c=0;c<6;c++)if(!g.P.defined(c,r)&&(r+c)%3)VR.einstein.click(g,c,r,sol[r][c],1);S.t=95;E.setPose(0,-1.45,0);}")
        pg.wait_for_timeout(500)
        pg.screenshot(path=os.path.join(shots, 'ein_term_scene.png'))
        save('S.term.panel', 'ein_term.png')
        ev("VR.app.E.loadRoom('hall')"); pg.wait_for_timeout(500)
        ev("()=>{const E=VR.app.E;E.setPose(2.7,-3.15,0);}"); pg.wait_for_timeout(500)
        pg.screenshot(path=os.path.join(shots, 'hall_front.png'))
        ev("()=>{const E=VR.app.E;E.setPose(4.2,-1.2,0);}"); pg.wait_for_timeout(500)
        pg.screenshot(path=os.path.join(shots, 'hall_door.png'))
        ev("()=>{const E=VR.app.E;E.goRoom('play');}"); pg.wait_for_timeout(900)
        ev("()=>{const E=VR.app.E;VR.einplay.begin(E,E.S.term.G);E.setPose(-2.7,-2.6,0);}"); pg.wait_for_timeout(500)
        pg.screenshot(path=os.path.join(shots, 'play_ein.png'))
        ev("()=>{const E=VR.app.E;E.setPose(-1.2,-0.8,-0.5);}"); pg.wait_for_timeout(500)
        pg.screenshot(path=os.path.join(shots, 'play_ein_wide.png'))
        ev("VR.app.E.loadRoom('hall')"); pg.wait_for_timeout(500)
        ev("()=>{const E=VR.app.E;E.setPose(2.7,-3.15,0);}"); pg.wait_for_timeout(300)
        ev("()=>{const E=VR.app.E,S=E.S;VR.einplay.begin(E,S.term.G);}")
        save('S.term.panel', 'hall_term.png')
        ok(ev("VR.app.E.bodies.length===0&&VR.app.E.room.targets(VR.app.E,VR.app.E.S).length===0"), 'холл: нет тел, targets пуст')
        ev("""()=>{const G=VR.games,T=G.tour;G._reset();const names=['Аня Петрова','Боря Иванов','Вика Сидорова','Гоша Орлов','Даша Ким','Егор Власов'];
          names.forEach((n,i)=>{const E={student:{id:'s'+i,name:n,grade:6}};G.finish(E,'einstein',{time:240+i*37,seed:i,moves:30+i});G.finish(E,'einstein',{time:300+i*20,seed:9+i,moves:33});
            G.finish(E,'chess',{res:i%3?'win':'lose',lvl:i%4,moves:40});});
          const t=T.create('einstein','Турнир 6 класса','s0');names.forEach((n,i)=>T.signup(t.id,'s'+i,n));T.start(t.id);
          const pl=names.map((n,i)=>'s'+i).find(id=>T.next(t.id,id)),a=T.next(t.id,pl);T.reportEinstein(t.id,a.r,a.i,a.m.a,{t:200,moves:20});T.reportEinstein(t.id,a.r,a.i,a.m.b,{t:260,moves:20});
          T.create('chess','Шахматы 6 А','s1');VR.app.E.student={id:'s0',name:'Аня Петрова',grade:6};}""")
        ev("VR.app.E.loadRoom('hall')"); pg.wait_for_timeout(300)
        pg.screenshot(path=os.path.join(shots, 'arena_hall.png'))
        ev("VR.app.E.goRoom('arena')"); pg.wait_for_timeout(900)
        pg.screenshot(path=os.path.join(shots, 'arena_room.png'))
        for i, nm in enumerate(['ein', 'chess', 'tours', 'me', 'hist']):
            ev("i=>{const S=VR.app.E.S;S.dtab=i;S.dash.dirty=true}", i)
            save('S.dash', 'arena_dash_%s.png' % nm)
        ev("()=>{const S=VR.app.E.S;S.tid=VR.games.tour.list()[1].id;S.brk.dirty=S.ctl.dirty=true}")
        save('S.brk', 'arena_bracket.png'); save('S.ctl', 'arena_ctl.png')
        ev("()=>{const E=VR.app.E;E.hooks.isTeacher=()=>true;E.laser.on=true;E.setLaserColor(6);}")
        save('E.menu', 'menu_teacher_rainbow.png')
        ev("()=>{const E=VR.app.E;E.setLaserColor(0);}")
        save('E.menu', 'menu_teacher_red.png')
        ok(not errs, 'ошибок страницы нет: %s' % errs[:2])
        b.close()
finally:
    web.terminate()
print('FAILS:', fails)
sys.exit(1 if fails else 0)
