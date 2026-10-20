#!/bin/sh
# Автообновление VR-урока на VPS (cron раз в 2 минуты): забирает main с GitHub.
# Сайт обновляется сразу; изменился server/ — перезапуск API; изменился Caddyfile — перечитать Caddy.
LOG=/var/log/vr-autoupdate.log
cd /opt/vr-lesson-app || exit 1
old=$(git rev-parse HEAD)
git fetch -q origin main || exit 0
new=$(git rev-parse origin/main)
[ "$old" = "$new" ] && exit 0
if ! git merge --ff-only -q origin/main; then echo "$(date '+%F %T') ОШИБКА: не fast-forward, нужна ручная проверка" >> $LOG; exit 1; fi
ch=$(git diff --name-only "$old" "$new")
echo "$ch" | grep -q '^server/' && docker restart vr-lesson-api >/dev/null
echo "$ch" | grep -q '^deploy/Caddyfile' && docker exec vrklass-web caddy reload --config /etc/caddy/Caddyfile >/dev/null 2>&1
echo "$(date '+%F %T') $old -> $new" >> $LOG
