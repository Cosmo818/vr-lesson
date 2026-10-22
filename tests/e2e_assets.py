"""Б51: модели GLB, текстуры, разбор и загрузка. Запуск: python3 tests/e2e_assets.py"""
import base64, io, math, os, struct, subprocess, sys, wave
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from glb import make_glb, box, png
from playwright.sync_api import sync_playwright

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
web = subprocess.Popen([sys.executable, '-m', 'http.server', '8776', '--bind', '127.0.0.1'], cwd=root, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
fails = []


def ok(c, m):
    print(('ok  : ' if c else 'FAIL: ') + m, flush=True)
    if not c:
        fails.append(m)


def wav(sec, rate=8000):
    bio = io.BytesIO(); w = wave.open(bio, 'wb'); w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate)
    w.writeframes(b''.join(struct.pack('<h', int(8000 * math.sin(i * 0.2))) for i in range(int(sec * rate)))); w.close(); return bio.getvalue()


good = make_glb([{'geom': box(), 'color': (1, .5, .2), 'image': png()}, {'geom': box(0, 1, 0, .5, .5, .5), 'color': (.2, .6, 1)}])
big = make_glb([{'geom': (lambda g: (g[0] * 1800, g[1] * 1800, g[2] * 1800, [i + k * 24 for k in range(1800) for i in g[3]]))(box())}])
b64 = lambda b: base64.b64encode(b).decode()
try:
    with sync_playwright() as p:
        b = p.chromium.launch(); pg = b.new_context(service_workers='block').new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.route('**/assets/models/test.glb', lambda r: r.fulfill(status=200, body=good, headers={'content-type': 'model/gltf-binary'}))
        pg.route('**/assets/sounds/test.wav', lambda r: r.fulfill(status=200, body=wav(.3), headers={'content-type': 'audio/wav'}))
        pg.route('**/assets/sounds/huge.wav', lambda r: r.fulfill(status=200, body=wav(70), headers={'content-type': 'audio/wav'}))
        pg.goto('http://127.0.0.1:8776/index.html'); pg.wait_for_timeout(800)
        run = lambda js, arg=None: pg.evaluate(js, arg)
        parse = "b64=>{const bin=atob(b64),u=new Uint8Array(bin.length);for(let i=0;i<u.length;i++)u[i]=bin.charCodeAt(i);try{const g=VR.assets.parseGLB(u.buffer);return{ok:1,parts:g.parts.length,tris:g.tris,img:g.parts.map(p=>!!p.image),h:g.max[1]-g.min[1]}}catch(e){return{err:e.message}}}"
        r = run(parse, b64(good))
        ok(r.get('ok') and r['parts'] == 2 and r['tris'] == 24 and r['img'] == [True, False], 'GLB: две части, 24 треугольника, картинка у первой (%s)' % r)
        ok(abs(r['h'] - 1.75) < .01, 'GLB: размеры модели считаются (высота %.2f)' % r['h'])
        ok('треугольников' in run(parse, b64(big)).get('err', ''), 'GLB: модель выше лимита треугольников отклонена')
        ok('glb' in run(parse, b64(b'x' * 100)).get('err', '').lower() or run(parse, b64(b'x' * 100)).get('err'), 'GLB: чужой файл отклонён')
        ok(run(parse, b64(good[:200])).get('err'), 'GLB: обрезанный файл отклонён')
        ok(run(parse, b64(make_glb([{'geom': box()}], bad_uri=True))).get('img') == [False], 'GLB: картинка по внешней ссылке игнорируется')
        r = run("async()=>{const o=[];for(const u of['http://evil.example/x.glb','assets/../secret','/etc/passwd','assets/a b.glb']){try{await VR.Store.getAsset(u,1000);o.push('ok')}catch(e){o.push('no')}}return o}")
        ok(r == ['no'] * 4, 'ресурсы: внешние и подозрительные адреса отклонены')
        r = run("async()=>{const E=VR.app.E;const g=await E.loadModel('assets/models/test.glb');const n0=E.statics.length;const s=E.addModel(g,1,0,-2,1.5,0.3);await new Promise(r=>setTimeout(r,500));return{n:E.statics.length-n0,parts:g.parts.length,mode:s.map(x=>x.mode),again:E.loadModel('assets/models/test.glb')===E.loadModel('assets/models/test.glb')}}")
        ok(r['n'] == 2 and r['mode'] == [4, 0] and r['again'], 'модель: загружена, поставлена, с картинкой — режим «текстура», без — цвет (%s)' % r)
        r = run("(()=>{const E=VR.app.E;return VR.assets.TEXTURES.map(n=>!!E.tex(n))})()")
        ok(all(r) and len(r) >= 8, 'текстуры: все нарисованные текстуры создаются (%d)' % len(r))
        pg.click('#guestBtn'); pg.click('#go'); pg.wait_for_timeout(500)
        r = run("async()=>{const E=VR.app.E;E.audio();const b=await E.loadSound('assets/sounds/test.wav');const h=E.playSound(b,{pos:[1,1,-2],loop:true});const ok1=typeof h.stop==='function';E.loadRoom('hall');let bad='';try{await E.loadSound('assets/sounds/huge.wav')}catch(e){bad=e.message}return{d:b.duration,ok1,bad}}")
        ok(abs(r['d'] - .3) < .05 and r['ok1'], 'звук: файл читается (%.2f с) и играет с места в комнате' % r['d'])
        ok('большой' in r['bad'], 'звук: файл тяжелее 1 МБ отклонён (%s)' % r['bad'])
        pg.wait_for_timeout(500)
        r = run("async()=>{const E=VR.app.E,RS=VR.roomspec,o=[];for(const k of Object.keys(RS.MODELS)){const g=await E.loadModel('assets/models/'+k+'.glb');o.push(g.tris<=3000&&g.parts.length>0)}for(const k of Object.keys(RS.SFX)){const b=await E.loadSound('assets/sounds/'+k+'.wav');o.push(b.duration>.03)}return o}")
        ok(all(r) and len(r) == 11, 'библиотека: все 6 моделей и 5 звуков читаются (%d)' % len(r))
        r = run("(()=>{const RS=VR.roomspec,t=Object.keys(RS.TEXOPTS).filter(Boolean).sort().join(),a=VR.assets.TEXTURES.slice().sort().join();return t===a})()")
        ok(r, 'текстуры: список в конструкторе совпадает с нарисованными')
        r = run("(()=>{const RS=VR.roomspec;const c=RS.clean({title:'T',blocks:[{type:'model',asset:'evil',x:1,z:1},{type:'sound',asset:'../../x'},{type:'item',tex:'hack',shape:'cube'},{type:'table',tex:'wood'}]});return c.spec.blocks.map(b=>b.asset||b.tex||'')})()")
        ok(r == ['tree', 'wind', '', 'wood'], 'комната: неизвестные модель, звук и текстура заменяются безопасными (%s)' % r)
        run("""(()=>{const RS=VR.roomspec,S=VR.Store;const res=S.saveRoom({title:'Ресурсы',blocks:[{type:'table',x:0,z:-3,w:2,d:1,h:.8,tex:'wood'},{type:'item',x:-.5,z:-3,lift:.8,size:.3,tex:'brick',label:'Кубик',info:'x'},{type:'model',asset:'house',x:2,z:-3,h:1.5,label:'Домик',discover:true},{type:'sound',asset:'birds',x:0,z:-4,loop:true,vol:.5}]});window.__rid=res.spec.id;VR.custom.refresh();window.__plays=0;const E=VR.app.E,pl=E.playSound;E.playSound=(b,o)=>{window.__plays++;return pl.call(E,b,o)};E.goRoom(res.spec.id)})()""")
        pg.wait_for_timeout(1500)
        r = run("(()=>{const E=VR.app.E;return{modes:E.statics.map(s=>s.mode).filter(m=>m===4).length,n:E.statics.length,plays:window.__plays,targets:VR.ROOMS[window.__rid].targets(E,E.S).length}})()")
        ok(r['plays'] == 1, 'комната: фоновый звук запущен один раз (%s)' % r['plays'])
        ok(r['modes'] >= 1 and r['n'] > 8, 'комната: стол с текстурой и модель появились (%s)' % r)
        ok(r['targets'] == 2, 'комната: на предмет и модель можно нажать (%d)' % r['targets'])
        pg.wait_for_timeout(300)
        ok(not errs, 'ошибок JS нет' + ('' if not errs else ': ' + '; '.join(errs[:3])))
        b.close()
finally:
    web.terminate()
print('\nПРОВАЛЕНО: %d' % len(fails) if fails else '\nВсе проверки пройдены')
sys.exit(1 if fails else 0)
