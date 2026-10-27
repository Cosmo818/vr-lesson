"""Кадры поз (server/netproto.py): те же байты, что даёт js/netproto.js, по общей фикстуре tests/fixtures/net_frames.json.
Плюс: разбор плохих кадров, круговое преобразование, отрицательный большой компонент, обрезка координат, NaN."""
import json, math, os, sys
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(root, 'server'))
import netproto as NP
fails = []


def ok(c, m):
    print(('ok  : ' if c else 'FAIL: ') + m)
    if not c:
        fails.append(m)


fx = json.load(open(os.path.join(root, 'tests', 'fixtures', 'net_frames.json'), encoding='utf-8'))
for c in fx['poses']:
    b = NP.encode_pose(c['input'])
    ok(len(b) == 52 and b.hex() == c['hex'], 'кадр «%s»: 52 байта, как у JS' % c['name'])
    d = NP.decode_pose(bytes.fromhex(c['hex']))
    ok(d is not None and NP.encode_pose(d).hex() == c['hex'], 'кадр «%s»: разбор и повторная сборка дают те же байты' % c['name'])
bt = fx['batch']
b = NP.encode_batch(bt['input'])
ok(b.hex() == bt['hex'], 'пачка из 3 записей: %d байт, как у JS' % len(b))
d = NP.decode_batch(b)
ok(d and d['tick'] == 1 and d['srv'] == 1234567 and [i['slot'] for i in d['items']] == [1, 2, 3] and d['items'][2]['age'] == 76, 'пачка: tick (mod 2^16), время, места и возраст (×4 мс)')
ok(NP.encode_batch(d).hex() == bt['hex'], 'пачка: разбор и повторная сборка дают те же байты')
p0 = fx['poses'][0]['input']
d0 = NP.decode_pose(bytes.fromhex(fx['poses'][0]['hex']))
ok(abs(d0['head']['p'][0] - 1.234) < 6e-4 and abs(d0['phys']['yaw'] - 2.5) < 2e-4 and d0['seq'] == 7 and d0['t'] == 123456 and d0['flags'] == 0b100111, 'значения возвращаются с точностью до мм')
qe = p0['head']['q']
qd = d0['head']['q']
ok(abs(sum(a * b for a, b in zip(qe, qd))) > 0.99999, 'поворот восстановлен (точность ≈ 0,003 рад)')
d1 = NP.decode_pose(bytes.fromhex(fx['poses'][1]['hex']))
ok(abs(d1['head']['q'][3] - 1) < 1e-6, 'отрицательный большой компонент: кватернион переведён в эквивалентный (−q = q)')
d2 = NP.decode_pose(bytes.fromhex(fx['poses'][2]['hex']))
ok(abs(d2['head']['p'][0] - 32.767) < 1e-9 and abs(d2['head']['p'][1] + 32.768) < 1e-9, 'координаты за ±32 м обрезаются')
d3 = NP.decode_pose(bytes.fromhex(fx['poses'][3]['hex']))
ok(d3['head']['p'] == [0, 0, 0] and d3['head']['q'] == [0, 0, 0, 1], 'NaN → 0, нулевой кватернион → единичный')
d4 = NP.decode_pose(bytes.fromhex(fx['poses'][4]['hex']))
ok(d4['seq'] == 3 and d4['t'] == 5 and d4['flags'] == 255, 'seq и время — по модулю 2^16 и 2^32')
good = bytes.fromhex(fx['poses'][0]['hex'])
ok(NP.decode_pose(good[:51]) is None and NP.decode_pose(good + b'\0') is None and NP.decode_pose(b'') is None, 'плохая длина кадра — отказ')
ok(NP.decode_pose(bytes([2]) + good[1:]) is None and NP.decode_pose(good[:1] + bytes([9]) + good[2:]) is None, 'чужая версия или тип — отказ')
gb = bytes.fromhex(bt['hex'])
ok(NP.decode_batch(gb[:-1]) is None and NP.decode_batch(gb[:8]) is None and NP.decode_batch(gb[:8] + bytes([255])) is None, 'пачка: обрезанная или с неверным числом записей — отказ')
ok(NP.decode_batch(NP.encode_batch({'tick': 1, 'srv': 1, 'items': []})) == {'tick': 1, 'srv': 1, 'items': []}, 'пустая пачка')
print('FAILS:', fails)
sys.exit(1 if fails else 0)
