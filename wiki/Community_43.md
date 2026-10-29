# Community 43

> 18 nodes · cohesion 0.18

## Key Concepts

- **hubticket.py** (23 connections) — `server/hubticket.py`
- **hmac** (18 connections)
- **re** (16 connections)
- **make_ticket()** (7 connections) — `server/hubticket.py`
- **verify_ticket()** (5 connections) — `server/hubticket.py`
- **secret_bytes()** (4 connections) — `server/hubticket.py`
- **sign_report()** (4 connections) — `server/hubticket.py`
- **unb64u()** (4 connections) — `server/hubticket.py`
- **b64u()** (3 connections) — `server/hubticket.py`
- **check_report()** (3 connections) — `server/hubticket.py`
- **derive()** (3 connections) — `server/hubticket.py`
- **binascii** (1 connections)
- **prune_used()** (1 connections) — `server/hubticket.py`
- **hubticket.py — билеты входа в живой урок и подпись отчётов hub (PLAN-network.md…** (1 connections) — `server/hubticket.py`
- **Подпись отчёта hub → app.py: hex HMAC-SHA256 тела (bytes).** (1 connections) — `server/hubticket.py`
- **hubSecret из config.json: hex (64 знака) или base64; меньше 32 байт — ошибка.** (1 connections) — `server/hubticket.py`
- **p — поля билета без exp/j/v (их ставит функция). Возвращает строку билета.** (1 connections) — `server/hubticket.py`
- **→ dict билета или None. used — dict j→exp одноразовых меток (функция дописывает…** (1 connections) — `server/hubticket.py`

## Relationships

- [Community 17](Community_17.md) (6 shared connections)
- [Community 8](Community_8.md) (5 shared connections)
- [Community 7](Community_7.md) (5 shared connections)
- [Community 27](Community_27.md) (5 shared connections)
- [Community 29](Community_29.md) (4 shared connections)
- [Community 9](Community_9.md) (3 shared connections)
- [Community 21](Community_21.md) (3 shared connections)
- [Community 20](Community_20.md) (2 shared connections)
- [Community 11](Community_11.md) (2 shared connections)
- [Community 39](Community_39.md) (2 shared connections)
- [Community 15](Community_15.md) (2 shared connections)
- [Community 42](Community_42.md) (2 shared connections)

## Source Files

- `server/hubticket.py`

## Audit Trail

- EXTRACTED: 70 (100%)
- INFERRED: 0 (0%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*