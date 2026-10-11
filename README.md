# File Processing Pipeline

An asynchronous file-processing application with a **Next.js dashboard** and a **FastAPI + Celery + Redis + PostgreSQL + MinIO/S3** backend. Upload requests return a job ID; workers process files independently and persist job state.

## Assignment requirements covered

- Multipart upload for images, PDF and UTF-8 plain text; strict 10 MiB maximum checked against actual bytes.
- Immediate `202 Accepted` response with `job_id` and status URL.
- Celery/Redis background queue, persistent PostgreSQL job records, and `QUEUED → PROCESSING → DONE/FAILED` state transitions.
- Images generate three JPEG outputs: thumbnail (150×150 box), medium (800×800 box), and large (1600×1600 box), preserving aspect ratio.
- PDFs have text extracted and stored as a `.txt` artifact.
- Text files get word-frequency statistics stored as JSON.
- Processed outputs are stored in MinIO/S3; API results contain time-limited signed URLs (default one hour).
- Processing failures are retried up to three times after the initial attempt with exponential delays (2, 4, 8 seconds). Final failures are persisted.
- Optional HTTPS webhook on completion/final failure. URL validation rejects non-HTTPS, credentials, localhost, private/non-global IPs and redirects are not followed. Notification failure does not undo completed processing.
- Docker Compose runs Redis, PostgreSQL, MinIO, API and worker.

## Run on Windows (recommended: Docker Desktop)

1. Install **Docker Desktop** and enable its WSL 2 backend. Start Docker Desktop.
2. Extract this project folder. Open PowerShell in that folder.
3. Copy `.env.example` to `.env`. Change `POSTGRES_PASSWORD` and `MINIO_SECRET_KEY` to strong local values. For a local demo the defaults work, but do not expose these services publicly.
4. Start the stack:

   ```powershell
   Copy-Item .env.example .env
   # Edit .env if you want to change the local credentials
   docker compose up --build -d
   docker compose ps
   ```

5. Open the **FileFlow frontend dashboard** at <http://localhost:3000>. API docs are at <http://localhost:8000/docs>. MinIO console is at <http://localhost:9001> (credentials from `.env`).
6. View logs:

   ```powershell
   docker compose logs -f frontend api worker
   ```

7. Stop services while preserving data:

   ```powershell
   docker compose down
   ```

   To delete the local database and object-store data as well, run `docker compose down -v` (destructive).


### Frontend dashboard

The included Next.js + TypeScript dashboard is served on <http://localhost:3000>. It provides a drag-and-drop upload form, client-side 10 MiB validation, optional HTTPS webhook field, recent-job list, automatic status polling, image output previews, extracted PDF text, word-frequency summaries, and signed download links. The API remains available separately at <http://localhost:8000/docs>.

The browser calls the API at `NEXT_PUBLIC_API_URL` (default `http://localhost:8000`). If you change the API's host or port, update the `frontend` service environment in `docker-compose.yml` and ensure `CORS_ORIGINS` includes the frontend origin. Rebuild after configuration changes with `docker compose up --build -d`.

### Upload examples (PowerShell)

Image:

```powershell
curl.exe -X POST http://localhost:8000/api/files -F "image=@C:\path\to\photo.jpg"
```

PDF:

```powershell
curl.exe -X POST http://localhost:8000/api/files -F "image=@C:\path\to\report.pdf"
```

Text:

```powershell
curl.exe -X POST http://localhost:8000/api/files -F "image=@C:\path\to\notes.txt"
```

The form field remains named `image` for compatibility with the starter repository. The upload response includes a `job_id`; query it like this:

```powershell
curl.exe http://localhost:8000/api/jobs/YOUR_JOB_ID
```

Legacy endpoints are also supported: `POST /process/images/` and `GET /status/{job_id}`.

### Webhook

Pass `webhook_url` as another multipart form field. It must be an HTTPS URL resolving to public IP addresses. This intentionally blocks localhost HTTP callbacks; use a public HTTPS callback endpoint for integration testing. Webhooks are best-effort and do not change the processing outcome if the receiver is down.

## Run locally without Docker (advanced)

Requirements: Python 3.12+, a running Redis, PostgreSQL, and MinIO/S3-compatible server. Configure environment variables from `.env.example`; when running processes directly on Windows, use `localhost` service endpoints.

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -e ".[test]"
$env:REDIS_URL = "redis://localhost:6379/0"
$env:DATABASE_URL = "postgresql+psycopg2://pipeline:YOUR_PASSWORD@localhost:5432/filepipeline"
$env:MINIO_ENDPOINT = "localhost:9000"
uvicorn main:app --reload
```

In a second PowerShell window (activate the same venv and set the same environment variables):

```powershell
celery -A celery_worker.celery_app worker --loglevel=INFO --pool=solo
```

The Docker route is recommended because it avoids installing and configuring Redis/PostgreSQL/MinIO directly on Windows.

## API

### `POST /api/files` (also `POST /process/images/`)

Multipart fields:
- `image` (required): image, PDF, or UTF-8 `.txt` file.
- `webhook_url` (optional): HTTPS public callback URL.
- `pipeline_json` (optional): retained for compatibility with the starter API; standard output generation is performed automatically.

Example accepted response (`202`):

```json
{
  "job_id": "<uuid>",
  "status": "QUEUED",
  "filename": "report.pdf",
  "status_url": "/api/jobs/<uuid>"
}
```

### `GET /api/jobs/{job_id}` (also `GET /status/{job_id}`)

Returns current persisted status, attempts, error if any, timestamps, and result once complete. Signed URLs expire after one hour by default.

### Health
- `GET /health`
- `GET /health/ready` (database readiness)

## Tests

```powershell
pip install -e ".[test]"
pytest -q
```

Tests cover word-frequency calculation, aspect-ratio-preserving resizing and webhook URL policy. For a full integration check, start Docker Compose, upload each of the three file types, poll job status until `DONE`, download each signed output URL, and verify failure/retry behavior by temporarily making the worker unable to reach object storage.

## Security and operational notes

- `.env` contains secrets; never commit it. `.env.example` is only for local development.
- Webhook URL validation mitigates SSRF, but deployments exposed to untrusted users should also enforce outbound network egress rules at the infrastructure layer to prevent DNS rebinding and access to internal services.
- For production, use HTTPS at a reverse proxy, authentication/authorization, upload rate limits, malware scanning, object lifecycle policies, webhook signing, and database migrations (e.g. Alembic). This assignment starter intentionally keeps authentication out of scope.
- Signed object URLs are bearer links: anyone possessing a link can access that object until expiration.
