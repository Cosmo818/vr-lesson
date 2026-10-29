---
type: community
cohesion: 0.08
members: 44
---

# Community 9

**Cohesion:** 0.08 - loosely connected
**Members:** 44 nodes

## Members
- [[GET apistudentme → данные из базы (класс и школа — актуальные, не из…]] - rationale - server/studev.py
- [[POST apistudentlogin (X-Student + код) → (код, тело) 200 {token, exp}; 401…]] - rationale - server/studev.py
- [[POST apistudentpair → (код, тело). Любая причина отказа — 403…]] - rationale - server/studev.py
- [[POST apistudentunpair ученик отвязывает это устройство, подтвердив своим…]] - rationale - server/studev.py
- [[_load()]] - code - server/studev.py
- [[_student_or_fail()]] - code - server/studev.py
- [[active_count()]] - code - server/studev.py
- [[admin()_3]] - code - server/studev.py
- [[can_read_student()]] - code - server/studev.py
- [[can_write_student()]] - code - server/studev.py
- [[check_pin()]] - code - server/studev.py
- [[clean_name()]] - code - server/studev.py
- [[device_by_key()_1]] - code - server/studev.py
- [[drop_sessions()]] - code - server/studev.py
- [[ein_count()]] - code - server/studev.py
- [[erase_student()]] - code - server/studev.py
- [[issue_code()]] - code - server/studev.py
- [[limit_of()]] - code - server/studev.py
- [[list_devices()]] - code - server/studev.py
- [[login()_5]] - code - server/studev.py
- [[logout()_1]] - code - server/studev.py
- [[me()_1]] - code - server/studev.py
- [[migrate_v9()]] - code - server/studev.py
- [[pair()_2]] - code - server/studev.py
- [[principal()]] - code - server/studev.py
- [[revoke()]] - code - server/studev.py
- [[revoke_all()]] - code - server/studev.py
- [[school_alive()]] - code - server/studev.py
- [[secrets]] - concept
- [[sha()_1]] - code - server/studev.py
- [[student_row()]] - code - server/studev.py
- [[studev.py]] - code - server/studev.py
- [[studev.py — привязка устройства к ученику и сеанс ученика (шаг Э1 PLAN-…]] - rationale - server/studev.py
- [[unpair_self()]] - code - server/studev.py
- [[v8 - v9 привязка устройств к ученикам, сеансы учеников, таблицы «Эйнштейна»…]] - rationale - server/studev.py
- [[Код привязки ученику 8 знаков, 15 мин, одноразовый; прежний неиспользованный…]] - rationale - server/studev.py
- [[Общая проверка кода ученика для login и unpair. → None при успехе или (код,…]] - rationale - server/studev.py
- [[Перевод в другую школу устройства отзываются (строки остаются, А15), сеансы…]] - rationale - server/studev.py
- [[Принципал ученика {'kind''student','id','school','dev'} или None. Ключ и токен…]] - rationale - server/studev.py
- [[Сеансы ученика гасятся (сброс кода входа, архив, перевод).]] - rationale - server/studev.py
- [[Сколько строк «Эйнштейна» у ученика (выданные, решения, сводка) — для счётчиков…]] - rationale - server/studev.py
- [[Стирание строк ученика (вызывает purge_erase_student в той же транзакции)…]] - rationale - server/studev.py
- [[Строка устройства по ключу или None. Действует, пока строка active, ученик…]] - rationale - server/studev.py
- [[Ученик из базы (name, grade, school, status, doc-словарь) или None.]] - rationale - server/studev.py

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Community_9
SORT file.name ASC
```

## Connections to other communities
- 5 edges to [[_COMMUNITY_Community 21]]
- 4 edges to [[_COMMUNITY_Community 27]]
- 3 edges to [[_COMMUNITY_Community 17]]
- 3 edges to [[_COMMUNITY_Community 5]]
- 3 edges to [[_COMMUNITY_Community 43]]
- 3 edges to [[_COMMUNITY_Community 7]]
- 2 edges to [[_COMMUNITY_Community 39]]
- 1 edge to [[_COMMUNITY_Community 4]]
- 1 edge to [[_COMMUNITY_Community 11]]
- 1 edge to [[_COMMUNITY_Community 20]]
- 1 edge to [[_COMMUNITY_Community 51]]
- 1 edge to [[_COMMUNITY_Community 8]]

## Top bridge nodes
- [[secrets]] - degree 20, connects to 9 communities
- [[studev.py]] - degree 36, connects to 5 communities
- [[sha()_1]] - degree 8, connects to 1 community
- [[admin()_3]] - degree 6, connects to 1 community
- [[check_pin()]] - degree 6, connects to 1 community