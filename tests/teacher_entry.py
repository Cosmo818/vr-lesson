import subprocess,time,os,sys
from playwright.sync_api import sync_playwright
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
srv=subprocess.Popen(['python3','-m','http.server','8898'],cwd=ROOT,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
time.sleep(1)
def t(c,m):print(('ok  : ' if c else 'FAIL: ')+m)
try:
  with sync_playwright() as p:
    b=p.chromium.launch(args=['--use-gl=swiftshader','--enable-unsafe-swiftshader']);pg=b.new_page()
    errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
    u='http://localhost:8898/'
    pg.goto(u+'index.html');pg.wait_for_timeout(1500)
    t(pg.is_visible('#teachBtn'),'на стартовой странице видна кнопка «Я учитель»')
    pg.click('#teachBtn');pg.wait_for_timeout(1200)
    t('teacher.html' in pg.url,'без входа кнопка ведёт в кабинет')
    pg.goto(u+'index.html');pg.evaluate("sessionStorage.setItem('vrl.laser',String(Date.now()+1e7))")
    pg.goto(u+'index.html?as=teacher');pg.wait_for_timeout(1500)
    t(pg.is_visible('#go') and pg.inner_text('#who')=='Учитель','?as=teacher с флагом: экран «Учитель» и кнопка входа')
    t(not pg.is_visible('#tClassP'),'без классов на устройстве выбора класса нет, есть выбор параллели')
    pg.click('#go');pg.wait_for_timeout(1500)
    t(pg.evaluate("VR.app.E.student.role")=='teacher','в сессии роль учителя')
    t(__import__('re').fullmatch(r'\d\d:\d\d',pg.evaluate("VR.app.E.hooks.hud().a")) is not None and not pg.evaluate("!!VR.app.E.hooks.hud().alert"),'у учителя вместо таймера часы (ЧЧ:ММ) и дата')
    # классы на устройстве (после входа в кабинет): выбор класса урока, параллель берётся из класса
    pg.goto(u+'index.html');pg.evaluate("""()=>{const n=Date.now();localStorage.setItem('vrlesson.v1',JSON.stringify({v:5,classes:[{id:'k7a',grade:7,letter:'А',created:n,updated:n},{id:'k9b',grade:9,letter:'Б',created:n,updated:n}],students:[{id:'s1',name:'Петров Пётр',grade:9,classId:'k9b',created:n,updated:n},{id:'s2',name:'Смирнова Анна',grade:9,classId:'k9b',created:n,updated:n},{id:'s3',name:'Чужой Ученик',grade:7,classId:'k7a',created:n,updated:n}],results:[],disc:{},tests:[],feedback:[],deleted:{},settings:{}}));localStorage.setItem('vrl.sub',JSON.stringify(['k9b']));sessionStorage.setItem('vrl.laser',String(Date.now()+1e7));}""")
    pg.goto(u+'index.html?as=teacher');pg.wait_for_timeout(1500)
    opts=pg.eval_on_selector_all('#tClass option','o=>o.map(x=>x.value+"|"+x.textContent)')
    t(pg.is_visible('#tClassP') and opts[0].startswith('k7a|7А') and any(o.startswith('k9b|') and 'предметник' in o for o in opts) and not pg.is_visible('#guestGrade'),'выбор класса урока: свои и предметные классы, параллель не спрашивается (%s)'%opts)
    pg.select_option('#tClass','k9b');pg.click('#go');pg.wait_for_timeout(1500)
    s=pg.evaluate("VR.app.E.student")
    t(s.get('classId')=='k9b' and s.get('grade')==9 and s.get('className')=='9Б','урок с классом 9Б: класс и параллель в сессии (%s)'%s)
    # планшет учителя: вкладка «Класс» со статистикой выбранного класса
    pg.evaluate("VR.app.E.toggleMenu(true)");pg.wait_for_timeout(400)
    lab=pg.evaluate("(()=>{const m=VR.app.E.menu;const b=m.btns.find(b=>b.x===218&&b.y===150);if(!b)return null;b.fn();m.dirty=true;return true;})()");pg.wait_for_timeout(500)
    txt=pg.evaluate("(()=>{const m=VR.app.E.menu,out=[];const c=m.ctx,f=c.fillText.bind(c);c.fillText=(t,...a)=>{out.push(String(t));return f(t,...a);};m.btns=[];m.over=[];VR.app.E.hooks.menuDraw(c,m);c.fillText=f;return out.join('|');})()")
    t(lab and 'Петров Пётр' in txt and 'Смирнова Анна' in txt and 'Чужой Ученик' not in txt and '9Б класс' in txt,'планшет учителя: вкладка «Класс» — ученики выбранного класса (9Б), чужих нет')
    # редактор своей комнаты в шлеме: автор = логин учителя
    r=pg.evaluate("""(()=>{const S=VR.Store,E=VR.app.E;sessionStorage.removeItem('vrl.editor');sessionStorage.setItem('vrl.user','t.mine');
      const a=S.saveRoom({schema:'room/1',title:'Моя',blocks:[]}).spec,b=S.saveRoom({schema:'room/1',title:'Чужая',blocks:[],author:'t.other'}).spec;VR.custom.refresh();
      return [a&&a.author,VR.custom.canEdit(E,a.id),VR.custom.canEdit(E,b.id)];})()""")
    t(r==['t.mine',True,False],'редактор в шлеме: своя комната — можно, чужая — нельзя (%s)'%r)
    # планшет ученика: «Мои успехи» — свои баллы и место в классе, одноклассники без имён
    pg.goto(u+'index.html');pg.evaluate("""()=>{sessionStorage.clear();const n=Date.now(),R=[];const st=[['a1','Аникин Артём'],['a2','Борисова Вера'],['a3','Волков Глеб']].map(([id,name])=>({id,name,grade:6,classId:'k6',created:n,updated:n}));
      [['a1',5],['a2',3],['a3',1]].forEach(([sid,sc],i)=>R.push({id:'r'+i,sid,subj:'math',score:sc,total:5,ts:n-i}));
      localStorage.setItem('vrlesson.v1',JSON.stringify({v:5,classes:[{id:'k6',grade:6,letter:'В',created:n,updated:n}],students:st,results:R,disc:{},tests:[],feedback:[],deleted:{},settings:{}}));}""")
    pg.goto(u+'index.html');pg.wait_for_timeout(1500)
    pg.evaluate("(()=>{VR.app.choose(VR.Store.student('a2'));VR.app.startSession();})()");pg.wait_for_timeout(800)
    pg.evaluate("VR.app.E.toggleMenu(true)");pg.wait_for_timeout(300)
    ok2=pg.evaluate("(()=>{const m=VR.app.E.menu;const b=m.btns.find(b=>b.y===150&&b.x>100);if(!b)return false;b.fn();return true;})()")
    txt=pg.evaluate("(()=>{const m=VR.app.E.menu,out=[];const c=m.ctx,f=c.fillText.bind(c);c.fillText=(t,...a)=>{out.push(String(t));return f(t,...a);};m.btns=[];m.over=[];VR.app.E.hooks.menuDraw(c,m);c.fillText=f;return out.join('|');})()")
    t(ok2 and 'место 2 из 3' in txt and 'Математика' in txt and '60%' in txt and 'Аникин' not in txt and 'Волков' not in txt,'планшет ученика: «Мои успехи» — баллы, место 2 из 3, проценты по предметам, без имён одноклассников')
    t(not pg.evaluate("VR.app.E.menu.over.length"),'планшет ученика: ничего не за краем')
    pg.evaluate("sessionStorage.setItem('vrl.laser',String(Date.now()+1e7))")
    t(pg.evaluate("VR.app.E.isTeacher()")==False,'ученик не получает инструменты учителя, даже если в вкладке остался флаг указки')
    # Т6: sessionStorage при переходе из кабинета кнопкой «▶ Войти в VR как учитель» (window.open, как в teacher.html)
    pg.goto(u+'teacher.html');pg.evaluate("sessionStorage.setItem('vrl.token','tok-t6');sessionStorage.setItem('vrl.user','t.six')")
    with pg.expect_popup() as pop:
        pg.evaluate("window.open('index.html?as=teacher','_blank')")
    pp=pop.value;pp.wait_for_load_state()
    t(pp.evaluate("sessionStorage.getItem('vrl.token')")=='tok-t6','window.open из кабинета (новая вкладка): токен учётки в sessionStorage скопирован')
    pg.evaluate("location.href='index.html?as=teacher'");pg.wait_for_timeout(1200)
    t(pg.evaluate("sessionStorage.getItem('vrl.token')")=='tok-t6','переход в той же вкладке: sessionStorage сохраняется')
    # без сервера и без флага учитель в шлеме не получает указку: кнопка уводит в кабинет
    pg.evaluate("sessionStorage.clear()");pg.goto(u+'index.html');pg.wait_for_timeout(1000)
    pg.click('#teachBtn');pg.wait_for_timeout(1200)
    t('teacher.html' in pg.url,'нет сервера и входа: «Я учитель» ведёт в кабинет')
    t(not errs,'ошибок JS нет')
    b.close()
finally: srv.kill()
