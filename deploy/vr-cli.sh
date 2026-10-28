#!/bin/sh
# Команды сервера (hub-secret, hub-setup, net on|off, create-superadmin …) без знания, куда смонтирован код в vr-lesson-api:
# временный контейнер того же образа, код /opt/vr-lesson-app (только чтение), данные /opt/vr-lesson-data. Пример: sh /opt/vr-lesson-app/deploy/vr-cli.sh hub-secret
IMG=$(docker inspect -f '{{.Config.Image}}' vr-lesson-api) || { echo 'нет контейнера vr-lesson-api'; exit 1; }
exec docker run --rm -i -v /opt/vr-lesson-app:/app:ro -v /opt/vr-lesson-data:/data -e DATA_DIR=/data "$IMG" python3 /app/server/app.py "$@"
