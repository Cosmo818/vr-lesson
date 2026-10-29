"""Шаг Э7 PLAN-einstein.md: einstein.html (веб-версия). Сервер (8850) для привязки, сайт (8851).
Запуск: python3 tests/e2e_einweb.py"""
import base64, hashlib, os, subprocess, sys, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
shots = os.path.join(root, 'shots'); os.makedirs(shots, exist_ok=True)
tmp = tempfile.mkdtemp(); fails = []
sys.path.insert(0, os.path.join(root, 'server'))
os.environ['DATA_DIR'] = tmp
import app, studev  # noqa: E402

NOW = int(time.time() * 1000); WHO = ('cli', 'test', '')
SRV = 'http://127.0.0.1:8850'; WEB = 'http://127.0.0.1:8851'


def pin_hash(sid, pin):
    return base64.b64encode(hashlib.pbkdf2_hmac('sha256', pin.encode(), ('st:' + sid).encode(), 20000, 32)).decode()


app.init_db()
with app.db() as c:
    c.execute("INSERT INTO schools(id, name, region, status, network, created, updated) VALUES('s-a', 'Школа А', 'Регион', 'active', '', ?, ?)", (NOW, NOW))
    tea = app.user_create(c, 't.a1', 'Учитель А', 'Pass-tA1-2026-Zq', WHO); app.role_add(c, tea, 'teacher', 's-a', WHO)
    inc = {'classes': [{'id': 'cA1', 'grade': 5, 'letter': 'А', 'created': NOW, 'updated': NOW, 'school': 's-a'}], 'students': [], 'results': [], 'disc': {}, 'settings': {'updated': NOW, 'minutes': 8}}
    inc['students'].append({'id': 'st1', 'name': 'Иванов Иван Иванович', 'grade': 5, 'classId': 'cA1', 'created': NOW, 'updated': NOW, 'school': 's-a', 'pinHash': pin_hash('st1', '1234'), 'status': 'active'})
    app.merge_in(c, inc, 'teacher', '', None)
    c.execute("UPDATE classes SET teacherId = ?, doc = json_set(doc, '$.teacherId', ?) WHERE id = 'cA1'", (tea, tea))
    code = studev.issue_code(app, c, {'id': tea}, 'st1', studev.student_row(c, 'st1'), '127.0.0.1', NOW)['code']
app.save_config({'accounts': True, 'legacyTeacher': True, 'studentDevices': True, 'sessionMinutes': 30})
web = subprocess.Popen([sys.executable, '-m', 'http.server', '8851', '--bind', '127.0.0.1'], cwd=root, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
srv = subprocess.Popen([sys.executable, '-I', os.path.join(root, 'server', 'app.py')], env=dict(os.environ, DATA_DIR=tmp, PORT='8850', TEACHER_KEY='tk', DEVICE_KEY='dk'), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
for port, path in ((8851, ''), (8850, 'api/health')):
    for _ in range(50):
        try:
            urllib.request.urlopen('http://127.0.0.1:%d/%s' % (port, path), timeout=2); break
        except Exception:
            time.sleep(.2)


def ok(c, m):
    print(('ok  : ' if c else 'FAIL: ') + m, flush=True)
    if not c:
        fails.append(m)


errs = []


def watch(pg):
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)


def fresh(b, setup='', **kw):
    """новая вкладка в чистом контексте; setup — JS, выполняемый до загрузки einstein.html"""
    ctx = b.new_context(**kw); pg = ctx.new_page(); watch(pg)
    pg.goto(WEB + '/index.html')
    pg.evaluate('()=>{localStorage.clear();sessionStorage.clear();}')
    if setup:
        pg.evaluate(setup)
    pg.goto(WEB + '/einstein.html'); pg.wait_for_selector('#enter')
    return pg


SEED_SCHOOL = '''async()=>{const S=VR.Store;const k=S.addClass(5,"А");
 const a=S.addStudent("Петров Пётр",5,k.id),b=S.addStudent("Сидорова Анна",5,k.id);
 await S.setStudentPin(a.id,"1111");await S.setStudentPin(b.id,"2222");
 localStorage.setItem("vrlesson.server",JSON.stringify({url:"%s",key:"%s"}));return[a.id,b.id,k.id]}''' % (SRV, 'k' * 24)


def gw_T_ok(pw, pm):
    t = 'VR.einweb.state().geo.T'
    return pm.evaluate(t) >= pw.evaluate(t)


def start_play(pg):
    pg.click('#gStart'); pg.wait_for_timeout(100)


def fix_seed(pg, seed):
    pg.evaluate('(s)=>{const G=VR.einweb.state();G.g=VR.einstein.newGame(VR.einstein.generate(s));G.phase="idle";}', seed)


def solpos(pg):
    """(c, r, верная фишка, неверная фишка) для первой неоткрытой клетки"""
    return pg.evaluate('''()=>{const G=VR.einweb.state(),g=G.g;for(let r=0;r<6;r++)for(let c=0;c<6;c++)if(!g.P.defined(c,r)){const s=g.pz.sol[r][c];
      let w=0;for(let e=1;e<=6;e++)if(e!==s&&g.P.can(c,r,e)){w=e;break}return[c,r,s,w]}}''')


def click_tile(pg, c, r, e, button='left'):
    pg.locator('#cf').scroll_into_view_if_needed()
    p = pg.evaluate('([c,r,e])=>VR.einweb.cellPos(c,r,e)', [c, r, e])
    pg.mouse.click(p['x'], p['y'], button=button)


def login_school(pg, num, pin):
    pg.select_option('#selClass', index=1); pg.fill('#selNum', str(num)); pg.fill('#selPin', pin); pg.click('#enterBtn')


try:
    with sync_playwright() as p:
        b = p.chromium.launch()

        # 1. устройство школы: класс -> номер -> код
        pg = fresh(b)
        ids = pg.evaluate(SEED_SCHOOL); pg.reload(); pg.wait_for_selector('#enter')
        ok(pg.is_visible('#eSchool') and not pg.is_visible('#pairBtn'), 'вход 1: устройство школы — класс/номер/код, кнопки «Привязать» нет')
        n1 = pg.evaluate('()=>VR.Store.numMap(VR.Store.classes()[0].id)[%r]' % ids[0])
        login_school(pg, n1, '9999'); pg.wait_for_timeout(600)
        ok(pg.is_visible('#eSchool') and 'Неверный' in pg.inner_text('#sErr'), 'неверный код: сообщение, в игру не пускает')
        for _ in range(4):
            pg.fill('#selPin', '9999'); pg.click('#enterBtn'); pg.wait_for_timeout(500)
        pg.fill('#selPin', '1111'); pg.click('#enterBtn'); pg.wait_for_timeout(500)
        ok(pg.is_visible('#eSchool') and 'Подожди' in pg.inner_text('#sErr'), '5 ошибок -> пауза 30 с, верный код во время паузы не пускает')
        pg.reload(); pg.wait_for_selector('#eSchool')
        login_school(pg, n1, '1111'); pg.wait_for_selector('#game:not([hidden])')
        ok('Петров' in pg.inner_text('#gWho') and pg.evaluate('VR.einweb.E().student.id') == ids[0], 'верный код -> игра, ученик определён')

        # игра: ЛКМ/ПКМ меняют P
        ok(pg.is_visible('#gStart') and pg.evaluate('VR.einweb.state().phase') == 'idle', 'партия готова, но не идёт до «Начать»')
        fix_seed(pg, 12345); start_play(pg)
        c, r, s, w = solpos(pg)
        click_tile(pg, c, r, w, 'right'); pg.wait_for_timeout(100)
        ok(pg.evaluate('([c,r,w])=>!VR.einweb.state().g.P.can(c,r,w)', [c, r, w]), 'ПКМ исключил фишку (P изменился)')
        click_tile(pg, c, r, s, 'left'); pg.wait_for_timeout(100)
        ok(pg.evaluate('([c,r,s])=>VR.einweb.state().g.P.defined(c,r)&&VR.einweb.state().g.P.value(c,r)===s', [c, r, s]), 'ЛКМ открыл верную фишку (P изменился)')
        ok(pg.evaluate('VR.einweb.state().g.status') == 'play', 'партия идёт')

        # пауза
        t0 = pg.evaluate('VR.einweb.state().t'); pg.wait_for_timeout(1200)
        t1 = pg.evaluate('VR.einweb.state().t')
        ok(t1 > t0 + .8, 'таймер идёт (%.1f -> %.1f)' % (t0, t1))
        pg.click('#gPause'); pg.wait_for_timeout(300); ta = pg.evaluate('VR.einweb.state().t'); pg.wait_for_timeout(1300); tb = pg.evaluate('VR.einweb.state().t')
        ok(abs(tb - ta) < .01 and pg.get_attribute('#cf', 'data-paused') == '1', 'пауза: таймер стоит, поле скрыто')
        labs = pg.evaluate('VR.einweb.labels()')
        ok(pg.evaluate('VR.einweb.state().geo') is None and '▶ Продолжить' in labs and 'Сначала' in labs and 'Новая партия' in labs and 'Обучение' in labs and 'Правила' in labs and 'A+' in labs, 'пауза: поле скрыто, на холсте окно меню (%s)' % labs)
        c2, r2, s2, w2 = solpos(pg)
        pg.evaluate('([c,r,w])=>VR.einplay.click(VR.einweb.E(),VR.einweb.state(),{wbtn:3},c,r,w)', [c2, r2, w2])
        ok(pg.evaluate('([c,r,w])=>VR.einweb.state().g.P.can(c,r,w)', [c2, r2, w2]), 'на паузе клики по полю не работают')
        ok(not any(l in labs for l in ('Курок', 'Касание')) and not pg.query_selector('#gMode'), 'кнопки режима касания нет')
        pg.click('#gPause'); pg.wait_for_timeout(200)
        ok(pg.get_attribute('#cf', 'data-paused') == '' and pg.evaluate('!VR.einweb.state().paused'), 'продолжение снимает паузу')
        pg.evaluate('()=>{Object.defineProperty(document,"hidden",{value:true,configurable:true});document.dispatchEvent(new Event("visibilitychange"))}')
        ok(pg.evaluate('VR.einweb.state().paused'), 'автопауза по visibilitychange')
        pg.evaluate('()=>{Object.defineProperty(document,"hidden",{value:false,configurable:true})}'); pg.click('#gPause')

        # подсказка гасится кликом
        pg.locator('#cf').scroll_into_view_if_needed()
        hp = pg.evaluate('VR.einweb.hintPos()'); pg.mouse.click(hp['x'], hp['y']); pg.wait_for_timeout(100)
        ok(pg.evaluate('VR.einweb.state().used.size') == 1, 'клик по подсказке гасит её')
        pg.mouse.click(hp['x'], hp['y']); pg.wait_for_timeout(100)
        ok(pg.evaluate('VR.einweb.state().used.size') == 0, 'повторный клик возвращает')

        # журнал: ошибка ученика пишется
        j0 = pg.evaluate('VR.games.load().games.length')
        c3, r3, s3, w3 = solpos(pg); click_tile(pg, c3, r3, w3, 'left'); pg.wait_for_timeout(200)
        j1 = pg.evaluate('VR.games.load().games')
        ok(pg.evaluate('VR.einweb.state().g.status') == 'lose' and len(j1) == j0 + 1 and j1[-1]['sid'] == ids[0] and j1[-1]['res'] == 'lose', 'ученик: проигрыш пишется в журнал')

        # размер подсказок: свой для ученика, сохраняется после перезагрузки
        pg.click('#gMenu'); pg.wait_for_timeout(200); pg.evaluate('()=>window.scrollBy(0,VR.einweb.btnPos("A+").y-300)'); ap = pg.evaluate('VR.einweb.btnPos("A+")'); pg.mouse.click(ap['x'], ap['y']); pg.wait_for_timeout(150)
        ok(pg.evaluate('VR.games.prefs(%r).hk' % ids[0]) == 2, 'A+ в меню сохранил размер подсказок ученику')
        pg.reload(); pg.wait_for_selector('#eSchool'); login_school(pg, n1, '1111'); pg.wait_for_selector('#game:not([hidden])')
        ok(pg.evaluate('VR.einweb.state().hk') == 2, 'после перезагрузки у ученика размер подсказок прежний')
        pg.click('#gExit'); pg.wait_for_selector('#eSchool')
        n2 = pg.evaluate('()=>VR.Store.numMap(VR.Store.classes()[0].id)[%r]' % ids[1])
        login_school(pg, n2, '2222'); pg.wait_for_selector('#game:not([hidden])')
        ok(pg.evaluate('VR.einweb.state().hk') == 1 and 'Сидорова' in pg.inner_text('#gWho'), 'у второго ученика свой размер (по умолчанию)')

        # 2. гость, никаких записей
        pg2 = fresh(b)
        ok(pg2.is_visible('#eFree') and pg2.is_visible('#guestBtn') and pg2.is_visible('#pairBtn'), 'вход 3: «Играть гостем» и «Привязать устройство»')
        ok(pg2.input_value('#pName') == 'Компьютер', 'название по умолчанию «Компьютер»')
        pg2.click('#guestBtn'); pg2.wait_for_selector('#game:not([hidden])')
        fix_seed(pg2, 777); start_play(pg2)
        c, r, s, w = solpos(pg2); click_tile(pg2, c, r, w, 'left'); pg2.wait_for_timeout(200)
        ok(pg2.evaluate('VR.einweb.state().g.status') == 'lose' and pg2.evaluate('VR.games.load().games.length') == 0, 'гость: проиграл, журнал пуст')
        pg2.click('#gMenu'); pg2.wait_for_timeout(200); pg2.evaluate('()=>window.scrollBy(0,VR.einweb.btnPos("Новая партия").y-300)'); nb = pg2.evaluate('VR.einweb.btnPos("Новая партия")'); pg2.mouse.click(nb['x'], nb['y']); pg2.wait_for_timeout(200)
        pg2.click('#gOpen'); pg2.wait_for_timeout(100)
        ok(pg2.evaluate('VR.einweb.state().helped') is True, '«Открыть клетку» помечает партию без зачёта')

        # 3. привязка устройства (живой сервер) и вход привязанного
        pg3 = fresh(b, '()=>localStorage.setItem("vrlesson.server",JSON.stringify({url:"%s",key:""}))' % SRV)
        pg3.click('#pairBtn'); pg3.fill('#pCode', 'ZZZZZZZZ'); pg3.click('#pGo'); pg3.wait_for_timeout(800)
        ok(pg3.is_visible('#eFree') and pg3.inner_text('#pErr').strip() != '', 'чужой код привязки: ошибка')
        pg3.fill('#pCode', code); pg3.fill('#pName', 'Телефон'); pg3.click('#pGo'); pg3.wait_for_selector('#eBound', timeout=8000)
        ok(pg3.inner_text('#boundWho').startswith('Вы — ') and 'Иван' in pg3.inner_text('#boundWho') and 'Иванович' not in pg3.inner_text('#boundWho') and '5' in pg3.inner_text('#boundWho') and pg3.is_visible('#bUnpair'), 'вход 2: привязано — «Вы — Имя Ф., класс» + поле кода (%s)' % pg3.inner_text('#boundWho'))
        pg3.fill('#bPin', '0000'); pg3.click('#bGo'); pg3.wait_for_timeout(800)
        ok(pg3.is_visible('#eBound') and pg3.inner_text('#bErr').strip() != '', 'неверный код привязанного: ответ сервера, в игру не пускает')
        pg3.fill('#bPin', '1234'); pg3.click('#bGo'); pg3.wait_for_selector('#game:not([hidden])', timeout=8000)
        ok(pg3.evaluate('VR.einweb.E().student.id') == 'st1', 'верный код: игра как st1')
        pg3.click('#gExit'); pg3.wait_for_selector('#eBound')
        pg3.context.set_offline(True)
        pg3.fill('#bPin', '1234'); pg3.click('#bGo'); pg3.wait_for_timeout(800)
        ok(pg3.is_visible('#bGuest') and 'связи' in pg3.inner_text('#bGuest'), 'нет связи: «Нет связи — играть гостем»')
        pg3.click('#bGuest'); pg3.wait_for_selector('#game:not([hidden])')
        ok(pg3.evaluate('VR.einweb.E().student') is None, 'гостем без связи — записи нет')
        pg3.context.set_offline(False); pg3.click('#gExit'); pg3.wait_for_selector('#eBound')
        pg3.once('dialog', lambda d: d.accept())
        pg3.click('#bUnpair'); pg3.wait_for_timeout(500)
        ok(pg3.is_visible('#eBound') and 'код' in pg3.inner_text('#bErr'), 'отвязка без кода не идёт')
        pg3.fill('#bPin', '1234'); pg3.click('#bUnpair'); pg3.wait_for_selector('#eFree', timeout=8000)
        ok(pg3.evaluate('VR.Store.studentSelf()') is None, '«Это не я — отвязать» с кодом: устройство свободно')

        # 4. учитель
        pg4 = fresh(b, '()=>{sessionStorage.setItem("vrl.token","tok");sessionStorage.setItem("vrl.user","t.a1")}')
        ok(pg4.is_visible('#eTeacher') and 'учитель' in pg4.inner_text('#eTeacher'), 'вход 4: «Вы — учитель»')
        pg4.click('#tGo'); pg4.wait_for_selector('#game:not([hidden])'); fix_seed(pg4, 5); start_play(pg4)
        c, r, s, w = solpos(pg4); click_tile(pg4, c, r, w, 'left'); pg4.wait_for_timeout(200)
        ok(pg4.evaluate('VR.games.load().games.length') == 0, 'учитель: журнал не пишется')

        # 5. вёрстка 390x844 и >= 900
        pm = fresh(b, viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True)

        def inside(pg):
            return pg.evaluate('''()=>{const W=innerWidth,bad=[];document.querySelectorAll('body *').forEach(e=>{const r=e.getBoundingClientRect();if(r.width&&e.offsetParent!==null&&(r.right>W+1||r.left<-1))bad.push(e.id||e.tagName)});
              return{sw:document.documentElement.scrollWidth,W,bad}}''')
        v = inside(pm); ok(v['sw'] <= v['W'] and not v['bad'], '390x844: вход — ничего не выходит за край %s' % v)
        pm.click('#guestBtn'); pm.wait_for_selector('#game:not([hidden])'); start_play(pm)
        v = inside(pm); ok(v['sw'] <= v['W'] and not v['bad'], '390x844: игра — ничего не выходит за край %s' % v)
        GEO = '''()=>{const g=VR.einweb.state().geo,fb=g.fy+6*g.cell,fr=g.fx+6*g.cell,W=g.W;
          return{cell:g.cell,under:g.items.filter(i=>i.k==="v").every(i=>i.y>=fb),right:g.items.filter(i=>i.k==="h").every(i=>i.x>=fr),inside:g.items.every(i=>i.x>=0&&i.x+i.w<=W&&i.y>=0&&i.y+i.h<=g.H),n:g.items.length}}'''
        gm = pm.evaluate(GEO)
        PH = '''()=>{const g=VR.einweb.state().geo,fb=g.fy+6*g.cell,vs=g.items.filter(i=>i.k==="v"),hs=g.items.filter(i=>i.k==="h"),vb=Math.max(...vs.map(i=>i.y+i.h));
          return{cell:g.cell,T:g.T,W:g.W,fw:g.fx+6*g.cell,vUnder:vs.every(i=>i.y>=fb),hBelow:hs.length>0&&hs.every(i=>i.y>=vb),inside:g.items.every(i=>i.x>=0&&i.x+i.w<=g.W&&i.y>=0&&i.y+i.h<=g.H),n:g.items.length}}'''
        gm = pm.evaluate(PH)
        ok(gm['cell'] >= 56 and gm['vUnder'] and gm['hBelow'] and gm['inside'] and gm['n'] > 10, '390x844: клетка >= 56 px, вертикальные под полем, горизонтальные ещё ниже, всё внутри холста %s' % gm)
        ok(gm['W'] - gm['fw'] <= 12, '390x844: поле на всю ширину холста %s' % gm)
        pm.screenshot(path=os.path.join(shots, 'einweb_phone_layout.png'), full_page=True)
        pm.click('#gPause'); pm.wait_for_timeout(250)
        pm.screenshot(path=os.path.join(shots, 'einweb_phone_menu.png'), full_page=True)
        v = inside(pm); ok(v['sw'] <= v['W'] and not v['bad'] and not pm.evaluate('VR.einweb.over()'), '390x844: окно меню — ничего не выходит за край %s' % v)
        for lbl, shot in (('Правила', 'einweb_phone_rules.png'), ('Обучение', 'einweb_phone_tutorial.png')):
            ok(pm.evaluate('l=>VR.einweb.press(l)', lbl), '390x844: «%s» нажимается' % lbl); pm.wait_for_timeout(250)
            v = inside(pm); ok(v['sw'] <= v['W'] and not v['bad'] and not pm.evaluate('VR.einweb.over()'), '390x844: %s — ничего не выходит за край %s' % (lbl, v))
            pm.screenshot(path=os.path.join(shots, shot), full_page=True)
            if lbl == 'Обучение':
                n = 0
                while pm.evaluate('VR.einweb.state().win') == 'tut' and n < 30:
                    ok_o = not pm.evaluate('VR.einweb.over()')
                    if not ok_o: fails.append('обучение: переполнение на шаге %d' % n); print('FAIL: обучение: переполнение на шаге %d %s' % (n, pm.evaluate('VR.einweb.over()')))
                    pm.evaluate('VR.einweb.press("Дальше")||VR.einweb.press("Готово")'); pm.wait_for_timeout(120); n += 1
                ok(pm.evaluate('VR.einweb.state().win') is None and pm.evaluate('VR.einweb.state().tutDone') is True and n >= 10, '390x844: обучение прошло до конца за %d шагов' % n)
            else:
                pm.evaluate('VR.einweb.press("Назад")'); pm.wait_for_timeout(200)
        pm.evaluate('VR.einweb.press("Продолжить")'); pm.wait_for_timeout(250)
        ok(pm.evaluate('!VR.einweb.state().paused'), '390x844: «Продолжить» из меню')
        # долгое нажатие убирает, короткое выбирает (касание)
        pm.locator('#cf').scroll_into_view_if_needed()
        c, r, s, w = solpos(pm)
        TOUCH = '''([x,y,ms])=>new Promise(res=>{const el=document.getElementById("cf"),o={clientX:x,clientY:y,pointerType:"touch",bubbles:true,button:0,pointerId:7};
          el.dispatchEvent(new PointerEvent("pointerdown",o));setTimeout(()=>{el.dispatchEvent(new PointerEvent("pointerup",o));res(1)},ms)})'''
        pp = pm.evaluate('([c,r,e])=>VR.einweb.cellPos(c,r,e)', [c, r, w]); pm.evaluate(TOUCH, [pp['x'], pp['y'], 700]); pm.wait_for_timeout(150)
        ok(pm.evaluate('([c,r,w])=>!VR.einweb.state().g.P.can(c,r,w)', [c, r, w]), 'долгое нажатие на касании убирает фишку')
        pp = pm.evaluate('([c,r,e])=>VR.einweb.cellPos(c,r,e)', [c, r, s]); pm.evaluate(TOUCH, [pp['x'], pp['y'], 60]); pm.wait_for_timeout(150)
        ok(pm.evaluate('([c,r,s])=>VR.einweb.state().g.P.defined(c,r)&&VR.einweb.state().g.P.value(c,r)===s', [c, r, s]), 'короткое касание выбирает фишку')
        pw = fresh(b, viewport={'width': 1280, 'height': 900}); pw.click('#guestBtn'); pw.wait_for_selector('#game:not([hidden])')
        pw.screenshot(path=os.path.join(shots, 'einweb_menu.png'), full_page=True)
        ok(pw.evaluate('VR.einweb.labels().includes("▶ Начать")') and pw.evaluate('VR.einweb.state().geo') is None, '1280: до старта на холсте меню, поле скрыто')
        pw.click('#gStart'); pw.wait_for_timeout(300); gw = pw.evaluate(GEO)
        ok(gw['under'] and gw['right'] and gw['inside'], '1280: вертикальные подсказки под полем, горизонтальные справа %s' % gw)
        pw.screenshot(path=os.path.join(shots, 'einweb_layout.png'), full_page=True)
        ok(gw_T_ok(pw, pm), '390x844: плитки подсказок не мельче, чем на 1280')
        SOLVE = '()=>{const E=VR.einweb.E(),G=VR.einweb.state(),g=G.g;for(let r=0;r<6;r++)for(let c=0;c<6;c++)if(!g.P.defined(c,r))VR.einplay.click(E,G,null,c,r,g.pz.sol[r][c]);return g.status}'
        pw.evaluate('()=>{window.scrollTo(0,0)}'); ok(not pw.is_visible('#gNew'), '1280: «Новая партия» до победы не видна')
        ok(pw.evaluate(SOLVE) == 'win', '1280: партия решена'); pw.wait_for_timeout(300)
        ok(pw.is_visible('#gNew') and pw.is_visible('#gMenu') and 'Новая' in pw.inner_text('#gNew'), '1280: после победы видны «Новая партия» и «Меню»')
        pw.screenshot(path=os.path.join(shots, 'einweb_win.png'), full_page=True)
        sd0 = pw.evaluate('VR.einweb.state().g.pz.seed'); pw.click('#gNew'); pw.wait_for_timeout(500)
        ok(pw.evaluate('VR.einweb.state().g.pz.seed') != sd0 and pw.evaluate('VR.einweb.state().g.status') == 'play' and not pw.is_visible('#gNew'), '1280: «Новая партия» после победы даёт другой номер и новую игру')
        pm.evaluate('()=>{window.scrollTo(0,0)}'); pm.evaluate(SOLVE); pm.wait_for_timeout(300)
        ok(pm.is_visible('#gNew'), '390x844: после победы видна «Новая партия»')
        v = inside(pm); ok(v['sw'] <= v['W'] and not v['bad'], '390x844: экран победы — ничего не выходит за край %s' % v)
        pm.screenshot(path=os.path.join(shots, 'einweb_phone_win.png'), full_page=True)
        pw.evaluate('()=>{VR.einweb.state().win="tut";VR.einweb.state().tut={i:4};VR.einweb.state().opt.onDirty()}'); pw.wait_for_timeout(300)
        pw.screenshot(path=os.path.join(shots, 'einweb_tutorial.png'), full_page=True)
        ok(not pw.evaluate('VR.einweb.over()'), '1280: шаг обучения влезает')

        # 6. офлайн из кэша
        ctx = b.new_context(); po = ctx.new_page(); watch(po)
        po.goto(WEB + '/einstein.html'); po.wait_for_function('navigator.serviceWorker && navigator.serviceWorker.controller', timeout=20000)
        ctx.set_offline(True); po.goto(WEB + '/einstein.html'); po.wait_for_selector('#guestBtn')
        po.click('#guestBtn'); po.wait_for_selector('#game:not([hidden])'); start_play(po)
        ok(po.evaluate('VR.einweb.state().phase') == 'play', 'офлайн: страница открылась из кэша и играет')
        ctx.set_offline(False)

        ok(not errs, 'ошибок в консоли нет (%s)' % errs[:3])
        b.close()
finally:
    srv.terminate(); web.terminate()
print('FAILS: %d' % len(fails)); sys.exit(1 if fails else 0)
