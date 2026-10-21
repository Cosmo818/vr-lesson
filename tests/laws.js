/* laws.js — автоматическая проверка законов (docs/LAWS.md) и контрактов модулей.
   Подключается из tests/run.js; отдельно: node tests/laws.js [--update-baseline] */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');
const cp = require('child_process');

const HOSTS_OK = ['vrklass.ru', 'www.vrklass.ru', 'cosmo818.github.io', 'www.w3.org', 'cdn.babylonjs.com', 'localhost', '127.0.0.1'];
const ALLOW = [
  {file: 'teacher.html', re: /DEF_HASH=/, why: 'PBKDF2-хэш пароля по умолчанию, не сам пароль (вынесено Айрату в вопросы)'}
];
const KNOWN_SHADOW = [];

const rd = (root, f) => fs.readFileSync(path.join(root, f), 'utf8');
const ex = (root, f) => fs.existsSync(path.join(root, f));

function scriptsOf(root, htmlFile) {
  const out = [], re = /<script\b[^>]*\bsrc="([^"]+)"/g, t = rd(root, htmlFile);
  let m; while ((m = re.exec(t))) out.push(m[1]);
  return out;
}
function inlineScripts(root, htmlFile) {
  const out = [], re = /<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g, t = rd(root, htmlFile);
  let m; while ((m = re.exec(t))) out.push(m[1]);
  return out;
}
function parseSw(text) {
  const V = (/const V='([^']+)'/.exec(text) || [])[1] || '';
  const fl = (/const FILES=\[([^\]]*)\]/.exec(text) || [])[1] || '';
  const FILES = []; const re = /'([^']*)'/g; let m;
  while ((m = re.exec(fl))) FILES.push(m[1]);
  return {V, FILES};
}
const readSw = root => parseSw(rd(root, 'sw.js'));

function loadSite(root) {
  const mem = {};
  const ls = {getItem: k => k in mem ? mem[k] : null, setItem: (k, v) => {mem[k] = String(v);}, removeItem: k => {delete mem[k];}};
  const el = () => ({style: {}, dataset: {}, addEventListener() {}, getContext: () => null, appendChild() {}});
  const sb = {
    document: {readyState: 'loading', addEventListener() {}, getElementById: () => null, createElement: el, body: el()},
    localStorage: ls, sessionStorage: ls, navigator: {}, location: {protocol: 'file:', hostname: 'localhost', origin: 'file://'},
    performance: {now: () => Date.now()}, setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, requestAnimationFrame: () => 0,
    addEventListener() {}, console, crypto: crypto.webcrypto, TextEncoder, btoa, atob
  };
  sb.window = sb; sb.globalThis = sb; sb.self = sb;
  vm.createContext(sb);
  for (const f of scriptsOf(root, 'index.html').filter(f => f !== 'js/app.js'))
    vm.runInContext(rd(root, f), sb, {filename: f});
  return sb.VR;
}

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const sha8 = s => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 8);
const safe = s => s.slice(0, 4) + '…';

function listFiles(root, dir, ext) {
  const d = path.join(root, dir);
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d).filter(f => !ext || f.endsWith(ext)).map(f => dir + '/' + f).filter(f => fs.statSync(path.join(root, f)).isFile());
}

function run(root) {
  const checks = [], warns = [];
  const add = (ok, msg) => checks.push({ok: !!ok, msg});
  const sw = readSw(root);
  const fileOf = f => f === './' ? 'index.html' : f;

  /* L1 */
  const missing = sw.FILES.filter(f => !ex(root, fileOf(f)));
  add(!missing.length, 'sw.js: все файлы FILES существуют' + (missing.length ? ' (нет: ' + missing.join(', ') + ')' : ''));
  add(/^vr-lesson-v\d+$/.test(sw.V), 'sw.js: версия кэша вида vr-lesson-v<число> (' + sw.V + ')');

  /* L2 */
  const pages = ['index.html', 'teacher.html', 'help.html', 'help-teacher.html'].filter(f => ex(root, f));
  const notCached = [];
  for (const p of pages) {
    const re = /\b(?:src|href)="([^"]*)"/g, t = rd(root, p); let m;
    while ((m = re.exec(t))) {
      let u = m[1];
      if (!u || /^(http|#|\?|mailto:|data:)/.test(u)) continue;
      u = u.replace(/[?#].*$/, '');
      if (u && !sw.FILES.includes(u) && !sw.FILES.includes('./' + u)) notCached.push(p + ' → ' + u);
    }
  }
  add(!notCached.length, 'sw.js: все src/href страниц есть в FILES' + (notCached.length ? ' (нет: ' + [...new Set(notCached)].join('; ') + ')' : ''));
  const disk = listFiles(root, 'js', '.js').concat(listFiles(root, 'css', '.css'));
  const notIn = disk.filter(f => !sw.FILES.includes(f));
  add(!notIn.length, 'sw.js: каждый js/*.js и css/*.css есть в FILES' + (notIn.length ? ' (нет: ' + notIn.join(', ') + ')' : ''));
  const si = scriptsOf(root, 'index.html'), st = ex(root, 'teacher.html') ? scriptsOf(root, 'teacher.html') : [];
  let pos = -1, orderOk = true;
  for (const s of st) { const i = si.indexOf(s, pos + 1); if (i < 0) {orderOk = false; break;} pos = i; }
  add(orderOk, 'порядок скриптов teacher.html согласован с index.html');

  /* L3 */
  let hasOrigin = false;
  try { cp.execFileSync('git', ['-C', root, 'rev-parse', '--verify', '-q', 'origin/main'], {stdio: 'pipe'}); hasOrigin = true; } catch (e) {}
  if (!hasOrigin) warns.push('git/origin/main недоступен — проверка версии кэша пропущена');
  else {
    try {
      const paths = sw.FILES.map(fileOf);
      const changed = cp.execFileSync('git', ['-C', root, 'diff', '--name-only', 'origin/main', '--'].concat(paths), {stdio: 'pipe'}).toString().split('\n').filter(Boolean);
      const old = parseSw(cp.execFileSync('git', ['-C', root, 'show', 'origin/main:sw.js'], {stdio: 'pipe'}).toString());
      const filesDiff = JSON.stringify(old.FILES) !== JSON.stringify(sw.FILES);
      const bad = (changed.length || filesDiff) && sw.V === old.V;
      add(!bad, bad ? 'изменены файлы сайта (' + (changed.join(', ') || 'список FILES') + '), а версия кэша V в sw.js не поднята' : 'версия кэша V согласована с изменениями файлов сайта');
    } catch (e) { warns.push('проверка версии кэша не удалась: ' + String(e.message).split('\n')[0]); }
  }

  /* L4 */
  const scanFiles = ['index.html', 'teacher.html', 'help.html', 'help-teacher.html', 'sw.js', 'manifest.webmanifest', 'icon.svg']
    .concat(listFiles(root, 'js', '.js'), listFiles(root, 'css', '.css'), listFiles(root, 'bench')).filter(f => ex(root, f));
  const pats = [
    ['S1 закрытый ключ', /-----BEGIN [A-Z ]*PRIVATE KEY-----/, null],
    ['S2 ссылка прокси', /\b(vless|vmess|trojan|ss):\/\//i, null],
    ['S3 IPv4', /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, m => m === '127.0.0.1' || m === '0.0.0.0'],
    ['S4 почта', /[\w.+-]+@[\w-]+(\.[\w-]+)*\.[a-z]{2,}/i, null],
    ['S5 присваивание секрета', /\b(api[_-]?key|secret|token|passw(or)?d|teacher[_-]?key|device[_-]?key|X-Key)\b\s*[:=]\s*['"`][^'"`\s]{6,}['"`]/i, null],
    ['S6 похоже на ключ', /['"`]([A-Za-z0-9_\-+\/=]{20,})['"`]/g, (m, g) => !(/[a-z]/.test(g) && /[A-Z]/.test(g) && /\d/.test(g))],
    ['S7 адрес сервера', /https?:\/\/([^\/\s'"`)<>]+)/g, (m, g) => HOSTS_OK.includes(g.replace(/:\d+$/, ''))],
    ['S8 хостинг ruvds', /ruvds/i, null]
  ];
  const secrets = [];
  for (const f of scanFiles) {
    const lines = rd(root, f).split('\n');
    lines.forEach((line, i) => {
      const allowed = ALLOW.some(a => a.file === f && a.re.test(line));
      if (/\/opt\//.test(line)) warns.push(f + ':' + (i + 1) + ' путь на сервере (/opt/) в публичном файле');
      for (const [name, re0, skip] of pats) {
        const re = new RegExp(re0.source, re0.flags.replace('g', '') + 'g'); let m;
        while ((m = re.exec(line))) {
          if (m[0] === '') {re.lastIndex++; continue;}
          if (skip && skip(m[0], m[1])) continue;
          if (allowed && /^S[1-7]/.test(name)) continue;
          secrets.push(f + ':' + (i + 1) + ' ' + name + ' «' + safe(m[1] && name.startsWith('S6') ? m[1] : m[0]) + '»');
        }
      }
    });
  }
  add(!secrets.length, 'секреты в публичных файлах (А14): не найдены' + (secrets.length ? ' — ' + secrets.join('; ') : ''));

  /* L5 */
  const jsAll = listFiles(root, 'js', '.js');
  const noNet = [/\bfetch\s*\(/, /XMLHttpRequest/, /WebSocket/, /sendBeacon/, /['"`]\/api\//, /vrlesson\.v1/, /vrlesson\.server/];
  const rules = {
    'js/data.js': [/VR\.(Store|app|ROOMS|createEngine|errors|flags)\b/, /\bdocument\./],
    'js/questions.js': [/VR\.(Store|app|ROOMS|createEngine|errors|flags)\b/, /\bdocument\./],
    'js/store.js': [/VR\.(app|ROOMS|createEngine|makeQuiz)\b/, /\bdocument\./],
    'js/engine.js': [/VR\.(app|ROOMS|makeQuiz)\b/],
    'js/rooms.js': [/VR\.app\b/], 'js/rooms2.js': [/VR\.app\b/],
    'js/schema.js': [/VR\.(Store|app|ROOMS|createEngine|flags)\b/, /localStorage/],
    'js/errors.js': [/VR\.(Store|app|ROOMS|createEngine|flags)\b/, /localStorage/],
    'js/flags.js': [/VR\.(app|ROOMS|createEngine)\b/, /localStorage/]
  };
  const layerBad = [];
  const units = [];
  for (const f of jsAll) units.push({name: f, text: rd(root, f), net: f !== 'js/store.js'});
  for (const h of ['index.html', 'teacher.html']) if (ex(root, h)) inlineScripts(root, h).forEach((t, i) => units.push({name: h + '#script' + (i + 1), text: t, net: true}));
  for (const u of units) {
    const list = (u.net ? noNet : []).concat(rules[u.name] || []);
    for (const re of list) if (re.test(u.text)) layerBad.push(u.name + ' ~ ' + re.source);
  }
  add(!layerBad.length, 'слои (А2): запрещённые зависимости не найдены' + (layerBad.length ? ' — ' + layerBad.join('; ') : ''));

  /* L6 */
  const shadowUnits = ['js/app.js', 'js/store.js', 'js/rooms.js', 'js/rooms2.js'].filter(f => ex(root, f)).map(f => ({name: f, text: rd(root, f)}));
  if (ex(root, 'teacher.html')) shadowUnits.push({name: 'teacher.html', text: inlineScripts(root, 'teacher.html').join('\n')});
  const shadow = [];
  for (const u of shadowUnits) {
    const seen = new Set();
    for (const line of u.text.split('\n')) {
      let m = /^(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/.exec(line), kind = 'f';
      if (!m) { m = /^const\s+([A-Za-z_$][\w$]*)\s*=/.exec(line); kind = 'c'; }
      if (!m || seen.has(m[1])) continue;
      seen.add(m[1]);
      const N = esc(m[1]);
      const res = [new RegExp('\\b(?:const|let|var)\\s+' + N + '\\s*=(?![=>])', 'g'),
        new RegExp('\\b(?:const|let|var)\\s+[^;]*?,\\s*' + N + '\\s*=(?![=>])', 'g'),
        new RegExp('\\b(?:const|let|var)\\s+' + N + '\\s+(?:of|in)\\b', 'g')];
      const n = res.reduce((a, r) => a + (u.text.match(r) || []).length, 0);
      if ((kind === 'f' && n >= 1) || (kind === 'c' && n >= 2)) {
        const key = u.name + ':' + m[1];
        if (!KNOWN_SHADOW.includes(key)) shadow.push(key);
      }
    }
  }
  add(!shadow.length, 'локальные переменные не затеняют общие функции' + (shadow.length ? ' — ' + shadow.join(', ') : ''));
  if (ex(root, 'teacher.html')) {
    const lines = inlineScripts(root, 'teacher.html').join('\n').split('\n');
    const at = lines.findIndex(l => l.trim() === 'if(unlocked())unlock();');
    let last = -1; lines.forEach((l, i) => { if (/^(let|const) /.test(l)) last = i; });
    add(at >= 0 && at > last, 'teacher.html: автозапуск (unlocked/unlock) стоит в конце скрипта');
  }
  if (ex(root, 'js/app.js')) {
    const lines = rd(root, 'js/app.js').split('\n');
    let at = -1, last = -1;
    lines.forEach((l, i) => { if (/document\.readyState==='loading'/.test(l) && /init\(\)/.test(l)) at = i; if (/^(let|const) /.test(l)) last = i; });
    add(at >= 0 && at > last, 'js/app.js: автозапуск init() стоит после всех let/const');
  }

  /* VR */
  let VR = null;
  try { VR = loadSite(root); } catch (e) { add(false, 'песочница: сайт не загрузился (' + String(e.message).split('\n')[0] + ')'); }
  if (VR) {
    /* L7 */
    const cur = {counts: {}, hash: {}};
    const Q = (VR.DATA || {}).Q || {};
    for (const s in Q) for (const b in Q[s]) {
      cur.counts[s + '-' + b] = Q[s][b].length;
      Q[s][b].forEach(q => { cur.hash[q.id] = sha8(q.q); });
    }
    const bp = path.join(root, 'tests', 'laws.baseline.json');
    if (!fs.existsSync(bp)) warns.push('нет tests/laws.baseline.json — проверка вопросов пропущена');
    else {
      const base = JSON.parse(fs.readFileSync(bp, 'utf8')).questions;
      const probs = [];
      for (const k in base.counts) if ((cur.counts[k] || 0) < base.counts[k]) probs.push('меньше вопросов в ' + k);
      for (const id in base.hash) {
        if (!(id in cur.hash)) probs.push('пропал ' + id);
        else if (cur.hash[id] !== base.hash[id]) probs.push('изменился текст ' + id + ' (порядок или текст вопроса изменился — id по позиции)');
      }
      add(!probs.length, 'вопросы: порядок и тексты не нарушены (А16)' + (probs.length ? ' — ' + probs.slice(0, 5).join('; ') : ''));
      const added = Object.keys(cur.hash).length - Object.keys(base.hash).length;
      if (added > 0) warns.push('добавлено ' + added + ' вопросов, обнови базу (node tests/laws.js --update-baseline, с согласия Айрата)');
    }

    /* L8 */
    const S = VR.Store || {};
    const fns = 'merge norm band reload onChange canSave students student addStudent updateStudent removeStudent classes klass className addClass removeClass studentsOf archiveStudent restoreStudent archiveClass restoreClass genPin pinHash setStudentPin checkStudentPin classStats addResult results addDiscovery discoveries best points lastActive tests test testsFor saveTest removeTest question addFeedback feedback removeFeedback settings setSettings clearResults exportJSON importJSON server setServer sync onStatus syncSoon'.split(' ');
    const lost = fns.filter(k => typeof S[k] !== 'function');
    add(!lost.length, 'контракт VR.Store: методы на месте' + (lost.length ? ' (нет: ' + lost.join(', ') + ')' : ''));
    add(Array.isArray(S.SUBJ) && S.SUBJ.length === 9 && S.SUBJ.every(x => typeof x === 'string'), 'контракт VR.Store: SUBJ — 9 строк');
    add(S.status !== null && typeof S.status === 'object', 'контракт VR.Store: status — объект');

    /* L9 */
    try {
      const F = JSON.parse(rd(root, 'tests/fixtures/legacy-v2.json'));
      const j = x => JSON.stringify(x);
      const n0 = S.norm(null);
      add(['classes', 'students', 'results', 'tests', 'feedback'].every(k => Array.isArray(n0[k])) && ['disc', 'deleted', 'settings'].every(k => n0[k] && typeof n0[k] === 'object' && !Array.isArray(n0[k])) && n0.settings.minutes === 8, 'norm(null): пустая структура, minutes=8');
      const nf = S.norm(JSON.parse(j(F)));
      add(nf.students.length === 4 && nf.classes.length === 2 && nf.results.length === 5 && nf.tests.length === 1 && nf.feedback.length === 2, 'norm(старые данные): 4 ученика, 2 класса, 5 результатов, 1 тест, 2 отзыва');
      const cnt = m => [m.students.length, m.results.length, Object.keys(m.disc.s1 || {}).length].join(',');
      const mm = S.merge(JSON.parse(j(F)), JSON.parse(j(F)));
      add(cnt(mm) === '4,4,2', 'merge(F,F): 4 ученика, 4 результата (удалённого нет), disc.s1 — 2 ключа (получено ' + cnt(mm) + ')');
      add(cnt(S.merge(JSON.parse(j(F)), {})) === cnt(mm) && cnt(S.merge({}, JSON.parse(j(F)))) === cnt(mm), 'merge: порядок аргументов не теряет данные');
      add(mm.settings.futureKey === 'keep-me', 'merge: неизвестные ключи настроек сохраняются');
      if (VR.schema) add(S.norm(null).v === VR.schema.VERSION, 'norm(null).v равна VR.schema.VERSION');
    } catch (e) { add(false, 'контракт merge/norm: исключение ' + String(e.message).split('\n')[0]); }

    /* L10 */
    const R = VR.ROOMS || {}, bad = [];
    const keys = ['hall'].concat(VR.ORDER || []);
    if (!VR.ORDER) bad.push('нет VR.ORDER');
    for (const k of keys) if (!R[k]) bad.push('нет комнаты ' + k);
    for (const k of VR.ORDER || []) {
      if (!VR.DATA.subjects || !VR.DATA.subjects[k]) bad.push('нет subjects.' + k);
      if (!VR.DATA.Q || !VR.DATA.Q[k]) bad.push('нет Q.' + k);
    }
    for (const k of keys) {
      const r = R[k]; if (!r) continue;
      const ne = v => typeof v === 'string' && v.length > 0;
      if (!ne(r.title)) bad.push(k + '.title');
      if (!ne(r.hint)) bad.push(k + '.hint');
      if (!r.env || typeof r.env !== 'object') bad.push(k + '.env');
      for (const f of ['build', 'targets', 'draw']) if (typeof r[f] !== 'function') bad.push(k + '.' + f);
      for (const f of ['update', 'onGrab', 'onRelease', 'leave']) if (r[f] !== undefined && typeof r[f] !== 'function') bad.push(k + '.' + f);
      if (r.spawn !== undefined && !(r.spawn && typeof r.spawn.x === 'number' && typeof r.spawn.z === 'number')) bad.push(k + '.spawn');
    }
    if (typeof VR.createEngine !== 'function') bad.push('VR.createEngine');
    if (typeof VR.makeQuiz !== 'function') bad.push('VR.makeQuiz');
    add(!bad.length, 'контракт комнат: все комнаты и VR.createEngine/makeQuiz в порядке' + (bad.length ? ' — ' + bad.slice(0, 8).join(', ') : ''));
  }
  return {checks, warns};
}

function updateBaseline(root) {
  const VR = loadSite(root), cur = {counts: {}, hash: {}}, Q = VR.DATA.Q;
  for (const s in Q) for (const b in Q[s]) {
    cur.counts[s + '-' + b] = Q[s][b].length;
    Q[s][b].forEach(q => { cur.hash[q.id] = sha8(q.q); });
  }
  const bp = path.join(root, 'tests', 'laws.baseline.json');
  if (fs.existsSync(bp)) {
    const base = JSON.parse(fs.readFileSync(bp, 'utf8')).questions, probs = [];
    for (const k in base.counts) if ((cur.counts[k] || 0) < base.counts[k]) probs.push('меньше вопросов в ' + k);
    for (const id in base.hash) if (!(id in cur.hash)) probs.push('пропал ' + id);
    if (probs.length) { console.log('ОТКАЗ: база не обновлена (А16): ' + probs.join('; ')); return 1; }
  }
  const out = {_comment: 'Обновлять только с согласия Айрата (А16). Вопросы: порядок не менять, новые — в конец.', questions: cur};
  fs.writeFileSync(bp, JSON.stringify(out, null, 1) + '\n');
  console.log('база вопросов записана: ' + Object.keys(cur.hash).length + ' вопросов');
  return 0;
}

module.exports = {run, loadSite, scriptsOf, readSw};

if (require.main === module) {
  const ROOT = path.join(__dirname, '..');
  if (process.argv.includes('--update-baseline')) process.exit(updateBaseline(ROOT));
  const r = run(ROOT); let fails = 0;
  for (const c of r.checks) { if (!c.ok) fails++; console.log((c.ok ? 'ok  : ' : 'FAIL: ') + c.msg); }
  for (const w of r.warns) console.log('warn: ' + w);
  process.exit(fails ? 1 : 0);
}
