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
