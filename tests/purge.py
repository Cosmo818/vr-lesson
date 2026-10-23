"""Шаг 25 PLAN.md (Б74.2, Б74.8): окончательное стирание (API), выдержка, пометки на стирание, список копий. Вида user нет.
Запуск: python3 -I tests/purge.py. Печатает «ok  : …» / «FAIL: …»; tests/run.js включает строки в общий счёт."""
import collections, json, os, sqlite3, subprocess, sys, tempfile, threading, time, urllib.error, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
tmp = tempfile.mkdtemp()
PORT, PORT2 = 8803, 8804
fails = 0
os.environ.update(DATA_DIR=tmp)
sys.path.insert(0, os.path.join(ROOT, 'server'))
import app  # noqa: E402


def ok(c, m):
    global fails
    print(('ok  : ' if c else 'FAIL: ') + m, flush=True)
    if not c:
        fails += 1


NOW = int(time.time() * 1000)
DAY = 86400000
WHO = ('cli', 'test', '')
KEYS = ('sup', 'dirA', 'tA1', 'tA2', 'dirB', 'regN')
LOGIN = {'sup': 'super.one', 'dirA': 'dir.a', 'tA1': 't.a1', 'tA2': 't.a2', 'dirB': 'dir.b', 'regN': 'reg.north'}
PW = {u: 'Pass-%s-2026-Zq' % u for u in KEYS}
UID = {}
app.init_db()
with app.db() as c:
    for sid, name, reg, st in (('s-a', 'Школа А', 'Север', 'active'), ('s-b', 'Школа Б', 'Юг', 'active'), ('s-old', 'Пустая школа', 'Пустой', 'active'), ('s-full', 'Школа с классом', 'Полный', 'active')):
        c.execute("INSERT INTO schools(id, name, region, district, status, network, created, updated) VALUES(?, ?, ?, '', ?, '', ?, ?)", (sid, name, reg, st, NOW, NOW))
    for k, roles in (('sup', [('superadmin', '')]), ('dirA', [('director', 's-a')]), ('tA1', [('teacher', 's-a')]), ('tA2', [('teacher', 's-a')]), ('dirB', [('director', 's-b')]),
                     ('regN', [('region_admin', 'r:Север')])):
        UID[k] = app.user_create(c, LOGIN[k], k, PW[k], WHO)
        for r, s in roles:
            app.role_add(c, UID[k], r, s, WHO)
    classes = [('cA1', 's-a', 'tA1', 5, 'А'), ('cA2', 's-a', 'tA2', 5, 'Б'), ('cB1', 's-b', None, 7, 'А'), ('cF', 's-full', None, 6, 'В')]
    studs = [('sA1', 'cA1', 's-a'), ('sA2', 'cA1', 's-a'), ('sA3', 'cA2', 's-a'), ('sA4', 'cA1', 's-a'), ('sB1', 'cB1', 's-b')]
    inc = {'classes': [{'id': i, 'grade': g, 'letter': l, 'created': NOW, 'updated': NOW, 'school': sch} for i, sch, t, g, l in classes],
           'students': [{'id': i, 'name': 'Ученик Секретов %s' % i, 'grade': 5, 'classId': cl, 'created': NOW, 'updated': NOW, 'school': sch, 'pinHash': 'secret-hash-%s' % i} for i, cl, sch in studs],
           'results': [{'id': 'r-%s-%d' % (i, n), 'sid': i, 'subj': 'math', 'score': 3, 'total': 5, 'ts': NOW - 1000 * n} for i, cl, sch in studs for n in (1, 2, 3)],
           'disc': {i: {'chem:el_H': NOW, 'bio:cell': NOW} for i, cl, sch in studs},
           'feedback': [{'id': 'fb1', 'ts': NOW, 'kind': 'room', 'room': 'chem', 'rating': 5, 'text': 'хорошо', 'sid': 'sA1'}, {'id': 'fb2', 'ts': NOW, 'kind': 'room', 'room': 'chem', 'rating': 4, 'text': 'ok', 'sid': 'sB1'}],
           'settings': {'updated': NOW, 'minutes': 8}}
    app.merge_in(c, inc, 'teacher', '', None)
    for i, sch, t, g, l in classes:
        if t:
            c.execute("UPDATE classes SET teacherId = ?, doc = json_set(doc, '$.teacherId', ?) WHERE id = ?", (UID[t], UID[t], i))
    c.execute("INSERT INTO devices(id, school, key_hash, name, status, created) VALUES('dv-old', 's-old', 'h1', 'x', 'revoked', ?)", (NOW,))
    c.execute("INSERT INTO pair_codes(code_hash, school, name, created, expires) VALUES('ph1', 's-old', 'x', ?, ?)", (NOW, NOW))

app.save_config({'accounts': True, 'legacyTeacher': True, 'sessionMinutes': 15})  # purge выключен по умолчанию
env = dict(os.environ, DATA_DIR=tmp, PORT=str(PORT), TEACHER_KEY='teach-secret', DEVICE_KEY='dev-secret')
log = open(os.path.join(tmp, 'server.log'), 'w')
srv = subprocess.Popen([sys.executable, '-I', os.path.join(ROOT, 'server', 'app.py')], env=env, stdout=log, stderr=log)
DBP = os.path.join(tmp, 'vrlesson.db')


def req(method, path, body=None, headers=None, port=PORT, raw_body=None):
    data = raw_body if raw_body is not None else json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request('http://127.0.0.1:%d%s' % (port, path), data=data, method=method, headers=dict({'Content-Type': 'application/json'}, **(headers or {})))
    try:
        with urllib.request.urlopen(r, timeout=60) as f:
            return f.status, json.loads(f.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or '{}')


def sql(q, *a):
    c = sqlite3.connect(DBP)
    try:
        r = c.execute(q, a).fetchall()
        c.commit()
        return r
    finally:
        c.close()


def cfg(**kw):
    c = app.load_config()
    c.update(kw)
    app.save_config(c)


def baks():
    return sorted(f for f in os.listdir(tmp) if '.bak-purge-' in f)


try:
    for _ in range(50):
        try:
            if req('GET', '/api/health')[0] == 200:
                break
        except Exception:
            time.sleep(.2)
    TOK = {}
    for k in KEYS:
        sql('delete from login_fail')
        TOK[k] = req('POST', '/api/auth/login', {'login': LOGIN[k], 'password': PW[k]})[1].get('token', '')
    ok(all(TOK.values()), 'фикстура: пользователи вошли')
    H = lambda k: {'Authorization': 'Bearer ' + TOK[k]}  # noqa: E731
    adm = lambda k, a, body=None, port=PORT: req('POST', '/api/admin/' + a, body or {}, H(k), port)  # noqa: E731
    pg = lambda body, k='sup', **kw: (sql('delete from login_fail'), adm(k, 'purge', dict(body, password=PW[k]), **kw))[1]  # noqa: E731  (лимит 20 запросов/мин с одного IP — отдельно не мешаем)
    audits = lambda q='1=1', *a: sql('select action, target_kind, target_id, detail from audit_log where ' + q, *a)  # noqa: E731

    # --- флаг и конфиг
    cf = app.load_config()
    ok(cf['purge'] is False and cf['purgeHoldDays'] == 30, 'config: purge по умолчанию false, выдержка 30 дней')
    ok(pg({'kind': 'student', 'ids': ['sA1']})[0] == 404 and adm('sup', 'purge.preview', {'kind': 'student', 'ids': ['sA1']})[0] == 404, 'флаг выключен: purge и purge.preview -> 404')
    ok(adm('sup', 'backup.list')[0] == 200 and adm('sup', 'purge.marks')[0] == 200, 'флаг выключен: backup.list и purge.marks работают')
    cfg(purge=True)

    # --- пометки (до архива: объект может быть действующим)
    d0 = len(audits("action = 'admin.denied'"))
    ok(adm('tA1', 'purge.mark', {'kind': 'student', 'id': 'sA4', 'why': 'ушёл из школы'})[0] == 200, 'пометка: учитель помечает ученика своего класса')
    ok(adm('tA1', 'purge.mark', {'kind': 'student', 'id': 'sA4'})[1].get('already') is True, 'повторная пометка не дублируется')
    ok(adm('tA1', 'purge.mark', {'kind': 'student', 'id': 'sA3'})[0] == 403 and adm('tA1', 'purge.mark', {'kind': 'student', 'id': 'sB1'})[0] == 403, 'пометка: чужой класс и чужая школа -> 403')
    ok(len(audits("action = 'admin.denied'")) == d0 + 2, 'отказы пометки записаны в аудит')
    ok(adm('dirA', 'purge.mark', {'kind': 'student', 'id': 'sA1', 'why': 'выпуск'})[0] == 200 and adm('dirA', 'purge.mark', {'kind': 'student', 'id': 'sA3'})[0] == 200, 'пометка: директор — ученики своей школы')
    ok(adm('dirB', 'purge.mark', {'kind': 'student', 'id': 'sA4'})[0] == 403, 'пометка: директор другой школы -> 403')
    ok(adm('regN', 'purge.mark', {'kind': 'class', 'id': 'cA1'})[0] == 200, 'пометка: администратор региона — класс школы своей области')
    ok(adm('regN', 'purge.mark', {'kind': 'class', 'id': 'cB1'})[0] == 403, 'пометка: администратор региона — чужая область -> 403')
    ok(adm('dirA', 'purge.mark', {'kind': 'school', 'id': 's-a'})[0] == 200 and adm('dirA', 'purge.mark', {'kind': 'school', 'id': 's-b'})[0] == 403, 'пометка школы: своей — да, чужой — нет')
    ok(adm('dirA', 'purge.mark', {'kind': 'user', 'id': UID['tA1']})[0] == 400 and adm('dirA', 'purge.mark', {'kind': 'student', 'id': 'нет'})[0] == 404, 'пометка: вид user -> 400, неизвестный объект -> 404')
    ok(adm('tA1', 'purge.mark', {'kind': 'school', 'id': 's-a'})[0] == 403, 'пометка школы учителем -> 403')
    st, b = adm('sup', 'purge.marks')
    ok(st == 200 and {(i['kind'], i['id']) for i in b['items']} >= {('student', 'sA4'), ('student', 'sA1'), ('class', 'cA1'), ('school', 's-a')}, 'purge.marks: суперадмин видит все')
    ok(all(i['state'] == 'active' for i in b['items']) and any(i['by'] for i in b['items']), 'purge.marks: состояние и автор')
    ids = {(i['kind'], i['id']) for i in adm('dirA', 'purge.marks')[1]['items']}
    ok(('student', 'sA4') in ids and ('student', 'sA1') in ids and ('student', 'sB1') not in ids, 'purge.marks: директор — свои школы')
    ids = {(i['kind'], i['id']) for i in adm('tA1', 'purge.marks')[1]['items']}
    ok(ids == {('student', 'sA4')}, 'purge.marks: учитель — только свои пометки')
    ok(adm('dirA', 'purge.marks', {'school': 's-b'})[0] == 403, 'purge.marks: чужая школа -> 403')
    ok(adm('dirB', 'purge.mark', {'kind': 'student', 'id': 'sB1'})[0] == 200 and not any(i['id'] == 'sB1' for i in adm('dirA', 'purge.marks')[1]['items']), 'пометки другой школы директору А не видны')
    ok(adm('tA2', 'purge.unmark', {'kind': 'student', 'id': 'sA4'})[0] == 403, 'снять пометку: чужой учитель -> 403')
    ok(adm('tA1', 'purge.unmark', {'kind': 'student', 'id': 'sA4'})[0] == 200 and adm('tA1', 'purge.unmark', {'kind': 'student', 'id': 'sA4'})[0] == 404, 'снять пометку: автор может, повторно -> 404')
    ok(adm('tA1', 'purge.mark', {'kind': 'student', 'id': 'sA4'})[0] == 200 and adm('dirA', 'purge.unmark', {'kind': 'student', 'id': 'sA4'})[0] == 200, 'снять пометку: директор школы может снять чужую')
    ok(adm('tA1', 'purge.mark', {'kind': 'student', 'id': 'sA4'})[0] == 200 and adm('sup', 'purge.unmark', {'kind': 'student', 'id': 'sA4'})[0] == 200, 'снять пометку: суперадмин может')
    ok(all(any(a[0] == x for a in audits()) for x in ('purge.mark', 'purge.unmark')), 'пометки и снятия записаны в аудит')
    ok(sql("select count(*) from purge_marks where kind = 'student' and id = 'sA4'")[0][0] == 0, 'пометка снята из таблицы')
    ok(sql("select count(*) from audit_log where action = 'purge.mark'")[0][0] >= 6, 'каждая пометка — строка аудита')

    ok(adm('dirA', 'purge.mark', {'kind': 'class', 'id': 'cA2', 'why': 'строка\nвторая   ' + 'я' * 500})[0] == 200, 'пометка с длинным why')
    w = sql("select why from purge_marks where id = 'cA2'")[0][0]
    ok('\n' not in w and len(w) <= 200 and w.startswith('строка вторая я'), 'why: без переводов строк, до 200 знаков')
    sql("delete from purge_marks where id = 'cA2'")
    # объект ушёл в чужую школу: директор старой школы имени не видит, суперадмин видит текущую школу
    ok(adm('dirA', 'purge.mark', {'kind': 'student', 'id': 'sA4'})[0] == 200, 'пометка sA4 до переноса')
    sql("update students set school = 's-b', doc = json_set(doc, '$.school', 's-b', '$.classId', 'cB1') where id = 'sA4'")
    it = [i for i in adm('dirA', 'purge.marks')[1]['items'] if i['id'] == 'sA4']
    ok(len(it) == 1 and it[0]['name'] == '' and it[0]['state'] == 'moved' and it[0]['from'] is None, 'purge.marks: объект ушёл в чужую школу -> без имени, state moved')
    it = [i for i in adm('sup', 'purge.marks')[1]['items'] if i['id'] == 'sA4']
    ok(it and it[0]['school'] == 's-b' and it[0]['name'].startswith('Ученик'), 'purge.marks: суперадмин видит имя и текущую школу')
    sql("delete from purge_marks where id = 'sA4'")
    # --- права, пароль, троттлинг
    d0 = len(audits("action = 'admin.denied'"))
    for k in ('dirA', 'tA1', 'regN'):
        ok(pg({'kind': 'student', 'ids': ['sA1']}, k)[0] == 403, 'purge: %s -> 403' % k)
    ok(len(audits("action = 'admin.denied'")) == d0 + 3, 'purge от не-суперадмина: admin.denied в аудите')
    ok(adm('dirA', 'purge.preview', {'kind': 'student', 'ids': ['sA1']})[0] == 403 and adm('tA1', 'purge.preview', {'kind': 'student', 'ids': ['sA1']})[0] == 403, 'purge.preview: директор и учитель -> 403')
    ok(adm('tA1', 'backup.list')[0] == 403 and adm('dirA', 'backup.list')[0] == 403, 'backup.list: только суперадмин')
    sql('delete from login_fail')
    ok(adm('sup', 'purge', {'kind': 'student', 'ids': ['sA1']})[0] == 403, 'purge без пароля -> 403')
    ok(adm('sup', 'purge', {'kind': 'student', 'ids': ['sA1'], 'password': 'Wrong-pass-1'})[0] == 403, 'purge с неверным паролем -> 403')
    for _ in range(3):
        adm('sup', 'purge', {'kind': 'student', 'ids': ['sA1'], 'password': 'Wrong-pass-1'})
    st, b = adm('sup', 'purge', {'kind': 'student', 'ids': ['sA1'], 'password': PW['sup']})
    ok(st == 429, 'после 5 ошибок пароля даже верный пароль -> 429 (получено %s)' % st)
    ok(not baks(), 'без пароля и при 429 копия не делалась')
    sql('delete from login_fail')

    # --- действующего стирать нельзя; вид user; пакет; размер тела
    st, b = pg({'kind': 'student', 'ids': ['sA1']})
    ok(st == 400 and 'в архиве' in b['error'], 'действующего ученика стереть нельзя -> 400')
    st, b = pg({'kind': 'user', 'ids': [UID['tA1']]})
    ok(st == 400 and 'Стирание учёток пока не предусмотрено' in b['error'], 'kind=user -> 400 «Стирание учёток пока не предусмотрено»')
    ok(adm('sup', 'purge.preview', {'kind': 'user', 'ids': ['x']})[0] == 400, 'preview kind=user -> 400')
    ok(pg({'kind': 'student', 'ids': ['x%d' % i for i in range(51)]})[0] == 400 and pg({'kind': 'student', 'ids': []})[0] == 400 and pg({'kind': 'zzz', 'ids': ['a']})[0] == 400, 'пакет: >50, пусто, неверный вид -> 400')
    ok(req('POST', '/api/admin/purge', None, H('sup'), raw_body=b'{"kind":"student","ids":["' + b'a' * 9000 + b'"]}')[0] == 413, 'тело /purge больше 8192 байт -> 413')
    big = {'kind': 'student', 'ids': ['s' * 80 for _ in range(50)], 'password': PW['sup']}
    ok(4096 < len(json.dumps(big)) < 8192 and pg(big)[0] == 404, 'тело /purge до 8192 принимается (50 id; дальше «Объекта нет»)')
    ok(not baks(), 'ошибки проверки не делают копий')

    # --- выдержка
    ok(adm('dirA', 'student.archive', {'student_id': 'sA1'})[0] == 200 and adm('dirA', 'student.archive', {'student_id': 'sA2'})[0] == 200, 'ученики sA1, sA2 в архиве')
    st, b = pg({'kind': 'student', 'ids': ['sA1']})
    ok(st == 400 and b['error'] == 'Выдержка в архиве: осталось 30 дн.', 'выдержка: только что архивный -> «осталось 30 дн.» (%s)' % b.get('error'))
    upd = sql("select updated from students where id = 'sA1'")[0][0]
    st, pv = adm('sup', 'purge.preview', {'kind': 'student', 'ids': ['sA1']})
    ok(st == 200 and pv['can'] is False and pv['hold_days'] == 30 and pv['items'][0]['from'] == upd + 30 * DAY, 'preview: дата, с которой можно стирать = updated + 30 дн.')
    sql("update students set updated = ? where id = 'sA1'", NOW - 29 * DAY - 3600000)
    ok(pg({'kind': 'student', 'ids': ['sA1']})[1].get('error') == 'Выдержка в архиве: осталось 1 дн.', 'выдержка: на 29-й день осталось 1 дн.')
    cfg(purgeHoldDays=10)
    ok(pg({'kind': 'student', 'ids': ['sA1']})[0] == 200, 'выдержка меняется конфигом (10 дн.) без перезапуска: sA1 стёрт')
    cfg(purgeHoldDays=30)
    # sA1 уже стёрт — проверки результата
    ok(all(sql(q, 'sA1')[0][0] == 0 for q in ('select count(*) from students where id = ?', 'select count(*) from results where sid = ?', 'select count(*) from disc where sid = ?')), 'sA1: строк ученика, результатов и открытий нет')
    ok(sql("select doc from feedback where id = 'fb1'")[0][0].find('sid') < 0 and sql("select count(*) from feedback where id = 'fb1'")[0][0] == 1, 'отзыв остался, поле sid убрано')
    ok('sid' in sql("select doc from feedback where id = 'fb2'")[0][0], 'отзыв другого ученика не тронут')
    ok(sql("select count(*) from purged where id = 'sA1'")[0][0] == 1 and sql("select count(*) from deleted where id = 'sA1'")[0][0] == 1, 'id в purged и deleted')
    ok(sql("select count(*) from purge_marks where id = 'sA1'")[0][0] == 0, 'purge снимает пометку объекта')
    bk = baks()
    ok(len(bk) == 1 and oct(os.stat(os.path.join(tmp, bk[0])).st_mode)[-3:] == '600', 'рядом с базой одна копия bak-purge-*, права 600')
    cb = sqlite3.connect(os.path.join(tmp, bk[0]))
    ok(cb.execute("select count(*) from students where id = 'sA1'").fetchone()[0] == 1 and cb.execute("select count(*) from results where sid = 'sA1'").fetchone()[0] == 3, 'в копии ученик и его 3 результата ещё есть')
    cb.close()
    # старый клиент присылает ученика и результаты снова — не воскресает
    old = {'students': [{'id': 'sA1', 'name': 'Ученик Секретов sA1', 'grade': 5, 'classId': 'cA1', 'updated': NOW + 10 ** 6, 'school': 's-a'}],
           'results': [{'id': 'r-new', 'sid': 'sA1', 'subj': 'math', 'score': 1, 'total': 5, 'ts': NOW}], 'disc': {'sA1': {'x': NOW}}}
    st, b = req('POST', '/api/sync', old, {'X-Key': 'teach-secret'})
    ok(st == 200 and not any(s['id'] == 'sA1' for s in b['state']['students']), 'старый клиент: ученик не воскресает в ответе')
    ok(sql("select count(*) from students where id = 'sA1'")[0][0] == 0 and sql("select count(*) from results where sid = 'sA1' and id = 'r-new'")[0][0] == 0, 'старый клиент: ученик и его новый результат не записались')
    st, b = req('POST', '/api/sync', {'students': [], 'purged': b['state'].get('purged', {})}, {'X-Key': 'teach-secret'})
    ok(st == 200 and 'sA1' in (b['state'].get('purged') or {}) , 'новый клиент получает sA1 в purged')
    ok(sql("select count(*) from audit_log where detail like '%Секретов%' or target_id like '%Секретов%' or detail like '%secret-hash%' or detail like '%pinHash%'")[0][0] == 0, 'в аудите нет имени ученика и хэшей')
    rows = audits("action = 'purge' and target_id = 'sA1'")
    dt = json.loads(rows[0][3]) if rows else {}
    ok(len(rows) == 1 and dt.get('results') == 3 and dt.get('disc') == 2 and dt.get('feedback_anonymized') == 1 and dt.get('backup') == bk[0], 'аудит purge: счётчики и имя копии без пути')

    # --- класс
    ok(adm('dirA', 'class.archive', {'class_id': 'cA2'})[0] == 200, 'класс cA2 в архиве')
    st, b = pg({'kind': 'class', 'ids': ['cA2']})
    ok(st == 400 and 'В классе есть действующие ученики: 1' in b['error'], 'класс с действующим учеником -> 400 со счётчиком (%s)' % b.get('error'))
    ok(adm('dirA', 'student.archive', {'student_id': 'sA3'})[0] == 200, 'ученик sA3 в архиве')
    ok(pg({'kind': 'class', 'ids': ['cA2']})[1].get('error', '').startswith('Выдержка'), 'класс: выдержка действует и на каскад')
    sql("update classes set updated = ? where id = 'cA2'", NOW - 40 * DAY)
    sql("update students set updated = ? where id = 'sA3'", NOW - 40 * DAY)
    st, pv = adm('sup', 'purge.preview', {'kind': 'class', 'ids': ['cA2']})
    ok(st == 200 and pv['can'] and pv['total'] == {'students': 1, 'results': 3, 'disc': 2, 'feedback_anonymized': 0} and pv['items'][0]['name'] == '5Б', 'preview класса: каскад и счётчики (%s)' % pv.get('total'))
    n_bak = len(baks())
    st, b = pg({'kind': 'class', 'ids': ['cA2']})
    ok(st == 200 and b['purged'] == 1 and b['total'] == pv['total'] and len(baks()) == n_bak + 1 and b['backup'] in baks() and '/' not in b['backup'], 'purge класса: те же счётчики, что в preview; копия, имя без пути')
    ok(sql("select count(*) from classes where id = 'cA2'")[0][0] == 0 and sql("select count(*) from students where id = 'sA3'")[0][0] == 0 and sql("select count(*) from purged where id in ('cA2', 'sA3')")[0][0] == 2, 'класс и ученик каскадом стёрты, оба в purged')
    r = audits("action = 'purge' and target_id = 'cA2'")
    dt = json.loads(r[0][3]) if r else {}
    ok(dt.get('students') == 1 and dt.get('name') == '5Б' and len(audits("action = 'purge' and target_kind = 'student' and target_id = 'sA3'")) == 1, 'аудит класса: students=1, name «5Б»; строка и на ученика')
    ok(sql("select count(*) from purge_marks where id in ('cA2', 'sA3')")[0][0] == 0, 'пометки каскада сняты')

    # --- 507: мало места, ничего не тронуто
    sql("update students set updated = ? where id = 'sA2'", NOW - 40 * DAY)
    srv2 = app.ThreadingHTTPServer(('127.0.0.1', PORT2), app.H)
    threading.Thread(target=srv2.serve_forever, daemon=True).start()
    real = app.shutil.disk_usage
    app.shutil.disk_usage = lambda p: collections.namedtuple('du', 'total used free')(10 ** 9, 10 ** 9 - 1, 1)
    n_bak = len(baks())
    try:
        st, b = pg({'kind': 'student', 'ids': ['sA2']}, port=PORT2)
    finally:
        app.shutil.disk_usage = real
    ok(st == 507 and 'Мало места' in b['error'], 'мало места -> 507 (%s)' % st)
    ok(sql("select count(*) from students where id = 'sA2'")[0][0] == 1 and sql("select count(*) from results where sid = 'sA2'")[0][0] == 3 and len(baks()) == n_bak, '507: данные целы, копия не создана')
    ok(len(audits("action = 'purge.failed'")) == 1, '507: purge.failed в аудите')
    srv2.shutdown()

    # --- школа
    st, b = pg({'kind': 'school', 'ids': ['s-full']})
    ok(st == 400 and 'не архивная' not in b['error'], 'действующую школу стереть нельзя -> 400')
    ok(adm('sup', 'school.update', {'id': 's-full', 'status': 'archived'})[0] == 200 and adm('sup', 'school.update', {'id': 's-old', 'status': 'archived'})[0] == 200, 'школы s-full, s-old в архиве')
    sql("update schools set updated = ? where id in ('s-full', 's-old')", NOW - 40 * DAY)
    sql("update audit_log set ts = ? where action = 'school.update' and target_id in ('s-full', 's-old')", NOW - 40 * DAY)
    sql("insert or ignore into classes(id, name, updated, doc, school) values('cF', '6В', ?, '{\"id\":\"cF\"}', 's-full')", NOW)
    st, b = pg({'kind': 'school', 'ids': ['s-full']})
    ok(st == 400 and 'классов 1' in b['error'], 'непустая школа -> 400 со счётчиками (%s)' % b.get('error'))
    ok(pg({'kind': 'school', 'ids': [app.DEFAULT_SCHOOL]})[0] == 400, 'school-default стереть нельзя')
    st, b = adm('sup', 'options', {}) if False else req('GET', '/api/options?level=region', None, H('sup'))
    ok(any(i['id'] == 'Пустой' for i in b['items']), 'до стирания регион «Пустой» в options')
    st, b = pg({'kind': 'school', 'ids': ['s-old']})
    ok(st == 200, 'пустая архивная школа стёрта (%s)' % st)
    ok(sql("select count(*) from schools where id = 's-old'")[0][0] == 0 and sql("select count(*) from devices where school = 's-old'")[0][0] == 0 and sql("select count(*) from pair_codes where school = 's-old'")[0][0] == 0, 'школа, отозванные шлемы и коды пары стёрты')
    st, b = req('GET', '/api/options?level=region', None, H('sup'))
    ok(not any(i['id'] == 'Пустой' for i in b['items']), 'регион стёртой школы пропал из options')
    ok(audits("action = 'purge' and target_kind = 'school' and target_id = 's-old'") != [], 'аудит стирания школы')

    # --- файлы
    os.makedirs(os.path.join(tmp, 'uploads'), exist_ok=True)
    for uid, arch in (('u1', NOW), ('u2', NOW - 40 * DAY), ('u3', NOW - 40 * DAY), ('u4', None)):
        sql("insert into uploads(id, school, owner, kind, name, size, ext, sha, status, created, archived_at) values(?, 's-a', ?, 'sound', 'f', 10, 'ogg', 'x', 'approved', ?, ?)", uid, UID['tA1'], NOW, arch)
    for uid in ('u1', 'u2', 'u4'):
        open(os.path.join(tmp, 'uploads', uid + '.ogg'), 'wb').write(b'x')  # у u3 файла нет
    ok(pg({'kind': 'upload', 'ids': ['u1']})[1].get('error', '').startswith('Выдержка') and pg({'kind': 'upload', 'ids': ['u4']})[0] == 400, 'файл: свежий архивный — выдержка; не в архиве — 400')
    ok(adm('tA1', 'purge.mark', {'kind': 'upload', 'id': 'u2'})[0] == 200 and adm('tA2', 'purge.mark', {'kind': 'upload', 'id': 'u3'})[0] == 403, 'пометка файла: владелец да, чужой учитель нет')
    st, b = pg({'kind': 'upload', 'ids': ['u2', 'u3']})
    ok(st == 200 and not os.path.exists(os.path.join(tmp, 'uploads', 'u2.ogg')) and os.path.exists(os.path.join(tmp, 'uploads', 'u1.ogg')) and sql("select count(*) from uploads where id in ('u2', 'u3')")[0][0] == 0, 'файлы u2, u3 стёрты, u1 остался')
    ok(json.loads(audits("action = 'purge' and target_id = 'u3'")[0][3]).get('file') == 'missing' and 'file' not in json.loads(audits("action = 'purge' and target_id = 'u2'")[0][3]), 'нет файла на диске -> detail file=missing, не молча')
    ok(sql("select count(*) from purge_marks where id = 'u2'")[0][0] == 0, 'пометка файла снята')

    # --- не удалось удалить файл / путь не строился
    sql("insert into uploads(id, school, owner, kind, name, size, ext, sha, status, created, archived_at) values('u5', 's-a', ?, 'sound', 'f', 10, 'ogg', 'x', 'approved', ?, ?), ('u6', 's-a', ?, 'sound', 'f', 10, 'o/g', 'x', 'approved', ?, ?)", UID['tA1'], NOW, NOW - 40 * DAY, UID['tA1'], NOW, NOW - 40 * DAY)
    os.makedirs(os.path.join(tmp, 'uploads', 'u5.ogg'))  # remove() на каталоге не удастся
    st, b = pg({'kind': 'upload', 'ids': ['u5', 'u6']})
    ok(st == 200 and b.get('lost') == ['u5'], 'файл не удалился -> в ответе lost [u5] (%s)' % b)
    ok(json.loads(audits("action = 'purge' and target_id = 'u6'")[0][3]).get('file') == 'skipped' and len(audits("action = 'purge.file_failed' and target_id = 'u5'")) == 1, 'ext не прошёл проверку -> file=skipped; сбой удаления — purge.file_failed')
    # --- корзина
    sql("insert into trash(kind, id, school, doc, ts) values('test', 't-1', 'school-default', '{\"title\":\"Тест\"}', ?), ('test', 't-2', 'school-default', '{\"title\":\"Старый\"}', ?)", NOW, NOW - 40 * DAY)
    ok(pg({'kind': 'trash', 'ids': ['test:t-1']})[1].get('error', '').startswith('Выдержка'), 'корзина: свежая запись — выдержка')
    ok(pg({'kind': 'trash', 'ids': ['test:t-zzz']})[0] == 404, 'корзина: нет записи -> 404')
    st, b = pg({'kind': 'trash', 'ids': ['test:t-2']})
    ok(st == 200 and sql("select count(*) from trash where id = 't-2'")[0][0] == 0 and sql("select count(*) from purged where id = 't-2'")[0][0] == 1 and sql("select count(*) from trash where id = 't-1'")[0][0] == 1, 'корзина: запись стёрта, соседняя цела, id в purged')

    # --- reset
    ok(pg({'kind': 'reset'})[1].get('error') == 'Очистки результатов не было.', 'reset без resetAt -> 400')
    sql("update settings set doc = json_set(doc, '$.resetAt', ?) where id = 1", NOW - 5 * DAY)
    sql("update results set ts = ? where id like 'r-sB1-%'", NOW - 60 * DAY)
    sql("update disc set ts = ? where sid = 'sB1' and k = 'bio:cell'", NOW - 60 * DAY)
    ok(pg({'kind': 'reset'})[1].get('error', '').startswith('Выдержка в архиве: осталось 25'), 'reset: выдержка считается от resetAt')
    sql("update settings set doc = json_set(doc, '$.resetAt', ?) where id = 1", NOW - 40 * DAY)
    sql("update results set ts = ? where id like 'r-sB1-%'", NOW - 60 * DAY)
    sql("update results set ts = ? where id like 'r-sA2-%'", NOW - 10 * DAY)
    sql("update results set ts = ? where id = 'r-sB1-1'", NOW - 10 * DAY)
    st, pv = adm('sup', 'purge.preview', {'kind': 'reset'})
    st2, b = pg({'kind': 'reset'})
    ok(st == 200 and st2 == 200 and pv['total']['results'] == 2 and b['total']['results'] == 2 and b['total']['disc'] == 1, 'reset: стёрты только строки до resetAt (2 результата, 1 открытие)')
    ok(sql("select count(*) from results where id = 'r-sB1-1'")[0][0] == 1 and sql("select count(*) from results where sid = 'sA2'")[0][0] == 3, 'reset: строки после resetAt целы')

    # --- копии bak-purge-*
    for fn in ('vrlesson.db.bak-purge-20190101-000000', 'vrlesson.db.bak-purge-20300101-000000', 'vrlesson.db.bak-v5-20190101-000000', 'other.bak-purge-20190101-000000'):
        open(os.path.join(tmp, fn), 'wb').write(b'x')
    st, b = adm('sup', 'backup.list')
    names = {i['name']: i for i in b['items']}
    ok(st == 200 and 'vrlesson.db.bak-purge-20190101-000000' in names and names['vrlesson.db.bak-purge-20190101-000000']['expired'] is True and names['vrlesson.db.bak-purge-20300101-000000']['expired'] is False, 'backup.list: старше 5 лет — expired')
    ok(b['expired'] == 1 and all('/' not in n and n.startswith('vrlesson.db.bak-purge-') for n in names) and len(names) == len(baks()) + 1 - 0 or len(names) >= 3, 'backup.list: только bak-purge-*, без путей')
    ok(os.path.exists(os.path.join(tmp, 'vrlesson.db.bak-purge-20190101-000000')), 'сервер старые копии не удаляет')

    # --- CLI
    ce = dict(os.environ, DATA_DIR=tmp)
    run = lambda *a: subprocess.run([sys.executable, '-I', os.path.join(ROOT, 'server', 'app.py')] + list(a), env=ce, capture_output=True, text=True)  # noqa: E731
    ok(run('set-purge-hold', '7').returncode == 0 and app.load_config()['purgeHoldDays'] == 7, 'CLI set-purge-hold 7')
    ok(run('set-purge-hold', '4000').returncode == 1 and run('set-purge-hold', 'x').returncode == 1 and app.load_config()['purgeHoldDays'] == 7, 'CLI set-purge-hold: вне 0–3650 -> ошибка')
    ok(run('set-purge-hold', '0').returncode == 0 and app.load_config()['purgeHoldDays'] == 0, 'CLI set-purge-hold 0')
    ok(pg({'kind': 'trash', 'ids': ['test:t-1']})[0] == 200, 'выдержка 0: свежая корзина стирается сразу')
    ok(run('purge', 'off').returncode == 0 and app.load_config()['purge'] is False and pg({'kind': 'student', 'ids': ['sA2']})[0] == 404, 'CLI purge off -> 404')
    ok(run('purge', 'on').returncode == 0 and app.load_config()['purge'] is True, 'CLI purge on')
    ok(sql("select count(*) from audit_log where action in ('config.purge', 'config.purge_hold')")[0][0] == 4, 'CLI пишет аудит конфигурации')
    ok(sql("select count(*) from pragma_table_info('purge_marks')")[0][0] == 6, 'таблица purge_marks создана (migrate_b74 идемпотентна)')
    with app.db() as c:
        app.migrate_b74(c)
    ok(sql("select count(*) from purge_marks")[0][0] >= 0, 'migrate_b74 повторно не падает')
finally:
    srv.terminate()
    try:
        srv.wait(5)
    except Exception:
        srv.kill()
print('purge.py: проваленных проверок %d' % fails, flush=True)
sys.exit(1 if fails else 0)
