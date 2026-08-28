FROM nvidia/cuda:12.1.1-cudnn8-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive PIP_NO_CACHE_DIR=1 PYTHONUNBUFFERED=1
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.10 python3-pip python3-dev git ffmpeg build-essential ninja-build \
    && rm -rf /var/lib/apt/lists/*
RUN ln -sf /usr/bin/python3.10 /usr/local/bin/python

WORKDIR /opt
RUN git clone --depth 1 https://github.com/MeiGen-AI/InfiniteTalk.git
WORKDIR /opt/InfiniteTalk
RUN pip install torch==2.4.1 torchvision==0.19.1 torchaudio==2.4.1 --index-url https://download.pytorch.org/whl/cu121 \
    && pip install xformers==0.0.28.post1 --index-url https://download.pytorch.org/whl/cu121 \
    && pip install -r requirements.txt \
    && pip install misaki[en] ninja psutil packaging wheel

COPY requirements.txt /tmp/api-requirements.txt
RUN pip install -r /tmp/api-requirements.txt
COPY api.py /opt/worker/api.py

ENV INFINITETALK_ROOT=/opt/InfiniteTalk INFINITETALK_DATA=/data/infinitetalk
VOLUME ["/opt/InfiniteTalk/weights", "/data/infinitetalk"]
EXPOSE 8080
CMD ["uvicorn", "worker.api:app", "--app-dir", "/opt", "--host", "0.0.0.0", "--port", "8080"]
