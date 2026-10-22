#!/bin/sh
# Ночная копия VR-урока на VPS (cron раз в сутки). Согласованный снимок базы без остановки сервера + архив загруженных файлов.
# Хранит 14 последних копий; удаляет только свои файлы db-*.sqlite, db-*.sqlite.config и uploads-*.tgz в папке копий.
D=${DATA_DIR:-/opt/vr-lesson-data}; B=${BACKUP_DIR:-/opt/vr-lesson-backup}; APP=${APP_DIR:-/opt/vr-lesson-app}; LOG=${BACKUP_LOG:-/var/log/vr-backup.log}
mkdir -p "$B" || exit 1
f="$B/db-$(date +%F).sqlite"; [ -e "$f" ] && f="$B/db-$(date +%F-%H%M).sqlite"
if DATA_DIR="$D" python3 "$APP/server/app.py" backup "$f" >> "$LOG" 2>&1; then
  [ -d "$D/uploads" ] && tar -C "$D" -czf "$B/uploads-$(date +%F).tgz" uploads 2>> "$LOG"
  ls -1t "$B"/db-*.sqlite 2>/dev/null | tail -n +15 | while read -r x; do rm -f "$x" "$x.config"; done
  ls -1t "$B"/uploads-*.tgz 2>/dev/null | tail -n +15 | while read -r x; do rm -f "$x"; done
  echo "$(date '+%F %T') копия $f" >> "$LOG"
else
  echo "$(date '+%F %T') ОШИБКА копии" >> "$LOG"; exit 1
fi
