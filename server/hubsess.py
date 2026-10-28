"""hubsess.py — сессии живого урока в hub (шаг Н3, PLAN-network.md §3.4, §4.2–4.6, §8.1–8.2). Только stdlib, без базы.
Слой WebSocket — server/hub.py; билеты и подписи — server/hubticket.py; формат поз — docs/NET_PROTOCOL.md.

Что здесь: hello/welcome/roster, места (slot 1..200), такт и отбор поз, медленные клиенты, away, удержание места 120 с и resume,
второе подключение того же uid (старое — 4014), события с проверкой роли (ведущий — только r='t'), удаление учителем (4012),
закрытие сессии (4011), ограничения частоты (позы 30/с, управление 20 + 10/с, указка 12/с, реакции раз в 2 с; флуд 10 с — 4009),
отчёт посещаемости (в app.py — шаг Н4; здесь — вызов reporter, в тестах файл/список).
uid в сообщения клиентам не уходит никогда: наружу только slot, «Имя Ф.», роль, цвет, комната."""
import json
import math
import os
import re
import struct
import time

import hubticket as HT

PV_MIN, PV_MAX = 1, 1
POSE_LEN, BODY_LEN, T_POSE, T_BATCH = 52, 44, 1, 0x81
MAX_SLOT = 200
ROOM_RE = re.compile(r'^[A-Za-z0-9_]{1,24}$')
LEAD = ('gather', 'freeze', 'room', 'follow', 'hall', 'kick')
DEF = {
    'tick_hz': 20, 'away_s': 3.0, 'hold_s': 120.0, 'report_s': 60.0, 'text_max': 2048, 'near': 12, 'far_every': 4, 'phys_m': 3.0,
    'ctl_cap': 20, 'ctl_rate': 10.0, 'pose_cap': 30, 'pose_rate': 30.0, 'point_cap': 12, 'point_rate': 12.0, 'react_s': 2.0,
    'flood_s': 10.0, 'slow1': 32 << 10, 'slow2': 128 << 10, 'slow3': 512 << 10, 'slow_s': 5.0, 'hard': 2 << 20,
    'max_seats': 60, 'aud': 'center', 'kid': None, 'poll_s': 10.0,
}
SESS_DEF = {'chat': 'off', 'mode': 'seat', 'maxSeats': 60, 'pointers': True}


class Bucket:
    __slots__ = ('cap', 'rate', 'v', 't')

    def __init__(self, cap, rate, now):
        self.cap, self.rate, self.v, self.t = cap, rate, float(cap), now

    def take(self, now):
        self.v = min(self.cap, self.v + (now - self.t) * self.rate)
        self.t = now
        if self.v >= 1:
            self.v -= 1
            return True
        return False


def _js(o):
    return json.dumps(o, ensure_ascii=False, separators=(',', ':')).encode('utf-8')


class Seat:
    def __init__(self, slot, p, now):
        self.sid = p['sid']
        self.slot, self.uid, self.role, self.name = slot, p['uid'], p['r'], p['n']
        self.col = (slot - 1) % 12
        self.conn, self.room, self.body, self.pose_t = None, 'hall', None, None
        self.pos, self.phys, self.away, self.gone_t, self.resume = (0.0, 0.0), None, False, None, None
        self.rate, self.over_t, self.react_t, self.att = None, None, 0.0, now
        self.b_ctl = self.b_pose = self.b_point = None

    def pub(self):
        return {'slot': self.slot, 'name': self.name, 'role': self.role, 'col': self.col, 'room': self.room, 'away': self.away}


class Session:
    def __init__(self, p, now):
        self.id, self.kind, self.sch, self.cls = p['sid'], p['k'], p['sch'], p['cls']
        self.seats, self.freeze, self.banned, self.kicked = {}, False, set(), []
        self.set = dict(SESS_DEF)
        self.tick, self.created, self.attend = 0, now, {}

    def pub(self):
        return {'id': self.id, 'kind': self.kind, 'chat': self.set['chat'], 'mode': self.set['mode'], 'freeze': self.freeze,
                'pointers': bool(self.set['pointers'])}


class Core:
    """Все сессии одного hub. reporter(dict) → dict|None (ответ app.py: closed/banned/settings) — §4.6."""

    def __init__(self, keys, limits=None, reporter=None, clock=time.monotonic, wall=time.time, poller=None):
        self.K = keys
        self.L = dict(DEF)
        self.L.update(limits or {})
        self.reporter, self.clock, self.wall, self.poller = reporter, clock, wall, poller
        self.last_poll = clock()
        self.sessions, self.closed, self.used, self.live, self.resumes = {}, {}, {}, {}, {}
        self.t0 = clock()
        self.last_rep = self.t0
        self.stats = {'batches': 0, 'bytes': 0, 'drop_pose': 0}

    # ---------------------------------------------------------------- вход
    def srv_ms(self):
        return int((self.clock() - self.t0) * 1000) & 0xFFFFFFFF

    def on_text(self, conn, data):
        L = self.L
        if len(data) > L['text_max']:
            return conn.close(4010, 'big')
        try:
            m = json.loads(data.decode('utf-8'))
        except (ValueError, RecursionError):
            return conn.close(1007, 'json')
        if not isinstance(m, dict) or not isinstance(m.get('t'), str):
            return conn.close(1007, 'msg')
        if conn.seat is None:
            if m['t'] != 'hello':
                return conn.close(4001, 'hello')
            return self.hello(conn, m)
        s, now = conn.seat, self.clock()
        b = s.b_point if (m['t'] == 'ev' and m.get('k') == 'point') else s.b_ctl
        if not b.take(now):
            # флуд: отбрасывания идут подряд дольше flood_s (сброс — только после целой секунды без отбрасываний)
            if conn.flood_t is None:
                conn.flood_t = now
            conn.drop_t = now
            if now - conn.flood_t > L['flood_s']:
                conn.close(4009, 'flood')
            return
        if conn.flood_t is not None and now - getattr(conn, 'drop_t', now) > 1.0:
            conn.flood_t = None
        t = m['t']
        if t == 'p':
            c = m.get('c')
            if isinstance(c, (int, float)) and not isinstance(c, bool) and math.isfinite(c):
                conn.text({'t': 'P', 'c': c, 's': self.srv_ms()})
        elif t == 'room':
            rid = m.get('id')
            if isinstance(rid, str) and ROOM_RE.match(rid) and rid != s.room:
                s.room = rid
                self.bcast(self.sess_of(s), {'t': 'room', 'slot': s.slot, 'id': rid}, ex=s)
        elif t == 'ev':
            self.event(conn, s, m)
        elif t == 'bye':
            self.leave(s, 'left')
            conn.close(1000, 'bye')
        else:
            conn.text({'t': 'err', 'code': 'unknown', 'msg': t[:20]})

    def on_bin(self, conn, data):
        s = conn.seat
        if s is None:
            return conn.close(4001, 'hello')
        now = self.clock()
        if not s.b_pose.take(now):
            self.stats['drop_pose'] += 1
            return
        if len(data) != POSE_LEN or not PV_MIN <= data[0] <= PV_MAX or data[1] != T_POSE:
            return
        s.body = bytes(data[8:])
        s.pose_t = now
        x, _y, z = struct.unpack_from('<hhh', data, 10)
        s.pos = (x / 1000.0, z / 1000.0)
        s.phys = struct.unpack_from('<hh', data, 46) if data[8] & 8 else None
        if s.away:
            s.away = False
            self.bcast(self.sess_of(s), {'t': 'away', 'slot': s.slot, 'on': False}, ex=s)

    def on_close(self, conn):
        s = conn.seat
        conn.seat = None
        if s is None or s.conn is not conn:
            return
        if self.live.get(s.uid) is conn:
            del self.live[s.uid]
        s.conn, s.gone_t, s.body = None, self.clock(), None
        self.touch(self.sess_of(s), s)
        if not s.away:
            s.away = True
            self.bcast(self.sess_of(s), {'t': 'away', 'slot': s.slot, 'on': True}, ex=s)

    # ---------------------------------------------------------------- hello
    def hello(self, conn, m):
        L, now = self.L, self.clock()
        pv = m.get('pv')
        if not isinstance(pv, int) or not PV_MIN <= pv <= PV_MAX:
            return conn.close(4013, 'version')
        if isinstance(m.get('resume'), str):
            ref = self.resumes.get(m['resume'])
            if not ref:
                return conn.close(4001, 'resume')
            sess = self.sessions.get(ref[0])
            seat = sess and sess.seats.get(ref[1])
            if not seat or seat.resume != m['resume'] or seat.uid in sess.banned:
                return conn.close(4001, 'resume')
            fresh = False
        else:
            p = HT.verify_ticket(m.get('ticket'), self.K['ticket'], int(self.wall()), L['aud'], self.used, L['kid'])
            if not p:
                return conn.close(4001, 'ticket')
            if p['sid'] in self.closed:
                return conn.close(4011, 'closed')
            sess = self.sessions.get(p['sid'])
            if sess is None:
                sess = self.sessions[p['sid']] = Session(p, now)
            elif (sess.kind, sess.sch, sess.cls) != (p['k'], p['sch'], p['cls']):
                return conn.close(4001, 'ticket')
            if p['uid'] in sess.banned:
                return conn.close(4012, 'removed')
            seat = next((x for x in sess.seats.values() if x.uid == p['uid']), None)
            fresh = seat is None
            if fresh:
                cap = max(1, min(MAX_SLOT, int(sess.set.get('maxSeats') or L['max_seats'])))
                if len(sess.seats) >= cap:
                    return conn.close(4015, 'full')
                slot = next(i for i in range(1, MAX_SLOT + 1) if i not in sess.seats)
                seat = sess.seats[slot] = Seat(slot, p, now)
            else:
                seat.role, seat.name = p['r'], p['n']
        old = self.live.get(seat.uid)
        if old is not None and old is not conn:
            if old.seat is not seat:
                self.on_close(old)          # место в другой сессии — как обрыв: удержание и away
            old.seat = None
            old.close(4014, 'second')
        if seat.conn is not None and seat.conn is not conn:
            seat.conn.seat = None
            seat.conn.close(4014, 'second')
        if seat.resume:
            self.resumes.pop(seat.resume, None)
        seat.resume = HT.b64u(os.urandom(32))
        self.resumes[seat.resume] = (sess.id, seat.slot)
        seat.conn, seat.gone_t, seat.pose_t, seat.body, seat.att = conn, None, None, None, now
        seat.b_ctl = Bucket(L['ctl_cap'], L['ctl_rate'], now)
        seat.b_pose = Bucket(L['pose_cap'], L['pose_rate'], now)
        seat.b_point = Bucket(L['point_cap'], L['point_rate'], now)
        conn.seat, conn.authed = seat, True
        self.live[seat.uid] = conn
        a = sess.attend.setdefault(seat.uid, {'uid': seat.uid, 'role': seat.role, 'first': int(self.wall()), 'last': int(self.wall()), 'joins': 0})
        a['joins'] += 1
        a['role'] = seat.role
        conn.text({'t': 'welcome', 'slot': seat.slot, 'resume': seat.resume, 'srv': self.srv_ms(), 'tick': sess.tick,
                   'hz': L['tick_hz'], 'hold': int(L['hold_s']),
                   'limits': {'pose_hz': L['pose_rate'], 'ctl': L['ctl_rate'], 'text': L['text_max']},
                   'sess': sess.pub(), 'roster': [x.pub() for x in sorted(sess.seats.values(), key=lambda x: x.slot) if x is not seat]})
        if fresh:
            self.bcast(sess, dict(seat.pub(), t='roster+'), ex=seat)
        else:
            seat.room = seat.room or 'hall'
            self.bcast(sess, {'t': 'roster~', 'slot': seat.slot, 'name': seat.name, 'role': seat.role, 'room': seat.room}, ex=seat)

    # ---------------------------------------------------------------- события §8.1–8.2
    def event(self, conn, s, m):
        sess, k, now = self.sess_of(s), m.get('k'), self.clock()
        lead = s.role == 't'
        if k in LEAD and not lead:
            return conn.text({'t': 'err', 'code': 'role', 'msg': str(k)[:20]})
        if k == 'point':
            if not lead and (not sess.set['pointers'] or sess.freeze):
                return
            on = m.get('on') is True
            out = {'t': 'ev', 'k': 'point', 'slot': s.slot, 'on': on}
            if on:
                o, d, ci = _vec(m.get('o')), _vec(m.get('d')), m.get('ci', 0)
                if o is None or d is None or not isinstance(ci, int) or isinstance(ci, bool) or not 0 <= ci <= 6:
                    return
                out.update(o=o, d=d, ci=ci)
            return self.bcast(sess, out, ex=s, room=s.room)
        if k == 'react':
            e = m.get('e')
            if not isinstance(e, int) or isinstance(e, bool) or not 0 <= e < 12 or now - s.react_t < self.L['react_s']:
                return
            if sess.freeze and not lead:
                return
            s.react_t = now
            return self.bcast(sess, {'t': 'ev', 'k': 'react', 'slot': s.slot, 'e': e}, ex=s, room=s.room)
        if k == 'rate':
            hz = m.get('hz')
            if hz in (5, 10, 15, 20):
                s.rate = hz
            return
        if k == 'freeze' or k == 'follow':
            on = m.get('on') is True
            if k == 'freeze':
                sess.freeze = on
            return self.bcast(sess, {'t': 'ev', 'k': k, 'slot': s.slot, 'on': on}, ex=s)
        if k == 'gather' or k == 'hall':
            return self.bcast(sess, {'t': 'ev', 'k': k, 'slot': s.slot}, ex=s)
        if k == 'room':
            rid = m.get('id')
            if isinstance(rid, str) and ROOM_RE.match(rid):
                self.bcast(sess, {'t': 'ev', 'k': 'room', 'slot': s.slot, 'id': rid}, ex=s)
            return
        if k == 'kick':
            t = sess.seats.get(m.get('slot')) if isinstance(m.get('slot'), int) else None
            if t is None or t.role != 's':
                return conn.text({'t': 'err', 'code': 'kick', 'msg': 'нельзя'})
            sess.banned.add(t.uid)
            sess.kicked.append(t.uid)
            c = t.conn
            self.leave(t, 'kick')
            if c:
                c.seat = None
                c.close(4012, 'removed')
            return
        conn.text({'t': 'err', 'code': 'unknown', 'msg': str(k)[:20]})

    # ---------------------------------------------------------------- рассылка и такт §4.3–4.4
    def sess_of(self, s):
        x = self.sessions.get(s.sid)
        return x if x is not None and x.seats.get(s.slot) is s else None

    def bcast(self, sess, obj, ex=None, room=None):
        if sess is None:
            return
        raw = _js(obj)
        for x in sess.seats.values():
            if x is not ex and x.conn and (room is None or x.room == room):
                x.conn.text(raw)

    def leave(self, s, why):
        sess = self.sess_of(s)
        if sess is None:
            return
        self.touch(sess, s)
        sess.seats.pop(s.slot, None)
        if s.resume:
            self.resumes.pop(s.resume, None)
        if s.conn and self.live.get(s.uid) is s.conn:
            del self.live[s.uid]
        s.conn = None
        self.bcast(sess, {'t': 'roster-', 'slot': s.slot, 'why': why})

    def touch(self, sess, s):
        if sess and s.uid in sess.attend:
            sess.attend[s.uid]['last'] = int(self.wall())

    def tick_all(self):
        for sess in list(self.sessions.values()):
            self.tick(sess)

    def tick(self, sess):
        L, now = self.L, self.clock()
        sess.tick = (sess.tick + 1) & 0xFFFF
        hz, tk = L['tick_hz'], sess.tick
        posed = [(x, x.body, x.pose_t) for x in sess.seats.values() if x.conn and x.body is not None and not x.away]   # снимок: место может закрыться посреди такта
        if not posed:
            return
        srv = self.srv_ms()
        for r in sess.seats.values():
            c = r.conn
            if not c or c.closed:
                continue
            b = c.buf()
            if b > L['hard'] or (b > L['slow3'] and r.over_t is not None and now - r.over_t > L['slow_s']):
                c.close(4008, 'slow', abort=True)
                self.on_close(c)
                continue
            if b > L['slow3']:
                if r.over_t is None:
                    r.over_t = now
                continue
            r.over_t = None
            step = max(1, round(hz / r.rate)) if r.rate else 1
            if b > L['slow2']:
                step = max(step, round(hz / 5))
            elif b > L['slow1']:
                step = max(step, 2)
            if tk % step:
                continue
            far = (tk // step) % L['far_every'] == 0
            cand = [e for e in posed if e[0] is not r and e[0].room == r.room]
            if not cand:
                continue
            if len(cand) > L['near']:
                rx, rz = r.pos
                cand.sort(key=lambda e: (e[0].pos[0] - rx) ** 2 + (e[0].pos[1] - rz) ** 2)
                pick = cand[:L['near']]
                for e in cand[L['near']:]:
                    if far or e[0].role == 't' or _physnear(r, e[0], L['phys_m']):
                        pick.append(e)
            else:
                pick = cand
            pick = pick[:255]
            out = [struct.pack('<BBHIB', PV_MAX, T_BATCH, tk, srv, len(pick))]
            for x, body, pt in pick:
                age = min(255, int((now - pt) * 250 + 0.5))
                out.append(struct.pack('<BB', x.slot, age) + body)
            pkt = b''.join(out)
            c.bin(pkt)
            self.stats['batches'] += 1
            self.stats['bytes'] += len(pkt)

    # ---------------------------------------------------------------- обслуживание (раз в 0,5 с)
    def housekeep(self):
        L, now = self.L, self.clock()
        for sess in list(self.sessions.values()):
            for s in list(sess.seats.values()):
                if s.conn:
                    last = s.pose_t or s.att
                    if not s.away and now - last > L['away_s']:
                        s.away = True
                        self.bcast(sess, {'t': 'away', 'slot': s.slot, 'on': True}, ex=s)
                elif s.gone_t is not None and now - s.gone_t > L['hold_s']:
                    self.leave(s, 'gone')
            if not sess.seats:
                self.report_one(sess, final=True)
                del self.sessions[sess.id]
        HT.prune_used(self.used, int(self.wall()))
        for sid in [k for k, t in self.closed.items() if now - t > 86400]:
            del self.closed[sid]
        if self.poller and self.sessions and now - self.last_poll >= L['poll_s']:   # запасной путь узнать о закрытии из кабинета (§4.6)
            self.last_poll = now
            try:
                resp = self.poller()
            except Exception:
                resp = None
            if isinstance(resp, dict):
                self.apply(resp)
        if now - self.last_rep >= L['report_s']:
            self.last_rep = now
            for sess in list(self.sessions.values()):
                self.report_one(sess)

    # ---------------------------------------------------------------- отчёт и управление из app.py §4.6
    def report_one(self, sess, final=False, ended=False):
        if not self.reporter:
            return
        for s in sess.seats.values():
            if s.conn:
                self.touch(sess, s)
        body = {'sid': sess.id, 'attend': list(sess.attend.values()), 'chat': [], 'kicked': list(sess.kicked)}
        if final:
            body['final'] = True
        if ended:
            body['ended'] = True
        try:
            resp = self.reporter(body)
        except Exception:
            resp = None
        sess.kicked = []
        if isinstance(resp, dict):
            self.apply(resp)

    def apply(self, resp):
        """Ответ app.py: {closed:[sid], banned:{sid:[uid]}, settings:{sid:{chat,mode,maxSeats,pointers}}}."""
        for sid in resp.get('closed') or []:
            if isinstance(sid, str):
                self.close_session(sid)
        for sid, uids in (resp.get('banned') or {}).items():
            sess = self.sessions.get(sid)
            if not sess or not isinstance(uids, list):
                continue
            for uid in uids:
                if not isinstance(uid, str):
                    continue
                sess.banned.add(uid)
                s = next((x for x in sess.seats.values() if x.uid == uid), None)
                if s:
                    c = s.conn
                    self.leave(s, 'kick')
                    if c:
                        c.seat = None
                        c.close(4012, 'removed')
        for sid, st in (resp.get('settings') or {}).items():
            sess = self.sessions.get(sid)
            if not sess or not isinstance(st, dict):
                continue
            for k in SESS_DEF:
                if k in st and isinstance(st[k], type(SESS_DEF[k])):
                    sess.set[k] = st[k]
            self.bcast(sess, {'t': 'sess', 'sess': sess.pub()})

    def close_session(self, sid):
        self.closed[sid] = self.clock()
        sess = self.sessions.pop(sid, None)
        if not sess:
            return
        conns = [s.conn for s in sess.seats.values() if s.conn]
        self.report_one(sess, final=True, ended=True)
        for s in sess.seats.values():
            if s.resume:
                self.resumes.pop(s.resume, None)
            if s.conn and self.live.get(s.uid) is s.conn:
                del self.live[s.uid]
        for c in conns:
            c.seat = None
            c.close(4011, 'closed')

    def health(self):
        return {'sessions': len(self.sessions), 'seats': sum(len(s.seats) for s in self.sessions.values())}


def _vec(v):
    if not isinstance(v, list) or len(v) != 3:
        return None
    out = []
    for a in v:
        if isinstance(a, bool) or not isinstance(a, (int, float)) or not math.isfinite(a) or abs(a) > 100:
            return None
        out.append(round(float(a), 3))
    return out


def _physnear(a, b, m):
    if not a.phys or not b.phys:
        return False
    dx, dz = (a.phys[0] - b.phys[0]) / 1000.0, (a.phys[1] - b.phys[1]) / 1000.0
    return dx * dx + dz * dz < m * m
