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
    'ping_s': 10.0, 'idle_s': 35.0, 'origins': [],
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


async def ws_handshake(reader, writer, limits, health=None):
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

class Hub:
    def __init__(self, limits, test=False, on_message=None):
        self.L = dict(DEFAULT_LIMITS)
        self.L.update(limits)
        self.test = test
        self.on_message = on_message
        self.conns = 0
        self.unauth = {}
        self.sessions = {}
        self.t0 = time.time()

    def health(self):
        return {'ok': True, 'sessions': len(self.sessions), 'conns': self.conns, 'up': int(time.time() - self.t0)}

    async def handle(self, reader, writer):
        ip = (writer.get_extra_info('peername') or ('?',))[0]
        if self.conns >= self.L['max_conns'] or self.unauth.get(ip, 0) >= self.L['max_unauth_ip']:
            _http(writer, 429, 'Too Many Requests')
            await self._shut(writer)
            return
        self.conns += 1
        self.unauth[ip] = self.unauth.get(ip, 0) + 1
        authed = False
        try:
            hs = await ws_handshake(reader, writer, self.L, self.health)
            if not hs:
                return
            last = time.time()
            first = True
            fst = {}
            while True:
                tmo = self.L['hello_s'] if first else self.L['ping_s']
                try:
                    op, data = await asyncio.wait_for(ws_read(reader, self.L['frame_max'], fst), tmo)
                except asyncio.TimeoutError:
                    if first:
                        ws_close(writer, 4009, 'hello')
                        return
                    if time.time() - last > self.L['idle_s']:
                        ws_close(writer, 1001, 'idle')
                        return
                    ws_send(writer, OP_PING, b'')
                    await writer.drain()
                    continue
                last = time.time()
                if op == OP_PING:
                    ws_send(writer, OP_PONG, data)
                elif op == OP_PONG:
                    pass
                elif op == OP_CLOSE:
                    ws_close(writer, 1000)
                    await writer.drain()
                    return
                else:
                    if first:
                        first = False
                        authed = True
                        self.unauth[ip] = max(0, self.unauth.get(ip, 1) - 1)
                    if self.test:
                        ws_send(writer, op, data)
                    elif self.on_message:
                        await self.on_message(self, writer, op, data)
                    else:
                        ws_close(writer, 4003, 'нет сессий')
                        await writer.drain()
                        return
                await writer.drain()
        except WSClose as e:
            ws_close(writer, e.code, e.reason)
            try:
                await writer.drain()
            except Exception:
                pass
        except (asyncio.IncompleteReadError, ConnectionError, asyncio.CancelledError):
            pass
        finally:
            self.conns -= 1
            if not authed:
                self.unauth[ip] = max(0, self.unauth.get(ip, 1) - 1)
            if not self.unauth.get(ip):
                self.unauth.pop(ip, None)
            await self._shut(writer)

    @staticmethod
    async def _shut(writer):
        try:
            writer.close()
            await asyncio.wait_for(writer.wait_closed(), 2)
        except Exception:
            pass


async def serve(host, port, limits, test=False):
    hub = Hub(limits, test)
    srv = await asyncio.start_server(hub.handle, host, port, limit=limits.get('head_max', 8192) + 1024 if limits else 9216)
    return hub, srv


def load_limits(args):
    L = {}
    if args.config and os.path.exists(args.config):
        try:
            cfg = json.load(open(args.config, encoding='utf-8'))
            if isinstance(cfg.get('hubOrigins'), list):
                L['origins'] = [str(x) for x in cfg['hubOrigins']][:20]
        except Exception as e:
            print('config.json не прочитан:', e, file=sys.stderr)
    if args.origins:
        L['origins'] = [x for x in args.origins.split(',') if x]
    for k in ('handshake_s', 'hello_s', 'max_unauth_ip', 'max_conns', 'ping_s', 'idle_s'):
        v = getattr(args, k)
        if v is not None:
            L[k] = v
    return L


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--host', default='127.0.0.1')
    ap.add_argument('--port', type=int, default=8788)
    ap.add_argument('--config', default='')
    ap.add_argument('--origins', default='')
    ap.add_argument('--test', action='store_true', help='эхо-канал для тестов (в рабочем режиме не включать)')
    ap.add_argument('--handshake_s', type=float)
    ap.add_argument('--hello_s', type=float)
    ap.add_argument('--max_unauth_ip', type=int)
    ap.add_argument('--max_conns', type=int)
    ap.add_argument('--ping_s', type=float)
    ap.add_argument('--idle_s', type=float)
    a = ap.parse_args()

    async def run():
        hub, srv = await serve(a.host, a.port, load_limits(a), a.test)
        print('hub слушает %s:%d%s' % (a.host, a.port, ' (тестовый режим)' if a.test else ''), flush=True)
        async with srv:
            await srv.serve_forever()

    try:
        asyncio.run(run())
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
