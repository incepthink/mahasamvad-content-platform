FROM vllm/vllm-openai:v0.20.1

ENTRYPOINT []
WORKDIR /app

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY handler.py /app/handler.py
COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh

ENV PYTHONUNBUFFERED=1 \
    HF_HOME=/runpod-volume/huggingface-cache \
    SURYA_MODEL_CHECKPOINT=datalab-to/surya-ocr-2 \
    SURYA_INFERENCE_BACKEND=vllm \
    SURYA_INFERENCE_URL=http://127.0.0.1:8000/v1 \
    SURYA_INFERENCE_AUTOSTART=false \
    SURYA_INFERENCE_PARALLEL=4 \
    MAX_FILE_BYTES=52428800 \
    MAX_PAGES=20 \
    PDF_DPI=192 \
    MAX_IMAGE_WIDTH=2048

CMD ["/app/start.sh"]

