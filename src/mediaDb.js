const DB_NAME = 'sltm_local';
const DB_VERSION = 1;
const STORE = 'media';

function openDb() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDB no disponible'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('No fue posible abrir almacenamiento local'));
  });
}

export async function prepareImage(file, { maxDimension = 1600, quality = 0.82 } = {}) {
  if (!file || !file.type?.startsWith('image/')) return file;
  if (file.size <= 1.8 * 1024 * 1024 && /image\/(jpeg|webp)/i.test(file.type)) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob) return file;
    const base = (file.name || 'evidencia').replace(/\.[^.]+$/, '');
    return new File([blob], `${base}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
  } catch {
    return file;
  }
}

export async function saveMedia(id, file) {
  const stored = await prepareImage(file);
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({ id, blob: stored, name: stored?.name || file?.name || 'evidencia.jpg', type: stored?.type || file?.type || 'image/jpeg', size: stored?.size || file?.size || 0, originalSize: file?.size || 0, createdAt: new Date().toISOString() });
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error || new Error('No fue posible guardar la evidencia'));
  });
  db.close();
  return { id, size: stored?.size || 0, originalSize: file?.size || 0, name: stored?.name || file?.name || 'evidencia.jpg' };
}

export async function getMedia(id) {
  if (!id) return null;
  const db = await openDb();
  const result = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error || new Error('No fue posible leer la evidencia'));
  });
  db.close();
  return result;
}
