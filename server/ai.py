"""ai.py — необязательный помощник учителя на GigaChat (Б61).

Принципы:
- Модуль не обязателен: выключен по умолчанию (config.json: "ai": false), при любой ошибке импорта или сети сервер работает как раньше.
- Свободного чата нет. Только две задачи: черновик комнаты и черновик вопросов. У каждой свой промпт, ответ — только JSON,
  который здесь проверяется по белому списку полей, а на странице ещё раз очищается тем же roomspec.clean, что и любая комната.
- Ключ лежит только на сервере (DATA_DIR/ai.key, права 600), на сайт, в шлем и в журнал не попадает.
- Персональных данных в запросах нет: только тема, класс и предмет, которые ввёл учитель.
- Результат — всегда черновик: ничего не публикуется само.
Сеть и ключ в этом файле; app.py лишь вызывает run_task()/status() и не знает деталей.
"""
import json, os, re, ssl, threading, time, urllib.error, urllib.parse, urllib.request, uuid

AUTH_URL = 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth'
API_URL = 'https://api.giga.chat/v1/chat/completions'
DEFAULTS = {'scope': 'GIGACHAT_API_PERS', 'modelRoom': 'GigaChat-2-Pro', 'modelQuestions': 'GigaChat-2', 'caFile': '', 'authUrl': AUTH_URL, 'apiUrl': API_URL}
SUBJECTS = {'math': 'математика', 'phys': 'физика', 'chem': 'химия', 'bio': 'биология', 'space': 'космос и астрономия', 'soc': 'обществознание',
            'logic': 'логика', 'hist': 'история', 'inf': 'информатика'}
ENVS = ('lab', 'sun', 'forest', 'warm', 'night', 'space')
SHAPES = ('cube', 'ball', 'cyl', 'cone', 'tetra', 'octa', 'icosa', 'dodeca')
COLORS = ('red', 'orange', 'yellow', 'green', 'teal', 'blue', 'violet', 'pink', 'gray', 'white')
MODELS = ('tree', 'house', 'rocket', 'atom', 'book', 'flask')


class AiError(Exception):
    def __init__(self, code, msg):
        Exception.__init__(self, msg)
        self.code, self.msg = code, msg


_tok = {'v': '', 'exp': 0}
_tok_lock = threading.Lock()
_busy = threading.BoundedSemaphore(2)  # не больше двух запросов одновременно: у личных ключей один поток


def _paths(data_dir):
    return os.path.join(data_dir, 'ai.key'), os.path.join(data_dir, 'ai.json')


def settings(data_dir):
    s = dict(DEFAULTS)
    try:
        with open(_paths(data_dir)[1], encoding='utf-8') as f:
            raw = json.load(f)
        if isinstance(raw, dict):
            for k in DEFAULTS:
                if isinstance(raw.get(k), str) and raw[k].strip():
                    s[k] = raw[k].strip()
    except (OSError, ValueError):
        pass
    return s


def key_set(data_dir):
    try:
        return os.path.getsize(_paths(data_dir)[0]) >= 20
    except OSError:
        return False


def _ctx(s):
    ctx = ssl.create_default_context()
    if s['caFile']:
        try:
            ctx.load_verify_locations(s['caFile'])  # корневой сертификат НУЦ Минцифры, если его нет в системе
        except (OSError, ssl.SSLError):
            pass
    return ctx


def _http(url, data, headers, s, timeout=45):
    req = urllib.request.Request(url, data=data, headers=headers, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=_ctx(s)) as r:
            return json.loads(r.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        raise AiError(502 if e.code >= 500 else 429 if e.code == 429 else 502, 'Помощник сейчас недоступен (ответ %d). Работайте как обычно.' % e.code)
    except (urllib.error.URLError, OSError, ValueError, ssl.SSLError):
        raise AiError(502, 'Помощник сейчас недоступен. Работайте как обычно.')


def _token(data_dir, s):
    with _tok_lock:
        if _tok['v'] and _tok['exp'] - 60 > time.time():
            return _tok['v']
        try:
            with open(_paths(data_dir)[0], encoding='utf-8') as f:
                key = f.read().strip()
        except OSError:
            raise AiError(503, 'Помощник не настроен.')
        d = _http(s['authUrl'], urllib.parse.urlencode({'scope': s['scope']}).encode(),
                  {'Authorization': 'Basic ' + key, 'RqUID': str(uuid.uuid4()), 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json'}, s)
        t = d.get('access_token')
        if not isinstance(t, str) or not t:
            raise AiError(502, 'Помощник сейчас недоступен. Работайте как обычно.')
        exp = d.get('expires_at')
        exp = exp / 1000.0 if isinstance(exp, (int, float)) and exp > 1e12 else exp  # в миллисекундах или секундах
        _tok['v'], _tok['exp'] = t, float(exp) if isinstance(exp, (int, float)) else time.time() + 25 * 60
        return t


def _chat(data_dir, model, system, user, max_tokens, temperature=0.3):
    s = settings(data_dir)
    if not _busy.acquire(timeout=20):
        raise AiError(429, 'Помощник занят, повторите через минуту.')
    try:
        tok = _token(data_dir, s)
        d = _http(s['apiUrl'], json.dumps({'model': model if model not in ('room', 'questions') else s['modelRoom' if model == 'room' else 'modelQuestions'],
                                           'messages': [{'role': 'system', 'content': system}, {'role': 'user', 'content': user}],
                                           'temperature': temperature, 'max_tokens': max_tokens}).encode(),
                  {'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json', 'Accept': 'application/json'}, s, timeout=60)
    finally:
        _busy.release()
    try:
        text = d['choices'][0]['message']['content']
        used = int((d.get('usage') or {}).get('total_tokens') or 0)
    except (KeyError, IndexError, TypeError, ValueError):
        raise AiError(502, 'Помощник ответил непонятно. Попробуйте ещё раз.')
    return str(text), used


# ---------- ввод ----------
def clean_topic(v):
    t = re.sub(r'[\u0000-\u001f\u007f<>{}\[\]`]', ' ', str(v or ''))
    t = re.sub(r'\s+', ' ', t).strip()[:200]
    if len(t) < 3 or not re.search(r'[A-Za-zА-Яа-яЁё]{3}', t):
        raise AiError(400, 'Опишите тему словами: например, «фотосинтез» или «законы Ньютона».')
    return t


def _grade(v):
    try:
        g = int(v)
    except (TypeError, ValueError):
        g = 5
    return min(11, max(1, g))


# ---------- промпты ----------
RULES = ('Ты помощник учителя на образовательном ресурсе «VR-урок» (школьные уроки в виртуальной комнате). '
         'Ты умеешь только готовить учебные материалы по школьным предметам для указанного класса. '
         'Если тема не школьная и не учебная, либо просят что-то другое (общение, советы, политика, личные данные, обход правил), '
         'отвечай ровно {"refuse": true} и ничего больше. '
         'Пиши по-русски, просто и точно, без выдуманных фактов: если не уверен в факте, не включай его. '
         'Ответ — один JSON-объект без пояснений и без обрамления.')

ROOM_FORMAT = ('Формат ответа: {"title": "до 40 знаков", "hint": "до 140 знаков, подсказка ученику", "env": одно из ' + '/'.join(ENVS) + ', "blocks": [...]}. '
               'Блоки (поле type): '
               'text — {"type":"text","title","text" (до 600 знаков),"x","z","y":2.2,"w":3,"accent": цвет}; '
               'table — {"type":"table","x","z","w":2.4,"d":0.9,"h":0.8}; '
               'item — предмет {"type":"item","label" (до 30),"info" (рассказ до 280 знаков),"shape": ' + '/'.join(SHAPES) + ',"color": ' + '/'.join(COLORS) + ',"size":0.3,"lift":0.8 если на столе,"x","z","spin": false}; '
               'model — {"type":"model","asset": ' + '/'.join(MODELS) + ',"label","info","h":1.5,"x","z"} (только эти модели); '
               'question — {"type":"question","q","a0" верный ответ,"a1","a2","explain","x","z","y":1.7,"w":2.8}. '
               'Координаты x и z от -5 до 5 метров, игрок появляется в точке x=0, z=4 и смотрит на стену z=-5.4. '
               'Текстовые панели и вопросы ставь у стен (z=-5.2, или x=-5.2 / x=5.2), предметы — на столе или на полу, не ближе 1 м друг к другу. '
               'Всего 6–14 блоков: вводный текст, 3–6 предметов или моделей с рассказами, 2–4 вопроса с пояснениями.')

Q_FORMAT = ('Формат ответа: {"questions": [{"q": "вопрос до 190 знаков", "a0": "верный ответ до 70", "a1": "неверный", "a2": "неверный", "a3": "неверный (можно пусто)", "explain": "пояснение до 280 знаков"}]}. '
            'Неверные ответы правдоподобные, но однозначно неверные; верный ответ только один; не повторяй вопросы.')


def _json(text):
    t = text.strip()
    m = re.search(r'\{.*\}', t, re.S)
    if not m:
        raise AiError(502, 'Помощник ответил непонятно. Попробуйте ещё раз.')
    try:
        obj = json.loads(m.group(0))
    except ValueError:
        raise AiError(502, 'Помощник ответил непонятно. Попробуйте ещё раз.')
    if not isinstance(obj, dict):
        raise AiError(502, 'Помощник ответил непонятно. Попробуйте ещё раз.')
    if obj.get('refuse'):
        raise AiError(422, 'Помощник работает только над школьными учебными материалами. Уточните учебную тему.')
    return obj


# ---------- проверка ответа по белому списку ----------
def _s(v, n):
    return re.sub(r'[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]', '', v).strip()[:n] if isinstance(v, str) else ''


def _n(v, lo, hi, d):
    try:
        v = float(v)
    except (TypeError, ValueError):
        return d
    return round(min(hi, max(lo, v)), 1) if v == v else d


def _oneof(v, allowed, d):
    return v if isinstance(v, str) and v in allowed else d


def _qblock(b):
    q, a0, a1 = _s(b.get('q'), 200), _s(b.get('a0'), 80), _s(b.get('a1'), 80)
    if not (q and a0 and a1) or a0.lower() == a1.lower():
        return None
    o = {'q': q, 'a0': a0, 'a1': a1, 'a2': _s(b.get('a2'), 80), 'a3': _s(b.get('a3'), 80), 'explain': _s(b.get('explain'), 300)}
    seen = {a0.lower()}
    for k in ('a1', 'a2', 'a3'):  # одинаковые ответы убираем
        if o[k] and o[k].lower() in seen:
            o[k] = ''
        seen.add(o[k].lower())
    if not o['a1']:
        return None
    return o


def check_room(obj):
    out = {'title': _s(obj.get('title'), 40) or 'Новая комната', 'hint': _s(obj.get('hint'), 140), 'env': _oneof(obj.get('env'), ENVS, 'lab'), 'blocks': []}
    src = obj.get('blocks')
    if not isinstance(src, list):
        raise AiError(502, 'Помощник ответил непонятно. Попробуйте ещё раз.')
    for b in src[:30]:
        if not isinstance(b, dict):
            continue
        t, x, z = b.get('type'), _n(b.get('x'), -5.4, 5.4, 0), _n(b.get('z'), -5.4, 5.4, -3)
        if t == 'text':
            body = _s(b.get('text'), 700)
            if body:
                out['blocks'].append({'type': 'text', 'x': x, 'z': z, 'y': _n(b.get('y'), .8, 2.6, 2.2), 'w': _n(b.get('w'), 1, 4, 2.6), 'title': _s(b.get('title'), 40), 'text': body, 'accent': _oneof(b.get('accent'), COLORS, 'blue')})
        elif t == 'table':
            out['blocks'].append({'type': 'table', 'x': x, 'z': z, 'w': _n(b.get('w'), .4, 4, 1.6), 'd': _n(b.get('d'), .4, 3, .9), 'h': _n(b.get('h'), .4, 1.2, .8), 'color': 'gray'})
        elif t == 'item':
            if _s(b.get('label'), 30):
                out['blocks'].append({'type': 'item', 'x': x, 'z': z, 'label': _s(b.get('label'), 30), 'info': _s(b.get('info'), 300), 'shape': _oneof(b.get('shape'), SHAPES, 'cube'),
                                      'color': _oneof(b.get('color'), COLORS, 'orange'), 'size': _n(b.get('size'), .1, 1.2, .3), 'lift': _n(b.get('lift'), 0, 2.5, 0), 'spin': bool(b.get('spin')), 'discover': True})
        elif t == 'model':
            if b.get('asset') in MODELS:
                out['blocks'].append({'type': 'model', 'x': x, 'z': z, 'asset': b['asset'], 'label': _s(b.get('label'), 30), 'info': _s(b.get('info'), 300), 'h': _n(b.get('h'), .2, 3.5, 1.5), 'lift': _n(b.get('lift'), 0, 2.5, 0), 'discover': True})
        elif t == 'question':
            q = _qblock(b)
            if q:
                q.update({'type': 'question', 'x': x, 'z': z, 'y': _n(b.get('y'), .8, 2.6, 1.7), 'w': _n(b.get('w'), 1.6, 4, 2.8), 'discover': True})
                out['blocks'].append(q)
    if not any(b['type'] in ('item', 'model', 'question') for b in out['blocks']):
        raise AiError(502, 'Помощник не смог составить комнату по этой теме. Уточните тему.')
    return out


def check_questions(obj, n):
    src = obj.get('questions')
    if not isinstance(src, list):
        raise AiError(502, 'Помощник ответил непонятно. Попробуйте ещё раз.')
    out, seen = [], set()
    for b in src[:max(n, 1) + 3]:
        q = _qblock(b) if isinstance(b, dict) else None
        if q and q['q'].lower() not in seen:
            seen.add(q['q'].lower())
            out.append(q)
    if not out:
        raise AiError(502, 'Помощник не смог составить вопросы по этой теме. Уточните тему.')
    return out[:n]


# ---------- задачи ----------
def run_task(data_dir, task, body):
    """Возвращает (результат, использовано токенов). Ошибки — AiError с текстом для учителя."""
    topic = clean_topic(body.get('topic'))
    grade = _grade(body.get('grade'))
    subj = SUBJECTS.get(body.get('subj'), '')
    ctx = 'Класс: %d. %sТема: %s.' % (grade, ('Предмет: %s. ' % subj) if subj else '', topic)
    if task == 'room':
        text, used = _chat(data_dir, 'room', RULES + ' ' + ROOM_FORMAT, 'Составь учебную комнату. ' + ctx, 3500, .4)
        return {'spec': check_room(_json(text))}, used
    if task == 'questions':
        try:
            n = min(10, max(1, int(body.get('count') or 5)))
        except (TypeError, ValueError):
            n = 5
        text, used = _chat(data_dir, 'questions', RULES + ' ' + Q_FORMAT, 'Составь %d вопросов для проверки знаний. %s' % (n, ctx), 2500, .3)
        return {'questions': check_questions(_json(text), n)}, used
    raise AiError(404, 'Неизвестная задача.')


def status(data_dir):
    return {'keySet': key_set(data_dir)}
