"""Правила шахмат на сервере (server/chess.py): perft по общим эталонам tests/fixtures/chess_perft.json — те же наборы проверяет js/chess.js в tests/run.js.
Плюс: FEN туда-обратно, мат/пат/ничья, превращение, взятие на проходе, рокировка."""
import json, os, sys, time
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(root, 'server'))
import chess as C
fails = []


def ok(c, m):
    print(('ok  : ' if c else 'FAIL: ') + m)
    if not c:
        fails.append(m)


fx = json.load(open(os.path.join(root, 'tests', 'fixtures', 'chess_perft.json'), encoding='utf-8'))
t0 = time.time()
for pos in fx['positions']:
    p = C.from_fen(pos['fen'])
    got = [C.perft(p, d + 1) for d in range(len(pos['perft']))]
    ok(got == pos['perft'], 'perft %s: %s' % (pos['name'], got))
ok(C.to_fen(C.start()) == C.START, 'FEN туда-обратно (старт)')
ok(all(C.to_fen(C.from_fen(x['fen'])).split(' ')[:4] == x['fen'].split(' ')[:4] for x in fx['positions']), 'FEN туда-обратно (все эталоны)')
ok(C.status(C.from_fen('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1')) == 'stalemate', 'пат')
ok(C.status(C.from_fen('6k1/5ppp/8/8/8/8/8/3RK3 w - - 0 1')) == 'play' and C.status(C.apply(C.from_fen('6k1/5ppp/8/8/8/8/8/3RK3 w - - 0 1'), C.find(C.from_fen('6k1/5ppp/8/8/8/8/8/3RK3 w - - 0 1'), 3, 59))) == 'mate', 'мат ладьёй по последней горизонтали')
ok(C.status(C.from_fen('8/8/8/4k3/8/8/8/4K3 w - - 0 1')) == 'material', 'ничья по недостатку фигур')
p = C.from_fen('8/P6k/8/8/8/8/8/K7 w - - 0 1')
ok(C.find(p, 48, 56, 5) is not None and C.find(p, 48, 56, 0) is None, 'превращение: только с выбором фигуры')
p = C.from_fen('rnbqkbnr/ppp1pppp/8/8/3pP3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 3')
ok(C.find(p, 27, 20) is not None and C.find(p, 27, 20)[3], 'взятие на проходе')
p = C.from_fen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1')
ok(C.find(p, 4, 6) is not None and C.find(p, 4, 2) is not None, 'рокировка в обе стороны')
ok(C.find(C.start(), 12, 28) is not None and C.find(C.start(), 12, 45) is None, 'ход по клеткам: e2-e4 можно, e2-f6 нельзя')
print('время perft: %.1f с' % (time.time() - t0))
print('FAILS:', fails)
sys.exit(1 if fails else 0)
