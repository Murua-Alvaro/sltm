import { getMedia } from './mediaDb';

export const WORKSPACE_ID = 'oe-mazatlan-demo-2026-09';
const API = (import.meta.env.VITE_SLTM_API_URL || '').replace(/\/$/, '');
const QUEUE_KEY = 'sltm_sync_queue_v1';

const readQueue = () => {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); } catch { return []; }
};
const writeQueue = q => {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  emit({ pending: q.length });
};
const emit = extra => window.dispatchEvent(new CustomEvent('sltm-sync', { detail: { online: navigator.onLine, apiConfigured: !!API, ...extra } }));
const id = () => `${Date.now()}-${Math.random().toString(36).slice(2,9)}`;

async function request(path, options = {}) {
  if (!API) throw new Error('API no configurada');
  const res = await fetch(`${API}${path}`, options);
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try { const j = await res.json(); message = j.error || message; } catch {}
    throw new Error(message);
  }
  const type = res.headers.get('content-type') || '';
  return type.includes('application/json') ? res.json() : res;
}

export function getSyncSnapshot() {
  return { online: navigator.onLine, apiConfigured: !!API, pending: readQueue().length, api: API };
}

export async function pingApi() {
  if (!API || !navigator.onLine) return false;
  try { const r = await request('/health'); emit({ backend: !!r.ok }); return !!r.ok; }
  catch { emit({ backend: false }); return false; }
}

export async function pullWorkspace() {
  if (!API) return { terrains: [], visits: [] };
  const [t, v] = await Promise.all([
    request(`/api/workspaces/${WORKSPACE_ID}/terrains`),
    request(`/api/workspaces/${WORKSPACE_ID}/visits`)
  ]);
  return { terrains: t.terrains || [], visits: v.visits || [] };
}

function enqueue(op) {
  const q = readQueue();
  if (op.type === 'terrain') {
    const i = q.findIndex(x => x.type === 'terrain' && x.terrainId === op.terrainId);
    if (i >= 0) q.splice(i, 1);
  }
  if (op.type === 'visit' && q.some(x => x.type === 'visit' && x.visit?.id === op.visit?.id)) return flushQueue();
  if (op.type === 'evidence' && q.some(x => x.type === 'evidence' && x.evidenceId === op.evidenceId)) return flushQueue();
  q.push({ queueId: id(), createdAt: new Date().toISOString(), ...op });
  writeQueue(q);
  flushQueue();
}

export function queueTerrain(terrain) {
  enqueue({ type: 'terrain', terrainId: terrain.id, terrain });
}

export function queueVisitBundle(terrainId, visit) {
  enqueue({ type: 'visit', terrainId, visit });
  for (const ev of visit.evidence || []) {
    enqueue({ type: 'evidence', terrainId, visitId: visit.id, evidenceId: ev.id, metadata: ev });
  }
}

let flushing = false;
export async function flushQueue() {
  if (flushing || !API || !navigator.onLine) { emit({ pending: readQueue().length }); return; }
  flushing = true; emit({ syncing: true, backend: true });
  try {
    let q = readQueue();
    while (q.length) {
      const op = q[0];
      try {
        if (op.type === 'terrain') {
          await request(`/api/workspaces/${WORKSPACE_ID}/terrains/${encodeURIComponent(op.terrainId)}`, {
            method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(op.terrain)
          });
        } else if (op.type === 'visit') {
          await request(`/api/workspaces/${WORKSPACE_ID}/visits`, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ terrainId: op.terrainId, visit: op.visit })
          });
        } else if (op.type === 'evidence') {
          const media = await getMedia(op.evidenceId);
          if (!media?.blob) throw new Error('Archivo local de evidencia no disponible');
          const fd = new FormData();
          fd.append('file', media.blob, media.name || 'evidencia.jpg');
          fd.append('evidenceId', op.evidenceId);
          fd.append('terrainId', op.terrainId);
          fd.append('visitId', op.visitId || '');
          fd.append('metadata', JSON.stringify(op.metadata || {}));
          await request(`/api/workspaces/${WORKSPACE_ID}/evidence`, { method: 'POST', body: fd });
        }
        q.shift(); writeQueue(q);
      } catch (err) {
        emit({ backend: false, error: err.message, pending: q.length });
        break;
      }
    }
    if (!q.length) emit({ backend: true, syncedAt: new Date().toISOString(), pending: 0 });
  } finally {
    flushing = false; emit({ syncing: false, pending: readQueue().length });
  }
}

export async function openRemoteEvidence(evidenceId) {
  if (!API) throw new Error('API no configurada');
  const res = await request(`/api/workspaces/${WORKSPACE_ID}/evidence/${encodeURIComponent(evidenceId)}`);
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

export function exportUrl() {
  return API ? `${API}/api/workspaces/${WORKSPACE_ID}/export` : null;
}

window.addEventListener('online', () => { emit({ online: true }); flushQueue(); });
window.addEventListener('offline', () => emit({ online: false }));
