# AI-Scientist — контейнер для запуска и работы с пайплайном.
# Сборка:  docker compose build
# Запуск:  docker compose run --rm scientist
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    AISC_INTERACTIVE=auto

# LaTeX (pdflatex/bibtex/chktex) для writeup, git для aider, nano для редактора шаблонов.
RUN apt-get update && apt-get install -y --no-install-recommends \
        git nano less procps build-essential curl \
        texlive-latex-base texlive-latex-recommended texlive-latex-extra \
        texlive-fonts-recommended texlive-bibtex-extra chktex \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# CPU-torch отдельно (в разы меньше CUDA-версии из PyPI по умолчанию).
# Для GPU-варианта: docker build --build-arg TORCH_INDEX=https://download.pytorch.org/whl/cu124
ARG TORCH_INDEX=https://download.pytorch.org/whl/cpu
RUN pip install --no-cache-dir torch --index-url ${TORCH_INDEX}

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Тесты и dev-инструменты
COPY requirements-dev.txt .
RUN pip install --no-cache-dir -r requirements-dev.txt

COPY . .

# По умолчанию — TUI. CLI-режим:
#   docker compose run --rm scientist run --template nanoGPT_lite --stages ideas
ENTRYPOINT ["python", "-m", "ai_scientist.console.cli"]
