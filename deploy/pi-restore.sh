#!/bin/sh
# Raspberry Pi: аварийный запуск из последней копии, когда VPS недоступен. Запускать вручную.
# Старую базу Pi не удаляет, а откладывает рядом с пометкой времени.
R=${RESERVE_DIR:-/opt/vr-lesson-reserve}; D=${DATA_DIR:-/opt/vr-lesson-data}; T=$(date +%F-%H%M)
db=$(ls -1t "$R"/db-*.sqlite 2>/dev/null | head -1); [ -n "$db" ] || { echo "Копий нет в $R"; exit 1; }
echo "Копия: $db"
docker stop vr-lesson-api >/dev/null 2>&1
mkdir -p "$D"
for x in vrlesson.db vrlesson.db-wal vrlesson.db-shm; do [ -e "$D/$x" ] && mv "$D/$x" "$D/$x.до-восстановления-$T"; done
cp "$db" "$D/vrlesson.db" && { [ -s "$db.config" ] && cp "$db.config" "$D/config.json"; }
up=$(ls -1t "$R"/uploads-*.tgz 2>/dev/null | head -1)
if [ -n "$up" ]; then [ -d "$D/uploads" ] && mv "$D/uploads" "$D/uploads.до-восстановления-$T"; tar -C "$D" -xzf "$up"; fi
docker start vr-lesson-api && sleep 2 && wget -qO- http://127.0.0.1:8787/api/health; echo
