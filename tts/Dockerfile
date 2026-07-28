FROM python:3.11-slim

WORKDIR /app

RUN pip install --no-cache-dir \
    "kokoro>=0.9.4" \
    soundfile \
    fastapi \
    uvicorn \
    httpx \
    ipython
RUN apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends espeak-ng && \
    rm -rf /var/lib/apt/lists/*
RUN --mount=type=cache,target=/root/.cache/huggingface \
    python -c "from kokoro import KPipeline; KPipeline(lang_code='a')"

ENV HF_HOME=/cache/huggingface
RUN mkdir -p /cache/huggingface

COPY main.py /app/main.py

EXPOSE 5001

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "5001"]
