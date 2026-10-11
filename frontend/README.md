# FileFlow frontend

Next.js + TypeScript dashboard for the File Processing Pipeline backend.

## Docker (recommended)
Run from the repository root:

```powershell
docker compose up --build -d
```
Open http://localhost:3000. The frontend calls the API at http://localhost:8000. Signed MinIO download links are generated for `localhost:9000`, which is published by Docker Compose for browser access.

## Run the frontend outside Docker
Requires Node.js 20 or newer. Start the backend stack first, then:

```powershell
cd frontend
Copy-Item .env.local.example .env.local -ErrorAction SilentlyContinue
npm install
npm run dev
```

Open http://localhost:3000. Set `NEXT_PUBLIC_API_URL` to the API origin if it is not `http://localhost:8000`.
