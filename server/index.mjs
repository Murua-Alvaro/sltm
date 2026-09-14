import express from 'express';
import cors from 'cors';
import multer from 'multer';
import pg from 'pg';

const { Pool } = pg;
const app = express();
const port = process.env.PORT || 10000;
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL no configurada');

const pool = new Pool({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false }, max: 5 });
const allowedOrigins = new Set([
  'https://sltm.onrender.com',
  'http://localhost:5173',
  ...(process.env.ALLOWED_ORIGINS || '').split(',').map(x => x.trim()).filter(Boolean)
]);

app.disable('x-powered-by');
app.use(cors({ origin(origin, cb) { if (!origin || allowedOrigins.has(origin)) return cb(null, true); cb(new Error('Origen no permitido')); } }));
app.use(express.json({ limit: '2mb' }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter(_req, file, cb) {
    if (!/^image\/(jpeg|png|webp|heic|heif)$/i.test(file.mimetype || '')) return cb(new Error('Formato de imagen no permitido'));
    cb(null, true);
  }
});

const idOk = v => typeof v === 'string' && /^[A-Za-z0-9._:-]{1,120}$/.test(v);
const workspaceOk = v => typeof v === 'string' && /^[A-Za-z0-9._:-]{3,120}$/.test(v);

async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS terrains (
      workspace_id text NOT NULL,
      terrain_id text NOT NULL,
      payload jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (workspace_id, terrain_id)
    );
    CREATE TABLE IF NOT EXISTS visits (
      workspace_id text NOT NULL,
      visit_id text NOT NULL,
      terrain_id text NOT NULL,
      payload jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (workspace_id, visit_id)
    );
    CREATE INDEX IF NOT EXISTS visits_workspace_terrain_idx ON visits(workspace_id, terrain_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS evidence (
      workspace_id text NOT NULL,
      evidence_id text NOT NULL,
      terrain_id text NOT NULL,
      visit_id text,
      mime_type text NOT NULL,
      filename text,
      bytes bytea NOT NULL,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (workspace_id, evidence_id)
    );
    CREATE INDEX IF NOT EXISTS evidence_workspace_terrain_idx ON evidence(workspace_id, terrain_id, created_at DESC);
  `);
}

app.get('/health', async (_req, res) => {
  try {
    const r = await pool.query('select now() as now');
    res.json({ ok: true, database: true, now: r.rows[0].now });
  } catch (e) {
    res.status(503).json({ ok: false, database: false, error: e.message });
  }
});

app.get('/api/workspaces/:workspace/audit', async (req, res) => {
  const { workspace } = req.params;
  if (!workspaceOk(workspace)) return res.status(400).json({ error: 'workspace inválido' });
  const r = await pool.query(`
    select
      (select count(*)::int from terrains where workspace_id=$1) as terrains,
      (select count(*)::int from visits where workspace_id=$1) as visits,
      (select count(*)::int from evidence where workspace_id=$1) as evidence,
      (select coalesce(sum(octet_length(bytes)),0)::bigint from evidence where workspace_id=$1) as evidence_bytes,
      (select max(updated_at) from terrains where workspace_id=$1) as last_terrain_update,
      (select max(created_at) from visits where workspace_id=$1) as last_visit
  `,[workspace]);
  res.json({ workspace, ...r.rows[0] });
});

app.get('/api/workspaces/:workspace/terrains', async (req, res) => {
  const { workspace } = req.params;
  if (!workspaceOk(workspace)) return res.status(400).json({ error: 'workspace inválido' });
  const r = await pool.query('select terrain_id, payload, updated_at from terrains where workspace_id=$1 order by terrain_id', [workspace]);
  res.json({ terrains: r.rows.map(x => ({ ...x.payload, id: x.terrain_id, _serverUpdatedAt: x.updated_at })) });
});

app.put('/api/workspaces/:workspace/terrains/:terrainId', async (req, res) => {
  const { workspace, terrainId } = req.params;
  if (!workspaceOk(workspace) || !idOk(terrainId)) return res.status(400).json({ error: 'identificador inválido' });
  const payload = req.body;
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.poly)) return res.status(400).json({ error: 'payload de terreno inválido' });
  await pool.query(`insert into terrains(workspace_id, terrain_id, payload, updated_at) values($1,$2,$3::jsonb,now()) on conflict(workspace_id,terrain_id) do update set payload=excluded.payload, updated_at=now()`, [workspace, terrainId, JSON.stringify(payload)]);
  res.json({ ok: true, terrainId });
});

app.get('/api/workspaces/:workspace/visits', async (req, res) => {
  const { workspace } = req.params;
  const terrainId = req.query.terrainId;
  if (!workspaceOk(workspace)) return res.status(400).json({ error: 'workspace inválido' });
  const params = [workspace];
  let sql = 'select visit_id, terrain_id, payload, created_at from visits where workspace_id=$1';
  if (terrainId) { if (!idOk(String(terrainId))) return res.status(400).json({ error: 'terrainId inválido' }); params.push(String(terrainId)); sql += ' and terrain_id=$2'; }
  sql += ' order by created_at desc limit 500';
  const r = await pool.query(sql, params);
  res.json({ visits: r.rows.map(x => ({ ...x.payload, id: x.visit_id, terrainId: x.terrain_id, _serverCreatedAt: x.created_at })) });
});

app.post('/api/workspaces/:workspace/visits', async (req, res) => {
  const { workspace } = req.params;
  const { terrainId, visit } = req.body || {};
  if (!workspaceOk(workspace) || !idOk(terrainId) || !visit || !idOk(visit.id)) return res.status(400).json({ error: 'visita inválida' });
  await pool.query(`insert into visits(workspace_id, visit_id, terrain_id, payload) values($1,$2,$3,$4::jsonb) on conflict(workspace_id,visit_id) do update set payload=excluded.payload`, [workspace, visit.id, terrainId, JSON.stringify(visit)]);
  res.json({ ok: true, visitId: visit.id });
});

app.post('/api/workspaces/:workspace/evidence', upload.single('file'), async (req, res) => {
  const { workspace } = req.params;
  const { evidenceId, terrainId, visitId, metadata } = req.body || {};
  if (!workspaceOk(workspace) || !idOk(evidenceId) || !idOk(terrainId) || !req.file) return res.status(400).json({ error: 'evidencia inválida' });
  let meta = {};
  try { meta = metadata ? JSON.parse(metadata) : {}; } catch { return res.status(400).json({ error: 'metadata inválida' }); }
  await pool.query(`insert into evidence(workspace_id,evidence_id,terrain_id,visit_id,mime_type,filename,bytes,metadata) values($1,$2,$3,$4,$5,$6,$7,$8::jsonb) on conflict(workspace_id,evidence_id) do update set visit_id=excluded.visit_id,mime_type=excluded.mime_type,filename=excluded.filename,bytes=excluded.bytes,metadata=excluded.metadata`, [workspace,evidenceId,terrainId,visitId||null,req.file.mimetype,req.file.originalname,req.file.buffer,JSON.stringify(meta)]);
  res.json({ ok: true, evidenceId });
});

app.get('/api/workspaces/:workspace/evidence/:evidenceId', async (req, res) => {
  const { workspace, evidenceId } = req.params;
  if (!workspaceOk(workspace) || !idOk(evidenceId)) return res.status(400).json({ error: 'identificador inválido' });
  const r = await pool.query('select mime_type, filename, bytes from evidence where workspace_id=$1 and evidence_id=$2', [workspace, evidenceId]);
  if (!r.rowCount) return res.status(404).json({ error: 'no encontrada' });
  res.setHeader('Content-Type', r.rows[0].mime_type || 'application/octet-stream');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.send(r.rows[0].bytes);
});

app.get('/api/workspaces/:workspace/export', async (req, res) => {
  const { workspace } = req.params;
  if (!workspaceOk(workspace)) return res.status(400).json({ error: 'workspace inválido' });
  const [terrains, visits, evidence] = await Promise.all([
    pool.query('select terrain_id,payload,updated_at from terrains where workspace_id=$1 order by terrain_id',[workspace]),
    pool.query('select visit_id,terrain_id,payload,created_at from visits where workspace_id=$1 order by created_at',[workspace]),
    pool.query('select evidence_id,terrain_id,visit_id,mime_type,filename,metadata,created_at,octet_length(bytes) as size from evidence where workspace_id=$1 order by created_at',[workspace])
  ]);
  res.json({ workspace, exportedAt: new Date().toISOString(), terrains: terrains.rows, visits: visits.rows, evidence: evidence.rows });
});

app.get('/api/workspaces/:workspace/export.geojson', async (req, res) => {
  const { workspace } = req.params;
  if (!workspaceOk(workspace)) return res.status(400).json({ error: 'workspace inválido' });
  const [terrains, visits] = await Promise.all([
    pool.query('select terrain_id,payload from terrains where workspace_id=$1 order by terrain_id',[workspace]),
    pool.query('select visit_id,terrain_id,payload from visits where workspace_id=$1 order by created_at',[workspace])
  ]);
  const features = [];
  for (const row of terrains.rows) {
    const t = row.payload || {};
    if (Array.isArray(t.poly) && t.poly.length >= 3) {
      const ring = t.poly.map(p => [Number(p[1]), Number(p[0])]);
      if (ring.length && (ring[0][0] !== ring.at(-1)[0] || ring[0][1] !== ring.at(-1)[1])) ring.push([...ring[0]]);
      features.push({ type:'Feature', geometry:{ type:'Polygon', coordinates:[ring] }, properties:{ featureType:'terrain', terrainId:row.terrain_id, name:t.name||row.terrain_id, status:t.status||null, use:t.use||null, area:t.area||null, slope:t.slope||null, permeable:t.permeable||null, built:t.built||null, access:t.access||null, change:t.change||null, drainage:t.drainage||null, vegetation:t.vegetation||null, fill:t.fill||null } });
    }
  }
  for (const row of visits.rows) {
    const v = row.payload || {};
    if (Array.isArray(v.track) && v.track.length >= 2) features.push({ type:'Feature', geometry:{ type:'LineString', coordinates:v.track.map(p => [Number(p.lng),Number(p.lat),Number.isFinite(p.alt)?Number(p.alt):0]) }, properties:{ featureType:'visit_track', terrainId:row.terrain_id, visitId:row.visit_id, date:v.date||null, mode:v.mode||null, distance:v.distance||null, quality:v.quality||null, avgAcc:v.avgAcc||null } });
    for (const [i,p] of (v.points||[]).entries()) if (Number.isFinite(p.lat) && Number.isFinite(p.lng)) features.push({ type:'Feature', geometry:{ type:'Point', coordinates:[Number(p.lng),Number(p.lat),Number.isFinite(p.alt)?Number(p.alt):0] }, properties:{ featureType:'observation', terrainId:row.terrain_id, visitId:row.visit_id, observationIndex:i+1, kind:p.kind||null, note:p.note||null, accuracy:p.acc||null, timestamp:p.at||null, heading:p.heading||null } });
    for (const e of (v.evidence||[])) if (Number.isFinite(e?.gps?.lat) && Number.isFinite(e?.gps?.lng)) features.push({ type:'Feature', geometry:{ type:'Point', coordinates:[Number(e.gps.lng),Number(e.gps.lat),Number.isFinite(e.gps.alt)?Number(e.gps.alt):0] }, properties:{ featureType:'evidence', terrainId:row.terrain_id, visitId:row.visit_id, evidenceId:e.id, timestamp:e.at||null, accuracy:e.gps.acc||null, heading:e.gps.heading||null } });
  }
  res.setHeader('Content-Type','application/geo+json; charset=utf-8');
  res.setHeader('Content-Disposition',`attachment; filename="sltm-${workspace}.geojson"`);
  res.json({ type:'FeatureCollection', name:`SLTM ${workspace}`, features });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  const code = err?.code === 'LIMIT_FILE_SIZE' ? 413 : 500;
  res.status(code).json({ error: code === 413 ? 'La imagen supera 5 MB' : (err.message || 'Error interno') });
});

await ensureSchema();
const server = app.listen(port, '0.0.0.0', () => console.log(`SLTM API escuchando en ${port}`));
const shutdown = async () => { server.close(); await pool.end(); process.exit(0); };
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
