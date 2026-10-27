"""chess.py — правила шахмат для сервера (hub проверяет ходы). Зеркало js/chess.js: те же позиция, ходы и результат status().
Позиция: dict b (список 64: 1 пешка, 2 конь, 3 слон, 4 ладья, 5 ферзь, 6 король; белые >0), t (1 белые / -1 чёрные),
c (права рокировки: 1 K, 2 Q, 4 k, 8 q), ep (клетка взятия на проходе или -1), h (полуходы), n (номер хода).
Ход: (from, to, promo, ep, cs). Клетка = ряд*8 + вертикаль (a1 = 0). Сверяется perft-наборами tests/fixtures/chess_perft.json."""
P, N, B, R, Q, K = 1, 2, 3, 4, 5, 6
KN = [(1, 2), (2, 1), (2, -1), (1, -2), (-1, -2), (-2, -1), (-2, 1), (-1, 2)]
DG = [(1, 1), (1, -1), (-1, 1), (-1, -1)]
OR = [(1, 0), (-1, 0), (0, 1), (0, -1)]
KG = DG + OR
START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
LET = {'p': P, 'n': N, 'b': B, 'r': R, 'q': Q, 'k': K}
FEN_CH = ' PNBRQK'


def sq_name(s):
    return chr(97 + (s & 7)) + str((s >> 3) + 1)


def from_fen(fen):
    f = fen.split()
    rows = f[0].split('/')
    if len(rows) != 8:
        raise ValueError('FEN: нужно 8 рядов')
    b = [0] * 64
    for i, row in enumerate(rows):
        file = 0
        r = 7 - i
        for ch in row:
            if '1' <= ch <= '8':
                file += int(ch)
                continue
            t = LET.get(ch.lower())
            if not t or file > 7:
                raise ValueError('FEN: плохая фигура ' + ch)
            b[r * 8 + file] = -t if ch.islower() else t
            file += 1
        if file != 8:
            raise ValueError('FEN: в ряду не 8 клеток')
    cs = f[2] if len(f) > 2 else '-'
    c = (1 if 'K' in cs else 0) | (2 if 'Q' in cs else 0) | (4 if 'k' in cs else 0) | (8 if 'q' in cs else 0)
    ep = -1
    if len(f) > 3 and f[3] != '-':
        ep = (ord(f[3][0]) - 97) + (int(f[3][1]) - 1) * 8
    return {'b': b, 't': -1 if len(f) > 1 and f[1] == 'b' else 1, 'c': c, 'ep': ep,
            'h': int(f[4]) if len(f) > 4 else 0, 'n': int(f[5]) if len(f) > 5 else 1}


def to_fen(p):
    s = ''
    for r in range(7, -1, -1):
        e = 0
        for x in range(8):
            v = p['b'][r * 8 + x]
            if not v:
                e += 1
                continue
            if e:
                s += str(e)
                e = 0
            ch = FEN_CH[abs(v)]
            s += ch if v > 0 else ch.lower()
        if e:
            s += str(e)
        if r:
            s += '/'
    cs = ('K' if p['c'] & 1 else '') + ('Q' if p['c'] & 2 else '') + ('k' if p['c'] & 4 else '') + ('q' if p['c'] & 8 else '')
    return '%s %s %s %s %d %d' % (s, 'w' if p['t'] > 0 else 'b', cs or '-', sq_name(p['ep']) if p['ep'] >= 0 else '-', p['h'], p['n'])


def key(p):
    return ' '.join(to_fen(p).split(' ')[:4])


def start():
    return from_fen(START)


def clone(p):
    return {'b': p['b'][:], 't': p['t'], 'c': p['c'], 'ep': p['ep'], 'h': p['h'], 'n': p['n']}


def attacked(b, s, by):
    f, r = s & 7, s >> 3
    pr = r - by
    if 0 <= pr < 8:
        if f > 0 and b[pr * 8 + f - 1] == by * P:
            return True
        if f < 7 and b[pr * 8 + f + 1] == by * P:
            return True
    for dx, dy in KN:
        x, y = f + dx, r + dy
        if 0 <= x < 8 and 0 <= y < 8 and b[y * 8 + x] == by * N:
            return True
    for dx, dy in KG:
        x, y = f + dx, r + dy
        if 0 <= x < 8 and 0 <= y < 8 and b[y * 8 + x] == by * K:
            return True
    for dirs, a1, a2 in ((DG, B, Q), (OR, R, Q)):
        for dx, dy in dirs:
            x, y = f + dx, r + dy
            while 0 <= x < 8 and 0 <= y < 8:
                v = b[y * 8 + x]
                if v:
                    if v == by * a1 or v == by * a2:
                        return True
                    break
                x += dx
                y += dy
    return False


def king_sq(b, side):
    k = side * K
    for i in range(64):
        if b[i] == k:
            return i
    return -1


def in_check(p, side=None):
    side = p['t'] if side is None else side
    k = king_sq(p['b'], side)
    return k >= 0 and attacked(p['b'], k, -side)


def pseudo(p):
    b, t, out = p['b'], p['t'], []

    def add(f, to, pr=0, ep=False, cs=0):
        out.append((f, to, pr, ep, cs))

    for s in range(64):
        v = b[s]
        if not v or (1 if v > 0 else -1) != t:
            continue
        a, f, r = abs(v), s & 7, s >> 3
        if a == P:
            r1 = r + t
            last = 7 if t > 0 else 0
            if r1 < 0 or r1 > 7:
                continue

            def push(to):
                if r1 == last:
                    for pr in (Q, R, B, N):
                        add(s, to, pr)
                else:
                    add(s, to)

            if not b[r1 * 8 + f]:
                push(r1 * 8 + f)
                if r == (1 if t > 0 else 6) and not b[(r + 2 * t) * 8 + f]:
                    add(s, (r + 2 * t) * 8 + f)
            for df in (-1, 1):
                x = f + df
                if x < 0 or x > 7:
                    continue
                to = r1 * 8 + x
                tv = b[to]
                if tv and (1 if tv > 0 else -1) != t:
                    push(to)
                elif not tv and to == p['ep']:
                    add(s, to, 0, True)
        elif a == N or a == K:
            for dx, dy in (KN if a == N else KG):
                x, y = f + dx, r + dy
                if x < 0 or x > 7 or y < 0 or y > 7:
                    continue
                tv = b[y * 8 + x]
                if not tv or (1 if tv > 0 else -1) != t:
                    add(s, y * 8 + x)
            if a == K:
                home = 0 if t > 0 else 56
                kb, qb = (1, 2) if t > 0 else (4, 8)
                if s == home + 4 and not attacked(b, s, -t):
                    if (p['c'] & kb) and not b[home + 5] and not b[home + 6] and b[home + 7] == t * R \
                            and not attacked(b, home + 5, -t) and not attacked(b, home + 6, -t):
                        add(s, home + 6, 0, False, 1)
                    if (p['c'] & qb) and not b[home + 3] and not b[home + 2] and not b[home + 1] and b[home] == t * R \
                            and not attacked(b, home + 3, -t) and not attacked(b, home + 2, -t):
                        add(s, home + 2, 0, False, 2)
        else:
            for dx, dy in (DG if a == B else OR if a == R else KG):
                x, y = f + dx, r + dy
                while 0 <= x < 8 and 0 <= y < 8:
                    tv = b[y * 8 + x]
                    if not tv:
                        add(s, y * 8 + x)
                    else:
                        if (1 if tv > 0 else -1) != t:
                            add(s, y * 8 + x)
                        break
                    x += dx
                    y += dy
    return out


def apply(p, m):
    fr, to, pr, ep, cs = m
    q = clone(p)
    b = q['b']
    v = b[fr]
    a = abs(v)
    t = p['t']
    cap = b[to]
    b[to] = t * pr if pr else v
    b[fr] = 0
    if ep:
        b[to - 8 * t] = 0
    if cs:
        home = 0 if t > 0 else 56
        if cs == 1:
            b[home + 7] = 0
            b[home + 5] = t * R
        else:
            b[home] = 0
            b[home + 3] = t * R
    q['ep'] = (fr + to) // 2 if (a == P and abs(to - fr) == 16) else -1
    if a == K:
        q['c'] &= ~3 if t > 0 else ~12
    if fr == 0 or to == 0:
        q['c'] &= ~2
    if fr == 7 or to == 7:
        q['c'] &= ~1
    if fr == 56 or to == 56:
        q['c'] &= ~8
    if fr == 63 or to == 63:
        q['c'] &= ~4
    q['h'] = 0 if (a == P or cap or ep) else p['h'] + 1
    q['t'] = -t
    if t < 0:
        q['n'] = p['n'] + 1
    return q


def legal(p):
    out = []
    for m in pseudo(p):
        q = apply(p, m)
        k = king_sq(q['b'], p['t'])
        if k >= 0 and not attacked(q['b'], k, -p['t']):
            out.append(m)
    return out


def insufficient(b):
    mn = []
    for i in range(64):
        a = abs(b[i])
        if not a or a == K:
            continue
        if a in (P, R, Q):
            return False
        mn.append((a, ((i & 7) + (i >> 3)) & 1))
    if len(mn) <= 1:
        return True
    return all(x[0] == B for x in mn) and all(x[1] == mn[0][1] for x in mn)


def status(p, moves=None):
    ms = legal(p) if moves is None else moves
    chk = in_check(p)
    if not ms:
        return 'mate' if chk else 'stalemate'
    if insufficient(p['b']):
        return 'material'
    if p['h'] >= 100:
        return 'draw50'
    return 'check' if chk else 'play'


def perft(p, d):
    if d == 0:
        return 1
    ms = legal(p)
    if d == 1:
        return len(ms)
    return sum(perft(apply(p, m), d - 1) for m in ms)


def find(p, fr, to, promo=0):
    for m in legal(p):
        if m[0] == fr and m[1] == to and m[2] == (promo or 0):
            return m
    return None
