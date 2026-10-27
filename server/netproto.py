"""netproto.py — двоичные кадры поз (зеркало js/netproto.js, формат — docs/NET_PROTOCOL.md). Little-endian.
Поза: dict seq, t, flags, head/left/right = {'p': [x,y,z] м, 'q': [x,y,z,w]}, phys = {'x','z','yaw'}.
Одинаковые кадры с JS проверяет tests/fixtures/net_frames.json (tests/net_proto.py и tests/run.js)."""
import math
import struct

PV, T_POSE, T_BATCH = 1, 1, 0x81
POSE_LEN, BODY_LEN, BATCH_HEAD = 52, 44, 9
REC_LEN = 2 + BODY_LEN
S2 = math.sqrt(2)


def _c16(v):
    return 32767 if v > 32767 else -32768 if v < -32768 else v


def _q16(v, k):
    try:
        v = float(v)
    except (TypeError, ValueError):
        v = 0.0
    if not math.isfinite(v):
        v = 0.0
    return _c16(int(math.floor(v * k + 0.5)))


def _mm(v):
    return _q16(v, 1000)


def _quat(q):
    x, y, z, w = [float(a) for a in q]
    n = math.sqrt(x * x + y * y + z * z + w * w) if all(math.isfinite(a) for a in (x, y, z, w)) else float('nan')
    if not math.isfinite(n) or n < 1e-9:
        return [0.0, 0.0, 0.0, 1.0]
    return [x / n, y / n, z / n, w / n]


def pack_quat(q):
    q = _quat(q)
    m = 0
    for i in range(1, 4):
        if abs(q[i]) > abs(q[m]):
            m = i
    sg = -1 if q[m] < 0 else 1
    return m, [_c16(int(math.floor(sg * q[i] * 32767 * S2 + 0.5))) for i in range(4) if i != m]


def unpack_quat(idx, c):
    k = 1 / (32767 * S2)
    q = [0.0] * 4
    j = 0
    s = 0.0
    for i in range(4):
        if i != idx:
            q[i] = c[j] * k
            j += 1
            s += q[i] * q[i]
    q[idx] = math.sqrt(max(0.0, 1 - s))
    return q


def _hand(h):
    h = h or {}
    return {'p': list(h.get('p') or [0, 0, 0]), 'q': list(h.get('q') or [0, 0, 0, 1])}


def _put_body(o):
    hd, lf, rt, ph = _hand(o.get('head')), _hand(o.get('left')), _hand(o.get('right')), o.get('phys') or {}
    ai, ac = pack_quat(hd['q'])
    bi, bc = pack_quat(lf['q'])
    ci, cc = pack_quat(rt['q'])
    vals = [_mm(k) for k in hd['p'][:3]] + ac
    for h, qc in ((lf, bc), (rt, cc)):
        vals += [_mm(k) for k in h['p'][:3]] + qc
    vals += [_mm(ph.get('x')), _mm(ph.get('z')), _q16(ph.get('yaw'), 1e4)]
    return struct.pack('<BB' + 'h' * 21, int(o.get('flags', 0)) & 255, ai | (bi << 2) | (ci << 4), *vals)


def _get_body(buf, off):
    flags, ix = struct.unpack_from('<BB', buf, off)
    v = struct.unpack_from('<' + 'h' * 21, buf, off + 2)
    hp = [a / 1000 for a in v[0:3]]
    hq = unpack_quat(ix & 3, v[3:6])
    lp = [a / 1000 for a in v[6:9]]
    lq = unpack_quat((ix >> 2) & 3, v[9:12])
    rp = [a / 1000 for a in v[12:15]]
    rq = unpack_quat((ix >> 4) & 3, v[15:18])
    return {'flags': flags, 'head': {'p': hp, 'q': hq}, 'left': {'p': lp, 'q': lq}, 'right': {'p': rp, 'q': rq},
            'phys': {'x': v[18] / 1000, 'z': v[19] / 1000, 'yaw': v[20] / 1e4}}


def encode_pose(o):
    t = int(float(o.get('t', 0)) or 0) & 0xFFFFFFFF
    return struct.pack('<BBHI', PV, T_POSE, int(o.get('seq', 0)) & 0xFFFF, t) + _put_body(o)


def decode_pose(buf):
    if buf is None or len(buf) != POSE_LEN or buf[0] != PV or buf[1] != T_POSE:
        return None
    o = _get_body(buf, 8)
    o['seq'], o['t'] = struct.unpack_from('<HI', buf, 2)
    return o


def encode_batch(b):
    items = list(b.get('items') or [])[:255]
    out = struct.pack('<BBHIB', PV, T_BATCH, int(b.get('tick', 0)) & 0xFFFF, int(float(b.get('srv', 0)) or 0) & 0xFFFFFFFF, len(items))
    for it in items:
        age = max(0, min(255, int(math.floor((float(it.get('age', 0)) or 0) / 4 + 0.5))))
        out += struct.pack('<BB', int(it.get('slot', 0)) & 255, age) + _put_body(it)
    return out


def decode_batch(buf):
    if buf is None or len(buf) < BATCH_HEAD or buf[0] != PV or buf[1] != T_BATCH:
        return None
    n = buf[8]
    if len(buf) != BATCH_HEAD + n * REC_LEN:
        return None
    tick, srv = struct.unpack_from('<HI', buf, 2)
    items = []
    for i in range(n):
        off = BATCH_HEAD + i * REC_LEN
        it = _get_body(buf, off + 2)
        it['slot'], it['age'] = buf[off], buf[off + 1] * 4
        items.append(it)
    return {'tick': tick, 'srv': srv, 'items': items}
