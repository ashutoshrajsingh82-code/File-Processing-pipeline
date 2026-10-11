'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, ArrowDownToLine, ArrowRight, CheckCircle2, Clock3, CloudUpload, FileImage, FileText, Files, Gauge, HardDrive, LoaderCircle, RefreshCw, ShieldCheck, Sparkles, UploadCloud, XCircle } from 'lucide-react';

type Job = { job_id: string; status: string; filename?: string; attempts?: number; error?: string | null; created_at?: string | null; updated_at?: string | null; result?: any };
type HistoryItem = { id: string; filename: string; status: string; type: string; createdAt: number; job?: Job };
const API = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000').replace(/\/$/, '');
const fmt = (n: number) => n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / (1024 * 1024)).toFixed(2)} MB`;
const pretty = (s?: string) => (s || 'QUEUED').toLowerCase().replace(/^./, c => c.toUpperCase());

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [webhook, setWebhook] = useState('');
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [jobs, setJobs] = useState<HistoryItem[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const picker = useRef<HTMLInputElement>(null);
  const active = jobs.find(j => j.id === selected) || jobs[0];
  const selectedJob = active?.job;

  const acceptFile = (f?: File) => {
    setError(''); setNotice('');
    if (!f) return;
    const ext = f.name.split('.').pop()?.toLowerCase();
    if (!['png','jpg','jpeg','webp','gif','bmp','pdf','txt','text'].includes(ext || '')) { setError('Unsupported format. Choose an image, PDF, or plain-text file.'); return; }
    if (f.size > 10 * 1024 * 1024) { setError('This file is larger than the 10 MiB upload limit.'); return; }
    if (f.size === 0) { setError('This file is empty. Choose another file.'); return; }
    setFile(f);
  };

  const refreshJob = useCallback(async (id: string) => {
    try {
      const response = await fetch(`${API}/api/jobs/${encodeURIComponent(id)}`, { cache: 'no-store' });
      if (!response.ok) return;
      const job: Job = await response.json();
      setJobs(prev => prev.map(item => item.id === id ? { ...item, status: job.status, job } : item));
    } catch { /* transient network errors are retried by the next polling interval */ }
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API}/api/jobs?limit=30`, { cache: 'no-store' }).then(async response => {
      if (!response.ok) return;
      const payload = await response.json();
      if (cancelled || !Array.isArray(payload.jobs)) return;
      const restored: HistoryItem[] = payload.jobs.map((job: any) => ({
        id: job.job_id, filename: job.filename || 'Uploaded file', status: job.status || 'QUEUED',
        type: job.filename?.split('.').pop()?.toUpperCase() || 'FILE',
        createdAt: job.created_at ? new Date(job.created_at).getTime() : Date.now(), job
      }));
      setJobs(prev => {
        const known = new Set(prev.map(item => item.id));
        return [...prev, ...restored.filter(item => !known.has(item.id))].sort((a,b) => b.createdAt-a.createdAt);
      });
    }).catch(() => { /* API may still be starting; uploads show a visible connection error if needed */ });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const pending = jobs.filter(j => ['QUEUED','PROCESSING'].includes(j.status));
    if (!pending.length) return;
    const timer = setInterval(() => pending.forEach(j => refreshJob(j.id)), 2200);
    return () => clearInterval(timer);
  }, [jobs, refreshJob]);

  const upload = async () => {
    if (!file) { setError('Choose a file before starting processing.'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      const data = new FormData(); data.append('image', file);
      if (webhook.trim()) data.append('webhook_url', webhook.trim());
      const response = await fetch(`${API}/api/files`, { method: 'POST', body: data });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail || `Upload failed (${response.status}).`);
      const item: HistoryItem = { id: payload.job_id, filename: file.name, status: payload.status || 'QUEUED', type: file.name.split('.').pop()?.toUpperCase() || 'FILE', createdAt: Date.now() };
      setJobs(prev => [item, ...prev]); setSelected(item.id); setNotice('Upload accepted. Your file is queued for background processing.'); setFile(null); if (picker.current) picker.current.value = '';
      refreshJob(item.id);
    } catch (e) { setError(`${e instanceof Error ? e.message : 'Could not upload file.'} Check that the API is running at ${API}.`); }
    finally { setBusy(false); }
  };

  const clearHistory = () => { setJobs([]); setSelected(null); setNotice('Local dashboard history cleared. Jobs remain stored by the backend.'); };
  const result = selectedJob?.result?.result || selectedJob?.result;
  const status = selectedJob?.status || active?.status || 'QUEUED';
  const isDone = status === 'DONE';
  const isFailed = status === 'FAILED';

  return <main className="shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><Files size={21}/></div><div><b>FileFlow</b><span>PROCESSING PIPELINE</span></div></div>
      <div className="nav-label">WORKSPACE</div><div className="nav-item active"><Activity size={17}/> Overview <span className="nav-dot"/></div><div className="nav-item"><HardDrive size={17}/> File processing</div>
      <div className="sidebar-bottom"><div className="secure-icon"><ShieldCheck size={17}/></div><b>Private by design</b><p>Files are processed in the background and results are delivered through temporary download links.</p><div className="api-status"><span className="pulse"/> API endpoint <code>localhost:8000</code></div></div>
    </aside>
    <section className="main-area">
      <header className="topbar"><div className="breadcrumb">Workspace <span>/</span> <b>Overview</b></div><div className="top-right"><span className="online"><i/> Local environment</span><div className="avatar">FF</div></div></header>
      <div className="content">
        <div className="welcome"><div><div className="eyebrow"><Sparkles size={14}/> ASYNC FILE OPERATIONS</div><h1>File processing, <em>simplified.</em></h1><p>Upload a file, let the worker handle the heavy lifting, and get your results when they’re ready.</p></div><div className="welcome-icon"><Files size={32}/><span/></div></div>
        <div className="stats-grid">
          <div className="stat-card"><div className="stat-top"><span>Total jobs</span><div className="stat-icon blue"><Files size={17}/></div></div><div className="stat-value">{jobs.length}</div><div className="stat-foot">Tracked in this dashboard session</div></div>
          <div className="stat-card"><div className="stat-top"><span>In progress</span><div className="stat-icon amber"><Clock3 size={17}/></div></div><div className="stat-value">{jobs.filter(j => ['QUEUED','PROCESSING'].includes(j.status)).length}</div><div className="stat-foot">Queued or being processed</div></div>
          <div className="stat-card"><div className="stat-top"><span>Completed</span><div className="stat-icon green"><CheckCircle2 size={17}/></div></div><div className="stat-value">{jobs.filter(j => j.status === 'DONE').length}</div><div className="stat-foot">Ready to download</div></div>
          <div className="stat-card"><div className="stat-top"><span>Max file size</span><div className="stat-icon purple"><Gauge size={17}/></div></div><div className="stat-value">10 <small>MB</small></div><div className="stat-foot">Images, PDFs and TXT files</div></div>
        </div>
        <div className="work-grid">
          <section className="panel upload-panel"><div className="panel-heading"><div><h2>Upload a file</h2><p>Start a new background processing job.</p></div><span className="step-pill">01 / UPLOAD</span></div>
            <div className={`dropzone ${dragging ? 'dragging' : ''} ${file ? 'has-file' : ''}`} onDragOver={e => {e.preventDefault();setDragging(true)}} onDragLeave={() => setDragging(false)} onDrop={e => {e.preventDefault();setDragging(false);acceptFile(e.dataTransfer.files?.[0])}} onClick={() => picker.current?.click()} role="button" tabIndex={0} onKeyDown={e => {if(e.key === 'Enter' || e.key === ' ') picker.current?.click()}}>
              <input ref={picker} type="file" accept=".png,.jpg,.jpeg,.webp,.gif,.bmp,.pdf,.txt,.text" hidden onChange={e => acceptFile(e.target.files?.[0])}/>
              <div className="upload-symbol">{file ? <FileText size={25}/> : <CloudUpload size={27}/>}</div>
              {file ? <><b className="filename">{file.name}</b><span>{fmt(file.size)} · Ready to upload</span></> : <><b>Drop your file here, or <span className="browse">browse</span></b><span>PNG, JPG, WEBP, PDF or TXT</span><span className="file-limit">Maximum file size: 10 MiB</span></>}
              {file && <button className="remove-file" type="button" onClick={e => {e.stopPropagation();setFile(null);if(picker.current)picker.current.value=''}} aria-label="Remove file"><XCircle size={17}/></button>}
            </div>
            <label className="field-label" htmlFor="webhook">Webhook URL <span>OPTIONAL</span></label><input id="webhook" className="text-input" placeholder="https://your-service.com/callback" value={webhook} onChange={e => setWebhook(e.target.value)}/><p className="field-help">Receive a callback when the job completes. Public HTTPS URLs only.</p>
            {error && <div className="alert error"><XCircle size={17}/><span>{error}</span></div>}{notice && <div className="alert success"><CheckCircle2 size={17}/><span>{notice}</span></div>}
            <button className="primary-button" disabled={!file || busy} onClick={upload}>{busy ? <><LoaderCircle className="spin" size={17}/> Uploading…</> : <><UploadCloud size={17}/> Upload &amp; process <ArrowRight size={16}/></>}</button>
            <div className="upload-note"><ShieldCheck size={15}/> Your file is sent securely to your local API.</div>
          </section>
          <section className="panel pipeline-panel"><div className="panel-heading"><div><h2>Processing pipeline</h2><p>Every file follows the same reliable flow.</p></div><span className="live-tag"><i/> LIVE FLOW</span></div>
            <div className="pipeline-steps"><div className="pipeline-step"><div className="pipeline-icon upload"><UploadCloud size={18}/></div><div className="pipeline-copy"><b>Upload received</b><span>Validate file type and size</span></div><CheckCircle2 size={16} className="step-check"/></div><div className="connector"/><div className="pipeline-step"><div className="pipeline-icon queue"><Clock3 size={18}/></div><div className="pipeline-copy"><b>Queued for processing</b><span>Redis queue · Celery worker</span></div><span className="step-number">02</span></div><div className="connector"/><div className="pipeline-step"><div className="pipeline-icon process"><RefreshCw size={18}/></div><div className="pipeline-copy"><b>Transform file</b><span>Resize, extract text or analyze words</span></div><span className="step-number">03</span></div><div className="connector"/><div className="pipeline-step"><div className="pipeline-icon output"><ArrowDownToLine size={18}/></div><div className="pipeline-copy"><b>Results ready</b><span>Signed download links in job details</span></div><span className="step-number">04</span></div></div>
            <div className="pipeline-footer"><div className="mini-stack"><span>API</span><span>Q</span><span>DB</span></div><div><b>Built for asynchronous work</b><p>Jobs continue even after you leave this page.</p></div></div>
          </section>
        </div>
        <section className="panel jobs-panel"><div className="panel-heading"><div><h2>Recent jobs</h2><p>Monitor status and access completed output files.</p></div><div className="jobs-actions"><button className="subtle-button" onClick={() => jobs.forEach(j => refreshJob(j.id))}><RefreshCw size={14}/> Refresh</button><button className="subtle-button" onClick={clearHistory}>Clear view</button></div></div>
          {jobs.length === 0 ? <div className="empty-state"><div className="empty-icon"><Files size={23}/></div><b>No jobs yet</b><p>Your uploaded files will appear here. Start by uploading your first file above.</p></div> : <div className="jobs-layout"><div className="job-list">{jobs.map(j => <button key={j.id} className={`job-row ${active?.id === j.id ? 'selected' : ''}`} onClick={() => setSelected(j.id)}><div className={`file-type ${j.type === 'PDF' ? 'pdf' : j.type === 'TXT' || j.type === 'TEXT' ? 'txt' : 'img'}`}>{j.type === 'PDF' ? <FileText size={18}/> : j.type === 'TXT' || j.type === 'TEXT' ? <FileText size={18}/> : <FileImage size={18}/>}</div><div className="job-main"><b>{j.filename}</b><span>{new Date(j.createdAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})} · {j.id.slice(0,8)}</span></div><Status status={j.status}/></button>)}</div>
            <div className="job-detail">{active && <><div className="detail-head"><div><span className="detail-kicker">SELECTED JOB</span><h3>{active.filename}</h3></div><Status status={status}/></div><div className="detail-id">Job ID <code>{active.id}</code></div>{['QUEUED','PROCESSING'].includes(status) && <div className="processing-box"><LoaderCircle size={18} className="spin"/><div><b>{status === 'QUEUED' ? 'Waiting for a worker' : 'Your file is being processed'}</b><span>This panel updates automatically.</span></div></div>}{isFailed && <div className="alert error"><XCircle size={17}/><span>{selectedJob?.error || 'Processing failed. Check worker logs for details.'}</span></div>}{isDone && <Results result={result}/>}<div className="detail-meta"><span>Attempts <b>{selectedJob?.attempts ?? '—'}</b></span><span>Updated <b>{selectedJob?.updated_at ? new Date(selectedJob.updated_at).toLocaleTimeString() : '—'}</b></span></div></>}</div></div>}
        </section>
        <footer><span>© 2026 FileFlow · Local file processing pipeline</span><span><span className="footer-dot"/> Powered by FastAPI + Celery</span></footer>
      </div>
    </section>
  </main>;
}

function Status({ status }: { status: string }) { const cls = status === 'DONE' ? 'done' : status === 'FAILED' ? 'failed' : status === 'PROCESSING' ? 'processing' : 'queued'; return <span className={`status ${cls}`}><i/>{pretty(status)}</span>; }
function Results({ result }: { result: any }) {
  if (!result) return <div className="result-box">Job completed. No result payload was returned.</div>;
  if (result.type === 'image') return <div className="results-block"><b className="results-title">Image outputs</b><div className="image-results">{Object.entries(result.outputs || {}).map(([name, val]: [string, any]) => <a href={val.url} target="_blank" rel="noreferrer" key={name} className="image-result"><div className="image-preview"><img src={val.url} alt={`${name} output`} /></div><span>{name}</span><small>Open / download ↗</small></a>)}</div></div>;
  if (result.type === 'pdf') return <div className="results-block"><b className="results-title">Extracted PDF text</b><div className="text-preview">{(result.page_text || '').slice(0, 1800) || 'No selectable text was found in this PDF.'}</div>{result.text_url && <a className="download-link" href={result.text_url} target="_blank" rel="noreferrer"><ArrowDownToLine size={15}/> Download extracted text</a>}</div>;
  if (result.type === 'text') { const words = Object.entries(result.word_frequency || {}).sort((a: any,b: any) => Number(b[1])-Number(a[1])).slice(0,8); return <div className="results-block"><b className="results-title">Word frequency</b><div className="word-stats"><div><strong>{result.word_count ?? 0}</strong><span>Total words</span></div><div><strong>{result.unique_words ?? 0}</strong><span>Unique words</span></div></div><div className="word-list">{words.map(([word,count]: any) => <div key={word}><span>{word}</span><b>{count}</b></div>)}</div>{result.result_url && <a className="download-link" href={result.result_url} target="_blank" rel="noreferrer"><ArrowDownToLine size={15}/> Download full JSON</a>}</div>; }
  return <div className="result-box"><CheckCircle2 size={17}/> Processing completed successfully.</div>;
}
