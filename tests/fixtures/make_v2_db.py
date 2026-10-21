"""Создаёт настоящую базу формата v2 (до миграции) из tests/fixtures/legacy-v2.json.
Запуск: python3 -I make_v2_db.py <путь к .db> <путь к legacy-v2.json>. user_version не трогает."""
import json, sqlite3, sys

db_path, fx_path = sys.argv[1], sys.argv[2]
F = json.load(open(fx_path, encoding='utf-8'))
dump = lambda x: json.dumps(x, ensure_ascii=False)
c = sqlite3.connect(db_path)
c.executescript('''
CREATE TABLE IF NOT EXISTS students(id TEXT PRIMARY KEY, name TEXT, grade INTEGER, updated INTEGER, doc TEXT);
CREATE TABLE IF NOT EXISTS classes(id TEXT PRIMARY KEY, name TEXT, updated INTEGER, doc TEXT);
CREATE TABLE IF NOT EXISTS tests(id TEXT PRIMARY KEY, title TEXT, subj TEXT, updated INTEGER, doc TEXT);
CREATE TABLE IF NOT EXISTS results(id TEXT PRIMARY KEY, sid TEXT, subj TEXT, score INTEGER, total INTEGER, ts INTEGER, doc TEXT);
CREATE TABLE IF NOT EXISTS disc(sid TEXT, k TEXT, ts INTEGER, PRIMARY KEY(sid, k));
CREATE TABLE IF NOT EXISTS deleted(id TEXT PRIMARY KEY, ts INTEGER);
CREATE TABLE IF NOT EXISTS feedback(id TEXT PRIMARY KEY, ts INTEGER, kind TEXT, room TEXT, rating INTEGER, text TEXT, doc TEXT);
CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY CHECK(id = 1), updated INTEGER, doc TEXT);
CREATE INDEX IF NOT EXISTS results_sid ON results(sid);
''')
for s in F['students']:
    c.execute('INSERT INTO students VALUES(?,?,?,?,?)', (s['id'], s['name'], s.get('grade'), s.get('updated') or s.get('created') or 0, dump(s)))
for k in F['classes']:
    c.execute('INSERT INTO classes VALUES(?,?,?,?)', (k['id'], '%s%s' % (k['grade'], k.get('letter', '')), k.get('updated') or 0, dump(k)))
for t in F['tests']:
    c.execute('INSERT INTO tests VALUES(?,?,?,?,?)', (t['id'], t.get('title', ''), t.get('subj', ''), t.get('updated') or 0, dump(t)))
for r in F['results']:
    c.execute('INSERT INTO results VALUES(?,?,?,?,?,?,?)', (r['id'], r['sid'], r.get('subj', ''), r.get('score') or 0, r.get('total') or 0, r.get('ts') or 0, dump(r)))
for sid, m in F['disc'].items():
    for k, ts in m.items():
        c.execute('INSERT INTO disc VALUES(?,?,?)', (sid, k, ts))
for k, ts in F['deleted'].items():
    c.execute('INSERT INTO deleted VALUES(?,?)', (k, ts))
for f in F['feedback']:
    c.execute('INSERT INTO feedback VALUES(?,?,?,?,?,?,?)', (f['id'], f.get('ts') or 0, f.get('kind', ''), f.get('room') or '', f.get('rating'), f.get('text', ''), dump(f)))
c.execute('INSERT INTO settings VALUES(1,?,?)', (F['settings'].get('updated') or 0, dump(F['settings'])))
c.commit()
c.close()
