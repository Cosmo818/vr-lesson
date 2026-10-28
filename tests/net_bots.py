"""Проверки сессий hub (шаг Н3): server/hubsess.py + server/hubticket.py + server/hub.py.
Часть 1 — ядро на поддельных соединениях и ручных часах (отбор поз, медленные клиенты, away, удержание места, роли).
Часть 2 — 30 ботов через настоящий WebSocket (вход, пачки, события, второе подключение, удаление, закрытие, флуд).
Запуск: python3 tests/net_bots.py"""
import asyncio, base64, json, os, random, struct, sys, time
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'server'))
import hub as H
import hubsess as S
import hubticket as T
import netproto as NP

FAIL = []
TNOW = [None]
SECRET = bytes(range(32))
K = T.derive(SECRET)
ORIGIN = 'https://school.example'


def check(name, ok, info=''):
    print(('ok  : ' if ok else 'FAIL: ') + name + ('' if ok else '  ' + str(info)[:300]))
    if not ok:
        FAIL.append(name)


def tk(uid, r='s', sid='rs-aaa', k='lesson', sch='sch1', cls='c7a', n=None, **kw):
    p = {'kid': None, 'aud': 'center', 'sid': sid, 'k': k, 'sch': sch, 'cls': cls, 'uid': uid, 'r': r, 'n': n or ('Имя ' + uid[-2:])}
    p.update(kw)
    p = {a: b for a, b in p.items() if b is not None}
    return T.make_ticket(K['ticket'], p, now=TNOW[0]() if TNOW[0] else None)


def pose(x=0.0, z=0.0, flags=4, seq=0, phys=None):
    o = {'seq': seq, 't': 0, 'flags': flags | (8 if phys else 0), 'head': {'p': [x, 1.6, z], 'q': [0, 0, 0, 1]}}
    if phys:
        o['phys'] = {'x': phys[0], 'z': phys[1], 'yaw': 0}
    return NP.encode_pose(o)


# ======================================================================= часть 1: ядро
print('--- билеты')
now = int(time.time())
used = {}
t1 = tk('u-01')
check('верный билет принимается', T.verify_ticket(t1, K['ticket'], now, 'center', used) is not None)
check('повтор того же билета — отказ', T.verify_ticket(t1, K['ticket'], now, 'center', used) is None)
bad = t1[:-2] + ('AA' if t1[-2:] != 'AA' else 'BB')
check('подделанная подпись — отказ', T.verify_ticket(bad, K['ticket'], now, 'center', {}) is None)
check('чужой ключ — отказ', T.verify_ticket(tk('u-02'), T.derive(b'x' * 32)['ticket'], now, 'center', {}) is None)
check('просроченный — отказ', T.verify_ticket(tk('u-03', exp=now - 1), K['ticket'], now, 'center', {}) is None)
check('срок дальше 10 мин — отказ', T.verify_ticket(tk('u-04', exp=now + 3600), K['ticket'], now, 'center', {}) is None)
check('чужая аудитория (узел) — отказ', T.verify_ticket(tk('u-05', aud='node-2'), K['ticket'], now, 'center', {}) is None)
check('роль v (зритель) пока не пускается', T.verify_ticket(tk('u-06', r='v'), K['ticket'], now, 'center', {}) is None)
check('имя длиннее 24 — отказ', T.verify_ticket(tk('u-07', n='Я' * 25), K['ticket'], now, 'center', {}) is None)
check('uid с пробелом — отказ', T.verify_ticket(tk('u 08'), K['ticket'], now, 'center', {}) is None)
check('мусор вместо билета — отказ', all(T.verify_ticket(x, K['ticket'], now, 'center', {}) is None for x in [None, '', '.', 'a.b.c', 'zz.' + 'A' * 22, 5, 'é.é']))
check('kid не совпал — отказ', T.verify_ticket(tk('u-09', kid='k1'), K['ticket'], now, 'center', {}, kid='k2') is None)
check('секрет короче 32 байт — ошибка', (lambda: (T.derive('ab' * 8), False))() if False else True)
try:
    T.derive('ab' * 8)
    check('секрет короче 32 байт — ошибка', False)
except ValueError:
    pass
check('секрет в hex принимается', T.derive(SECRET.hex())['ticket'] == K['ticket'])
check('подпись отчёта сверяется', T.check_report(K['report'], b'{"a":1}', T.sign_report(K['report'], b'{"a":1}')) and not T.check_report(K['report'], b'{"a":2}', T.sign_report(K['report'], b'{"a":1}')))


class FakeConn:
    def __init__(self):
        self.seat, self.authed, self.closed, self.flood_t, self.ip = None, False, False, None, '1.1.1.1'
        self.texts, self.bins, self.code, self.b = [], [], None, 0

    def buf(self):
        return self.b

    def text(self, o):
        if not self.closed:
            self.texts.append(json.loads(o) if isinstance(o, bytes) else json.loads(json.dumps(o)))

    def bin(self, b):
        if not self.closed:
            self.bins.append(b)

    def close(self, code, reason='', abort=False):
        if not self.closed:
            self.closed, self.code = True, code

    def of(self, t):
        return [m for m in self.texts if m.get('t') == t]


CLK = [1000.0]
WALL = [float(now)]
REP = []
TNOW[0] = lambda: WALL[0]
core = S.Core(K, {'tick_hz': 20}, reporter=lambda b: REP.append(json.loads(json.dumps(b))), clock=lambda: CLK[0], wall=lambda: WALL[0])


def join(uid, r='s', **kw):
    c = FakeConn()
    core.on_text(c, json.dumps({'t': 'hello', 'pv': 1, 'ticket': tk(uid, r, **kw)}).encode())
    return c


def adv(dt):
    CLK[0] += dt
    WALL[0] += dt


print('--- вход и места')
teacher = join('t-00', 't', n='Анна П.')
w = teacher.of('welcome')
check('учитель получил welcome со slot 1', w and w[0]['slot'] == 1 and w[0]['sess']['kind'] == 'lesson', teacher.texts)
studs = [join('s-%02d' % i) for i in range(1, 30)]
check('30 мест выданы без повторов', sorted(c.seat.slot for c in [teacher] + studs) == list(range(1, 31)))
check('roster в welcome у последнего — 29 других', len(studs[-1].of('welcome')[0]['roster']) == 29)
check('roster+ разосланы (учитель видит 29 новых)', len(teacher.of('roster+')) == 29)
allt = json.dumps([c.texts for c in [teacher] + studs], ensure_ascii=False)
check('uid не уходит клиентам (ни в welcome, ни в roster)', 's-05' not in allt and 't-00' not in allt and 'sch1' not in allt and 'c7a' not in allt)
c4 = FakeConn()
core.on_text(c4, json.dumps({'t': 'hello', 'pv': 2, 'ticket': tk('s-77')}).encode())
check('pv=2 → 4013', c4.code == 4013)
c5 = FakeConn()
core.on_text(c5, b'{"t":"p","c":1}')
check('сообщение до hello → 4001', c5.code == 4001)
c6 = FakeConn()
core.on_bin(c6, pose())
check('поза до hello → 4001', c6.code == 4001)
c7 = FakeConn()
core.on_text(c7, json.dumps({'t': 'hello', 'pv': 1, 'ticket': tk('s-78', k='play')}).encode())
check('билет той же sid, но другого вида → 4001', c7.code == 4001)
c8 = FakeConn()
core.on_text(c8, json.dumps({'t': 'hello', 'pv': 1, 'ticket': tk('s-79', cls='c9b')}).encode())
check('билет той же sid, но другого класса → 4001', c8.code == 4001)
c9 = FakeConn()
core.on_text(c9, b'[1,2]')
check('не объект JSON → 1007', c9.code == 1007)
c10 = FakeConn()
core.on_text(c10, b'{"t":"hello","pv":1,"ticket":"' + b'a' * 3000 + b'"}')
check('текст больше 2 КБ → 4010', c10.code == 4010)

c11 = FakeConn()
core.on_text(c11, b'[' * 2000)
check('вложенность 2000 скобок → 1007, без падения', c11.code == 1007)
c12 = FakeConn()
core.on_text(c12, b'{"t":"hello","pv":1,"ticket":' + b'[' * 1900 + b'}')
check('глубокая вложенность внутри hello → 1007', c12.code == 1007)

print('--- отбор поз')
# стоят в линию по x через 1 м: учитель в x=0 ... ученик i в x=i
for i, c in enumerate([teacher] + studs):
    core.on_bin(c, pose(x=float(i)))
for c in [teacher] + studs:
    c.bins.clear()
for _ in range(8):
    adv(0.05)
    core.tick_all()
far = studs[-1]   # x=29: ближние 12 — 17..28, учитель (x=0) — всегда


def slots_of(c):
    return [[it['slot'] for it in NP.decode_batch(b)['items']] for b in c.bins]


got = slots_of(far)
check('за 8 тактов 8 пачек', len(got) == 8, len(got))
near_ok = all(set(range(18, 30)) <= set(g) for g in got)
check('12 ближних — в каждой пачке', near_ok, got[:2])
check('учитель — в каждой пачке, хотя дальний', all(1 in g for g in got))
full = [g for g in got if len(g) == 29]
check('все 29 — раз в 4 такта (2 из 8)', len(full) == 2, [len(g) for g in got])
check('своей позы в пачке нет', all(30 not in g for g in got))
dec = NP.decode_batch(far.bins[0])
check('пачка разбирается кодеком, позиция соседа верна', dec and abs([it for it in dec['items'] if it['slot'] == 29][0]['head']['p'][0] - 28.0) < 1e-3)
# физическая близость: ученик 2 (x=2 виртуально) стоит физически рядом с дальним
core.on_bin(studs[0], pose(x=1.0, phys=(0.5, 0.5)))
core.on_bin(far, pose(x=29.0, phys=(1.0, 0.5)))
far.bins.clear()
for _ in range(4):
    adv(0.05)
    core.tick_all()
check('физически ближе 3 м — в каждой пачке (кольца)', all(2 in g for g in slots_of(far)), slots_of(far))
t0 = time.perf_counter()
for _ in range(100):
    adv(0.05)
    core.tick_all()
ms = (time.perf_counter() - t0) * 10
check('такт на 30 человек < 3 мс (%.2f мс)' % ms, ms < 3, ms)

print('--- комнаты и события')
s1, s2, s3 = studs[0], studs[1], studs[2]
for c in [teacher] + studs:
    c.bins.clear()
    c.texts.clear()
core.on_text(s3, b'{"t":"room","id":"chem"}')
adv(0.05)
core.tick_all()
check('ушёл в другую комнату — не в пачках холла', all(4 not in g for g in slots_of(s1)))
check('другим разослано room {slot,id}', any(m.get('slot') == 4 and m.get('id') == 'chem' for m in s1.of('room')))
# Н9: физически ближе 3 м (оба откалиброваны) — в пачках даже из другой комнаты; кабинет (t без поз) видит все комнаты
core.on_bin(s3, pose(x=3.0, phys=(0.6, 0.5)))
s1.bins.clear()
adv(0.05)
core.tick_all()
check('Н9: сосед из другой комнаты, физически рядом — в пачке (кольца)', all(4 in g for g in slots_of(s1)) and slots_of(s1), slots_of(s1))
core.on_bin(s3, pose(x=3.0))
cab = join('t-cab', 't', n='Кабинет')
adv(0.05)
core.tick_all()
cg = slots_of(cab)
check('Н9: кабинет учителя без своих поз видит позы всех комнат', cg and 4 in cg[-1] and 2 in cg[-1], cg)
for c in (teacher, s2, cab):
    c.texts.clear()
core.on_text(s1, json.dumps({'t': 'ev', 'k': 'st', 'cal': 1, 'off': 0, 'near': 2, 'vr': 1, 'fps': 999}).encode())
est = [m for m in cab.of('ev') if m.get('k') == 'st']
check('Н9: ev st — учителю и кабинету (slot, поля, fps обрезан до 240)', est and est[0]['slot'] == 2 and est[0]['near'] == 2 and est[0]['fps'] == 240 and any(m.get('k') == 'st' for m in teacher.of('ev')), cab.texts)
check('Н9: ev st ученикам не рассылается', not any(m.get('k') == 'st' for m in s2.of('ev')), s2.texts)
cab.texts.clear()
core.on_text(s1, json.dumps({'t': 'ev', 'k': 'st', 'cal': True}).encode())
check('Н9: ev st с неверным полем отбрасывается', not cab.of('ev') and not s1.of('err'), cab.texts)
core.apply({'settings': {'rs-aaa': {'stations': [{'id': 'Окно', 'x': 1, 'z': -2, 'yaw': 90}, {'id': 5}, 'x', {'id': 'Б', 'x': 'a'}]}}})
ss = [m for m in s2.of('sess')]
check('Н9: станции из app.py доходят до учеников, мусор отброшен', ss and ss[-1]['sess']['stations'] == [{'id': 'Окно', 'x': 1.0, 'z': -2.0, 'yaw': 90.0}], ss[-1:] if ss else s2.texts)
cab.close(1000)
core.on_close(cab)
core.on_text(s1, json.dumps({'t': 'ev', 'k': 'point', 'on': True, 'o': [0, 1, 0], 'd': [0, 0, -1], 'ci': 6}).encode())
check('указка ученика — тем, кто в той же комнате', any(m.get('k') == 'point' and m.get('slot') == 2 for m in s2.of('ev')))
check('указка не уходит в другую комнату', not s3.of('ev'))
core.on_text(s1, json.dumps({'t': 'ev', 'k': 'point', 'on': True, 'o': [0, 1, 0], 'd': [float('nan'), 0, 0], 'ci': 1}).encode().replace(b'NaN', b'1e999'))
check('указка с бесконечностью отброшена', len([m for m in s2.of('ev') if m.get('k') == 'point']) == 1)
core.on_text(s1, b'{"t":"ev","k":"gather"}')
check('ученик не может gather → err role', s1.of('err') and s1.of('err')[-1]['code'] == 'role')
check('gather ученика никому не разослан', not [m for m in s2.of('ev') if m.get('k') == 'gather'])
core.on_text(teacher, b'{"t":"ev","k":"gather"}')
check('gather учителя — всем, со slot учителя', all(any(m.get('k') == 'gather' and m.get('slot') == 1 for m in c.of('ev')) for c in studs))
core.on_text(teacher, b'{"t":"ev","k":"gather","id":"chem"}')
check('Н10: gather из кабинета несёт комнату', all(any(m.get('k') == 'gather' and m.get('id') == 'chem' for m in c.of('ev')) for c in studs))
core.on_text(teacher, b'{"t":"ev","k":"gather","id":"../x"}')
check('Н10: gather с плохим кодом комнаты — без id', all(c.of('ev')[-1].get('k') == 'gather' and 'id' not in c.of('ev')[-1] for c in studs))
core.on_text(teacher, b'{"t":"ev","k":"hall","id":"chem"}')
check('Н10: hall комнату не несёт', all(c.of('ev')[-1].get('k') == 'hall' and 'id' not in c.of('ev')[-1] for c in studs))
core.on_text(teacher, b'{"t":"ev","k":"freeze","on":true}')
n0 = len(s2.of('ev'))
core.on_text(s1, json.dumps({'t': 'ev', 'k': 'point', 'on': True, 'o': [0, 1, 0], 'd': [0, 0, -1], 'ci': 0}).encode())
check('при freeze указка ученика не проходит', len(s2.of('ev')) == n0)
core.on_text(teacher, json.dumps({'t': 'ev', 'k': 'point', 'on': True, 'o': [0, 1, 0], 'd': [0, 0, -1], 'ci': 3}).encode())
check('при freeze указка учителя проходит', len(s2.of('ev')) == n0 + 1)
core.on_text(teacher, b'{"t":"ev","k":"freeze","on":false}')
core.on_text(s1, b'{"t":"ev","k":"react","e":3}')
core.on_text(s1, b'{"t":"ev","k":"react","e":4}')
check('реакция не чаще раза в 2 с', len([m for m in s2.of('ev') if m.get('k') == 'react']) == 1)
core.on_text(s1, b'{"t":"p","c":123.5}')
check('часы: P {c,s}', s1.of('P') and s1.of('P')[0]['c'] == 123.5 and isinstance(s1.of('P')[0]['s'], int))

t2 = join('t-09', 't', n='Борис В.')
core.on_text(t2, b'{"t":"ev","k":"freeze","on":true}')
core.on_text(t2, b'{"t":"bye"}')
check('Н10: ушёл один из учителей — «внимание» остаётся', core.sessions['rs-aaa'].freeze is True)
tseats = [x for x in core.sessions['rs-aaa'].seats.values() if x.role == 't']
for x in tseats:
    x.role = 'x'
t3 = join('t-08', 't', n='Вера Г.')
core.on_text(t3, b'{"t":"bye"}')
for x in tseats:
    x.role = 't'
check('Н10: ушёл последний учитель — «внимание» снято, всем freeze off', core.sessions['rs-aaa'].freeze is False and any(m.get('k') == 'freeze' and m.get('on') is False for m in s2.of('ev')))
print('--- удаление, второе подключение, away, удержание')
core.on_text(s1, json.dumps({'t': 'ev', 'k': 'kick', 'slot': 3}).encode())
check('ученик не может удалить', s2.code is None and s1.of('err')[-1]['code'] == 'role')
core.on_text(teacher, json.dumps({'t': 'ev', 'k': 'kick', 'slot': 1}).encode())
check('учитель не удаляет учителя', teacher.code is None)
core.on_text(teacher, json.dumps({'t': 'ev', 'k': 'kick', 'slot': 3}).encode())
check('удалённый учителем → 4012', s2.code == 4012)
check('Н10: удаление — серверу сразу отдельным отчётом', any('s-02' in x['kicked'] for x in REP if x['sid'] == 'rs-aaa'))
check('всем — roster- why kick', any(m.get('slot') == 3 and m.get('why') == 'kick' for m in s1.of('roster-')))
back = join('s-02')
check('удалённый с новым билетом → 4012', back.code == 4012)
dup = join('s-05')
check('второе подключение того же uid: старое → 4014', studs[4].code == 4014 and dup.seat and dup.seat.slot == 6)
check('новое подключение заняло то же место', not dup.code and dup.of('welcome')[0]['slot'] == 6)
core.on_close(studs[4])
check('закрытие старого подключения не трогает место', dup.seat and dup.seat.conn is dup)
for c in [teacher] + studs:
    c.texts.clear()
adv(4.0)
core.housekeep()
check('нет поз > 3 с → away всем', any(m.get('on') is True for m in s1.of('away')))
core.on_bin(s1, pose())
check('поза пришла → away снят', any(m.get('slot') == 2 and m.get('on') is False for m in teacher.of('away')))
res = teacher.of('welcome') or [None]
tres = teacher.seat.resume
core.on_close(teacher)
check('учитель ушёл — сессия живёт', 'rs-aaa' in core.sessions and core.sessions['rs-aaa'].seats.get(1))
back_t = FakeConn()
core.on_text(back_t, json.dumps({'t': 'hello', 'pv': 1, 'resume': tres}).encode())
check('resume — то же место 1, без билета', back_t.seat and back_t.seat.slot == 1 and back_t.of('welcome')[0]['slot'] == 1)
check('resume выдаёт новый токен (старый недействителен)', back_t.of('welcome')[0]['resume'] != tres)
again = FakeConn()
core.on_text(again, json.dumps({'t': 'hello', 'pv': 1, 'resume': tres}).encode())
check('старый resume → 4001', again.code == 4001)
s7res = studs[6].seat.resume
core.on_close(studs[6])
adv(121)
core.housekeep()
check('после 120 с место освобождено: roster- gone', any(m.get('slot') == 8 and m.get('why') == 'gone' for m in back_t.of('roster-')))
late = FakeConn()
core.on_text(late, json.dumps({'t': 'hello', 'pv': 1, 'resume': s7res}).encode())
check('resume после 120 с → 4001', late.code == 4001)

print('--- медленные и флуд')
s9 = studs[8]
for c in [back_t] + studs:
    if c.seat:
        core.on_bin(c, pose(x=1))
s9.bins.clear()
s9.b = 40 << 10
for _ in range(8):
    adv(0.05)
    core.tick_all()
check('буфер > 32 КБ — пачки через такт (4 из 8)', len(s9.bins) == 4, len(s9.bins))
s9.bins.clear()
s9.b = 200 << 10
for _ in range(8):
    adv(0.05)
    core.tick_all()
check('буфер > 128 КБ — 5 Гц (2 из 8)', len(s9.bins) == 2, len(s9.bins))
s9.b = 600 << 10
for _ in range(40):
    adv(0.05)
    for c in [back_t] + studs:
        if c.seat and not c.closed:
            core.on_bin(c, pose(x=1))
    core.tick_all()
check('буфер > 512 КБ дольше 5 с → 4008', s9.code is None)
for _ in range(80):
    adv(0.05)
    core.tick_all()
check('буфер > 512 КБ дольше 5 с → 4008 (через 6 с)', s9.code == 4008)
check('место медленного держится для resume', core.sessions['rs-aaa'].seats.get(10) is not None and core.sessions['rs-aaa'].seats[10].conn is None)
s10 = studs[9]
for i in range(25):
    core.on_text(s10, b'{"t":"p","c":1}')
check('ведро: 20 сразу, остальное отброшено', len(s10.of('P')) == 20, len(s10.of('P')))
for i in range(30):
    adv(0.4)
    for _ in range(10):
        core.on_text(s10, b'{"t":"p","c":1}')
check('флуд дольше 10 с (25/с при пределе 10/с) → 4009', s10.code == 4009)
s10b = studs[11]
for i in range(40):
    adv(0.5)
    for _ in range(4):
        core.on_text(s10b, b'{"t":"p","c":1}')
check('8/с (в пределе) 20 с — не флуд', s10b.code is None)
s11 = studs[10]
d0 = core.stats['drop_pose']
for i in range(60):
    core.on_bin(s11, pose())
check('позы сверх 30/с отбрасываются', core.stats['drop_pose'] - d0 == 30, core.stats['drop_pose'] - d0)

print('--- отчёт, закрытие, предел мест')
adv(61)
core.housekeep()
r = [x for x in REP if x['sid'] == 'rs-aaa'][-1:]
check('отчёт раз в 60 с: посещаемость с joins', r and any(a['uid'] == 's-05' and a['joins'] == 2 for a in r[0]['attend']), r[:1])
check('в отчёте удалённые учителем', 's-02' in r[0]['kicked'] if r else False, r[:1])
# Н10: удаление повторяется в отчётах, пока app.py не вернёт его в banned; полный список banned заменяет список hub (возврат)
core.apply({'banned': {'rs-aaa': []}})
check('Н10: не подтверждённое удаление hub держит сам', 's-02' in core.sessions['rs-aaa'].banned and core.sessions['rs-aaa'].kicked == ['s-02'])
core.apply({'banned': {'rs-aaa': ['s-02']}})
check('Н10: подтверждённое удаление уходит из очереди отчёта', core.sessions['rs-aaa'].kicked == [] and 's-02' in core.sessions['rs-aaa'].banned)
core.apply({'banned': {'rs-aaa': []}})
check('Н10: «Вернуть» — пустой список снимает запрет в hub', 's-02' not in core.sessions['rs-aaa'].banned)
back2 = join('s-02')
check('Н10: возвращённый снова входит', back2.code is None and back2.seat is not None)
core.on_close(back2)
check('в отчёте нет поз и координат', r and 'body' not in json.dumps(r) and 'pos' not in json.dumps(r))
core.apply({'settings': {'rs-aaa': {'chat': 'phrases', 'maxSeats': 'много'}}})
check('настройки из app.py: верный тип применён, неверный — нет', core.sessions['rs-aaa'].set['chat'] == 'phrases' and core.sessions['rs-aaa'].set['maxSeats'] == 60)
conns = [c for c in [back_t] + studs if c.seat and not c.closed]
core.apply({'closed': ['rs-aaa']})
check('сессия закрыта из кабинета → всем 4011', conns and all(c.code == 4011 for c in conns), [c.code for c in conns])
check('финальный отчёт с ended', any(x.get('ended') and x['sid'] == 'rs-aaa' for x in REP))
late2 = join('s-20')
check('билет в закрытую сессию → 4011', late2.code == 4011)
p1 = join('a-1', sid='rs-bbb', k='play')
core.apply({'settings': {'rs-bbb': {'maxSeats': 2}}})
p2 = join('a-2', sid='rs-bbb', k='play')
p3 = join('a-3', sid='rs-bbb', k='play')
check('мест нет → 4015', p3.code == 4015 and p2.code is None)
check('в игровой без учителя нет ведущего', (core.on_text(p1, b'{"t":"ev","k":"hall"}') or True) and p1.of('err')[-1]['code'] == 'role')
other = join('a-2', sid='rs-ccc', k='play')
check('тот же uid в другой сессии: старое подключение → 4014', p2.code == 4014 and other.seat)
for c in (p1, other):
    core.on_close(c)
adv(121)
core.housekeep()
check('пустые сессии забыты hub (финальный отчёт отправлен)', 'rs-bbb' not in core.sessions and any(x.get('final') and x['sid'] == 'rs-bbb' for x in REP))


# ======================================================================= часть 2: живые боты
class Bot:
    def __init__(self, name):
        self.name, self.texts, self.batches, self.code, self.slot = name, [], [], None, None

    async def open(self, port, origin=ORIGIN):
        self.r, self.w = await asyncio.open_connection('127.0.0.1', port)
        key = base64.b64encode(os.urandom(16)).decode()
        self.w.write(('GET /ws HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: %s\r\n'
                      'Sec-WebSocket-Version: 13\r\nOrigin: %s\r\n\r\n' % (key, origin)).encode())
        head = await asyncio.wait_for(self.r.readuntil(b'\r\n\r\n'), 3)
        assert b' 101 ' in head.split(b'\r\n')[0], head
        self.task = asyncio.ensure_future(self.loop())

    def frame(self, op, data):
        mk = os.urandom(4)
        n = len(data)
        h = bytes([0x80 | op, 0x80 | n]) if n < 126 else bytes([0x80 | op, 0x80 | 126]) + struct.pack('>H', n)
        return h + mk + bytes(c ^ mk[i % 4] for i, c in enumerate(data))

    def send(self, o):
        if self.code is None:
            self.w.write(self.frame(1, json.dumps(o, ensure_ascii=False).encode()))

    def pose(self, b):
        if self.code is None:
            self.w.write(self.frame(2, b))

    async def loop(self):
        try:
            while True:
                b1, b2 = await self.r.readexactly(2)
                n = b2 & 0x7F
                if n == 126:
                    n = struct.unpack('>H', await self.r.readexactly(2))[0]
                elif n == 127:
                    n = struct.unpack('>Q', await self.r.readexactly(8))[0]
                d = await self.r.readexactly(n)
                op = b1 & 15
                if op == 1:
                    m = json.loads(d)
                    self.texts.append(m)
                    if m.get('t') == 'welcome':
                        self.slot = m['slot']
                elif op == 2:
                    self.batches.append(NP.decode_batch(d))
                elif op == 9:
                    self.w.write(self.frame(10, d))
                elif op == 8:
                    self.code = struct.unpack('>H', d[:2])[0] if len(d) >= 2 else 1005
                    return
        except Exception:
            if self.code is None:
                self.code = -1

    def of(self, t):
        return [m for m in self.texts if m.get('t') == t]


async def live():
    TNOW[0] = None
    print('--- 30 ботов через WebSocket')
    REP2 = []
    core2 = S.Core(K, {'tick_hz': 20, 'away_s': 1.0, 'hold_s': 2.0, 'report_s': 1.0}, reporter=lambda b: REP2.append(b))
    hub, srv = await H.serve('127.0.0.1', 0, {'origins': [ORIGIN], 'max_unauth_ip': 100}, core=core2)
    port = srv.sockets[0].getsockname()[1]
    bots = [Bot('t')] + [Bot('s%02d' % i) for i in range(1, 30)]
    for i, b in enumerate(bots):
        await b.open(port)
        b.send({'t': 'hello', 'pv': 1, 'ticket': tk(('t-00' if i == 0 else 'x-%02d' % i), 't' if i == 0 else 's', sid='rs-live')})
    await asyncio.sleep(0.4)
    check('все 30 вошли, места 1..30', sorted(b.slot for b in bots if b.slot) == list(range(1, 31)), [b.slot for b in bots])
    check('hub считает: 1 сессия, 30 мест, 30 соединений', hub.health()['sessions'] == 1 and hub.health()['seats'] == 30 and hub.conns == 30, hub.health())
    check('неавторизованных не осталось', hub.pending == 0 and not hub.unauth, (hub.pending, hub.unauth))

    async def walk(b, i, sec):
        t_end = time.monotonic() + sec
        seq = 0
        while time.monotonic() < t_end and b.code is None:
            seq += 1
            b.pose(pose(x=float(i) + random.uniform(-.05, .05), z=0, seq=seq))
            await asyncio.sleep(0.05 + random.uniform(-0.01, 0.02))   # дрожание сети/кадров

    await asyncio.gather(*[walk(b, i, 1.5) for i, b in enumerate(bots)])
    await asyncio.sleep(0.1)
    seen = set()
    for bt in bots[-1].batches:
        seen |= {it['slot'] for it in bt['items']}
    check('за 1,5 с последний увидел всех 29 других', seen == set(range(1, 30)), sorted(seen))
    nb = [len(b.batches) for b in bots]
    check('пачек ~20 Гц у каждого (≥ 20 за 1,5 с)', min(nb) >= 20, nb)
    txt = json.dumps([b.texts for b in bots], ensure_ascii=False)
    check('ни одного uid в сообщениях клиентам', 'x-05' not in txt and 't-00' not in txt)

    # учитель уходит и возвращается по resume
    tb = bots[0]
    tres = tb.of('welcome')[0]['resume']
    tb.w.close()
    await asyncio.sleep(0.3)
    check('учитель ушёл — у учеников away {slot 1}', any(m.get('slot') == 1 and m.get('on') for m in bots[5].of('away')))
    nt = Bot('t2')
    await nt.open(port)
    nt.send({'t': 'hello', 'pv': 1, 'resume': tres})
    await asyncio.sleep(0.2)
    check('учитель вернулся по resume на место 1', nt.slot == 1)
    check('ученикам — roster~ про возврат', any(m.get('slot') == 1 for m in bots[5].of('roster~')))
    # второе подключение ученика
    db = Bot('dup')
    await db.open(port)
    db.send({'t': 'hello', 'pv': 1, 'ticket': tk('x-05', sid='rs-live')})
    await asyncio.sleep(0.3)
    check('второй шлем с тем же учеником: старый закрыт 4014', bots[5].code == 4014 and db.slot == 6, (bots[5].code, db.slot))
    # удаление учителем
    nt.send({'t': 'ev', 'k': 'kick', 'slot': 8})
    await asyncio.sleep(0.2)
    check('удаление учителем → 4012', bots[7].code == 4012)
    kb = Bot('k')
    await kb.open(port)
    kb.send({'t': 'hello', 'pv': 1, 'ticket': tk('x-07', sid='rs-live')})
    await asyncio.sleep(0.2)
    check('удалённый не возвращается → 4012', kb.code == 4012)
    # флуд
    fb = bots[9]
    for _ in range(300):
        fb.send({'t': 'p', 'c': 1})
    await asyncio.sleep(0.2)
    check('живой флуд: ответов не больше ведра', len(fb.of('P')) <= 22, len(fb.of('P')))
    # чужой Origin и мусор без hello
    try:
        eb = Bot('evil')
        await eb.open(port, origin='https://evil.example')
        check('чужой Origin не пускается', False)
    except AssertionError:
        check('чужой Origin не пускается', True)
    gb = Bot('g')
    await gb.open(port)
    gb.pose(pose())
    await asyncio.sleep(0.2)
    check('поза без hello → 4001', gb.code == 4001)
    sl = Bot('sl')
    await sl.open(port)
    for _ in range(40):
        sl.send({'t': 'p', 'c': 1})       # пинги не продлевают срок hello
        await asyncio.sleep(0.03)
    hub.L['hello_s'] = 0.5
    sl2 = Bot('sl2')
    await sl2.open(port)
    t0 = time.monotonic()
    while time.monotonic() - t0 < 1.5 and sl2.code is None:
        sl2.w.write(sl2.frame(9, b'k'))
        await asyncio.sleep(0.05)
    check('ping-кадры не продлевают срок hello → 4009', sl2.code == 4009, sl2.code)
    check('текст до hello → 4001', sl.code == 4001, sl.code)
    # закрытие из кабинета
    live_bots = [b for b in bots + [nt, db] if b.code is None]
    core2.apply({'closed': ['rs-live']})
    await asyncio.sleep(0.3)
    check('закрытие сессии → всем 4011', all(b.code == 4011 for b in live_bots), [b.code for b in live_bots])
    check('отчёты приходили (посещаемость)', any(r['sid'] == 'rs-live' and len(r['attend']) >= 29 for r in REP2))
    await asyncio.sleep(0.5)
    check('после закрытия соединений не осталось', hub.conns == 0 and hub.pending == 0, (hub.conns, hub.pending))
    hub.loop_task.cancel()
    srv.close()


asyncio.run(live())
print('\nИТОГО: %s' % ('всё зелёное' if not FAIL else 'ПРОВАЛЫ: ' + ', '.join(FAIL)))
sys.exit(1 if FAIL else 0)
