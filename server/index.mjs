import express from 'express';
import cors from 'cors';
import multer from 'multer';
import pg from 'pg';
import crypto from 'node:crypto';

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
app.use(express.json({ limit: '3mb' }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 10 },
  fileFilter(_req, file, cb) {
    if (!/^image\/(jpeg|png|webp|heic|heif)$/i.test(file.mimetype || '')) return cb(new Error('Formato de imagen no permitido'));
    cb(null, true);
  }
});

const idOk = v => typeof v === 'string' && /^[A-Za-z0-9._:-]{1,120}$/.test(v);
const workspaceOk = v => typeof v === 'string' && /^[A-Za-z0-9._:-]{3,120}$/.test(v);
const finite = v => Number.isFinite(Number(v));
const validLatLng = p => p && finite(p.lat) && finite(p.lng) && Number(p.lat) >= -90 && Number(p.lat) <= 90 && Number(p.lng) >= -180 && Number(p.lng) <= 180;
const clampText = (v, n=500) => typeof v === 'string' ? v.trim().slice(0,n) : '';

function hav(a,b){
  const R=6371000,dLat=(Number(b.lat)-Number(a.lat))*Math.PI/180,dLon=(Number(b.lng)-Number(a.lng))*Math.PI/180,la1=Number(a.lat)*Math.PI/180,la2=Number(b.lat)*Math.PI/180;
  const h=Math.sin(dLat/2)**2+Math.cos(la1)*Math.cos(la2)*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(h));
}
function routeDistance(pts){return pts.slice(1).reduce((s,p,i)=>s+hav(pts[i],p),0)}
function polygonPerimeter(poly){if(poly.length<3)return 0;let s=0;for(let i=0;i<poly.length;i++){const a={lat:poly[i][0],lng:poly[i][1]},b={lat:poly[(i+1)%poly.length][0],lng:poly[(i+1)%poly.length][1]};s+=hav(a,b)}return s}
function polygonArea(poly){
  if(poly.length<3)return 0;
  const lat0=poly.reduce((s,p)=>s+Number(p[0]),0)/poly.length*Math.PI/180;
  const pts=poly.map(([lat,lng])=>({x:Number(lng)*111320*Math.cos(lat0),y:Number(lat)*110540}));
  let a=0;pts.forEach((p,i)=>{const q=pts[(i+1)%pts.length];a+=p.x*q.y-q.x*p.y});return Math.abs(a)/2;
}
function median(xs){if(!xs.length)return null;const a=[...xs].sort((x,y)=>x-y),m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2}
function cleanPoint(p){
  if(!validLatLng(p))return null;
  const out={lat:Number(p.lat),lng:Number(p.lng)};
  for(const k of ['alt','altAcc','acc','speed','heading']) if(finite(p[k])) out[k]=Number(p[k]);
  if(p.at) out.at=String(p.at).slice(0,40);
  if(p.id) out.id=clampText(p.id,120);
  if(p.kind) out.kind=clampText(p.kind,60);
  if(p.severity) out.severity=clampText(p.severity,20);
  if(p.note) out.note=clampText(p.note,1000);
  return out;
}
function cleanPoly(poly){
  if(!Array.isArray(poly)||poly.length<3||poly.length>10000) throw new Error('polígono inválido');
  return poly.map(p=>{if(!Array.isArray(p)||p.length<2||!finite(p[0])||!finite(p[1]))throw new Error('coordenada inválida');const lat=Number(p[0]),lng=Number(p[1]);if(lat<-90||lat>90||lng<-180||lng>180)throw new Error('coordenada fuera de rango');return[lat,lng]});
}
function accuracyStats(points){const xs=points.map(p=>Number(p.acc)).filter(x=>Number.isFinite(x)&&x>=0&&x<10000);return{avg:xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null,median:median(xs),max:xs.length?Math.max(...xs):null,min:xs.length?Math.min(...xs):null}}
function durationSeconds(start,end){const a=Date.parse(start||''),b=Date.parse(end||'');return Number.isFinite(a)&&Number.isFinite(b)&&b>=a?Math.round((b-a)/1000):null}
function counts(items,key){return items.reduce((o,x)=>{const k=x?.[key]||'sin_clasificar';o[k]=(o[k]||0)+1;return o},{})}

function canonicalTerrain(terrainId,payload){
  const poly=cleanPoly(payload?.poly);
  const area=polygonArea(poly),perimeter=polygonPerimeter(poly);
  const sourceAccuracy=payload?.sourceAccuracy&&typeof payload.sourceAccuracy==='object'?payload.sourceAccuracy:null;
  return {
    ...payload,
    id:terrainId,
    name:clampText(payload?.name,200)||terrainId,
    note:clampText(payload?.note,2000),
    purpose:clampText(payload?.purpose,120),
    poly,
    area,
    perimeter,
    serverMetrics:{area,perimeter,vertices:poly.length,recalculatedAt:new Date().toISOString()},
    sourceAccuracy
  };
}
function canonicalVisit(visit){
  const trackRaw=Array.isArray(visit?.track)?visit.track:[];
  const pointsRaw=Array.isArray(visit?.points)?visit.points:[];
  const evidenceRaw=Array.isArray(visit?.evidence)?visit.evidence:[];
  if(trackRaw.length>15000||pointsRaw.length>1500||evidenceRaw.length>800)throw new Error('visita excede límites operativos');
  const track=trackRaw.map(cleanPoint).filter(Boolean);
  const points=pointsRaw.map(cleanPoint).filter(Boolean);
  if(!track.length&&!points.length)throw new Error('visita sin posiciones válidas');
  const evidence=evidenceRaw.slice(0,800).map(e=>({
    id:clampText(e?.id,120),at:e?.at?String(e.at).slice(0,40):null,kind:clampText(e?.kind,60),severity:clampText(e?.severity,20),observationId:clampText(e?.observationId,120),gps:cleanPoint(e?.gps)
  })).filter(e=>e.id);
  const acc=accuracyStats(track.length?track:points),distance=routeDistance(track),durationSec=durationSeconds(visit?.startedAt,visit?.endedAt);
  const canonical={
    ...visit,
    track,points,evidence,
    distance,avgAcc:acc.avg,medianAcc:acc.median,maxAcc:acc.max,minAcc:acc.min,durationSec,
    serverMetrics:{
      distance,trackPoints:track.length,observationCount:points.length,evidenceCount:evidence.length,
      accuracy:acc,durationSec,byKind:counts(points,'kind'),bySeverity:counts(points,'severity'),
      highSeverity:points.filter(p=>p.severity==='alta').length,recalculatedAt:new Date().toISOString()
    }
  };
  return canonical;
}

async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS terrains (
      workspace_id text NOT NULL, terrain_id text NOT NULL, payload jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (workspace_id, terrain_id)
    );
    CREATE TABLE IF NOT EXISTS visits (
      workspace_id text NOT NULL, visit_id text NOT NULL, terrain_id text NOT NULL, payload jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (workspace_id, visit_id)
    );
    CREATE INDEX IF NOT EXISTS visits_workspace_terrain_idx ON visits(workspace_id, terrain_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS evidence (
      workspace_id text NOT NULL, evidence_id text NOT NULL, terrain_id text NOT NULL, visit_id text,
      mime_type text NOT NULL, filename text, bytes bytea NOT NULL, metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (workspace_id, evidence_id)
    );
    CREATE INDEX IF NOT EXISTS evidence_workspace_terrain_idx ON evidence(workspace_id, terrain_id, created_at DESC);
  `);
}

app.get('/health', async (_req,res)=>{try{const r=await pool.query('select now() as now');res.json({ok:true,database:true,now:r.rows[0].now,version:'field-real-v2'})}catch(e){res.status(503).json({ok:false,database:false,error:e.message})}});

app.get('/api/workspaces/:workspace/audit', async (req,res)=>{
  const{workspace}=req.params;if(!workspaceOk(workspace))return res.status(400).json({error:'workspace inválido'});
  const r=await pool.query(`select
    (select count(*)::int from terrains where workspace_id=$1) terrains,
    (select count(*)::int from visits where workspace_id=$1) visits,
    (select count(*)::int from evidence where workspace_id=$1) evidence,
    (select coalesce(sum(octet_length(bytes)),0)::bigint from evidence where workspace_id=$1) evidence_bytes,
    (select max(updated_at) from terrains where workspace_id=$1) last_terrain_update,
    (select max(created_at) from visits where workspace_id=$1) last_visit`,[workspace]);
  res.json({workspace,...r.rows[0]});
});

app.get('/api/workspaces/:workspace/terrains',async(req,res)=>{
  const{workspace}=req.params;if(!workspaceOk(workspace))return res.status(400).json({error:'workspace inválido'});
  const r=await pool.query('select terrain_id,payload,updated_at from terrains where workspace_id=$1 order by updated_at desc',[workspace]);
  res.json({terrains:r.rows.map(x=>({...x.payload,id:x.terrain_id,_serverUpdatedAt:x.updated_at}))});
});

app.put('/api/workspaces/:workspace/terrains/:terrainId',async(req,res)=>{
  const{workspace,terrainId}=req.params;if(!workspaceOk(workspace)||!idOk(terrainId))return res.status(400).json({error:'identificador inválido'});
  let payload;try{payload=canonicalTerrain(terrainId,req.body)}catch(e){return res.status(400).json({error:e.message})}
  await pool.query(`insert into terrains(workspace_id,terrain_id,payload,updated_at) values($1,$2,$3::jsonb,now()) on conflict(workspace_id,terrain_id) do update set payload=excluded.payload,updated_at=now()`,[workspace,terrainId,JSON.stringify(payload)]);
  res.json({ok:true,terrainId,metrics:payload.serverMetrics});
});

app.get('/api/workspaces/:workspace/visits',async(req,res)=>{
  const{workspace}=req.params,terrainId=req.query.terrainId;if(!workspaceOk(workspace))return res.status(400).json({error:'workspace inválido'});
  const params=[workspace];let sql='select visit_id,terrain_id,payload,created_at from visits where workspace_id=$1';
  if(terrainId){if(!idOk(String(terrainId)))return res.status(400).json({error:'terrainId inválido'});params.push(String(terrainId));sql+=' and terrain_id=$2'}
  sql+=' order by created_at desc limit 1000';const r=await pool.query(sql,params);
  res.json({visits:r.rows.map(x=>({...x.payload,id:x.visit_id,terrainId:x.terrain_id,_serverCreatedAt:x.created_at}))});
});

app.post('/api/workspaces/:workspace/visits',async(req,res)=>{
  const{workspace}=req.params,{terrainId,visit}=req.body||{};
  if(!workspaceOk(workspace)||!idOk(terrainId)||!visit||!idOk(visit.id))return res.status(400).json({error:'visita inválida'});
  const terrain=await pool.query('select 1 from terrains where workspace_id=$1 and terrain_id=$2',[workspace,terrainId]);
  if(!terrain.rowCount)return res.status(409).json({error:'el terreno debe sincronizarse antes de la visita'});
  let payload;try{payload=canonicalVisit(visit)}catch(e){return res.status(400).json({error:e.message})}
  await pool.query(`insert into visits(workspace_id,visit_id,terrain_id,payload) values($1,$2,$3,$4::jsonb) on conflict(workspace_id,visit_id) do update set payload=excluded.payload`,[workspace,visit.id,terrainId,JSON.stringify(payload)]);
  res.json({ok:true,visitId:visit.id,metrics:payload.serverMetrics});
});

app.post('/api/workspaces/:workspace/evidence',upload.single('file'),async(req,res)=>{
  const{workspace}=req.params,{evidenceId,terrainId,visitId,metadata}=req.body||{};
  if(!workspaceOk(workspace)||!idOk(evidenceId)||!idOk(terrainId)||!req.file)return res.status(400).json({error:'evidencia inválida'});
  let meta={};try{meta=metadata?JSON.parse(metadata):{}}catch{return res.status(400).json({error:'metadata inválida'})}
  const terrain=await pool.query('select 1 from terrains where workspace_id=$1 and terrain_id=$2',[workspace,terrainId]);if(!terrain.rowCount)return res.status(409).json({error:'terreno no sincronizado'});
  if(visitId){const visit=await pool.query('select 1 from visits where workspace_id=$1 and visit_id=$2',[workspace,visitId]);if(!visit.rowCount)return res.status(409).json({error:'visita no sincronizada'})}
  const sha256=crypto.createHash('sha256').update(req.file.buffer).digest('hex');meta={...meta,sha256,serverReceivedAt:new Date().toISOString(),bytes:req.file.buffer.length};
  await pool.query(`insert into evidence(workspace_id,evidence_id,terrain_id,visit_id,mime_type,filename,bytes,metadata) values($1,$2,$3,$4,$5,$6,$7,$8::jsonb) on conflict(workspace_id,evidence_id) do update set visit_id=excluded.visit_id,mime_type=excluded.mime_type,filename=excluded.filename,bytes=excluded.bytes,metadata=excluded.metadata`,[workspace,evidenceId,terrainId,visitId||null,req.file.mimetype,req.file.originalname,req.file.buffer,JSON.stringify(meta)]);
  res.json({ok:true,evidenceId,sha256,bytes:req.file.buffer.length});
});

app.get('/api/workspaces/:workspace/evidence/:evidenceId',async(req,res)=>{
  const{workspace,evidenceId}=req.params;if(!workspaceOk(workspace)||!idOk(evidenceId))return res.status(400).json({error:'identificador inválido'});
  const r=await pool.query('select mime_type,filename,bytes,metadata from evidence where workspace_id=$1 and evidence_id=$2',[workspace,evidenceId]);if(!r.rowCount)return res.status(404).json({error:'no encontrada'});
  res.setHeader('Content-Type',r.rows[0].mime_type||'application/octet-stream');res.setHeader('Cache-Control','private, max-age=3600');res.setHeader('X-SLTM-SHA256',r.rows[0].metadata?.sha256||'');res.send(r.rows[0].bytes);
});

app.get('/api/workspaces/:workspace/terrains/:terrainId/report',async(req,res)=>{
  const{workspace,terrainId}=req.params;if(!workspaceOk(workspace)||!idOk(terrainId))return res.status(400).json({error:'identificador inválido'});
  const[t,v,e]=await Promise.all([
    pool.query('select payload,updated_at from terrains where workspace_id=$1 and terrain_id=$2',[workspace,terrainId]),
    pool.query('select visit_id,payload,created_at from visits where workspace_id=$1 and terrain_id=$2 order by created_at desc',[workspace,terrainId]),
    pool.query('select evidence_id,visit_id,mime_type,filename,metadata,created_at,octet_length(bytes) size from evidence where workspace_id=$1 and terrain_id=$2 order by created_at desc',[workspace,terrainId])
  ]);
  if(!t.rowCount)return res.status(404).json({error:'terreno no encontrado'});
  const visits=v.rows.map(x=>({...x.payload,id:x.visit_id,_serverCreatedAt:x.created_at})),allPoints=visits.flatMap(x=>x.points||[]);
  res.json({terrain:{...t.rows[0].payload,_serverUpdatedAt:t.rows[0].updated_at},visits,evidence:e.rows,summary:{visits:visits.length,observations:allPoints.length,evidence:e.rowCount,byKind:counts(allPoints,'kind'),bySeverity:counts(allPoints,'severity'),highSeverity:allPoints.filter(p=>p.severity==='alta').length,lastVisit:visits[0]?.endedAt||visits[0]?._serverCreatedAt||null}});
});

app.get('/api/workspaces/:workspace/export',async(req,res)=>{
  const{workspace}=req.params;if(!workspaceOk(workspace))return res.status(400).json({error:'workspace inválido'});
  const[terrains,visits,evidence]=await Promise.all([
    pool.query('select terrain_id,payload,updated_at from terrains where workspace_id=$1 order by terrain_id',[workspace]),
    pool.query('select visit_id,terrain_id,payload,created_at from visits where workspace_id=$1 order by created_at',[workspace]),
    pool.query('select evidence_id,terrain_id,visit_id,mime_type,filename,metadata,created_at,octet_length(bytes) size from evidence where workspace_id=$1 order by created_at',[workspace])
  ]);
  res.json({workspace,exportedAt:new Date().toISOString(),terrains:terrains.rows,visits:visits.rows,evidence:evidence.rows});
});

app.get('/api/workspaces/:workspace/export.geojson',async(req,res)=>{
  const{workspace}=req.params;if(!workspaceOk(workspace))return res.status(400).json({error:'workspace inválido'});
  const[terrains,visits]=await Promise.all([pool.query('select terrain_id,payload from terrains where workspace_id=$1 order by terrain_id',[workspace]),pool.query('select visit_id,terrain_id,payload from visits where workspace_id=$1 order by created_at',[workspace])]);
  const features=[];
  for(const row of terrains.rows){const t=row.payload||{};if(Array.isArray(t.poly)&&t.poly.length>=3){const ring=t.poly.map(p=>[Number(p[1]),Number(p[0])]);if(ring.length&&(ring[0][0]!==ring.at(-1)[0]||ring[0][1]!==ring.at(-1)[1]))ring.push([...ring[0]]);features.push({type:'Feature',geometry:{type:'Polygon',coordinates:[ring]},properties:{featureType:'terrain',terrainId:row.terrain_id,name:t.name||row.terrain_id,purpose:t.purpose||null,source:t.source||null,area:t.area||null,perimeter:t.perimeter||null,avgAccuracy:t.sourceAccuracy?.avg??null,closure:t.sourceAccuracy?.closure??null}})}}
  for(const row of visits.rows){const v=row.payload||{};if(Array.isArray(v.track)&&v.track.length>=2)features.push({type:'Feature',geometry:{type:'LineString',coordinates:v.track.map(p=>[Number(p.lng),Number(p.lat),finite(p.alt)?Number(p.alt):0])},properties:{featureType:'visit_track',terrainId:row.terrain_id,visitId:row.visit_id,date:v.date||null,distance:v.distance||null,avgAccuracy:v.avgAcc||null,durationSec:v.durationSec||null}});for(const[i,p]of(v.points||[]).entries())if(validLatLng(p))features.push({type:'Feature',geometry:{type:'Point',coordinates:[Number(p.lng),Number(p.lat),finite(p.alt)?Number(p.alt):0]},properties:{featureType:'observation',terrainId:row.terrain_id,visitId:row.visit_id,observationIndex:i+1,kind:p.kind||null,severity:p.severity||null,note:p.note||null,accuracy:p.acc||null,timestamp:p.at||null}});for(const e of(v.evidence||[]))if(validLatLng(e?.gps))features.push({type:'Feature',geometry:{type:'Point',coordinates:[Number(e.gps.lng),Number(e.gps.lat),finite(e.gps.alt)?Number(e.gps.alt):0]},properties:{featureType:'evidence',terrainId:row.terrain_id,visitId:row.visit_id,evidenceId:e.id,observationId:e.observationId||null,kind:e.kind||null,severity:e.severity||null,timestamp:e.at||null,accuracy:e.gps.acc||null}})}
  res.setHeader('Content-Type','application/geo+json; charset=utf-8');res.setHeader('Content-Disposition',`attachment; filename="sltm-${workspace}.geojson"`);res.json({type:'FeatureCollection',name:`SLTM ${workspace}`,features});
});

app.use((err,_req,res,_next)=>{console.error(err);const code=err?.code==='LIMIT_FILE_SIZE'?413:500;res.status(code).json({error:code===413?'La imagen supera 5 MB':(err.message||'Error interno')})});

await ensureSchema();
const server=app.listen(port,'0.0.0.0',()=>console.log(`SLTM API escuchando en ${port}`));
const shutdown=async()=>{server.close();await pool.end();process.exit(0)};
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
