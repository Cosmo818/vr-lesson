#!/bin/sh
# Запуск (или пересоздание) контейнера hub — живые уроки по WebSocket — рядом с vr-lesson-api на VPS.
# Тот же образ и та же сеть, что у API; код и данные только для чтения. Нужны в config.json: hubSecret, hubOrigins, hubUrl
# (их ставят: python3 /app/server/app.py hub-secret и hub-setup <домен>). Флаг net (выдача билетов) включается отдельно: net on.
APP=/opt/vr-lesson-app
DATA=/opt/vr-lesson-data
IMG=$(docker inspect -f '{{.Config.Image}}' vr-lesson-api) || { echo 'нет контейнера vr-lesson-api'; exit 1; }
NET=$(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' vr-lesson-api | awk '{print $1}')
docker rm -f vr-lesson-hub >/dev/null 2>&1
docker run -d --name vr-lesson-hub --restart unless-stopped --network "$NET" \
	-v "$APP":/app:ro -v "$DATA":/data:ro "$IMG" \
	python3 /app/server/hub.py --host 0.0.0.0 --port 8788 --config /data/config.json >/dev/null || exit 1
sleep 2
docker exec vr-lesson-hub wget -qO- -T 3 http://127.0.0.1:8788/health && echo || { echo 'hub не отвечает:'; docker logs --tail 5 vr-lesson-hub; exit 1; }
