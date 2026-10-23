# Community 31

> 9 nodes · cohesion 0.25

## Key Concepts

- **purge_exec()** (12 connections) — `server/app.py`
- **purge_erase_student()** (6 connections) — `server/app.py`
- **purge_run()** (6 connections) — `server/app.py`
- **failed()** (3 connections) — `server/app.py`
- **purge_hard()** (3 connections) — `server/app.py`
- **shutil** (2 connections)
- **Стирает ученика и всё его: результаты, открытия, корзину результатов; в отзывах…** (1 connections) — `server/app.py`
- **Само стирание: вызывать под lock в одной транзакции (исключение -> откат).…** (1 connections) — `server/app.py`
- **POST /api/admin/purge после проверки прав и пароля. Под lock: разбор ->…** (1 connections) — `server/app.py`

## Relationships

- [Community 6](Community_6.md) (6 shared connections)
- [Community 8](Community_8.md) (4 shared connections)
- [Community 11](Community_11.md) (3 shared connections)
- [Community 23](Community_23.md) (2 shared connections)
- [Community 13](Community_13.md) (1 shared connections)
- [Community 4](Community_4.md) (1 shared connections)

## Source Files

- `server/app.py`

## Audit Trail

- EXTRACTED: 26 (100%)
- INFERRED: 0 (0%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*