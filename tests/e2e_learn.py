"""Обучающие комнаты, модель контроллера и управление мышью (захват указателя). Запуск: python3 tests/e2e_learn.py"""
import os, subprocess, sys
from playwright.sync_api import sync_playwright

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
web = subprocess.Popen([sys.executable, '-m', 'http.server', '8782', '--bind', '127.0.0.1'], cwd=root, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
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
        pg.goto('http://127.0.0.1:8782/index.html'); pg.wait_for_timeout(700)
        ev = lambda js, a=None: pg.evaluate(js, a)
        pg.click('#guestBtn'); pg.click('#go'); pg.wait_for_timeout(500)
        ok(ev("VR.app.E.rooms.learn&&VR.app.E.rooms.learnT?1:0") == 1, 'комнаты «Первые шаги» и «Обучение учителя» зарегистрированы')
        ok(ev("VR.app.E.panels.some(p=>p.w===1.7&&p.accent==='#22c55e')"), 'в холле есть панель «Обучение»')
        ok(ev('VR.app.E.mouseCfg.smooth') == .1, 'плавность мыши по умолчанию 10%% (%s)' % ev('VR.app.E.mouseCfg.smooth'))
        # ---- мышь: захват указателя
        ok(not ev('VR.app.E.mouseLocked()') and pg.is_visible('#lockHint'), 'сначала мышь не захвачена, видна подсказка «щёлкни по экрану»')
        pg.mouse.click(550, 350); pg.wait_for_timeout(500)
        locked = ev('VR.app.E.mouseLocked()')
        if locked:
            ok(True, 'первый щелчок захватывает мышь')
            ok(not pg.is_visible('#lockHint'), 'подсказка скрыта после захвата')
            ev('VR.app.E.setMouseCfg({smooth:0,sens:1,invY:false})')
            y0 = ev('VR.app.E.deskCam.yaw'); p0 = ev('VR.app.E.deskCam.pitch')
            ev("document.dispatchEvent(new MouseEvent('mousemove',{movementX:100,movementY:50}))"); pg.wait_for_timeout(250)
            y1 = ev('VR.app.E.deskCam.yaw'); p1 = ev('VR.app.E.deskCam.pitch')
            ok(abs((y1 - y0) + 100 * .0022) < 1e-6 and p1 < p0, 'мышь без нажатия поворачивает взгляд (%.3f → %.3f)' % (y0, y1))
            # плавность: при высокой плавности взгляд догоняет мышь не сразу, но доходит до того же места
            ev('VR.app.E.setMouseCfg({smooth:1})'); y2 = ev('VR.app.E.deskCam.yaw')
            ev("document.dispatchEvent(new MouseEvent('mousemove',{movementX:200,movementY:0}))")
            pg.wait_for_timeout(40); ya = ev('VR.app.E.deskCam.yaw')
            ok(abs(ya - y2) < 200 * .0022 * .9, 'плавность 100%%: за первые кадры взгляд прошёл не всё (%.3f из %.3f)' % (abs(ya - y2), 200 * .0022))
            for _ in range(30):  # кадров в безголовом браузере мало: ждём, пока взгляд дойдёт
                pg.wait_for_timeout(300); yb = ev('VR.app.E.deskCam.yaw')
                if abs((yb - y2) + 200 * .0022) < 1e-3: break
            ok(abs((yb - y2) + 200 * .0022) < 1e-3, 'и в итоге доходит до того же угла, что без сглаживания')
            ev('VR.app.E.setMouseCfg({smooth:0,sens:2})'); y3 = ev('VR.app.E.deskCam.yaw')
            ev("document.dispatchEvent(new MouseEvent('mousemove',{movementX:50,movementY:0}))"); pg.wait_for_timeout(200)
            ok(abs((ev('VR.app.E.deskCam.yaw') - y3) + 50 * .0022 * 2) < 1e-6, 'чувствительность 200% вдвое быстрее')
            ev('VR.app.E.setMouseCfg({sens:1})'); y1 = ev('VR.app.E.deskCam.yaw')
            ev("document.dispatchEvent(new MouseEvent('mousemove',{movementX:5000,movementY:0}))"); pg.wait_for_timeout(200)
            ok(ev('VR.app.E.deskCam.yaw') == y1, 'скачок драйвера (>600 px) игнорируется')
            ev("for(let i=0;i<50;i++)document.dispatchEvent(new MouseEvent('mousemove',{movementX:0,movementY:-500}))"); pg.wait_for_timeout(600)
            ok(ev('VR.app.E.deskCam.pitch') <= 1.5 and ev('VR.app.E.deskCam.pitch') >= 1.49, 'наклон взгляда упирается в предел 1.5 рад')
            ev("for(let i=0;i<80;i++)document.dispatchEvent(new MouseEvent('mousemove',{movementX:0,movementY:500}))"); pg.wait_for_timeout(800)
            ok(ev('VR.app.E.deskCam.pitch') == -1.5, 'и вниз — предел -1.5 рад')
            ev('VR.app.E.deskCam.pitch=-.08')
            # ЛКМ в захвате: «курок» удерживается, пока кнопка зажата
            pg.mouse.down(); pg.wait_for_timeout(150)
            ok(ev('VR.app.E.H[1].gp&&VR.app.E.H[1].gp.buttons[0].pressed'), 'ЛКМ зажата — курок нажат')
            pg.mouse.up(); pg.wait_for_timeout(150)
            ok(not ev('VR.app.E.H[1].gp.buttons[0].pressed'), 'ЛКМ отпущена — курок отпущен')
            pg.mouse.down(button='right'); pg.wait_for_timeout(150)
            ok(ev('VR.app.E.H[1].gp.buttons[1].pressed'), 'ПКМ зажата — хват нажат')
            pg.mouse.up(button='right'); pg.wait_for_timeout(100)
            # обе кнопки сразу: состояние по маске buttons, ничего не залипает
            pg.mouse.down(button='right'); pg.mouse.down(); pg.wait_for_timeout(200)
            ok(ev('VR.app.E.H[1].gp.buttons[0].pressed&&VR.app.E.H[1].gp.buttons[1].pressed'), 'обе кнопки зажаты — курок и хват нажаты')
            pg.mouse.up(); pg.wait_for_timeout(200)
            ok(ev('!VR.app.E.H[1].gp.buttons[0].pressed&&VR.app.E.H[1].gp.buttons[1].pressed'), 'ЛКМ отпущена, ПКМ всё ещё держит')
            pg.mouse.up(button='right'); pg.wait_for_timeout(200)
            ok(ev('!VR.app.E.H[1].gp.buttons[0].pressed&&!VR.app.E.H[1].gp.buttons[1].pressed'), 'обе отпущены — ничего не залипло')
        else:
            ok(True, 'в безголовом браузере захват недоступен — проверяется запасной способ (зажатая кнопка)')
            y0 = ev('VR.app.E.deskCam.yaw'); pg.mouse.move(550, 350); pg.mouse.down(); pg.mouse.move(650, 350, steps=4); pg.mouse.up(); pg.wait_for_timeout(200)
            ok(ev('VR.app.E.deskCam.yaw') != y0, 'запасной способ: взгляд поворачивается при зажатой кнопке')
        # ---- ни одна панель не выше потолка (2.9 м) ни в одной встроенной комнате
        bad = []
        for rid in ev("Object.keys(VR.app.E.rooms).filter(k=>!VR.app.E.rooms[k].custom)"):
            ev("k=>VR.app.E.loadRoom(k)", rid); pg.wait_for_timeout(250)
            for t in ev("VR.app.E.panels.filter(p=>!VR.app.E.open).map(p=>({y:p.pos[1],h:p.h,c:p.accent}))"):
                if t['y'] + t['h'] / 2 > 2.92:
                    bad.append((rid, round(t['y'] + t['h'] / 2, 2)))
        ok(not bad, 'панели не выше потолка во всех комнатах (%s)' % bad[:4])
        ev("VR.app.E.loadRoom('hall')"); pg.wait_for_timeout(250)
        # ---- прыжок, присед, справка и настройки мыши
        eye = lambda: ev('VR.app.E.headPose().pos[1]')
        e0 = eye(); pg.keyboard.down('Control'); pg.wait_for_timeout(1200)
        ok(eye() < 1.2, 'Ctrl: присед, глаза опустились (%.2f → %.2f)' % (e0, eye()))
        pg.keyboard.up('Control')
        for _ in range(20):  # в безголовом браузере около 5 кадров в секунду: ждём, пока рост вернётся
            pg.wait_for_timeout(300)
            if abs(eye() - 1.6) < .06: break
        ok(abs(eye() - 1.6) < .06, 'Ctrl отпущен: рост вернулся')
        pg.keyboard.down('Space'); mx = 0
        for _ in range(8):
            pg.wait_for_timeout(100); mx = max(mx, eye())
        pg.keyboard.up('Space')
        for _ in range(30):
            pg.wait_for_timeout(300); mx = max(mx, eye())
            if ev('VR.app.E.deskCam.jy') == 0 and abs(eye() - 1.6) < .02: break
        ok(mx > 1.7 and abs(eye() - 1.6) < .02, 'Пробел: прыжок вверх (%.2f) и приземление' % mx)
        ok(pg.is_visible('#helpBtn'), 'кнопка «? Управление» видна всегда')
        pg.keyboard.press('KeyH'); pg.wait_for_timeout(300)  # при захваченной мыши клики уходят в сцену, поэтому окно открывает H
        ok(pg.is_visible('#deskPanel') and 'Пробел' in pg.inner_text('#deskPanel') and 'Ctrl' in pg.inner_text('#deskPanel'), 'окно справки открывается и описывает прыжок и присед')
        pg.fill('#mSens', '150') if False else pg.evaluate("()=>{const e=document.getElementById('mSens');e.value=150;e.dispatchEvent(new Event('input'))}")
        pg.evaluate("()=>{const e=document.getElementById('mSmooth');e.value=60;e.dispatchEvent(new Event('input'))}")
        ok(abs(ev('VR.app.E.mouseCfg.sens') - 1.5) < 1e-9 and abs(ev('VR.app.E.mouseCfg.smooth') - .6) < 1e-9, 'ползунки меняют чувствительность и плавность')
        ok(ev("VR.Store.pref('mouse',{}).sens") == 1.5, 'настройки сохранены на устройстве')
        ok(not pg.is_visible('#mSens') and pg.is_visible('#pKeys'), 'настройки мыши — в отдельной вкладке, на первой вкладке клавиши')
        pg.evaluate("()=>document.querySelector('#deskPanel .tab[data-p=mouse]').click()"); pg.wait_for_timeout(100)
        ok(pg.is_visible('#mSens') and not pg.is_visible('#pKeys'), 'вкладка «Мышь» показывает ползунки')
        pg.evaluate("()=>document.querySelector('#deskPanel .tab[data-p=gfx]').click()"); pg.wait_for_timeout(100)
        pg.evaluate("()=>{const e=document.getElementById('gFps');e.checked=true;e.dispatchEvent(new Event('change'))}")
        pg.evaluate("()=>{const e=document.getElementById('gScale');e.value=70;e.dispatchEvent(new Event('input'))}")
        pg.evaluate("()=>{const e=document.getElementById('gFov');e.value=80;e.dispatchEvent(new Event('input'))}")
        pg.wait_for_timeout(1500)
        ok(pg.is_visible('#fpsBox') and 'fps' in pg.inner_text('#fpsBox'), 'галочка fps показывает счётчик в углу (' + pg.inner_text('#fpsBox') + ')')
        ok(abs(ev('VR.app.E.perf.scale') - .7) < 1e-9 and ev('VR.app.E.perf.fov') == 80 and ev("VR.Store.pref('perf',{}).fov") == 80, 'масштаб и угол обзора применены и сохранены')
        pg.evaluate("()=>{const e=document.getElementById('gFps');e.checked=false;e.dispatchEvent(new Event('change'))}"); pg.wait_for_timeout(1200)
        ok(not pg.is_visible('#fpsBox'), 'без галочки счётчик скрыт')
        ev("VR.app.E.setPerf({scale:1,fov:66})")
        # сброс стенда: комната собирается заново, игрок остаётся на месте
        ev("(()=>{const E=VR.app.E;E.loadRoom('physics');})()"); pg.wait_for_timeout(300)
        n0 = ev("VR.app.E.bodies.length")
        ev("(()=>{const E=VR.app.E;E.bodies[0].p[0]+=3;E.bodies.pop();E.deskCam.x=1.1;})()")
        ok(n0 > 1, 'сброс стенда: в комнате есть предметы (' + str(n0) + ')')
        pg.keyboard.press('KeyR'); pg.wait_for_timeout(400)
        ok(ev("VR.app.E.bodies.length") == n0 and abs(ev("VR.app.E.deskCam.x") - 1.1) < 1e-6, 'клавиша R возвращает предметы на место, игрок не двигается')
        ev("VR.app.E.loadRoom('hall')"); pg.wait_for_timeout(250)
        pg.evaluate("()=>document.getElementById('helpClose').click()"); pg.wait_for_timeout(200)
        ok(not pg.is_visible('#deskPanel'), 'кнопка «Закрыть» закрывает окно')
        ev('VR.app.E.setMouseCfg({sens:1,smooth:0})')
        # ---- захват предмета из перекрестия (ПКМ / E)
        ev("(()=>{const E=VR.app.E;E.goRoom('learn');})()"); pg.wait_for_timeout(500)
        ev("(()=>{const E=VR.app.E,D=E.deskCam;D.x=2.4;D.z=-1.8;D.yaw=0;D.pitch=-.35;})()"); pg.wait_for_timeout(300)
        r = ev("(()=>{const E=VR.app.E,h=E.H[1];const b=E.bodies[0];const t=(()=>{const o=h.ro,d=h.rd;return(b.p[1]-o[1])/d[1]})();return{n:E.bodies.length,t,ro:h.ro,rd:h.rd,bp:b.p}})()")
        # поставить первый предмет ровно по лучу в 1.5 м
        ev("(()=>{const E=VR.app.E,h=E.H[1],b=E.bodies[0];b.p=[h.ro[0]+h.rd[0]*1.5,h.ro[1]+h.rd[1]*1.5,h.ro[2]+h.rd[2]*1.5];b.v=[0,0,0];b.fixed=false;E.gravity=0;})()")
        pg.keyboard.down('KeyE'); pg.wait_for_timeout(300)
        held = ev('VR.app.E.bodies.some(b=>b.held!==null)')
        pg.keyboard.up('KeyE'); pg.wait_for_timeout(200)
        ok(held, 'предмет под перекрестием берётся по E (луч, не только рядом с рукой)')
        ok(not ev('VR.app.E.bodies.some(b=>b.held!==null)'), 'отпустил — предмет отпущен')
        # ---- хват издалека: предмет в 4 м по лучу, E — прилетает в руку; курок (Enter/ЛКМ) при удержании — выстрел по лучу
        ev("(()=>{const E=VR.app.E,h=E.H[1],b=E.bodies[0];E.bodies.forEach((o,i)=>{if(i)o.fixed=true;});b.p=[h.ro[0]+h.rd[0]*4,h.ro[1]+h.rd[1]*4,h.ro[2]+h.rd[2]*4];b.v=[0,0,0];})()")
        pg.keyboard.down('KeyE')
        try:
            pg.wait_for_function('VR.app.E.bodies[0].pull===1', timeout=5000)
        except Exception:
            pass
        r = ev("(()=>{const E=VR.app.E,h=E.H[1],b=E.bodies[0];return{held:b.held,d:Math.hypot(b.p[0]-h.ro[0],b.p[1]-h.ro[1],b.p[2]-h.ro[2])}})()")
        ok(r['held'] == 1 and r['d'] < 1.0, 'хват издалека: предмет с 4 м прилетел в руку (%.2f м от глаз)' % r['d'])
        ev("(()=>{const E=VR.app.E;window._shot=null;const f=E.room.onRelease;E.room.onRelease=(e,S,b,sp)=>{window._shot={v:b.v.slice(),rd:E.H[1].rd.slice()};if(f)f(e,S,b,sp);};})()")
        pg.keyboard.press('Enter'); pg.wait_for_function('window._shot', timeout=5000)
        r = ev("(()=>{const s=window._shot,v=s.v,d=s.rd;return{held:VR.app.E.bodies[0].held,dot:v[0]*d[0]+v[1]*d[1]+v[2]*d[2],sp:Math.hypot(...v)}})()")
        pg.keyboard.up('KeyE'); pg.wait_for_timeout(100)
        ok(r['held'] is None and r['dot'] > 8 and abs(r['dot'] - r['sp']) < .5, 'курок при удержании — выстрел по лучу (%s)' % r)
        # курок без хвата по-прежнему берёт и отпускает (держат курком — курок не стреляет)
        ev("(()=>{const E=VR.app.E,h=E.H[1],b=E.bodies[0];b.p=[h.ro[0]+h.rd[0]*1.5,h.ro[1]+h.rd[1]*1.5,h.ro[2]+h.rd[2]*1.5];b.v=[0,0,0];})()")
        r = ev("(()=>{const E=VR.app.E,h=E.H[1];const b=E.bodies[0];h.held=null;b.held=1;b.by='trig';h.held=b;return 1})()")
        pg.keyboard.press('Enter'); pg.wait_for_timeout(100)
        ok(ev("VR.app.E.bodies[0].held===null&&Math.hypot(...VR.app.E.bodies[0].v)<2"), 'предмет, взятый курком, курок только отпускает (без выстрела)')
        ev('VR.app.E.gravity=9.8')
        # ---- обучающие шаги на компьютере: проходим действиями
        ev("(()=>{const E=VR.app.E;E.goRoom('learn');E.deskCam.x=0;E.deskCam.z=1.2;E.deskCam.yaw=0;})()"); pg.wait_for_timeout(400)
        ok(ev('VR.app.E.S.order.join()') == 'look,walk,select,grab,menu,end', 'порядок шагов на компьютере: ' + ev('VR.app.E.S.order.join()'))
        step = lambda: ev('VR.app.E.S.order[VR.app.E.S.i]')

        def wait_step(name, ms=9000):
            for _ in range(ms // 150):
                if step() == name:
                    return True
                pg.wait_for_timeout(150)
            return step() == name
        for k in range(8):
            ev("VR.app.E.deskCam.yaw+=.4"); pg.wait_for_timeout(150)
        wait_step('walk'); ok(step() == 'walk', 'повернул голову — шаг «Иди» (%s)' % step())
        for k in range(6):
            ev("VR.app.E.deskCam.x+=.7"); pg.wait_for_timeout(150)
        wait_step('select'); ok(step() == 'select', 'прошёл несколько шагов — шаг «Выбери» (%s)' % step())
        ev("(()=>{const E=VR.app.E;E.targets.find(t=>t.id==='ball').sel();})()"); wait_step('grab'); ok(step() == 'grab', 'выбрал шар — шаг «Возьми предмет» (%s)' % step())
        ev("(()=>{const E=VR.app.E;E.room.onGrab(E,E.S,E.bodies[0]);E.room.onRelease(E,E.S,E.bodies[0],1);})()"); wait_step('menu'); ok(step() == 'menu', 'взял и отпустил — шаг «Меню» (%s)' % step())
        ev("VR.app.E.toggleMenu(true)"); wait_step('end'); ok(step() == 'end', 'открыл меню — финал (%s)' % step())
        ev("VR.app.E.toggleMenu(false)")
        ev("VR.app.E.S.main.btns[0].fn()"); pg.wait_for_timeout(300)
        ok(ev('VR.app.E.roomId') == 'hall', 'кнопка «В холл» возвращает в холл')
        ev("VR.app.E.goRoom('learnT')"); pg.wait_for_timeout(400)
        ok(ev('VR.app.E.S.order.length') == 5 + 7 + 1, 'обучение учителя: 5 шагов управления + 7 страниц + финал (%s)' % ev('VR.app.E.S.order.length'))
        ev("(()=>{const E=VR.app.E;E.S.i=5;E.S.reset();E.S.main.dirty=true;})()"); pg.wait_for_timeout(300)
        ok(ev("VR.app.E.S.order[VR.app.E.S.i]") == 'page0', 'страницы платформы идут после управления')
        # ---- рендер панелей обучения: ни одна строка и кнопка не выходит за край текстуры (шлем, компьютер, учитель, холл)
        over = []
        for room, vr in (('learn', 0), ('learn', 1), ('learnT', 0)):
            over += ev("""(([room,vr])=>{const E=VR.app.E,out=[];if(vr)E.session={};E.loadRoom(room);if(vr)E.session=null;
              for(let k=0;k<E.S.order.length;k++){E.S.i=k;for(const p of E.panels)if(p.show){E.paintPanel(p);for(const o of p.over)out.push(room+(vr?'/шлем':'')+' '+E.S.order[k]+': '+o);}}
              return out})""", [room, vr])
        ev("VR.app.E.loadRoom('hall')")
        over += ev("VR.app.E.panels.filter(p=>p.w===1.7&&p.accent==='#22c55e').map(p=>{VR.app.E.paintPanel(p);return p.over.join()}).filter(Boolean)")
        ok(not over, 'панели обучения: текст и кнопки в пределах текстуры (%s)' % over[:3])
        ok(ev("(()=>{const E=VR.app.E;E.loadRoom('learn');return E.S.main.W>=1280&&E.S.main.H>=900})()"), 'главная панель обучения рисуется в 1280 px по ширине — разметка под этот размер')
        # ---- кнопка «Сбросить стенд»: обычная кнопка на столе, выровнена по осям стола (yaw = yaw стола, кратно 90°), точка появления не влияет, предметы не перекрывает
        r = ev("""(()=>{const E=VR.app.E,bad=[];let n=0;
          for(const id in E.rooms){try{E.loadRoom(id);}catch(e){continue;}
            for(const sp of[{x:0,z:0},{x:3,z:-2},{x:-4,z:5}]){E.spawn=sp;E.panels=E.panels.filter(p=>!(p.data&&p.data.reset));
              for(const t of E.tables.slice(0,3)){if(t.hx<.3&&t.hz<.3)continue;const rp=E.resetPose(t);E.addPanel({w:.34,h:.1,res:340,pos:rp.pos,yaw:rp.yaw,data:{reset:1}});}
              for(const p of E.panels){if(!p.data||!p.data.reset)continue;n++;
              const ty=0,q=((p.yaw-ty)/(Math.PI/2)),t=E.tables.find(t=>Math.abs(p.pos[0]-t.x)<=t.hx&&Math.abs(p.pos[2]-t.z)<=t.hz&&Math.abs(p.pos[1]-t.top-.055)<1e-6);
              if(Math.abs(q-Math.round(q))>1e-9)bad.push(id+' yaw '+p.yaw.toFixed(3));
              if(!t){bad.push(id+' не на столе');continue;}
              if(t.hx>=.3&&Math.abs(p.pos[0]-t.x)+.17>t.hx+1e-9)bad.push(id+' выступает по x');
              for(const b of E.bodies)if(b.p[1]<t.top+.4&&Math.abs(b.p[0]-p.pos[0])<.17+b.s/2&&Math.abs(b.p[2]-p.pos[2])<.05+b.s/2)bad.push(id+' перекрывает предмет');}}}
          return{n,bad}})()""")
        ok(r['n'] > 0 and not r['bad'], 'кнопки сброса (%d): на столе, выровнены по столу, не зависят от точки появления, не перекрывают предметы (%s)' % (r['n'], r['bad'][:3]))
        # ---- луч телепорта: дуга за 1 кадр не прыгает при скачке направления, за 0,5 с сходится; сглаживание по реальному dt
        r = ev("""(()=>{const E=VR.app.E,n=a=>{const l=Math.hypot(...a);return a.map(x=>x/l)};
          const mk=()=>({d:[0,-.3,-1].map((x,i,a)=>x/Math.hypot(...a)),v:[0,0,0]}),tgt=n([1,-.2,-1]),a=mk();
          const d0=a.d.slice();E.arcStep(a,tgt,1/60);const j1=Math.hypot(a.d[0]-d0[0],a.d[1]-d0[1],a.d[2]-d0[2]),full=Math.hypot(tgt[0]-d0[0],tgt[1]-d0[1],tgt[2]-d0[2]);
          for(let i=0;i<29;i++)E.arcStep(a,tgt,1/60);const e5=Math.hypot(a.d[0]-tgt[0],a.d[1]-tgt[1],a.d[2]-tgt[2]);
          const A=mk(),B=mk();for(let i=0;i<30;i++)E.arcStep(A,tgt,1/60);for(let i=0;i<15;i++)E.arcStep(B,tgt,1/30);
          const dd=Math.hypot(A.d[0]-B.d[0],A.d[1]-B.d[1],A.d[2]-B.d[2]);
          const L=E.arcLand([0,1.2,0],n([0,-.2,-1]));
          return{j1,full,e5,dd,L}})()""")
        ok(r['j1'] < .15 * r['full'] and r['e5'] < .02 and r['dd'] < .02 and r['L'] and r['L']['z'] < -1, 'луч телепорта: за кадр сдвиг %.3f из %.3f, через 0,5 с остаток %.4f, 60 и 30 к/с совпадают (%.4f)' % (r['j1'], r['full'], r['e5'], r['dd']))
        r = ev("""(()=>{const E=VR.app.E;E.loadRoom('phys');E.setPose(1.3,-.7,.8);E.deskCam.pitch=-.3;E.resetStand();const q=E.poseNow();
          return{x:q.x,z:q.z,yaw:q.yaw,p:E.deskCam.pitch,room:E.roomId}})()""")
        ok(abs(r['x'] - 1.3) < 1e-9 and abs(r['z'] + .7) < 1e-9 and abs(r['yaw'] - .8) < 1e-9 and abs(r['p'] + .3) < 1e-9 and r['room'] == 'phys', 'сброс стенда оставляет игрока на месте и с тем же взглядом (%s)' % r)
        # ---- модель контроллера
        r = ev("""(()=>{const C=VR.controllers,M=VR.M,E=VR.app.E;const out={};
          const mk=(pr)=>({g:M.id(),gp:{buttons:[{pressed:false},{pressed:false},{},{pressed:false},{pressed:false},{pressed:false}],axes:[0,0,0,0]},src:{profiles:pr}});
          out.k1=C.kind(mk(['oculus-touch-v3','oculus-touch'])).id;out.k2=C.kind(mk(['meta-quest-touch-plus','oculus-touch'])).id;out.k3=C.kind(mk(['generic-trigger'])).id;out.k4=C.kind({}).id;
          let n1=0,n2=0;const h=mk(['oculus-touch']);C.draw(()=>n1++,E.mesh,h,0,{});const h2=mk(['meta-quest-touch-plus']);C.draw(()=>n2++,E.mesh,h2,1,{});
          out.ring=n1>n2;out.parts=C.parts(0).map(p=>p.name).join()+'|'+C.parts(1).map(p=>p.name).join();
          const em=[];const hp=mk(['oculus-touch']);hp.gp.buttons[0].pressed=true;C.draw((m,mo,c,e)=>em.push(e),E.mesh,hp,0,{});const em0=[];C.draw((m,mo,c,e)=>em0.push(e),E.mesh,h,0,{});
          out.press=Math.max(...em)>Math.max(...em0);return out})()""")
        ok(r['k1'] == 'touch' and r['k2'] == 'plus' and r['k3'] == 'generic' and r['k4'] == 'generic', 'модель распознаёт Touch / Touch Plus / прочие (%s)' % r)
        ok(r['ring'], 'у Touch есть кольцо слежения, у Touch Plus — нет')
        ok(r['parts'] == 'Курок,Хват,Стик,X,Y|Курок,Хват,Стик,A,B', 'подписи кнопок: слева X и Y, справа A и B (%s)' % r['parts'])
        ok(r['press'], 'нажатая кнопка подсвечивается')
        ok(not errs, 'нет ошибок JS: %s' % errs[:2])
        b.close()
finally:
    web.terminate()
print('\nИТОГО: %s' % ('FAIL %d' % len(fails) if fails else 'всё зелёное'))
sys.exit(1 if fails else 0)
