#!/usr/bin/env bash
set -Eeuo pipefail

MODEL_ID="${SURYA_MODEL_CHECKPOINT:-datalab-to/surya-ocr-2}"
VLLM_DTYPE="${VLLM_DTYPE:-bfloat16}"
VLLM_MAX_MODEL_LEN="${VLLM_MAX_MODEL_LEN:-18000}"
VLLM_MAX_NUM_SEQS="${VLLM_MAX_NUM_SEQS:-8}"
VLLM_MAX_BATCHED_TOKENS="${VLLM_MAX_BATCHED_TOKENS:-4096}"
VLLM_GPU_MEMORY_UTILIZATION="${VLLM_GPU_MEMORY_UTILIZATION:-0.90}"

mkdir -p "${HF_HOME:-/runpod-volume/huggingface-cache}"

vllm serve "${MODEL_ID}" \
  --host 127.0.0.1 \
  --port 8000 \
  --dtype "${VLLM_DTYPE}" \
  --max-model-len "${VLLM_MAX_MODEL_LEN}" \
  --max-num-seqs "${VLLM_MAX_NUM_SEQS}" \
  --max-num-batched-tokens "${VLLM_MAX_BATCHED_TOKENS}" \
  --gpu-memory-utilization "${VLLM_GPU_MEMORY_UTILIZATION}" \
  --enable-prefix-caching \
  --mm-processor-kwargs '{"min_pixels":3136,"max_pixels":6291456}' \
  --served-model-name "${MODEL_ID}" &

VLLM_PID=$!

cleanup() {
  kill "${VLLM_PID}" 2>/dev/null || true
}
trap cleanup EXIT TERM INT

echo "Waiting for vLLM on http://127.0.0.1:8000 ..."
READY=0
for _ in $(seq 1 600); do
  if ! kill -0 "${VLLM_PID}" 2>/dev/null; then
    echo "vLLM exited before becoming ready"
    wait "${VLLM_PID}"
    exit 1
  fi

  if python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=2).read()" >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 1
done

if [ "${READY}" -ne 1 ]; then
  echo "vLLM did not become ready within 10 minutes"
  exit 1
fi

echo "vLLM is ready; starting the RunPod worker"
python -u /app/handler.py

