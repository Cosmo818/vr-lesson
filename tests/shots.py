import sys, subprocess, time, os
from playwright.sync_api import sync_playwright
root, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8765', '--bind', '127.0.0.1'], cwd=root, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
errs = []
try:
    with sync_playwright() as p:
        b = p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        pg = b.new_page(viewport={'width': 1280, 'height': 800})
        pg.on('console', lambda m: errs.append('console ' + m.type + ': ' + m.text) if m.type in ('error', 'warning') or 'error' in m.text else None)
        pg.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)))
        pg.goto('http://127.0.0.1:8765/index.html')
        pg.wait_for_timeout(1500)
        pg.screenshot(path=out + '/0-menu.png')
        pg.click('#addBtn'); pg.fill('#nm', 'Аня Петрова'); pg.select_option('#gr', '6'); pg.click('#addForm .btn:not(.ghost)')
        pg.wait_for_timeout(300)
        pg.screenshot(path=out + '/1-ready.png')
        pg.click('#go'); pg.wait_for_timeout(1500)
        pg.screenshot(path=out + '/2-hall.png')
        views = {
            'hall': [(0, -0.5, 0, 0.05), (0, -0.5, 3.1416, 0)],
            'bio': [(0, -0.5, 0, 0.0), (-2.5, 0.6, 1.5708, 0)],
            'soc': [(0, -0.5, 0, 0.05), (-1.5, 0, 1.5708, -0.05)],
            'logic': [(0, -1.5, 0, -0.1), (-3.0, 0.4, 1.5708, 0)],
            'hist': [(0, -1.5, 0, 0.05), (-1.5, 0, 1.5708, -0.05)],
        }
        pg.evaluate("VR.app.E.toast=()=>{}")
        for room, vs in views.items():
            pg.evaluate(f"VR.app.E.goRoom('{room}')")
            for i, (x, z, yaw, pitch) in enumerate(vs):
                pg.evaluate(f"(()=>{{const D=VR.app.E.deskCam;D.x={x};D.z={z};D.yaw={yaw};D.pitch={pitch};}})()")
                pg.wait_for_timeout(1300)
                pg.screenshot(path=f'{out}/3-{room}-{i}.png')
        # quiz panel close-up in math
        pg.evaluate("VR.app.E.goRoom('math')")
        pg.evaluate("(()=>{const E=VR.app.E;const q=E.panels.find(p=>p.quiz);q.quizApi.start();q.dirty=true;const D=E.deskCam;D.x=3.6;D.z=1.5;D.yaw=-1.5708;D.pitch=-0.05;})()")
        pg.wait_for_timeout(1300); pg.screenshot(path=out + '/4-quiz-q.png')
        pg.evaluate("(()=>{const q=VR.app.E.panels.find(p=>p.quiz);q.quizApi.answer(0);q.dirty=true;})()")
        pg.wait_for_timeout(800); pg.screenshot(path=out + '/4-quiz-fb.png')
        pg.evaluate("(()=>{const E=VR.app.E;E.toggleMenu(true);})()")
        pg.wait_for_timeout(800); pg.screenshot(path=out + '/5-menu.png')
        pg.evaluate("VR.app.endSession()")
        pg.wait_for_timeout(500); pg.screenshot(path=out + '/6-summary.png')
        # teacher
        pg.goto('http://127.0.0.1:8765/teacher.html'); pg.fill('#pin', '1234'); pg.click('#pinForm .btn'); pg.wait_for_timeout(300)
        pg.click('#rTable tr.click'); pg.wait_for_timeout(300)
        pg.screenshot(path=out + '/7-teacher.png', full_page=True)
        pg.click('[data-t=tests]'); pg.select_option('#tplSubj','bio'); pg.select_option('#tplBand','b'); pg.click('#fromBank'); pg.wait_for_timeout(300)
        pg.screenshot(path=out + '/7-ctor.png', full_page=False)
        pg.click('#eSave'); pg.wait_for_timeout(300); pg.screenshot(path=out + '/7-ctor-list.png')
        m = b.new_page(viewport={'width': 390, 'height': 800}); m.goto('http://127.0.0.1:8765/teacher.html'); m.fill('#pin', '1234'); m.click('#pinForm .btn'); m.wait_for_timeout(300)
        m.screenshot(path=out + '/8-teacher-phone.png')
        m.goto('http://127.0.0.1:8765/index.html'); m.wait_for_timeout(800); m.screenshot(path=out + '/8-index-phone.png')
        b.close()
finally:
    srv.terminate()
print('\n'.join(errs) if errs else 'no console errors')
