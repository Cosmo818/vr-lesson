"""Собирает учебную библиотеку: assets/models/*.glb и assets/sounds/*.wav. Запуск: python3 tools/make_assets.py
Всё нарисовано кодом, лицензии не нужны. Размеры: модель — десятки КБ, звук — до ~100 КБ."""
import math, os, random, struct, sys, wave
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tests'))
from glb import make_glb, box, cyl, cone, sphere, merge, png, _xf  # noqa: E402


def part(g, col):
    return {'geom': g, 'color': col}


def shift(g, dx=0, dy=0, dz=0):
    return _xf(g, lambda p: (p[0] + dx, p[1] + dy, p[2] + dz))


def scale_geom(g, sx, sy, sz):
    return _xf(g, lambda p: (p[0] * sx, p[1] * sy, p[2] * sz))


MODELS = {
    'tree': [part(cyl(10, .12, 1.0, .5), (.45, .3, .15)), part(cone(12, .7, 1.2, 1.5), (.15, .55, .2)), part(cone(12, .55, 1.0, 2.2), (.2, .65, .25))],
    'house': [part(box(0, .6, 0, 1.6, 1.2, 1.4), (.9, .85, .7)), part(shift(scale_geom(cone(4, .75, .7), 1.5, 1, 1.3), 0, 1.55, 0), (.7, .2, .15)),
              part(box(0, .4, .71, .3, .8, .04), (.4, .25, .12)), part(box(-.45, .7, .71, .25, .25, .04), (.5, .75, .95))],
    'rocket': [part(cyl(14, .3, 1.6, .9), (.92, .92, .95)), part(cone(14, .3, .6, 2.0), (.85, .15, .15)),
               part(box(.34, .3, 0, .06, .6, .3), (.85, .15, .15)), part(box(-.34, .3, 0, .06, .6, .3), (.85, .15, .15)), part(box(0, .3, .34, .3, .6, .06), (.85, .15, .15)),
               part(sphere(.12, 0, 1.2, .28, 8, 6), (.3, .6, .9))],
    'atom': [part(sphere(.22, 0, .8, 0), (.9, .3, .25))] + [part(sphere(.07, .6 * math.cos(a), .8 + .6 * math.sin(a) * s, .6 * math.sin(a) * c), col)
             for a, s, c, col in ((0.5, 1, 0, (.3, .6, 1)), (2.6, .5, .85, (.3, .6, 1)), (4.4, -.5, .85, (.3, .6, 1)))],
    'book': [part(box(0, .05, 0, .6, .1, .85), (.2, .35, .75)), part(box(.02, .12, 0, .55, .06, .8), (.95, .93, .85))],
    'flask': [part(cyl(14, .08, .5, .85), (.8, .9, 1.0)), part(cone(16, .4, .6, .3), (.6, .85, .95)), part(cyl(16, .3, .12, .06), (.3, .75, .5))],
}
RATE = 11025


def write_wav(path, samples):
    with wave.open(path, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(RATE)
        w.writeframes(b''.join(struct.pack('<h', int(max(-1, min(1, s)) * 24000)) for s in samples))


def tone(f, sec, decay=4, harm=(1,)):
    n = int(sec * RATE)
    return [sum(math.sin(2 * math.pi * f * (k + 1) * i / RATE) / (k + 1) for k in range(len(harm))) * math.exp(-decay * i / RATE) * .6 for i in range(n)]


def noise_loop(sec, lp, swell=0.0, seed=1):
    r = random.Random(seed); n = int(sec * RATE); y = 0; out = []
    for i in range(n):
        y += (r.uniform(-1, 1) - y) * lp
        out.append(y * (0.55 + swell * math.sin(2 * math.pi * i / n)))
    fade = int(.15 * RATE)  # мягкое начало и конец: стык цикла без щелчка
    for i in range(fade):
        k = i / fade; out[i] *= k; out[n - 1 - i] *= k
    return out


def chirps():
    out = []; r = random.Random(7)
    for c in range(5):
        f0 = r.uniform(2200, 3600); n = int(.12 * RATE)
        out += [math.sin(2 * math.pi * (f0 + 900 * (i / n)) * i / RATE) * math.sin(math.pi * i / n) * .5 for i in range(n)]
        out += [0] * int(r.uniform(.05, .25) * RATE)
    return out


SOUNDS = {
    'bell': tone(880, 1.4, 3.2, (1, 2, 3)),
    'click': tone(1500, .08, 40),
    'wind': noise_loop(4.0, .05, .35, 3),
    'water': noise_loop(4.0, .22, .2, 5),
    'birds': chirps(),
}
if __name__ == '__main__':
    for k, v in MODELS.items():
        d = make_glb(v); open(os.path.join(ROOT, 'assets/models/%s.glb' % k), 'wb').write(d); print(k, len(d))
    for k, v in SOUNDS.items():
        p = os.path.join(ROOT, 'assets/sounds/%s.wav' % k); write_wav(p, v); print(k, os.path.getsize(p))
