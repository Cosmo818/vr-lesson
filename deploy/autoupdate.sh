#!/bin/sh
# Автообновление VR-урока на VPS (cron раз в 2 минуты): забирает main с GitHub.
# Сайт обновляется сразу; изменился server/ — перезапуск API; изменился Caddyfile — перечитать Caddy.
# Hub (живые уроки) перезапускается только без идущих уроков (sessions = 0), иначе — отметка и повтор при следующем запуске cron.
LOG=/var/log/vr-autoupdate.log
PEND=/opt/vr-lesson-data/.hub-restart-pending
cd /opt/vr-lesson-app || exit 1
hub_try() {
	docker inspect vr-lesson-hub >/dev/null 2>&1 || { rm -f "$PEND"; return; }
	h=$(docker exec vr-lesson-hub wget -qO- -T 3 http://127.0.0.1:8788/health 2>/dev/null)
	if [ -n "$h" ] && ! echo "$h" | grep -q '"sessions": 0[,}]'; then
		[ -f "$PEND" ] || echo "$(date '+%F %T') hub: идут уроки, перезапуск отложен" >> $LOG
		touch "$PEND"; return
	fi
	docker restart vr-lesson-hub >/dev/null && rm -f "$PEND" && echo "$(date '+%F %T') hub перезапущен" >> $LOG
}
[ -f "$PEND" ] && hub_try
old=$(git rev-parse HEAD)
git fetch -q origin main || exit 0
new=$(git rev-parse origin/main)
[ "$old" = "$new" ] && exit 0
if ! git merge --ff-only -q origin/main; then echo "$(date '+%F %T') ОШИБКА: не fast-forward, нужна ручная проверка" >> $LOG; exit 1; fi
ch=$(git diff --name-only "$old" "$new")
echo "$ch" | grep -q '^server/' && docker restart vr-lesson-api >/dev/null
echo "$ch" | grep -q '^server/\(hub\|netproto\)' && hub_try
echo "$ch" | grep -q '^deploy/Caddyfile' && docker exec vrklass-web caddy reload --config /etc/caddy/Caddyfile >/dev/null 2>&1
echo "$(date '+%F %T') $old -> $new" >> $LOG
