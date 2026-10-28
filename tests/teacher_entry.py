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
    pg.click('#go');pg.wait_for_timeout(1500)
    t(pg.evaluate("VR.app.E.student.role")=='teacher','в сессии роль учителя')
    t(not errs,'ошибок JS нет')
    b.close()
finally: srv.kill()
