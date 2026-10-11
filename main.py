"""FastAPI entry point for the asynchronous file-processing pipeline."""
import json, logging, os, uuid
from datetime import timezone
from pathlib import Path
from typing import Optional
import boto3
from botocore.client import Config
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from jobs import Job, SessionLocal, init_db
from celery_worker import process_file_task, ensure_buckets, UPLOADS_BUCKET, MINIO_ENDPOINT, MINIO_ACCESS_KEY, MINIO_SECRET_KEY, MINIO_SECURE
from security import validate_webhook_url

MAX_UPLOAD_BYTES = 10 * 1024 * 1024
ALLOWED_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".pdf", ".txt", ".text"}
logger = logging.getLogger(__name__)
s3_client = boto3.client("s3", endpoint_url=f"{'https' if MINIO_SECURE else 'http'}://{MINIO_ENDPOINT}",
    aws_access_key_id=MINIO_ACCESS_KEY, aws_secret_access_key=MINIO_SECRET_KEY, config=Config(signature_version="s3v4"))
app = FastAPI(title="File Processing Pipeline", version="2.0.0", description="Asynchronous uploads, processing, persistent jobs and signed results.")
# The local Next.js dashboard runs on port 3000. Restrict browser CORS to local origins.
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(","),
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Accept"],
)

@app.on_event("startup")
def startup():
    init_db()
    # Bucket initialization is retried by deployment/worker if object storage is not ready.
    try: ensure_buckets()
    except Exception as exc: logger.warning("Object storage not ready at API startup: %s", exc)

@app.post("/process/images/", status_code=202)
@app.post("/api/files", status_code=202)
async def upload_file(image: UploadFile = File(...), webhook_url: Optional[str] = Form(None), pipeline_json: Optional[str] = Form(None)):
    filename = Path(image.filename or "upload").name
    suffix = Path(filename).suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise HTTPException(415, "Unsupported file type. Upload an image, PDF, or plain-text file.")
    try: webhook_url = validate_webhook_url(webhook_url)
    except ValueError as exc: raise HTTPException(422, str(exc)) from exc
    # Read at most 10 MiB + 1 byte so size validation does not trust Content-Length.
    data = await image.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "File exceeds the 10 MB upload limit.")
    if not data:
        raise HTTPException(400, "Uploaded file is empty.")
    if suffix in {".txt", ".text"}:
        try: data.decode("utf-8-sig")
        except UnicodeDecodeError as exc: raise HTTPException(422, "Text files must use UTF-8 encoding.") from exc
    job_id = str(uuid.uuid4())
    source_key = f"{job_id}/original{suffix}"
    content_type = image.content_type or "application/octet-stream"
    try:
        s3_client.put_object(Bucket=UPLOADS_BUCKET, Key=source_key, Body=data, ContentType=content_type)
        with SessionLocal() as session:
            session.add(Job(id=job_id, status="QUEUED", filename=filename, content_type=content_type,
                            source_key=source_key, webhook_url=webhook_url, pipeline_json=pipeline_json or "[]"))
            session.commit()
        process_file_task.apply_async(kwargs={"job_id": job_id, "source_key": source_key, "filename": filename,
            "content_type": content_type, "webhook_url": webhook_url}, task_id=job_id)
    except Exception as exc:
        logger.exception("Upload/job creation failed")
        try:
            with SessionLocal() as session:
                job = session.get(Job, job_id)
                if job: session.delete(job); session.commit()
        except Exception: pass
        raise HTTPException(503, "Could not store or queue the file. Please retry.") from exc
    return JSONResponse(status_code=202, content={"job_id": job_id, "status": "QUEUED", "filename": filename,
                                                   "status_url": f"/api/jobs/{job_id}"})

@app.get("/api/jobs")
def list_jobs(limit: int = 20):
    """List recent persisted jobs for the dashboard without returning large result payloads."""
    from sqlalchemy import desc
    limit = max(1, min(limit, 100))
    with SessionLocal() as session:
        jobs = session.query(Job).order_by(desc(Job.created_at)).limit(limit).all()
        return {"jobs": [{"job_id": job.id, "status": job.status, "filename": job.filename,
            "attempts": job.attempts, "error": job.error,
            "created_at": job.created_at.isoformat() if job.created_at else None,
            "updated_at": job.updated_at.isoformat() if job.updated_at else None} for job in jobs]}

@app.get("/api/jobs/{job_id}")
@app.get("/status/{job_id}")
def get_job_status(job_id: str):
    with SessionLocal() as session:
        job = session.get(Job, job_id)
        if not job: raise HTTPException(404, "Job not found")
        result = json.loads(job.result_json) if job.result_json else None
        return {"job_id": job.id, "status": job.status, "filename": job.filename,
                "attempts": job.attempts, "error": job.error, "result": result,
                "created_at": job.created_at.isoformat() if job.created_at else None,
                "updated_at": job.updated_at.isoformat() if job.updated_at else None}

@app.get("/health")
def health(): return {"status": "healthy", "service": "file-processing-pipeline"}

@app.get("/health/ready")
def readiness():
    try:
        with SessionLocal() as session: session.execute(__import__("sqlalchemy").text("SELECT 1"))
        return {"status": "ready", "database": "ok"}
    except Exception as exc: raise HTTPException(503, "Database unavailable") from exc
