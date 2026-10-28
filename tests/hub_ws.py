"""Проверки WebSocket-слоя hub (server/hub.py, шаг Н2): рукопожатие, кадры, лимиты, нарушения протокола, живой Chromium.
Запуск: python3 tests/hub_ws.py   (hub поднимается внутри теста на свободном порту, в тестовом режиме-эхо)."""
import asyncio, base64, os, struct, sys, json, time
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'server'))
import hub as H

ORIGIN = 'https://school.example'
FAIL = []


def check(name, ok, info=''):
    print(('ok  : ' if ok else 'FAIL: ') + name + ('' if ok else '  ' + str(info)))
    if not ok:
        FAIL.append(name)


def mframe(op, data=b'', fin=True, rsv=0, mask=True, length_override=None):
    b1 = (0x80 if fin else 0) | rsv | op
    n = len(data) if length_override is None else length_override
    if n < 126:
        h = bytes([b1, (0x80 if mask else 0) | n])
    elif n < 65536:
        h = bytes([b1, (0x80 if mask else 0) | 126]) + struct.pack('>H', n)
    else:
        h = bytes([b1, (0x80 if mask else 0) | 127]) + struct.pack('>Q', n)
    if not mask:
        return h + data
    mk = b'\x01\x02\x03\x04'
    return h + mk + bytes(c ^ mk[i % 4] for i, c in enumerate(data))


async def connect(port, origin=ORIGIN, path='/ws', key=None, extra=''):
    r, w = await asyncio.open_connection('127.0.0.1', port)
    key = key or base64.b64encode(os.urandom(16)).decode()
    req = 'GET %s HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\n' % (path, key)
    if origin:
        req += 'Origin: %s\r\n' % origin
    req += extra + '\r\n'
    w.write(req.encode())
    await w.drain()
    return r, w, key


async def status_line(r):
    try:
        head = await asyncio.wait_for(r.readuntil(b'\r\n\r\n'), 3)
    except Exception:
        return None, b''
    return head.split(b'\r\n')[0].decode(), head


async def read_frame(r, t=3):
    b1, b2 = await asyncio.wait_for(r.readexactly(2), t)
    n = b2 & 0x7F
    if n == 126:
        n = struct.unpack('>H', await r.readexactly(2))[0]
    elif n == 127:
        n = struct.unpack('>Q', await r.readexactly(8))[0]
    return b1 & 0x0F, await r.readexactly(n)


async def expect_close(r, code, name):
    try:
        op, d = await read_frame(r)
        check(name, op == 8 and struct.unpack('>H', d[:2])[0] == code, (op, d[:2]))
    except Exception as e:
        check(name, False, repr(e))


async def main():
    hub, srv = await H.serve('127.0.0.1', 0, {'origins': [ORIGIN, 'http://school.example'], 'handshake_s': 1.0, 'hello_s': 1.0, 'max_unauth_ip': 20, 'ping_s': 0.5, 'idle_s': 2.0}, test=True)
    port = srv.sockets[0].getsockname()[1]

    # ключ из RFC 6455
    check('accept-key по RFC', H.ws_accept_key('dGhlIHNhbXBsZSBub25jZQ==') == 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=')

    # рукопожатие и эхо
    r, w, key = await connect(port)
    st, head = await status_line(r)
    check('101 на верный Origin', st and ' 101 ' in st and H.ws_accept_key(key).encode() in head, st)
    w.write(mframe(1, 'привет'.encode()))
    await w.drain()
    op, d = await read_frame(r)
    check('эхо текста', op == 1 and d.decode() == 'привет', (op, d))
    w.write(mframe(2, bytes(range(200)) * 10))
    op, d = await read_frame(r)
    check('эхо бинарного 2000 Б (расширенная длина)', op == 2 and d == bytes(range(200)) * 10)
    w.write(mframe(9, b'abc'))
    op, d = await read_frame(r)
    check('ping → pong с теми же данными', op == 10 and d == b'abc', (op, d))
    # фрагментированное сообщение с пингом посередине
    w.write(mframe(1, b'he', fin=False) + mframe(9, b'p') + mframe(0, b'llo'))
    op1, d1 = await read_frame(r)
    op2, d2 = await read_frame(r)
    check('фрагменты собраны, ping между ними обслужен', (op1, d1) == (10, b'p') and (op2, d2) == (1, b'hello'), (op1, d1, op2, d2))
    # серверный ping при молчании клиента
    op, d = await read_frame(r, 3)
    check('сервер сам шлёт ping', op == 9, op)
    w.write(mframe(8, struct.pack('>H', 1000)))
    await expect_close(r, 1000, 'закрытие по просьбе клиента → 1000')
    w.close()

    # /health
    r, w = await asyncio.open_connection('127.0.0.1', port)
    w.write(b'GET /health HTTP/1.1\r\nHost: x\r\n\r\n')
    raw = await r.read(2000)
    body = json.loads(raw.split(b'\r\n\r\n', 1)[1])
    check('/health отвечает JSON', b' 200 ' in raw.split(b'\r\n')[0] and body.get('ok') is True and 'conns' in body, raw)
    w.close()

    # чужой Origin, нет Origin, неверный путь, версия, ключ
    r, w, _ = await connect(port, origin='https://evil.example')
    st, _h = await status_line(r)
    check('чужой Origin → 403', st and ' 403 ' in st, st)
    r, w, _ = await connect(port, origin=None)
    st, _h = await status_line(r)
    check('без Origin → 403 (список задан)', st and ' 403 ' in st, st)
    r, w, _ = await connect(port, path='/other')
    st, _h = await status_line(r)
    check('чужой путь → 404', st and ' 404 ' in st, st)
    r, w, _ = await connect(port, key='короткий')
    st, _h = await status_line(r)
    check('плохой ключ → 400', st and ' 400 ' in st, st)
    r, w = await asyncio.open_connection('127.0.0.1', port)
    w.write(('GET /ws HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nOrigin: %s\r\nSec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 8\r\n\r\n' % (ORIGIN, base64.b64encode(os.urandom(16)).decode())).encode())
    st, h = await status_line(r)
    check('версия 8 → 426 с Sec-WebSocket-Version: 13', st and ' 426 ' in st and b'Sec-WebSocket-Version: 13' in h, st)

    # слишком большой заголовок
    r, w, _ = await connect(port, extra='X-Pad: ' + 'a' * 20000 + '\r\n')
    st, _h = await status_line(r)
    check('заголовок > 8 КБ → 431/обрыв', st is None or ' 431 ' in st, st)

    # медленное рукопожатие
    r, w = await asyncio.open_connection('127.0.0.1', port)
    w.write(b'GET /ws HTTP/1.1\r\n')
    t0 = time.time()
    data = await asyncio.wait_for(r.read(100), 4)
    check('медленное рукопожатие обрывается за ~1 с', data == b'' and time.time() - t0 < 3, (data, time.time() - t0))

    # нарушения протокола
    async def bad(name, frames, code):
        r, w, _ = await connect(port)
        await status_line(r)
        w.write(frames)
        await w.drain()
        await expect_close(r, code, name)
        w.close()

    await bad('кадр без маски → 1002', mframe(1, b'x', mask=False), 1002)
    await bad('зарезервированные биты → 1002', mframe(1, b'x', rsv=0x40), 1002)
    await bad('длина 2^63 → 1002', bytes([0x81, 0x80 | 127]) + struct.pack('>Q', 1 << 63), 1002)
    await bad('длина 5000 > 4096 → 1009 до чтения тела', bytes([0x82, 0x80 | 126]) + struct.pack('>H', 5000), 1009)
    await bad('длина 2^40 → 1009', bytes([0x82, 0x80 | 127]) + struct.pack('>Q', 1 << 40), 1009)
    await bad('фрагментированный ping → 1002', mframe(9, b'a', fin=False), 1002)
    await bad('ping > 125 Б → 1002', mframe(9, b'a' * 126), 1002)
    await bad('неизвестный опкод 3 → 1002', mframe(3, b'a'), 1002)
    await bad('продолжение без начала → 1002', mframe(0, b'a'), 1002)
    await bad('новое сообщение посреди фрагментов → 1002', mframe(1, b'a', fin=False) + mframe(1, b'b'), 1002)
    await bad('плохой UTF-8 → 1007', mframe(1, b'\xff\xfe\xfd'), 1007)
    await bad('фрагменты в сумме > 4096 → 1009', mframe(2, b'a' * 3000, fin=False) + mframe(0, b'a' * 3000), 1009)

    # hello_s: клиент молчит после рукопожатия
    r, w, _ = await connect(port)
    await status_line(r)
    await expect_close(r, 4009, 'молчание после рукопожатия → 4009')
    w.close()

    # idle: ничего не отвечает на ping
    r, w, _ = await connect(port)
    await status_line(r)
    w.write(mframe(1, b'hi'))
    await read_frame(r)
    t0 = time.time()
    got = None
    try:
        while time.time() - t0 < 6:
            op, d = await read_frame(r, 4)
            if op == 8:
                got = struct.unpack('>H', d[:2])[0]
                break
    except Exception:
        pass
    check('клиент не отвечает на ping → 1001', got == 1001, got)
    w.close()

    # лимит неавторизованных на IP (20): без hello
    await asyncio.sleep(0.3)
    socks = []
    for _ in range(30):
        try:
            r, w, _ = await connect(port)
            socks.append((r, w))
        except Exception:
            pass
    codes = []
    for r, w in socks:
        st, _h = await status_line(r)
        codes.append(st.split(' ')[1] if st else '-')
        # не закрываем, держим открытыми
    check('неавторизованных на IP не больше 20 (остальные отказ)', codes.count('101') <= 20 and len(codes) - codes.count('101') >= 5, {c: codes.count(c) for c in set(codes)})
    for r, w in socks:
        w.close()
    await asyncio.sleep(1.5)
    check('после закрытия счётчики обнулились', hub.conns == 0 and not hub.unauth, (hub.conns, hub.unauth))

    # живой Chromium
    try:
        from playwright.async_api import async_playwright
        async with async_playwright() as pw:
            br = await pw.chromium.launch(args=['--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessSendPreflights,BlockInsecurePrivateNetworkRequests'])
            ctx = await br.new_context()
            pg = await ctx.new_page()
            await pg.route('http://school.example/', lambda rt: rt.fulfill(body='<html><body>x</body></html>', content_type='text/html'))
            await pg.goto('http://school.example/')
            res = await pg.evaluate("""p=>new Promise(ok=>{const w=new WebSocket('ws://127.0.0.1:'+p+'/ws');const out=[];
              w.binaryType='arraybuffer';
              w.onopen=()=>{w.send('привет');w.send(new Uint8Array([1,2,3,4]));};
              w.onmessage=e=>{out.push(typeof e.data==='string'?e.data:Array.from(new Uint8Array(e.data)).join());if(out.length==2){w.close();ok(out);}};
              w.onerror=()=>ok(['error']);setTimeout(()=>ok(['timeout']),4000);})""", port)
            check('Chromium: текст и бинарное через реальный WebSocket', res == ['привет', '1,2,3,4'], res)
            bad_origin = await pg.evaluate("""p=>new Promise(ok=>{const w=new WebSocket('ws://127.0.0.1:'+p+'/ws');w.onopen=()=>ok('open');w.onerror=()=>ok('error');})""", port)
            check('Chromium с этим Origin принят', bad_origin == 'open', bad_origin)
            ctx2 = await br.new_context()
            pg2 = await ctx2.new_page()
            await pg2.route('https://evil.example/', lambda rt: rt.fulfill(body='<html></html>', content_type='text/html'))
            await pg2.goto('https://evil.example/')
            r2 = await pg2.evaluate("""p=>new Promise(ok=>{const w=new WebSocket('ws://127.0.0.1:'+p+'/ws');w.onopen=()=>ok('open');w.onerror=()=>ok('error');})""", port)
            check('Chromium с чужим Origin отклонён', r2 == 'error', r2)
            await br.close()
    except ImportError:
        print('skip Chromium: нет playwright')

    srv.close()


asyncio.run(main())
print('\nИТОГО: %s' % ('всё зелёное' if not FAIL else 'ПРОВАЛЫ: ' + ', '.join(FAIL)))
sys.exit(1 if FAIL else 0)
