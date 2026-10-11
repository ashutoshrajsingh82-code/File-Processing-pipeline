"""Celery workers for image, PDF and plain-text processing."""
import io, os, json, logging
from urllib.parse import urlparse
import boto3
import requests
import fitz
from PIL import Image, ImageOps
from botocore.client import Config
from celery import Celery
from jobs import init_db, update_job
from security import validate_webhook_url
from processing_utils import word_frequency, resize_standard

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger(__name__)
MINIO_ENDPOINT = os.getenv("MINIO_ENDPOINT", "localhost:9000")
MINIO_PUBLIC_ENDPOINT = os.getenv("MINIO_PUBLIC_ENDPOINT", "localhost:9000")
MINIO_SECURE = os.getenv("MINIO_SECURE", "false").lower() == "true"
MINIO_ACCESS_KEY = os.getenv("MINIO_ACCESS_KEY", "minioadmin")
MINIO_SECRET_KEY = os.getenv("MINIO_SECRET_KEY", "minioadmin")
UPLOADS_BUCKET = os.getenv("UPLOADS_BUCKET", "uploads")
OUTPUTS_BUCKET = os.getenv("OUTPUTS_BUCKET", "processed")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

celery_app = Celery("file_pipeline", broker=REDIS_URL, backend=REDIS_URL)
celery_app.conf.update(task_track_started=True, task_acks_late=True, worker_prefetch_multiplier=1,
    task_reject_on_worker_lost=True, result_expires=86400, broker_connection_retry_on_startup=True)

s3_client = boto3.client("s3", endpoint_url=f"{'https' if MINIO_SECURE else 'http'}://{MINIO_ENDPOINT}",
    aws_access_key_id=MINIO_ACCESS_KEY, aws_secret_access_key=MINIO_SECRET_KEY,
    config=Config(signature_version="s3v4"))
# Presigned links are opened by the user's browser, so sign against the host-published endpoint.
presign_client = boto3.client("s3", endpoint_url=f"{'https' if MINIO_SECURE else 'http'}://{MINIO_PUBLIC_ENDPOINT}",
    aws_access_key_id=MINIO_ACCESS_KEY, aws_secret_access_key=MINIO_SECRET_KEY,
    config=Config(signature_version="s3v4"))

def ensure_buckets():
    for bucket in (UPLOADS_BUCKET, OUTPUTS_BUCKET):
        try: s3_client.head_bucket(Bucket=bucket)
        except Exception: s3_client.create_bucket(Bucket=bucket)

def signed_url(key: str, bucket: str = OUTPUTS_BUCKET, expires: int = 3600) -> str:
    return presign_client.generate_presigned_url("get_object", Params={"Bucket": bucket, "Key": key}, ExpiresIn=expires)

def process_image(data: bytes, job_id: str):
    outputs = {}
    with Image.open(io.BytesIO(data)) as original:
        image = ImageOps.exif_transpose(original).convert("RGB")
        for name, size in {"thumbnail": (150, 150), "medium": (800, 800), "large": (1600, 1600)}.items():
            output = io.BytesIO()
            resize_standard(image, size).save(output, format="JPEG", quality=90, optimize=True)
            key = f"{job_id}/images/{name}.jpg"
            s3_client.put_object(Bucket=OUTPUTS_BUCKET, Key=key, Body=output.getvalue(), ContentType="image/jpeg")
            outputs[name] = {"key": key, "url": signed_url(key)}
    return {"type": "image", "outputs": outputs}

def process_pdf(data: bytes, job_id: str):
    with fitz.open(stream=data, filetype="pdf") as doc:
        text = "\n".join(page.get_text() for page in doc)
    key = f"{job_id}/extracted.txt"
    s3_client.put_object(Bucket=OUTPUTS_BUCKET, Key=key, Body=text.encode("utf-8"), ContentType="text/plain; charset=utf-8")
    return {"type": "pdf", "page_text": text, "text_url": signed_url(key), "output_key": key}

def process_text(data: bytes, job_id: str):
    text = data.decode("utf-8-sig")
    frequencies = word_frequency(text)
    result = {"type": "text", "word_count": sum(frequencies.values()), "unique_words": len(frequencies), "word_frequency": frequencies}
    key = f"{job_id}/word-frequency.json"
    s3_client.put_object(Bucket=OUTPUTS_BUCKET, Key=key, Body=json.dumps(result, ensure_ascii=False, indent=2).encode(), ContentType="application/json")
    result.update({"output_key": key, "result_url": signed_url(key)})
    return result

def send_webhook(url: str, payload: dict):
    # Validate again at delivery time (DNS can change after upload).
    validate_webhook_url(url)
    response = requests.post(url, json=payload, timeout=(3, 10), allow_redirects=False,
        headers={"User-Agent": "FileProcessingPipeline/1.0"})
    response.raise_for_status()

@celery_app.task(bind=True, name="deliver_webhook", max_retries=3)
def deliver_webhook_task(self, url: str, payload: dict):
    """Deliver callbacks independently; retry temporary receiver/network failures."""
    try:
        send_webhook(url, payload)
        return {"status": "DELIVERED"}
    except Exception as exc:
        logger.warning("Webhook delivery attempt %s failed: %s", self.request.retries + 1, exc)
        if self.request.retries < self.max_retries:
            raise self.retry(exc=exc, countdown=2 ** (self.request.retries + 1))
        raise

@celery_app.task(bind=True, name="process_file", max_retries=3, acks_late=True)
def process_file_task(self, job_id: str, source_key: str, filename: str, content_type: str, webhook_url: str | None = None):
    init_db()
    update_job(job_id, status="PROCESSING", attempts=self.request.retries + 1, error=None)
    try:
        obj = s3_client.get_object(Bucket=UPLOADS_BUCKET, Key=source_key)
        data = obj["Body"].read()
        suffix = os.path.splitext(filename.lower())[1]
        if suffix == ".pdf" or content_type == "application/pdf":
            result = process_pdf(data, job_id)
        elif suffix in {".txt", ".text"} or content_type.startswith("text/plain"):
            result = process_text(data, job_id)
        else:
            result = process_image(data, job_id)
        payload = {"job_id": job_id, "status": "DONE", "result": result}
        update_job(job_id, status="DONE", result_json=json.dumps(payload, ensure_ascii=False), error=None)
        if webhook_url:
            # Callback retries are independent and cannot undo completed processing.
            deliver_webhook_task.delay(webhook_url, payload)
        return payload
    except Exception as exc:
        attempt = self.request.retries + 1
        update_job(job_id, status="QUEUED" if self.request.retries < self.max_retries else "FAILED",
                   attempts=attempt, error=str(exc))
        logger.exception("Job %s failed on attempt %s", job_id, attempt)
        if self.request.retries < self.max_retries:
            raise self.retry(exc=exc, countdown=2 ** (self.request.retries + 1))
        payload = {"job_id": job_id, "status": "FAILED", "error": str(exc)}
        if webhook_url:
            try: deliver_webhook_task.delay(webhook_url, payload)
            except Exception as hook_exc: logger.warning("Could not enqueue failure webhook for %s: %s", job_id, hook_exc)
        raise
