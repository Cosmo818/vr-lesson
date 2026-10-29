"""Т2 (PLAN-einstein.md, раздел 4): почему ломаются комнаты учителей. Живой сервер с учётками (API 8852, сайт 8853), две школы, три учителя,
шлемы школ по ключу. Комнаты создаёт настоящий клиент в браузере (конструктор teacher.html, Store.saveRoom), а не JSON руками.
Известный сбой — «ИЗВЕСТНО: …» (xfail, прогон не валится); не подтвердилось — «НЕ ПОДТВЕРДИЛОСЬ: …». «FAIL» — только если сломана сама подготовка.
Запуск: python3 tests/e2e_rooms_bugs.py"""
import json, os, sqlite3, subprocess, sys, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
tmp = tempfile.mkdtemp(); fails = []
sys.path.insert(0, os.path.join(root, 'server'))
os.environ['DATA_DIR'] = tmp
import app  # noqa: E402

API, WEB = 'http://127.0.0.1:8852', 'http://127.0.0.1:8853'
NOW = int(time.time() * 1000); WHO = ('cli', 'test', '')
PW = {'tea.a': 'Pass-teaA-2026-Zq', 'tea.b': 'Pass-teaB-2026-Zq', 'tea.c': 'Pass-teaC-2026-Zq'}
KEY = {'s-a': 'headset-key-school-A-' + 'a' * 12, 's-b': 'headset-key-school-B-' + 'b' * 12}
app.init_db()
with app.db() as c:
    for sid, name in (('s-a', 'Школа А'), ('s-b', 'Школа Б')):
        c.execute("INSERT INTO schools(id, name, region, status, network, created, updated) VALUES(?, ?, '', 'active', '', ?, ?)", (sid, name, NOW, NOW))
    for login, sch in (('tea.a', 's-a'), ('tea.b', 's-b'), ('tea.c', 's-a')):
        u = app.user_create(c, login, 'Учитель ' + login, PW[login], WHO); app.role_add(c, u, 'teacher', sch, WHO)
    cls = [{'id': 'cA1', 'grade': 5, 'letter': 'А', 'created': NOW, 'updated': NOW, 'school': 's-a'}, {'id': 'cB1', 'grade': 7, 'letter': 'Б', 'created': NOW, 'updated': NOW, 'school': 's-b'}]
    stu = [{'id': 'sA1', 'name': 'Ученик А', 'grade': 5, 'classId': 'cA1', 'created': NOW, 'updated': NOW, 'school': 's-a'},
           {'id': 'sB1', 'name': 'Ученик Б', 'grade': 7, 'classId': 'cB1', 'created': NOW, 'updated': NOW, 'school': 's-b'}]
    app.merge_in(c, {'classes': cls, 'students': stu, 'results': [], 'disc': {}, 'settings': {'updated': NOW, 'minutes': 8}}, 'teacher', '', None)
    for sch, key in KEY.items():  # шлем школы: запись в базе, как после привязки по коду
        c.execute('INSERT INTO devices(id, school, key_hash, name, status, created, created_by, last_seen) VALUES(?, ?, ?, ?, ?, ?, ?, ?)',
                  ('d-' + sch, sch, app.thash(key), 'шлем ' + sch, 'active', NOW, None, NOW))
app.save_config({'accounts': True, 'legacyTeacher': True, 'sessionMinutes': 60})
web = subprocess.Popen([sys.executable, '-m', 'http.server', '8853', '--bind', '127.0.0.1'], cwd=root, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
srv = subprocess.Popen([sys.executable, '-I', os.path.join(root, 'server', 'app.py')], env=dict(os.environ, DATA_DIR=tmp, PORT='8852', TEACHER_KEY='tk', DEVICE_KEY='dk'), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
for port, path in ((8853, ''), (8852, 'api/health')):
    for _ in range(50):
        try:
            urllib.request.urlopen('http://127.0.0.1:%d/%s' % (port, path), timeout=2); break
        except Exception:
            time.sleep(.2)


def ok(c, m):
    print(('ok  : ' if c else 'FAIL: ') + m, flush=True)
    if not c:
        fails.append(m)


def known(bug, m_known, m_not):
    """xfail: сбой есть — «ИЗВЕСТНО», прогон не валится; сбоя нет — «НЕ ПОДТВЕРДИЛОСЬ»."""
    print(('ИЗВЕСТНО: ' + m_known) if bug else ('НЕ ПОДТВЕРДИЛОСЬ: ' + m_not), flush=True)
    return bool(bug)


def dbq(sql, *a):
    k = sqlite3.connect(os.path.join(tmp, 'vrlesson.db')); r = k.execute(sql, a).fetchall(); k.commit(); k.close(); return r


def srv_settings():
    r = dbq('SELECT doc FROM settings WHERE id = 1')
    return json.loads(r[0][0]) if r else {}


def srv_rooms():
    return srv_settings().get('rooms') or {}


def srv_bands(rid):
    return ((srv_settings().get('content') or {}).get('rooms') or {}).get(rid)


def clear_throttle():
    dbq('DELETE FROM login_fail')


def seed(pg):
    pg.goto(WEB + '/help.html')


def teacher(ctx, login):
    """Кабинет учителя в браузере: вход по учётке, конструктор комнат."""
    pg = ctx.new_page(); pg.on('dialog', lambda d: d.accept()); pg.on('pageerror', lambda e: errs.append(login + ': ' + str(e)))
    pg.goto(WEB + '/help.html')
    pg.evaluate('()=>{localStorage.clear();sessionStorage.clear();localStorage.setItem("vrlesson.server",JSON.stringify({url:"%s",key:""}))}' % API)
    pg.goto(WEB + '/teacher.html'); pg.wait_for_timeout(900); clear_throttle()
    pg.fill('#lgn', login); pg.fill('#lgp', PW[login]); pg.click('#acctForm .btn'); pg.wait_for_timeout(2500)
    ok(pg.is_visible('#app'), 'вход учителя %s в кабинет' % login)
    sync(pg)
    return pg


def sync(pg):
    return pg.evaluate("VR.Store.sync().then(s=>s.state+(s.msg?':'+s.msg:''))")


def rooms_of(pg):
    return pg.evaluate("VR.Store.customRooms().map(r=>({id:r.id,title:r.title,author:r.author||''}))")


def mkroom(pg, title, bands='abcd'):
    """Новая комната настоящим конструктором: вкладка «Конструктор» → шаблон → название → «Сохранить» → отметка классов."""
    before = {r['id'] for r in rooms_of(pg)}
    pg.click('[data-t=builder]'); pg.wait_for_timeout(150)
    if pg.locator('[data-bd=back]').count():
        pg.click('[data-bd=back]'); pg.wait_for_timeout(150)
    pg.click('[data-bd=new][data-t=empty]'); pg.wait_for_timeout(300)
    new = [r['id'] for r in rooms_of(pg) if r['id'] not in before]
    if len(new) != 1:
        return None
    pg.fill('[data-r=title]', title); pg.click('[data-bd=save]'); pg.wait_for_timeout(200)
    if bands:
        pg.evaluate("([i,b])=>VR.Store.setBands('room',i,b)", [new[0], bands])
    return new[0]


def edit_title(pg, rid, title):
    """Правка комнаты тем же путём, что и редактор (Store.saveRoom по копии описания)."""
    return pg.evaluate("([i,t])=>{const s=JSON.parse(JSON.stringify(VR.Store.customRoom(i)));s.title=t;return VR.Store.saveRoom(s).errors||null;}", [rid, title])


def headset(ctx, sch, query=''):
    """Шлем школы: сайт учеников с ключом шлема, данные приходят синхронизацией."""
    pg = ctx.new_page(); pg.on('dialog', lambda d: d.accept()); pg.on('pageerror', lambda e: errs.append('headset ' + sch + ': ' + str(e)))
    pg.goto(WEB + '/help.html')
    pg.evaluate('()=>{localStorage.clear();sessionStorage.clear();localStorage.setItem("vrlesson.server",JSON.stringify({url:"%s",key:"%s"}))}' % (API, KEY[sch]))
    pg.goto(WEB + '/index.html' + query); pg.wait_for_timeout(1500)
    return pg


def hall(pg, grade):
    """Холл гостя нужного класса. Возвращает (сколько комнат открыто классу по правилу hallPanel, сколько кнопок на панели «Комнаты учителя»)."""
    pg.click('#guestBtn'); pg.wait_for_timeout(200); pg.select_option('#gg', str(grade)); pg.click('#go'); pg.wait_for_timeout(1500)
    return pg.evaluate("""g=>{const E=VR.app.E;const open=VR.custom.refresh().filter(s=>VR.Store.roomOn(s.id,g));
      const p=E.panels.find(p=>p.accent==='#a78bfa'&&p.w===2&&Math.abs(p.pos[2]-5.86)<.01);let n=0;if(p){E.paint(p);n=p.btns.length;}
      return{open:open.length,panel:n,ids:open.map(s=>s.id)};}""", grade)


errs = []
try:
    with sync_playwright() as p:
        b = p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        cA, cB, cC, cA2, cH = (b.new_context() for _ in range(5))
        pa = teacher(cA, 'tea.a'); pb = teacher(cB, 'tea.b')

        # ---- 1. A и B из разных школ создают по комнате → видит ли ученик школы B комнату A
        ra = mkroom(pa, 'Комната А', 'abcd'); ok(bool(ra), 'учитель А собрал комнату конструктором (%s)' % ra); sync(pa)
        sync(pb); rb = mkroom(pb, 'Комната Б', 'abcd'); ok(bool(rb), 'учитель Б собрал комнату конструктором (%s)' % rb); sync(pb); sync(pa)
        ok(set(srv_rooms()) == {ra, rb}, 'на сервере обе комнаты (%s)' % sorted(srv_rooms()))
        hb = headset(cH, 's-b'); sync(hb)
        h = hall(hb, 7)
        known(ra in h['ids'], 'ученик школы Б (7 класс, шлем школы Б) видит комнату учителя школы А в холле: settings.rooms и settings.content общие на весь сервер (server/app.py state(), js/custom.js hallPanel)',
              'комната школы А не показана ученику школы Б')
        known(ra in {r['id'] for r in rooms_of(pb)}, 'кабинет учителя Б получил комнату учителя А из другой школы (server/app.py state(): settings не режется по школе)', 'учитель Б чужих комнат не получил')

        # ---- 8. шлем школы (X-Key) получает комнаты всех школ в settings
        rs = hb.evaluate("VR.Store.customRooms().map(r=>r.author)")
        known({'tea.a', 'tea.b'} <= set(rs), 'шлем школы Б получил в settings комнаты обеих школ, авторы: %s (server/app.py state(), ветка device без фильтра по школе)' % sorted(rs), 'шлем получил только комнаты своей школы')
        hb.close()

        # ---- 3. новая комната без отметок классов не видна в холле
        rd = mkroom(pa, 'Черновик А', ''); sync(pa); sync(pb)
        ok(rd and srv_bands(rd) == '', 'новая комната записана в content.rooms как черновик (%r)' % srv_bands(rd))
        hint = pa.inner_text('#t-builder')
        hb = headset(cH, 's-a'); sync(hb); h = hall(hb, 5); hb.close()
        known(rd not in h['ids'], 'новая комната без отметки классов не попадает в холл (js/store.js saveRoom пишет content.rooms[id]=\'\', bandsOf для c-… без отметки = \'\')', 'новая комната сразу видна в холле')
        known('скрыт' not in hint and 'черновик' not in hint, 'в редакторе сразу после создания нет пояснения про скрытую комнату', 'пояснение есть: в редакторе рядом с отметками классов написано «комната скрыта (черновик)» (js/builder.js editHtml)')

        # ---- 2. одновременные правки
        # 2a: разные школы. B (устаревший) правит свою комнату после того, как A поменяла свою
        sync(pb); edit_title(pa, ra, 'Комната А (правка)'); sync(pa)
        edit_title(pb, rb, 'Комната Б (правка)'); sync(pb)
        t = {k: v.get('title') for k, v in srv_rooms().items()}
        known(t.get(ra) != 'Комната А (правка)' or t.get(rb) != 'Комната Б (правка)', 'правка комнаты одного из учителей разных школ потеряна (%s)' % t, 'правки А и Б сохранены обе: fix_rooms возвращает комнаты с чужим автором (server/app.py fix_rooms)')
        # 2b: А меняет классы своей комнаты, Б (устаревший) сохраняет свою → отметки классов откатываются целым документом settings.content
        sync(pb); pa.evaluate("([i])=>VR.Store.setBands('room',i,'a')", [ra]); sync(pa)
        edit_title(pb, rb, 'Комната Б (правка 2)'); sync(pb)
        known(srv_bands(ra) != 'a', 'отметка классов комнаты А откатилась после сохранения устаревшим кабинетом Б: было \'a\', стало %r (settings.content берётся целиком у более нового — js/store.js merge, server/app.py merge_in)' % srv_bands(ra),
              'отметка классов пережила сохранение устаревшим кабинетом')
        sync(pa); sync(pb)
        # 2c: один учитель на двух устройствах: устаревшее устройство затирает новую комнату
        pa2 = teacher(cA2, 'tea.a')
        rn = mkroom(pa, 'Новая с первого', 'abcd'); sync(pa)
        n0 = len(srv_rooms())
        edit_title(pa2, ra, 'Комната А со второго'); sync(pa2)
        gone = rn not in srv_rooms()
        tr = dbq("SELECT id FROM trash WHERE kind = 'room' AND id = ?", rn)
        known(gone, 'комната учителя А пропала с сервера после сохранения вторым устройством того же учителя (было комнат %d, стало %d); fix_rooms её не возвращает (автор тот же), в корзине: %s (server/app.py merge_in: цикл по old_rooms → to_trash)' % (n0, len(srv_rooms()), 'да' if tr else 'нет'),
              'комната учителя пережила сохранение вторым устройством')
        sync(pa)
        known(rn not in {r['id'] for r in rooms_of(pa)}, 'у первого устройства комната тоже исчезла после синхронизации (js/store.js merge: settings целиком от более нового)', 'у первого устройства комната осталась')
        pa2.close()

        # ---- 7. комната старого ключа учителя без автора
        hk = headset(cH, 's-a'); hk.evaluate('()=>localStorage.setItem("vrlesson.server",JSON.stringify({url:"%s",key:"tk"}))' % API); hk.reload(); hk.wait_for_timeout(1200)
        r0 = hk.evaluate("""()=>{const s=VR.roomspec.TEMPLATES.empty.make();s.title='Старая без автора';const r=VR.Store.saveRoom(s);return r.spec&&r.spec.id;}""")
        hk.evaluate("VR.Store.sync()"); hk.close()
        ok(r0 in srv_rooms() and not srv_rooms()[r0].get('author'), 'комната старого ключа сохранена без автора (%s)' % r0)
        sync(pa); sync(pb)
        pc = teacher(cC, 'tea.c')

        def can(pg, rid):
            """Настоящий VR.custom.canEdit учителя: страница шлема с тем же сеансом учётки."""
            tok = pg.evaluate("[sessionStorage.getItem('vrl.token'),sessionStorage.getItem('vrl.user'),sessionStorage.getItem('vrl.roles')]")
            q = pg.context.new_page(); q.goto(WEB + '/help.html')
            q.evaluate("t=>{sessionStorage.setItem('vrl.token',t[0]);sessionStorage.setItem('vrl.user',t[1]);sessionStorage.setItem('vrl.roles',t[2]);}", tok)
            q.goto(WEB + '/index.html'); q.wait_for_timeout(1200); q.evaluate("VR.Store.sync()"); q.wait_for_timeout(500)
            r = q.evaluate("id=>VR.custom.canEdit({student:null,isTeacher:()=>true},id)", rid); q.close(); return r
        c_before = can(pa, r0)
        known(not c_before, 'автор комнаты без автора не может править её в шлеме (js/custom.js canEdit: sp.author===who), только из кабинета («Править в VR»)', 'учитель может править комнату без автора в шлеме')
        edit_title(pa, r0, 'Забрала А'); sync(pa)
        a1 = srv_rooms()[r0].get('author')
        known(a1 == 'tea.a', 'первый изменивший учитель забрал комнату без автора себе: author=%r (server/app.py fix_rooms: «старую комнату без автора забирает первый изменивший»)' % a1, 'комната осталась без автора (author=%r)' % a1)
        sync(pc); res = edit_title(pc, r0, 'Попытка С'); sync(pc)
        known(srv_rooms()[r0].get('title') == 'Забрала А' and not can(pc, r0), 'учитель С (той же школы) комнату уже править не может: правка молча откатана, в шлеме редактор закрыт — комната «ушла» к А', 'учитель С смог изменить комнату')
        sync(pa)

        # ---- 6. ссылка index.html?room=c-… до загрузки холла
        h6 = headset(cH, 's-a', '?room=' + ra)
        h6.click('#guestBtn'); h6.wait_for_timeout(200); h6.click('#go'); h6.wait_for_timeout(1500)
        in_room = h6.evaluate("VR.app.E.roomId")
        known(in_room != ra, 'ссылка на комнату после первой синхронизации не открыла её (roomId=%s)' % in_room, 'ссылка открывает комнату: VR.custom.refresh() вызывается в app.js go() до перехода, не только из hallPanel')
        h6.close()
        cN = b.new_context(); h7 = cN.new_page(); h7.route('**/api/sync', lambda r: r.abort()); h7.on('dialog', lambda d: d.accept())
        h7.goto(WEB + '/help.html'); h7.evaluate('()=>{localStorage.clear();sessionStorage.clear();localStorage.setItem("vrlesson.server",JSON.stringify({url:"%s",key:"%s"}))}' % (API, KEY['s-a']))
        h7.goto(WEB + '/index.html?room=' + ra); h7.wait_for_timeout(1200); h7.click('#guestBtn'); h7.wait_for_timeout(200); h7.click('#go'); h7.wait_for_timeout(1500)
        r7 = h7.evaluate("VR.app.E.roomId")
        known(r7 != ra, 'без загруженных данных (нет связи при первом открытии устройства) ссылка на комнату уводит в холл (roomId=%s): комнаты берутся только из синхронизированных настроек' % r7, 'ссылка открыла комнату даже без данных')
        h7.close()

        # ---- 4. 9-я комната класса не попадает на панель холла
        for i in range(9):
            mkroom(pa, 'Зал %d' % i, 'abcd')
        sync(pa)
        hb = headset(cH, 's-a'); sync(hb); h = hall(hb, 5); hb.close()
        known(h['open'] > 8 and h['panel'] == 8, 'открыто классу комнат %d, на панели холла кнопок %d: остальные недостижимы из холла (js/custom.js hallPanel: slice(0,8))' % (h['open'], h['panel']), 'на панели показаны все открытые комнаты (открыто %d, кнопок %d)' % (h['open'], h['panel']))

        # ---- 5. 31-я комната на сервере отклоняется у всех учителей
        # добираем до 30 комнатами учителя А, потом пробуем создать у учителя Б другой школы
        have = len(srv_rooms())
        pa.evaluate("n=>{for(let i=0;i<n;i++){const s=VR.roomspec.TEMPLATES.empty.make();s.title='Лимит '+i;VR.Store.saveRoom(s);}}", max(0, 30 - have)); sync(pa)
        sync(pb); n_srv = len(srv_rooms())
        res = pb.evaluate("()=>{const s=VR.roomspec.TEMPLATES.empty.make();s.title='31-я Б';const r=VR.Store.saveRoom(s);return{ok:!!r.spec,err:(r.errors||[])[0]||''};}")
        known(n_srv >= 30 and not res['ok'], 'на сервере %d комнат; учитель другой школы получил отказ «%s»: лимит RS.LIM.rooms=30 один на весь сервер (js/store.js saveRoom, js/roomspec.js LIM.rooms)' % (n_srv, res['err']),
              'учитель Б смог создать комнату сверх 30 (на сервере %d)' % n_srv)
        # то же через интерфейс: конструктор показывает alert с отказом
        pb.close(); pa.close(); pc.close()
        b.close()
except Exception as e:
    import traceback; traceback.print_exc(); fails.append('исключение: %s' % e)
finally:
    srv.terminate(); web.terminate()
ok(not errs, 'ошибок страниц нет' + ('' if not errs else ': ' + errs[0]))
print('\nИТОГ: %s' % ('FAIL (%d)' % len(fails) if fails else 'подготовка и проверки в порядке (известные сбои не валят прогон)'), flush=True)
sys.exit(1 if fails else 0)
