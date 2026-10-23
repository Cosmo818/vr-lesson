---
type: community
cohesion: 0.12
members: 30
---

# Community 11

**Cohesion:** 0.12 - loosely connected
**Members:** 30 nodes

## Members
- [[dot-code_gate()]] - code - server/app.py
- [[dot-do_activate()]] - code - server/app.py
- [[dot-do_login()]] - code - server/app.py
- [[dot-do_pair()]] - code - server/app.py
- [[audit()]] - code - server/app.py
- [[cli()]] - code - server/app.py
- [[device_by_key()]] - code - server/app.py
- [[dummy_hash()]] - code - server/app.py
- [[hash_pw()]] - code - server/app.py
- [[pw_error()]] - code - server/app.py
- [[register_fail()]] - code - server/app.py
- [[role_add()]] - code - server/app.py
- [[scope_alive()]] - code - server/app.py
- [[session_start()]] - code - server/app.py
- [[set_password()]] - code - server/app.py
- [[thash()]] - code - server/app.py
- [[throttle()]] - code - server/app.py
- [[time]] - concept
- [[user_create()]] - code - server/app.py
- [[user_roles()]] - code - server/app.py
- [[Активация приглашения (новый учительдиректор код + логин + пароль) или кода…]] - rationale - server/app.py
- [[Есть ли куда выдавать роль для администратора области — хотя бы одна школа в…]] - rationale - server/app.py
- [[Ключ шлема школы (выдан по коду привязки) ищем по sha256, действует только…]] - rationale - server/app.py
- [[Команды суперадмина на сервере пароль только через getpass (не в аргументах,…]] - rationale - server/app.py
- [[Общая защита публичных «кодовых» входов лимит по IP и пауза после ошибок.…]] - rationale - server/app.py
- [[Пауза после ошибок и лимит по IP (PLAN 4). Возвращает секунды ожидания или 0.…]] - rationale - server/app.py
- [[Правила пароля (PLAN 1.3) 10–128 символов, не равен логину, не из списка…]] - rationale - server/app.py
- [[Привязка шлема по короткому коду выдаёт ключ шлема школы один раз. Лимит школы…]] - rationale - server/app.py
- [[Создать пользователя (без ролей). Бросает ValueError с понятным текстом. В…]] - rationale - server/app.py
- [[Строка в журнал аудита в той же транзакции, что и изменение (А13). Только…]] - rationale - server/app.py

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Community_11
SORT file.name ASC
```

## Connections to other communities
- 35 edges to [[_COMMUNITY_Community 8]]
- 28 edges to [[_COMMUNITY_Community 6]]
- 10 edges to [[_COMMUNITY_Community 4]]
- 7 edges to [[_COMMUNITY_Community 23]]
- 4 edges to [[_COMMUNITY_Community 15]]
- 4 edges to [[_COMMUNITY_Community 19]]
- 3 edges to [[_COMMUNITY_Community 31]]
- 3 edges to [[_COMMUNITY_Community 9]]
- 3 edges to [[_COMMUNITY_Community 20]]
- 2 edges to [[_COMMUNITY_Community 12]]
- 2 edges to [[_COMMUNITY_Community 21]]
- 2 edges to [[_COMMUNITY_Community 26]]
- 2 edges to [[_COMMUNITY_Community 27]]
- 1 edge to [[_COMMUNITY_Community 13]]
- 1 edge to [[_COMMUNITY_Community 32]]
- 1 edge to [[_COMMUNITY_Community 35]]
- 1 edge to [[_COMMUNITY_Community 36]]

## Top bridge nodes
- [[time]] - degree 35, connects to 14 communities
- [[audit()]] - degree 22, connects to 6 communities
- [[cli()]] - degree 15, connects to 4 communities
- [[thash()]] - degree 9, connects to 3 communities
- [[set_password()]] - degree 8, connects to 3 communities