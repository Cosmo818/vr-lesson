#!/bin/sh
# Raspberry Pi: забирает с VPS последнюю копию (cron раз в сутки, после ночной копии VPS) и проверяет её целостность.
# Настройки в /opt/vr-lesson-reserve/vps.conf (создаёт владелец, в репозиторий не попадает): VPS=пользователь@адрес и KEY=путь к ключу.
RB=${REMOTE_BACKUP:-/opt/vr-lesson-backup}; R=${RESERVE_DIR:-/opt/vr-lesson-reserve}; APP=${APP_DIR:-/opt/vr-lesson-app}; LOG=${SYNC_LOG:-/var/log/vr-reserve.log}
. "$R/vps.conf" || exit 1
S="ssh -i $KEY -o BatchMode=yes -o ConnectTimeout=20 -o StrictHostKeyChecking=accept-new"
fail() { echo "$(date '+%F %T') ОШИБКА: $1" >> "$LOG"; rm -f "$R"/*.part; exit 1; }
latest=$($S "$VPS" "ls -1t $RB/db-*.sqlite | head -1") || fail "нет связи с VPS"
[ -n "$latest" ] || fail "на VPS нет копий"
n=$(basename "$latest")
if [ ! -e "$R/$n" ]; then
  $S "$VPS" "cat '$latest'" > "$R/$n.part" || fail "не скачалась база"
  $S "$VPS" "cat '$latest.config' 2>/dev/null" > "$R/$n.config"
  DATA_DIR=/nonexistent python3 "$APP/server/app.py" check "$R/$n.part" >> "$LOG" 2>&1 || fail "копия базы не прошла проверку"
  mv "$R/$n.part" "$R/$n"
fi
up=$($S "$VPS" "ls -1t $RB/uploads-*.tgz 2>/dev/null | head -1")
if [ -n "$up" ] && [ ! -e "$R/$(basename "$up")" ]; then
  $S "$VPS" "cat '$up'" > "$R/$(basename "$up").part" || fail "не скачался архив файлов"
  mv "$R/$(basename "$up").part" "$R/$(basename "$up")"
fi
ls -1t "$R"/db-*.sqlite 2>/dev/null | tail -n +8 | while read -r x; do rm -f "$x" "$x.config"; done
ls -1t "$R"/uploads-*.tgz 2>/dev/null | tail -n +8 | while read -r x; do rm -f "$x"; done
echo "$(date '+%F %T') получена копия $n" >> "$LOG"
