"""RunPod Serverless handler for Surya 2 OCR.

The worker accepts either a short-lived HTTPS URL or base64-encoded bytes and
returns page text plus Surya's structured block output.
"""

from __future__ import annotations

import base64
import binascii
import io
import ipaddress
import os
import socket
from importlib.metadata import version
from urllib.parse import urljoin, urlparse

import pypdfium2 as pdfium
import requests
import runpod
from bs4 import BeautifulSoup
from PIL import Image, ImageOps
from surya.inference import SuryaInferenceManager
from surya.recognition import RecognitionPredictor


MAX_FILE_BYTES = int(os.getenv("MAX_FILE_BYTES", str(50 * 1024 * 1024)))
DEFAULT_MAX_PAGES = int(os.getenv("MAX_PAGES", "20"))
DEFAULT_DPI = int(os.getenv("PDF_DPI", "192"))
MAX_IMAGE_WIDTH = int(os.getenv("MAX_IMAGE_WIDTH", "2048"))
ALLOWED_SOURCE_HOSTS = {
    host.strip().lower()
    for host in os.getenv("ALLOWED_SOURCE_HOSTS", "").split(",")
    if host.strip()
}

Image.MAX_IMAGE_PIXELS = 40_000_000

HTTP = requests.Session()
MANAGER = SuryaInferenceManager()
PREDICTOR = RecognitionPredictor(MANAGER)


def _validate_source_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.hostname:
        raise ValueError("url must be an absolute HTTPS URL")

    hostname = parsed.hostname.lower()
    if ALLOWED_SOURCE_HOSTS and hostname not in ALLOWED_SOURCE_HOSTS:
        raise ValueError("url hostname is not in ALLOWED_SOURCE_HOSTS")

    try:
        addresses = socket.getaddrinfo(hostname, 443, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise ValueError("url hostname could not be resolved") from exc

    for address in addresses:
        ip = ipaddress.ip_address(address[4][0])
        if not ip.is_global:
            raise ValueError("url must not resolve to a private or reserved address")


def _download_file(url: str) -> bytes:
    current_url = url

    for redirect_count in range(4):
        _validate_source_url(current_url)
        with HTTP.get(
            current_url,
            stream=True,
            timeout=(10, 120),
            allow_redirects=False,
        ) as response:
            if response.is_redirect or response.is_permanent_redirect:
                if redirect_count == 3:
                    raise ValueError("url redirected too many times")
                location = response.headers.get("location")
                if not location:
                    raise ValueError("url returned a redirect without a location")
                current_url = urljoin(current_url, location)
                continue

            response.raise_for_status()
            content_length = int(response.headers.get("content-length", "0"))
            if content_length > MAX_FILE_BYTES:
                raise ValueError("file exceeds the configured size limit")

            content = bytearray()
            for chunk in response.iter_content(chunk_size=1024 * 1024):
                content.extend(chunk)
                if len(content) > MAX_FILE_BYTES:
                    raise ValueError("file exceeds the configured size limit")
            return bytes(content)

    raise ValueError("url could not be downloaded")


def _load_input(job_input: dict) -> bytes:
    url = job_input.get("url")
    encoded = job_input.get("base64")

    if bool(url) == bool(encoded):
        raise ValueError("provide exactly one of input.url or input.base64")

    if url:
        if not isinstance(url, str):
            raise ValueError("url must be a string")
        return _download_file(url)

    if not isinstance(encoded, str):
        raise ValueError("base64 must be a string")
    if "," in encoded:
        encoded = encoded.split(",", 1)[1]

    try:
        raw = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError("base64 is invalid") from exc

    if len(raw) > MAX_FILE_BYTES:
        raise ValueError("file exceeds the configured size limit")
    return raw


def _normalize_image(image: Image.Image) -> Image.Image:
    image = ImageOps.exif_transpose(image).convert("RGB")
    if image.width > MAX_IMAGE_WIDTH:
        new_height = round(image.height * (MAX_IMAGE_WIDTH / image.width))
        image = image.resize(
            (MAX_IMAGE_WIDTH, new_height), Image.Resampling.LANCZOS
        )
    return image


def _load_pages(raw: bytes, max_pages: int, dpi: int) -> list[Image.Image]:
    if raw.startswith(b"%PDF-"):
        document = pdfium.PdfDocument(raw)
        page_count = len(document)
        if page_count > max_pages:
            document.close()
            raise ValueError(
                f"PDF has {page_count} pages; maximum allowed is {max_pages}"
            )

        images: list[Image.Image] = []
        scale = dpi / 72
        try:
            for index in range(page_count):
                page = document[index]
                bitmap = page.render(scale=scale)
                try:
                    image = bitmap.to_pil().convert("RGB").copy()
                    images.append(_normalize_image(image))
                finally:
                    bitmap.close()
                    page.close()
        finally:
            document.close()
        return images

    try:
        image = Image.open(io.BytesIO(raw))
        image.load()
        return [_normalize_image(image)]
    except Exception as exc:
        raise ValueError("input is not a readable PDF or image") from exc


def _plain_text(page: dict) -> str:
    parts: list[str] = []
    for block in page.get("blocks", []):
        html = block.get("html") or ""
        if html:
            text = BeautifulSoup(html, "html.parser").get_text("\n", strip=True)
            if text:
                parts.append(text)
    return "\n\n".join(parts)


def handler(event: dict) -> dict:
    job_input = event.get("input") or {}
    if not isinstance(job_input, dict):
        raise ValueError("input must be an object")

    max_pages = int(job_input.get("max_pages", DEFAULT_MAX_PAGES))
    dpi = int(job_input.get("dpi", DEFAULT_DPI))
    include_blocks = bool(job_input.get("include_blocks", True))

    if not 1 <= max_pages <= 50:
        raise ValueError("max_pages must be between 1 and 50")
    if not 72 <= dpi <= 300:
        raise ValueError("dpi must be between 72 and 300")

    raw = _load_input(job_input)
    images = _load_pages(raw, max_pages=max_pages, dpi=dpi)

    try:
        predictions = PREDICTOR(images, full_page=True)
        pages = []
        for page_number, prediction in enumerate(predictions, start=1):
            structured = prediction.model_dump(mode="json")
            page = {
                "page": page_number,
                "text": _plain_text(structured),
                "image_bbox": structured.get("image_bbox"),
            }
            if include_blocks:
                page["blocks"] = structured.get("blocks", [])
            pages.append(page)

        return {
            "model": "datalab-to/surya-ocr-2",
            "surya_version": version("surya-ocr"),
            "page_count": len(pages),
            "text": "\n\n".join(page["text"] for page in pages),
            "pages": pages,
        }
    finally:
        for image in images:
            image.close()


if __name__ == "__main__":
    runpod.serverless.start({"handler": handler})

