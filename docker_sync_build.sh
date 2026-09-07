#!/bin/bash
# Синхронизирует проект из WSL в Windows-папку и собирает Docker-образ.
# Docker Desktop (docker.exe) не читает пути \\wsl$, поэтому сборка идёт из C:\Users\leks\AI-Scientist.
set -e
SRC_PARENT=/home/leks
DST_PARENT=/mnt/c/Users/leks
DST=$DST_PARENT/AI-Scientist

mkdir -p "$DST_PARENT"
# Чистая перезаливка, чтобы в контексте сборки не осталось устаревших файлов.
rm -rf "$DST"
# tar может увидеть меняющиеся файлы (логи/кэш) — это не ошибка синхронизации.
tar -C "$SRC_PARENT" -cf - \
    --exclude='AI-Scientist/.git' \
    --exclude='AI-Scientist/results' \
    --exclude='AI-Scientist/miniconda' \
    --exclude='__pycache__' \
    --exclude='*.pyc' \
    --exclude='*.log' \
    --warning=no-file-changed \
    AI-Scientist | tar -C "$DST_PARENT" -xf - || [ $? -eq 1 ]

test -f "$DST/docker-compose.yml" || { echo "ОШИБКА: $DST/docker-compose.yml не на месте"; exit 1; }

cd "$DST"
docker.exe compose build "$@"
echo
echo "Готово. Работа из Windows-папки $DST:"
echo "  docker.exe compose run --rm scientist                       # меню"
echo "  docker.exe compose run --rm scientist run --template nanoGPT_lite --stages ideas"
