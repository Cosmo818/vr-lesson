# HANDOFF — ядро проекта VR-урок

Короткая выжимка для нового чата. Сначала читать этот файл, затем только модуль, с которым работаешь. Весь проект целиком читать не нужно.

## Статус
- Версия 3.1: полевой прототип (каркас), графика без текстур. Ученики тестируют и оставляют отзывы.
- Сайт: https://vrklass.ru (Caddy на Pi, `deploy/Caddyfile`, контейнер `vrklass-web`) и запасной https://cosmo818.github.io/vr-lesson/ (GitHub Pages, ветка `main`). Учителю: `teacher.html`.
- Сервер синхронизации: `server/app.py` в Docker на VPS RUVDS (`vr-lesson-api`, данные `/opt/vr-lesson-data`), сайт — Caddy `vrklass-web`. Обновление само: cron → `deploy/autoupdate.sh`. Pi — запасная копия (контейнер остановлен).
- План развития ведётся в отдельном документе (ссылка в описании репозитория или в чате проекта).
- Законы проекта: `docs/LAWS.md`; архитектура модулей, кабинеты и темы: `docs/ARCHITECTURE.md`; иерархия школы и права: `docs/ROLES.md`; конструктор комнат: `docs/ROOM_SPEC.md` (все от 21.10.2026, решения владельца внесены).
- Замер Babylon.js: страница `bench/` (https://vrklass.ru/bench/). Quest 3, VR: лёгкая сцена 89 к/с, тяжёлая 67 к/с. Замер на школьном Quest 1 ещё не сделан — от него зависит выбор библиотеки.

## Откат версии
Каждая рабочая версия сохранена отдельной веткой: `release-v1.0`, `release-v2.0`, `release-v3.0`, `release-v3.1` (теги через прокси не отправляются).
- Посмотреть: GitHub → Branches.
- Откатить сайт: `git revert` до нужной версии (история сохраняется, ничего не удаляется).
- Сервер на Pi: `cd /opt/vr-lesson-app && git fetch origin release-v3.1 && git checkout FETCH_HEAD && docker restart vr-lesson-api`.

## Карта модулей (один файл — одна ответственность)
| Файл | За что отвечает | Публичный интерфейс |
|---|---|---|
| `js/engine.js` | Рендер WebGL2, WebXR, ввод (контроллеры, мышь/клавиатура), панели с кнопками, физика предметов, тосты, меню | `VR.createEngine(canvas)` → `E` |
| `js/rooms.js` | Тест (`makeQuiz`), холл, математика, физика, химия, космос | `VR.ROOMS.*`, `VR.makeQuiz`, `VR.ORDER` |
| `js/rooms2.js` | Биология, обществознание, логика, история, галерея | `VR.ROOMS.*` |
| `js/data.js` | Материал комнат (фигуры, элементы, планеты…) | `VR.DATA` |
| `js/questions.js` | Банк вопросов, уровни a/b/c/d = 1–4/5–6/7–8/9–11 | `VR.DATA.Q`, `VR.DATA.qById` |
| `js/store.js` | Данные + синхронизация с сервером | `VR.Store` |
| `js/app.js` | Стартовый экран, сеанс ученика, таймер, меню VR, форма отзывов | `VR.app` |
| `teacher.html` | Рейтинг, ученики, конструктор тестов, сложные вопросы, отзывы, сервер | — |
| `server/app.py` | HTTP API + SQLite, ключи teacher/device | `GET /api/health`, `POST /api/sync`, `GET /api/export` |

## Контракт комнаты
```js
VR.ROOMS.id = {
  title, hint, env:{floor,wall,trim,grid,open}, spawn:{x,z},
  build(E,S){},          // создать статику, панели, предметы; S — состояние комнаты
  targets(E,S){return[]},// объекты под лучом: {c:[x,y,z], r, id, sel(hand)}
  update(E,S,dt){}, draw(E,S,add){}, onGrab(E,S,b){}, onRelease(E,S,b,speed){}
};
```
Инструменты движка для комнат: `E.addPanel({w,h,pos,yaw,draw(c,p)})` (в `draw`: `p.text`, `p.button`, `p.area`), `E.addBody`, `E.addStatic`, `E.addTable`, `E.door`, `E.discover(subj,key,label)`, `E.toast`, `E.burst`, `E.beep/chime/fanfare`, `VR.makeQuiz(E,subj,pos,yaw)`.

Чтобы добавить комнату: 1) код по контракту в `rooms2.js` или новом файле; 2) предмет в `D.subjects` и `VR.ORDER`; 3) дверь в `DOORS` холла; 4) вопросы в `questions.js`; 5) новый файл — в `index.html` и `sw.js` (поднять версию кэша); 6) тест в `tests/run.js`.

## Данные (`VR.Store`)
Состояние: `{classes, students, results, disc, tests, feedback, deleted, settings}`. У ученика `classId` и `pinHash` (код входа, PBKDF2, соль `st:<id>`). Рейтинг классов — `Store.classStats()` (байесовское среднее, K=5). Ключ шлема может только добавлять учеников, но не менять существующих. Слияние: ученики, тесты и настройки — побеждает последняя правка (`updated`); результаты, открытия и отзывы — объединение; `deleted` — список удалённого; `settings.resetAt` — граница очистки результатов. Ключ шлема не может менять тесты, настройки и удалять. Логика одинакова в `store.js` (merge) и `server/app.py` (merge_in) — правки вносить в оба места.

## Проверка
- `node tests/run.js` — около 90 проверок на имитации шлема, вместе с живым сервером (нужен python3).
- `python3 tests/e2e.py` — проверка в настоящем браузере: навигация, перезагрузка, вход учителя.
- `python3 tests/shots.py . shots` — скриншоты в Chromium (Playwright).

## Известные ограничения
- Учётки учеников — имя и класс, без почты. Регистрация по почте и согласия по 152-ФЗ — в плане развития.
- Свой движок без библиотек — каркас. Для текстур, моделей и сетевой игры план — переход на Babylon.js или three.js (см. план развития).
- Сервер: один процесс, SQLite, без rate limit, кроме задержки на неверный ключ.

Сбои и их решения — в `CHECKLIST.md`.
