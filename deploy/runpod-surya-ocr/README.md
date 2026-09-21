# Surya OCR 2 on RunPod Serverless

## Deployed endpoint

- Endpoint: `surya-ocr-2`
- Endpoint ID: `8htzs2fu2qqqao`
- Model: `datalab-to/surya-ocr-2`
- Worker: RunPod's pinned `worker-vllm` release `v2.27.0`
- GPU pool: `AMPERE_24`, one GPU per worker
- Autoscaling: minimum `0`, maximum `1`, 300-second idle timeout
- Price observed at deployment: `$0.69/GPU-hour` while a worker is active

The endpoint exposes the OpenAI-compatible API at:

```text
https://api.runpod.ai/v2/8htzs2fu2qqqao/openai/v1
```

Authenticate with `RUNPOD_API_KEY`. Do not put the key in source control or a
browser bundle.

## Image request

Surya's prompt wording is part of its model contract. Use block mode when only
HTML/text is needed:

```python
import base64
import os
from openai import OpenAI

client = OpenAI(
    api_key=os.environ["RUNPOD_API_KEY"],
    base_url="https://api.runpod.ai/v2/8htzs2fu2qqqao/openai/v1",
)

with open("page.png", "rb") as source:
    image = base64.b64encode(source.read()).decode("ascii")

response = client.chat.completions.create(
    model="datalab-to/surya-ocr-2",
    messages=[
        {
            "role": "user",
            "content": [
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:image/png;base64,{image}"},
                },
                {"type": "text", "text": "OCR this block image to HTML."},
            ],
        }
    ],
    temperature=0,
    top_p=0.1,
    max_tokens=8192,
)

print(response.choices[0].message.content)
```

For page layout and normalized bounding boxes, replace the prompt with exactly:

```text
OCR this image to HTML. Each block is a div with data-label and data-bbox (x0 y0 x1 y1, normalized 0-1000).
```

Prefer inline data URLs or application-controlled object-storage URLs. Arbitrary
remote hosts can rate-limit worker downloads, and private documents should only
be sent after the application's data-handling policy permits RunPod processing.

Convert PDFs to page images before calling the official endpoint. The optional
custom worker in this directory adds PDF rendering plus URL validation when a
single-call PDF API is required.

## Reproducing the official-worker deployment

Deploy RunPod Hub repository `runpod-workers/worker-vllm` release `v2.27.0` with
these environment variables:

```text
MODEL_NAME=datalab-to/surya-ocr-2
OPENAI_SERVED_MODEL_NAME_OVERRIDE=datalab-to/surya-ocr-2
DTYPE=bfloat16
MAX_MODEL_LEN=18000
MAX_NUM_SEQS=8
MAX_NUM_BATCHED_TOKENS=4096
GPU_MEMORY_UTILIZATION=0.90
ENABLE_PREFIX_CACHING=true
MAX_CONCURRENCY=4
MM_PROCESSOR_KWARGS={"min_pixels":3136,"max_pixels":6291456}
```

The first request is a cold start and should use an asynchronous job or a client
retry strategy. Warm test inference completed in under two seconds during setup.

## Optional custom PDF worker

The included `Dockerfile`, `start.sh`, and `handler.py` are not used by the live
endpoint above. They provide a stricter queue-worker API that accepts one HTTPS
URL or base64 file, renders PDFs, and returns per-page structured output. If this
variant is needed, publish an immutable Linux AMD64 tag:

```bash
docker build --platform=linux/amd64 -t USER/surya-ocr-runpod:v1.0.0 .
docker push USER/surya-ocr-runpod:v1.0.0
```

Set `ALLOWED_SOURCE_HOSTS` in production and retain minimum workers `0`.

## License check

Surya's source code is Apache-2.0, but the published model weights use a modified
OpenRAIL license. Confirm that the deploying organization satisfies the model's
commercial-use terms before processing production government documents.
