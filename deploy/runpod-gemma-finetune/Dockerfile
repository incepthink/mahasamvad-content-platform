# Training image for the DGIPR article adapter.
#
# This is for an ON-DEMAND POD, not a serverless worker: training is a persistent process with
# a persistent optimiser state, and a serverless worker is killed between requests. There is no
# handler and no start.sh here for that reason — the entry point is a shell.
#
# The base only has to be a CUDA 12.4+ devel image carrying torch 2.5+. RunPod's own PyTorch
# pod template satisfies that too, in which case this image is optional: clone the repo on the
# pod and `pip install -r requirements.txt` instead. See README.md.
ARG BASE_IMAGE=pytorch/pytorch:2.6.0-cuda12.4-cudnn9-devel
FROM ${BASE_IMAGE}

WORKDIR /app

# git is what huggingface_hub uses for large-file transfer; the rest is build headroom for
# bitsandbytes on an image that ships no compiler.
RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY train.py /app/train.py
# Phase 0.4's tokenizer-side probe, run once on the box as a cross-check. train.py does not
# depend on its answer — it masks by hand — but a disagreement is worth seeing.
COPY check_chat_template.py /app/check_chat_template.py

# The self-test is free, offline and needs no GPU, so it runs at build time: an image that
# cannot pass it is broken before it is ever rented.
RUN python /app/train.py --self-test

ENV PYTHONUNBUFFERED=1 \
    HF_HOME=/workspace/huggingface-cache \
    HF_HUB_ENABLE_HF_TRANSFER=0 \
    TOKENIZERS_PARALLELISM=false

# No CMD that trains. A run must name its own dataset directory and its own output, and an
# image that starts spending GPU-hours the moment the pod boots is the wrong default.
CMD ["/bin/bash"]
