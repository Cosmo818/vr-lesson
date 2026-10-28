"""hub.py — hub живого урока: WebSocket (RFC 6455) на одной stdlib asyncio. Шаг Н2 плана сети (PLAN-network.md §4):
рукопожатие, кадры, лимиты, /health. Сессий и билетов пока нет (Н3, Н4): без --test после hello соединение закрывается кодом 4003.
Hub не пишет в базу и не читает данные школы. Слушает только внутреннюю сеть (наружу — через Caddy wss://…/ws), флаг net по умолчанию выключен.
Запуск:  python3 server/hub.py [--host 127.0.0.1] [--port 8788] [--config /data/config.json] [--origins URL,URL] [--test]
Безопасность (PLAN-network.md §13): Origin из списка, 5 с на рукопожатие и hello, заголовки ≤ 8 КБ, кадр клиента ≤ 4 КБ (длина проверяется
до чтения тела), маска обязательна, служебные кадры ≤ 125 Б и без фрагментов, сборка фрагментов с потолком, проверка UTF-8, ≤ 400 соединений,
≤ 60 неавторизованных на IP, расширения не согласуются."""
import argparse
import asyncio
import base64
import hashlib
import json
import os
import struct
import sys
import time

GUID = b'258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
OP_CONT, OP_TEXT, OP_BIN, OP_CLOSE, OP_PING, OP_PONG = 0, 1, 2, 8, 9, 10
DEFAULT_LIMITS = {
    'handshake_s': 5.0, 'hello_s': 5.0, 'head_max': 8192, 'frame_max': 4096, 'max_conns': 400, 'max_unauth_ip': 60,
    'max_unauth': 300, 'ping_s': 10.0, 'idle_s': 35.0, 'origins': [], 'trusted': ['127.0.0.1', '::1'], 'hard_buf': 2 << 20,
}


class WSClose(Exception):
    """Нарушение протокола или лимита: закрыть соединение этим кодом."""

    def __init__(self, code, reason=''):
        Exception.__init__(self, code, reason)
        self.code, self.reason = code, reason


# ---------------------------------------------------------------- кадры

def ws_accept_key(key):
    return base64.b64encode(hashlib.sha1(key.encode('ascii') + GUID).digest()).decode('ascii')


def _http(writer, code, text, extra=b'', body=b''):
    head = ('HTTP/1.1 %d %s\r\nContent-Length: %d\r\nConnection: close\r\n' % (code, text, len(body))).encode('ascii')
    writer.write(head + extra + b'\r\n' + body)


async def ws_handshake(reader, writer, limits, health=None, gate=None):
    """→ (path, headers) после ответа 101, либо None (ответ об ошибке уже отправлен, сокет закрывает вызывающий).
    Обычный GET /health без Upgrade отвечает JSON и тоже даёт None."""
    try:
        raw = await asyncio.wait_for(reader.readuntil(b'\r\n\r\n'), limits['handshake_s'])
    except asyncio.TimeoutError:
        return None
    except asyncio.LimitOverrunError:
        _http(writer, 431, 'Request Header Fields Too Large')
        return None
    except (asyncio.IncompleteReadError, ConnectionError):
        return None
    if len(raw) > limits['head_max']:
        _http(writer, 431, 'Request Header Fields Too Large')
        return None
    try:
        lines = raw[:-4].decode('latin-1').split('\r\n')
        method, path, ver = lines[0].split(' ')
        hd = {}
        for ln in lines[1:]:
            k, v = ln.split(':', 1)
            hd[k.strip().lower()] = v.strip()
    except ValueError:
        _http(writer, 400, 'Bad Request')
        return None
    if method != 'GET' or ver != 'HTTP/1.1':
        _http(writer, 400, 'Bad Request')
        return None
    path = path.split('?', 1)[0]
    if path == '/health' and 'upgrade' not in hd:
        body = json.dumps(health() if health else {'ok': True}).encode()
        _http(writer, 200, 'OK', b'Content-Type: application/json\r\n', body)
        return None
    if path != '/ws':
        _http(writer, 404, 'Not Found')
        return None
    origins = limits.get('origins') or []
    if origins and hd.get('origin', '') not in origins:
        _http(writer, 403, 'Forbidden')
        return None
    key = hd.get('sec-websocket-key', '')
    try:
        okkey = len(base64.b64decode(key, validate=True)) == 16
    except Exception:
        okkey = False
    if hd.get('upgrade', '').lower() != 'websocket' or 'upgrade' not in hd.get('connection', '').lower() or not okkey:
        _http(writer, 400, 'Bad Request')
        return None
    if hd.get('sec-websocket-version') != '13':
        _http(writer, 426, 'Upgrade Required', b'Sec-WebSocket-Version: 13\r\n')
        return None
    if gate and not gate(hd):
        _http(writer, 429, 'Too Many Requests')
        return None
    writer.write(('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: %s\r\n\r\n'
                  % ws_accept_key(key)).encode('ascii'))
    await writer.drain()
    return path, hd


def _unmask(data, mask):
    if not data:
        return b''
    n = len(data)
    m = (mask * (n // 4 + 1))[:n]
    return (int.from_bytes(data, 'big') ^ int.from_bytes(m, 'big')).to_bytes(n, 'big')


async def ws_read(reader, maxlen, st=None):
    """→ (opcode, bytes): целое сообщение (фрагменты собраны) или служебный кадр. Нарушение — WSClose.
    Длина проверяется ДО чтения тела: больше maxlen — 1009; 64-битная длина со старшим битом — 1002."""
    if st is None:
        st = {}
    while True:
        b1, b2 = await reader.readexactly(2)
        fin, rsv, op = b1 & 0x80, b1 & 0x70, b1 & 0x0F
        if rsv:
            raise WSClose(1002, 'rsv')
        if not (b2 & 0x80):
            raise WSClose(1002, 'mask')
        ln = b2 & 0x7F
        if op >= 8:
            if ln > 125 or not fin:
                raise WSClose(1002, 'control')
            if op not in (OP_CLOSE, OP_PING, OP_PONG):
                raise WSClose(1002, 'opcode')
        elif op not in (OP_CONT, OP_TEXT, OP_BIN):
            raise WSClose(1002, 'opcode')
        if ln == 126:
            ln = struct.unpack('>H', await reader.readexactly(2))[0]
        elif ln == 127:
            ln = struct.unpack('>Q', await reader.readexactly(8))[0]
            if ln >> 63:
                raise WSClose(1002, 'length')
        if ln > maxlen or st.get('total', 0) + ln > maxlen:
            raise WSClose(1009, 'big')
        mask = await reader.readexactly(4)
        data = _unmask(await reader.readexactly(ln), mask) if ln else b''
        if op >= 8:
            return op, data
        if op == OP_CONT:
            if st.get('op') is None:
                raise WSClose(1002, 'cont')
        else:
            if st.get('op') is not None:
                raise WSClose(1002, 'frag')
            st['op'], st['parts'], st['total'] = op, [], 0
        st['parts'].append(data)
        st['total'] += ln
        if fin:
            out = b''.join(st['parts'])
            msg_op = st['op']
            st.clear()
            if msg_op == OP_TEXT:
                try:
                    out.decode('utf-8')
                except UnicodeDecodeError:
                    raise WSClose(1007, 'utf8')
            return msg_op, out


def ws_frame(opcode, data=b''):
    n = len(data)
    if n < 126:
        h = struct.pack('>BB', 0x80 | opcode, n)
    elif n < 65536:
        h = struct.pack('>BBH', 0x80 | opcode, 126, n)
    else:
        h = struct.pack('>BBQ', 0x80 | opcode, 127, n)
    return h + data


def ws_send(writer, opcode, data=b''):
    writer.write(ws_frame(opcode, data))


def ws_close(writer, code, reason=''):
    try:
        ws_send(writer, OP_CLOSE, struct.pack('>H', code) + reason.encode('utf-8')[:100])
    except Exception:
        pass


# ---------------------------------------------------------------- сервер

class Conn:
    """Одно соединение; сессионный слой (server/hubsess.py) работает только через эти методы."""

    def __init__(self, writer, ip):
        self.writer, self.ip, self.seat, self.authed, self.closed = writer, ip, None, False, False
        self.flood_t = self.drop_t = None

    def buf(self):
        try:
            return self.writer.transport.get_write_buffer_size()
        except Exception:
            return 0

    def text(self, obj):
        if not self.closed:
            ws_send(self.writer, OP_TEXT, obj if isinstance(obj, bytes) else json.dumps(obj, ensure_ascii=False, separators=(',', ':')).encode('utf-8'))

    def bin(self, b):
        if not self.closed:
            ws_send(self.writer, OP_BIN, b)

    def close(self, code, reason='', abort=False):
        if self.closed:
            return
        self.closed = True
        try:
            if abort:
                self.writer.transport.abort()
            else:
                ws_close(self.writer, code, reason)
                self.writer.close()
        except Exception:
            pass


class Hub:
    def __init__(self, limits, test=False, core=None):
        self.L = dict(DEFAULT_LIMITS)
        self.L.update(limits or {})
        self.test, self.core = test, core
        self.conns, self.pending, self.unauth = 0, 0, {}
        self.t0 = time.time()

    def health(self):
        h = {'ok': True, 'sessions': 0, 'conns': self.conns, 'up': int(time.time() - self.t0)}
        if self.core:
            h.update(self.core.health())
        return h

    def real_ip(self, peer, hd):
        """За Caddy все приходят с одного адреса: настоящий берём из X-Forwarded-For, но только от доверенного прокси (последний адрес)."""
        if peer in (self.L.get('trusted') or []):
            xff = hd.get('x-forwarded-for', '')
            if xff:
                return xff.split(',')[-1].strip()[:64] or peer
        return peer

    def _auth(self, conn, counted):
        if counted[0]:
            counted[0] = False
            self.pending -= 1
            if counted[1]:
                n = self.unauth.get(conn.ip, 1) - 1
                if n > 0:
                    self.unauth[conn.ip] = n
                else:
                    self.unauth.pop(conn.ip, None)

    async def handle(self, reader, writer):
        L = self.L
        peer = (writer.get_extra_info('peername') or ('?',))[0]
        if self.conns >= L['max_conns'] or self.pending >= L['max_unauth']:
            _http(writer, 429, 'Too Many Requests')
            await self._shut(writer)
            return
        self.conns += 1
        self.pending += 1
        counted = [True, False]          # [в pending, в unauth по IP]
        conn = Conn(writer, peer)

        def gate(hd):
            ip = conn.ip = self.real_ip(peer, hd)
            if self.unauth.get(ip, 0) >= L['max_unauth_ip']:
                return False
            self.unauth[ip] = self.unauth.get(ip, 0) + 1
            counted[1] = True
            return True

        try:
            hs = await ws_handshake(reader, writer, L, self.health, gate)
            if not hs:
                return
            deadline = time.monotonic() + L['hello_s']
            last = time.monotonic()
            fst = {}
            while not conn.closed:
                if conn.authed:
                    tmo = L['ping_s']
                else:
                    tmo = deadline - time.monotonic()
                    if tmo <= 0:
                        ws_close(writer, 4009, 'hello')
                        return
                try:
                    op, data = await asyncio.wait_for(ws_read(reader, L['frame_max'], fst), tmo)
                except asyncio.TimeoutError:
                    if not conn.authed:
                        ws_close(writer, 4009, 'hello')
                        return
                    if time.monotonic() - last > L['idle_s']:
                        ws_close(writer, 1001, 'idle')
                        return
                    ws_send(writer, OP_PING, b'')
                    continue
                last = time.monotonic()
                if op == OP_PING:
                    ws_send(writer, OP_PONG, data)
                elif op == OP_PONG:
                    pass
                elif op == OP_CLOSE:
                    ws_close(writer, 1000)
                    return
                elif self.test:
                    conn.authed = True
                    ws_send(writer, op, data)
                    try:
                        await asyncio.wait_for(writer.drain(), 5)
                    except asyncio.TimeoutError:
                        ws_close(writer, 4008, 'slow')
                        return
                elif self.core:
                    try:
                        (self.core.on_text if op == OP_TEXT else self.core.on_bin)(conn, data)
                    except Exception as e:
                        print('core:', repr(e)[:200], file=sys.stderr)
                        conn.close(1011, 'internal')
                else:
                    ws_close(writer, 4003, 'нет сессий')
                    return
                if conn.authed:
                    self._auth(conn, counted)
                if conn.buf() > L['hard_buf']:
                    conn.close(4008, 'slow', abort=True)
        except WSClose as e:
            ws_close(writer, e.code, e.reason)
        except (asyncio.IncompleteReadError, ConnectionError, asyncio.CancelledError):
            pass
        finally:
            self.conns -= 1
            self._auth(conn, counted)
            if self.core:
                try:
                    self.core.on_close(conn)
                except Exception as e:
                    print('on_close:', repr(e), file=sys.stderr)
            conn.closed = True
            await self._shut(writer)

    @staticmethod
    async def _shut(writer):
        try:
            writer.close()
            await asyncio.wait_for(writer.wait_closed(), 2)
        except Exception:
            pass


async def run_loops(core):
    """Такт рассылки поз (tick_hz) и обслуживание (away, удержание мест, отчёт) раз в 0,5 с. Ошибка такта не роняет hub."""
    loop = asyncio.get_running_loop()
    dt = 1.0 / core.L['tick_hz']
    nxt = loop.time()
    hk = loop.time()
    while True:
        nxt += dt
        try:
            core.tick_all()
            if loop.time() - hk >= 0.5:
                hk = loop.time()
                core.housekeep()
        except Exception as e:
            print('tick:', repr(e), file=sys.stderr)
        wait = nxt - loop.time()
        if wait < -1:
            nxt = loop.time()
            wait = 0
        await asyncio.sleep(max(0.0, wait))


async def serve(host, port, limits, test=False, core=None):
    hub = Hub(limits, test, core)
    srv = await asyncio.start_server(hub.handle, host, port, limit=hub.L['head_max'] + 1024)
    hub.loop_task = asyncio.ensure_future(run_loops(core)) if core else None
    return hub, srv


class AppLink:
    """Связь hub → app.py: отчёты (POST /api/hub/report) и опрос закрытых сессий (GET /api/hub/sessions) с подписью HMAC k_report.
    Запросы идут в одном фоновом потоке (цикл событий не ждёт сеть); ответы app.py забираются при следующем вызове и применяются Core.apply."""

    def __init__(self, url, k_report, timeout=5.0):
        import concurrent.futures
        self.url, self.k, self.timeout = url.rstrip('/'), k_report, timeout
        self.ex = concurrent.futures.ThreadPoolExecutor(max_workers=1, thread_name_prefix='applink')
        self.futs = []
        self.errors = 0

    def _call(self, method, path, data, headers):
        import urllib.request
        import urllib.error
        r = urllib.request.Request(self.url + path, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(r, timeout=self.timeout) as f:
                return json.loads(f.read().decode('utf-8'))
        except (urllib.error.URLError, OSError, ValueError):
            self.errors += 1
            return None

    def _sig(self, raw):
        import hubticket
        return hubticket.sign_report(self.k, raw)

    def take(self):
        out = {}
        keep = []
        for f in self.futs:
            if not f.done():
                keep.append(f)
                continue
            try:
                r = f.result()
            except Exception:
                r = None
            if isinstance(r, dict):
                out.setdefault('closed', []).extend(r.get('closed') or [])
                out.setdefault('banned', {}).update(r.get('banned') or {})
                out.setdefault('settings', {}).update(r.get('settings') or {})
        self.futs = keep
        return out or None

    def report(self, body):
        raw = json.dumps(body, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
        self.futs.append(self.ex.submit(self._call, 'POST', '/api/hub/report', raw, {'Content-Type': 'application/json', 'X-Sig': self._sig(raw)}))
        return self.take()

    def poll(self):
        ts = str(int(time.time() * 1000))
        self.futs.append(self.ex.submit(self._call, 'GET', '/api/hub/sessions', None, {'X-Ts': ts, 'X-Sig': self._sig(('sessions:' + ts).encode())}))
        return self.take()


def file_reporter(path):
    def rep(body):
        with open(path, 'a', encoding='utf-8') as f:
            f.write(json.dumps(body, ensure_ascii=False) + '\n')
        return None
    return rep


def load_config(args):
    L, cfg = {}, {}
    if args.config and os.path.exists(args.config):
        try:
            cfg = json.load(open(args.config, encoding='utf-8'))
        except Exception as e:
            print('config.json не прочитан:', e, file=sys.stderr)
    if isinstance(cfg.get('hubOrigins'), list):
        L['origins'] = [str(x) for x in cfg['hubOrigins']][:20]
    if isinstance(cfg.get('hubTrusted'), list):
        L['trusted'] = [str(x) for x in cfg['hubTrusted']][:20]
    if args.origins:
        L['origins'] = [x for x in args.origins.split(',') if x]
    for k in ('handshake_s', 'hello_s', 'max_unauth_ip', 'max_conns', 'ping_s', 'idle_s'):
        v = getattr(args, k)
        if v is not None:
            L[k] = v
    return L, cfg


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--host', default='127.0.0.1')
    ap.add_argument('--port', type=int, default=8788)
    ap.add_argument('--config', default='')
    ap.add_argument('--origins', default='')
    ap.add_argument('--app-url', default='', help='адрес app.py для отчётов и опроса (по умолчанию hubAppUrl из config.json), например http://127.0.0.1:8787')
    ap.add_argument('--report-file', default='', help='отчёты посещаемости в файл (пока нет /api/hub/report — шаг Н4)')
    ap.add_argument('--test', action='store_true', help='эхо-канал для тестов (в рабочем режиме не включать)')
    ap.add_argument('--handshake_s', type=float)
    ap.add_argument('--hello_s', type=float)
    ap.add_argument('--max_unauth_ip', type=int)
    ap.add_argument('--max_conns', type=int)
    ap.add_argument('--ping_s', type=float)
    ap.add_argument('--report_s', type=float)
    ap.add_argument('--poll_s', type=float)
    ap.add_argument('--idle_s', type=float)
    a = ap.parse_args()
    L, cfg = load_config(a)
    core = None
    if not a.test:
        if not L.get('origins'):
            sys.exit('hub: не задан hubOrigins (config.json) — без списка разрешённых сайтов не запускаюсь')
        try:
            import hubticket
            import hubsess
            keys = hubticket.derive(cfg.get('hubSecret'))
        except ValueError as e:
            sys.exit('hub: hubSecret не задан или короток (%s); создать: python3 server/app.py hub-secret' % e)
        app_url = a.app_url or str(cfg.get('hubAppUrl') or '')
        link = AppLink(app_url, keys['report']) if app_url else None
        lim = {'aud': str(cfg.get('hubId') or 'center'), 'kid': cfg.get('hubKid') or None}
        lim.update({k: getattr(a, k) for k in ('report_s', 'poll_s') if getattr(a, k) is not None})
        core = hubsess.Core(keys, lim,
                            reporter=link.report if link else file_reporter(a.report_file) if a.report_file else None,
                            poller=link.poll if link else None)

    async def run():
        hub, srv = await serve(a.host, a.port, L, a.test, core)
        print('hub слушает %s:%d%s' % (a.host, a.port, ' (тестовый режим)' if a.test else ''), flush=True)
        async with srv:
            await srv.serve_forever()

    try:
        asyncio.run(run())
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    main()
