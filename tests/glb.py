"""Мини-писатель файлов .glb для тестов и для сборки учебных моделей (без внешних библиотек)."""
import json, struct, zlib


def png(w=8, h=8, rgb=(200, 120, 40)):
    raw = b''.join(b'\x00' + bytes(rgb) * w for _ in range(h))
    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')


def box(cx=0, cy=0, cz=0, sx=1, sy=1, sz=1):
    """Куб: (позиции, нормали, uv, индексы)."""
    P, N, T, I = [], [], [], []
    faces = [((0, 0, 1), (1, 0, 0), (0, 1, 0)), ((0, 0, -1), (-1, 0, 0), (0, 1, 0)), ((1, 0, 0), (0, 0, -1), (0, 1, 0)),
             ((-1, 0, 0), (0, 0, 1), (0, 1, 0)), ((0, 1, 0), (1, 0, 0), (0, 0, -1)), ((0, -1, 0), (1, 0, 0), (0, 0, 1))]
    for n, u, v in faces:
        b = len(P)
        for a, c in ((-.5, -.5), (.5, -.5), (.5, .5), (-.5, .5)):
            P.append((cx + sx * (n[0] * .5 + u[0] * a + v[0] * c), cy + sy * (n[1] * .5 + u[1] * a + v[1] * c), cz + sz * (n[2] * .5 + u[2] * a + v[2] * c)))
            N.append(n); T.append((a + .5, c + .5))
        I += [b, b + 1, b + 2, b, b + 2, b + 3]
    return P, N, T, I


def make_glb(prims, bad_uri=False):
    """prims: список словарей {geom:(P,N,T,I), color:(r,g,b), image:bytes|None}."""
    binb = bytearray(); views = []; acc = []; meshes = []; mats = []; imgs = []; texs = []

    def add(data, target=None):
        while len(binb) % 4: binb.append(0)
        views.append({'buffer': 0, 'byteOffset': len(binb), 'byteLength': len(data), **({'target': target} if target else {})})
        binb.extend(data); return len(views) - 1

    plist = []
    for pr in prims:
        P, N, T, I = pr['geom']
        def A(vals, comp, typ, bv, mm=None):
            a = {'bufferView': bv, 'componentType': comp, 'count': len(vals), 'type': typ}
            if mm: a.update(mm)
            acc.append(a); return len(acc) - 1
        pf = b''.join(struct.pack('<3f', *p) for p in P)
        mins = [min(p[i] for p in P) for i in range(3)]; maxs = [max(p[i] for p in P) for i in range(3)]
        ap = A(P, 5126, 'VEC3', add(pf, 34962), {'min': mins, 'max': maxs})
        an = A(N, 5126, 'VEC3', add(b''.join(struct.pack('<3f', *n) for n in N), 34962))
        at = A(T, 5126, 'VEC2', add(b''.join(struct.pack('<2f', *t) for t in T), 34962))
        ai = A(I, 5125, 'SCALAR', add(b''.join(struct.pack('<I', i) for i in I), 34963))
        m = {'pbrMetallicRoughness': {'baseColorFactor': list(pr.get('color', (1, 1, 1))) + [1]}}
        if pr.get('image') or bad_uri:
            if bad_uri:
                imgs.append({'uri': 'http://example.com/x.png'})
            else:
                imgs.append({'bufferView': add(pr['image']), 'mimeType': 'image/png'})
            texs.append({'source': len(imgs) - 1}); m['pbrMetallicRoughness']['baseColorTexture'] = {'index': len(texs) - 1}
        mats.append(m)
        plist.append({'attributes': {'POSITION': ap, 'NORMAL': an, 'TEXCOORD_0': at}, 'indices': ai, 'material': len(mats) - 1})
    meshes.append({'primitives': plist})
    g = {'asset': {'version': '2.0'}, 'scene': 0, 'scenes': [{'nodes': [0]}], 'nodes': [{'mesh': 0}], 'meshes': meshes, 'materials': mats,
         'accessors': acc, 'bufferViews': views, 'buffers': [{'byteLength': len(binb)}]}
    if imgs: g['images'] = imgs; g['textures'] = texs
    js = json.dumps(g).encode()
    while len(js) % 4: js += b' '
    while len(binb) % 4: binb.append(0)
    total = 12 + 8 + len(js) + 8 + len(binb)
    return struct.pack('<III', 0x46546C67, 2, total) + struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(binb), 0x004E4942) + bytes(binb)


# ---- простые тела для учебных моделей ----
def _xf(geom, f):
    P, N, T, I = geom
    return [f(p) for p in P], N, T, I


def merge(geoms):
    P, N, T, I = [], [], [], []
    for g in geoms:
        b = len(P); P += g[0]; N += g[1]; T += g[2]; I += [i + b for i in g[3]]
    return P, N, T, I


def cyl(n=16, r=.5, h=1.0, cy=0, cap=True):
    P, N, T, I = [], [], [], []
    for i in range(n):
        a0, a1 = 2 * math.pi * i / n, 2 * math.pi * (i + 1) / n
        b = len(P)
        for a, y, v in ((a0, -h / 2, 0), (a1, -h / 2, 0), (a1, h / 2, 1), (a0, h / 2, 1)):
            P.append((r * math.cos(a), cy + y, r * math.sin(a))); N.append((math.cos(a), 0, math.sin(a))); T.append(((a / (2 * math.pi)), v))
        I += [b, b + 1, b + 2, b, b + 2, b + 3]
        if cap:
            for y, ny, flip in ((h / 2, 1, 0), (-h / 2, -1, 1)):
                c = len(P); P += [(0, cy + y, 0), (r * math.cos(a0), cy + y, r * math.sin(a0)), (r * math.cos(a1), cy + y, r * math.sin(a1))]
                N += [(0, ny, 0)] * 3; T += [(.5, .5), (0, 0), (1, 0)]
                I += [c, c + 2, c + 1] if ny > 0 else [c, c + 1, c + 2]
    return P, N, T, I


def cone(n=16, r=.5, h=1.0, cy=0):
    P, N, T, I = [], [], [], []
    k = r / math.hypot(r, h)
    for i in range(n):
        a0, a1 = 2 * math.pi * i / n, 2 * math.pi * (i + 1) / n; am = (a0 + a1) / 2
        c = len(P)
        P += [(r * math.cos(a0), cy - h / 2, r * math.sin(a0)), (r * math.cos(a1), cy - h / 2, r * math.sin(a1)), (0, cy + h / 2, 0)]
        for a in (a0, a1, am):
            N.append((math.cos(a) * (1 - k * .0 + 0) * h / math.hypot(r, h), r / math.hypot(r, h), math.sin(a) * h / math.hypot(r, h)))
        T += [(0, 0), (1, 0), (.5, 1)]; I += [c, c + 1, c + 2]
        c = len(P); P += [(0, cy - h / 2, 0), (r * math.cos(a1), cy - h / 2, r * math.sin(a1)), (r * math.cos(a0), cy - h / 2, r * math.sin(a0))]
        N += [(0, -1, 0)] * 3; T += [(.5, .5), (0, 0), (1, 0)]; I += [c, c + 1, c + 2]
    return P, N, T, I


def sphere(r=.5, cx=0, cy=0, cz=0, n=14, m=10):
    P, N, T, I = [], [], [], []
    for j in range(m + 1):
        th = math.pi * j / m
        for i in range(n + 1):
            ph = 2 * math.pi * i / n
            x, y, z = math.sin(th) * math.cos(ph), math.cos(th), math.sin(th) * math.sin(ph)
            P.append((cx + r * x, cy + r * y, cz + r * z)); N.append((x, y, z)); T.append((i / n, j / m))
    for j in range(m):
        for i in range(n):
            a = j * (n + 1) + i; I += [a, a + n + 1, a + 1, a + 1, a + n + 1, a + n + 2]
    return P, N, T, I


import math  # noqa: E402
