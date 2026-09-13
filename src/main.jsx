import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './styles.css';
import { getMedia, saveMedia } from './mediaDb';

const CATEGORIES = ['Arbolado','Drenaje','Banqueta','Anuncio','Residuo','Obra','Predio','Vialidad','Vegetación','Alumbrado','Accesibilidad','Otro'];
const PRIORITIES = ['Informativa','Revisión','Prioritaria'];
const KEYS = {
  observations: 'sltm_observaciones_v2',
  sessions: 'sltm_recorridos_v2',
  active: 'sltm_recorrido_activo_v2',
  profile: 'sltm_perfil_v2',
  device: 'sltm_dispositivo_v2'
};
const API_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const DEFAULT_CENTER = [23.2494, -106.4111];

function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
function loadJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); } catch { return fallback; }
}
function saveJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}
function formatCoord(value) { return Number.isFinite(value) ? value.toFixed(6) : '—'; }
function formatDistance(meters) { return meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${Math.round(meters)} m`; }
function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const mins = Math.floor(ms / 60000);
  const hours = Math.floor(mins / 60);
  return hours ? `${hours} h ${mins % 60} min` : `${mins} min`;
}
function haversine(a, b) {
  if (!a || !b) return 0;
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function routeDistance(points = []) {
  return points.slice(1).reduce((sum, point, index) => sum + haversine(points[index], point), 0);
}
function averageAccuracy(points = []) {
  const values = points.map(p => p.accuracy).filter(Number.isFinite);
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}
function accuracyClass(value) {
  if (!Number.isFinite(value)) return { label: 'Sin lectura', cls: 'neutral' };
  if (value <= 10) return { label: 'Alta', cls: 'good' };
  if (value <= 25) return { label: 'Media', cls: 'warn' };
  return { label: 'Baja', cls: 'bad' };
}
function download(name, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function toGeoJSON(observations, sessions, active) {
  const features = [];
  observations.forEach(o => features.push({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [o.lon, o.lat] },
    properties: {
      id: o.id,
      categoria: o.categoria,
      prioridad: o.prioridad,
      nota: o.nota,
      precision_m: o.precision,
      fecha: o.fecha,
      estado: o.estado,
      brigadista: o.brigadista,
      dispositivo: o.dispositivo,
      evidencia: Boolean(o.mediaId)
    }
  }));
  [...sessions, ...(active?.points?.length ? [active] : [])].forEach(s => {
    if ((s.points || []).length < 2) return;
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: s.points.map(p => [p.lon, p.lat]) },
      properties: {
        id: s.id,
        nombre: s.nombre,
        inicio: s.startedAt,
        fin: s.endedAt || null,
        brigadista: s.brigadista,
        dispositivo: s.dispositivo,
        distancia_m: routeDistance(s.points),
        precision_media_m: averageAccuracy(s.points),
        estado: s.endedAt ? 'finalizado' : 'activo'
      }
    });
  });
  return { type: 'FeatureCollection', generatedAt: new Date().toISOString(), features };
}

function TerritoryMap({ coords, points, observations, focusToken }) {
  const el = useRef(null);
  const map = useRef(null);
  const routeLayer = useRef(null);
  const obsLayer = useRef(null);
  const currentLayer = useRef(null);
  const locatedOnce = useRef(false);

  useEffect(() => {
    if (!el.current || map.current) return;
    const instance = L.map(el.current, { zoomControl: false, attributionControl: true }).setView(DEFAULT_CENTER, 12);
    L.control.zoom({ position: 'bottomright' }).addTo(instance);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 20,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(instance);
    map.current = instance;
    setTimeout(() => instance.invalidateSize(), 0);
    return () => { instance.remove(); map.current = null; };
  }, []);

  useEffect(() => {
    if (!map.current) return;
    routeLayer.current?.remove();
    if (points.length > 1) {
      routeLayer.current = L.polyline(points.map(p => [p.lat, p.lon]), { color: '#315443', weight: 5, opacity: .92 }).addTo(map.current);
    }
  }, [points]);

  useEffect(() => {
    if (!map.current) return;
    obsLayer.current?.remove();
    const group = L.layerGroup();
    observations.forEach(o => {
      const priorityColor = o.prioridad === 'Prioritaria' ? '#9a4035' : o.prioridad === 'Revisión' ? '#9a6b32' : '#315443';
      L.circleMarker([o.lat, o.lon], { radius: 6, color: priorityColor, fillColor: priorityColor, fillOpacity: .86, weight: 2 })
        .bindTooltip(o.categoria, { direction: 'top' }).addTo(group);
    });
    group.addTo(map.current);
    obsLayer.current = group;
  }, [observations]);

  useEffect(() => {
    if (!map.current || !coords) return;
    currentLayer.current?.remove();
    currentLayer.current = L.circleMarker([coords.lat, coords.lon], { radius: 8, color: '#ffffff', fillColor: '#1f5d80', fillOpacity: 1, weight: 3 }).addTo(map.current);
    if (!locatedOnce.current) {
      map.current.setView([coords.lat, coords.lon], 17);
      locatedOnce.current = true;
    }
  }, [coords]);

  useEffect(() => {
    if (!map.current || !coords || !focusToken) return;
    map.current.flyTo([coords.lat, coords.lon], Math.max(map.current.getZoom(), 17), { duration: .5 });
  }, [focusToken, coords]);

  return <div ref={el} className="real-map" aria-label="Mapa del levantamiento" />;
}

function App() {
  const queryMode = new URLSearchParams(window.location.search).get('modo');
  const [mode, setMode] = useState(['campo', 'observacion', 'datos', 'sistema'].includes(queryMode) ? queryMode : 'resumen');
  const [coords, setCoords] = useState(null);
  const [accuracy, setAccuracy] = useState(null);
  const [tracking, setTracking] = useState(false);
  const [observations, setObservations] = useState(() => loadJSON(KEYS.observations, []));
  const [sessions, setSessions] = useState(() => loadJSON(KEYS.sessions, []));
  const [active, setActive] = useState(() => loadJSON(KEYS.active, null));
  const [profile, setProfile] = useState(() => loadJSON(KEYS.profile, { nombre: '', brigada: '' }));
  const [deviceId] = useState(() => {
    const saved = localStorage.getItem(KEYS.device);
    if (saved) return saved;
    const id = `DISP-${uuid().slice(0, 8).toUpperCase()}`;
    localStorage.setItem(KEYS.device, id);
    return id;
  });
  const [category, setCategory] = useState('Arbolado');
  const [priority, setPriority] = useState('Informativa');
  const [note, setNote] = useState('');
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState('');
  const [message, setMessage] = useState('Sistema listo.');
  const [online, setOnline] = useState(navigator.onLine);
  const [rejected, setRejected] = useState(0);
  const [focusToken, setFocusToken] = useState(0);
  const [installPrompt, setInstallPrompt] = useState(null);
  const [storageInfo, setStorageInfo] = useState(null);
  const [orientation, setOrientation] = useState(null);
  const [evidenceUrl, setEvidenceUrl] = useState('');
  const [dataTab, setDataTab] = useState('observaciones');
  const watchRef = useRef(null);
  const fileRef = useRef(null);
  const orientationHandler = useRef(null);

  const activePoints = active?.points || [];

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    const onInstall = e => { e.preventDefault(); setInstallPrompt(e); };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener('beforeinstallprompt', onInstall);
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
    if (navigator.storage?.estimate) navigator.storage.estimate().then(setStorageInfo).catch(() => {});
    navigator.storage?.persist?.().catch(() => {});
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('beforeinstallprompt', onInstall);
      if (watchRef.current !== null && navigator.geolocation) navigator.geolocation.clearWatch(watchRef.current);
      if (orientationHandler.current) window.removeEventListener('deviceorientation', orientationHandler.current);
      if (evidenceUrl) URL.revokeObjectURL(evidenceUrl);
    };
  }, []);

  useEffect(() => saveJSON(KEYS.observations, observations), [observations]);
  useEffect(() => saveJSON(KEYS.sessions, sessions), [sessions]);
  useEffect(() => saveJSON(KEYS.active, active), [active]);
  useEffect(() => saveJSON(KEYS.profile, profile), [profile]);
  useEffect(() => () => { if (photoPreview) URL.revokeObjectURL(photoPreview); }, [photoPreview]);

  const completedDistance = useMemo(() => sessions.reduce((sum, s) => sum + routeDistance(s.points), 0), [sessions]);
  const currentDistance = useMemo(() => routeDistance(activePoints), [activePoints]);
  const currentAccuracy = useMemo(() => averageAccuracy(activePoints), [activePoints]);
  const pending = observations.filter(o => o.estado !== 'enviado').length + sessions.filter(s => s.estado !== 'enviado').length;
  const quality = accuracyClass(accuracy);

  const updatePosition = position => {
    const next = {
      lat: position.coords.latitude,
      lon: position.coords.longitude,
      alt: position.coords.altitude,
      speed: position.coords.speed,
      heading: position.coords.heading,
      accuracy: position.coords.accuracy,
      at: new Date(position.timestamp).toISOString()
    };
    setCoords(next);
    setAccuracy(position.coords.accuracy);
    return next;
  };

  const appendTrackPoint = next => {
    setActive(prev => {
      if (!prev) return prev;
      if (Number.isFinite(next.accuracy) && next.accuracy > 80) { setRejected(r => r + 1); return prev; }
      const points = prev.points || [];
      const last = points[points.length - 1];
      if (last) {
        const d = haversine(last, next);
        const dt = new Date(next.at) - new Date(last.at);
        if (d < 1.5 && dt < 10000) return prev;
      }
      return { ...prev, points: [...points, next], updatedAt: new Date().toISOString() };
    });
  };

  const requestPosition = () => {
    if (!navigator.geolocation) { setMessage('Geolocalización no disponible en este dispositivo.'); return; }
    setMessage('Obteniendo posición de alta precisión…');
    navigator.geolocation.getCurrentPosition(
      p => { updatePosition(p); setMessage('Posición actualizada.'); },
      err => setMessage(`No fue posible obtener ubicación: ${err.message || 'revisa permisos.'}`),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  };

  const beginWatch = () => {
    if (!navigator.geolocation || watchRef.current !== null) return;
    const id = navigator.geolocation.watchPosition(
      p => { const next = updatePosition(p); appendTrackPoint(next); },
      err => setMessage(`Seguimiento GPS interrumpido: ${err.message || 'se conservaron los datos locales.'}`),
      { enableHighAccuracy: true, maximumAge: 500, timeout: 20000 }
    );
    watchRef.current = id;
    setTracking(true);
  };

  const startTrack = () => {
    if (!active) {
      const now = new Date();
      setActive({
        id: uuid(),
        nombre: `Levantamiento ${now.toLocaleDateString('es-MX')} ${now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}`,
        startedAt: now.toISOString(),
        endedAt: null,
        points: [],
        brigadista: profile.nombre || 'Sin identificar',
        brigada: profile.brigada || '',
        dispositivo: deviceId,
        estado: 'local'
      });
    }
    beginWatch();
    setMode('campo');
    setMessage('Levantamiento activo. El sistema filtra lecturas GPS de muy baja calidad y conserva el recorrido localmente.');
  };

  const pauseTrack = () => {
    if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current);
    watchRef.current = null;
    setTracking(false);
    setMessage('Levantamiento pausado. Puedes reanudarlo sin perder puntos.');
  };

  const finishTrack = () => {
    pauseTrack();
    if (!active) return;
    const endedAt = new Date().toISOString();
    const finalized = { ...active, endedAt, estado: 'local' };
    setSessions(prev => [finalized, ...prev]);
    setActive(null);
    setMessage(`Levantamiento finalizado: ${formatDistance(routeDistance(finalized.points))} y ${finalized.points.length} posiciones válidas.`);
  };

  const onPhoto = e => {
    const file = e.target.files?.[0] || null;
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoFile(file);
    setPhotoPreview(file ? URL.createObjectURL(file) : '');
  };

  const addObservation = async () => {
    if (!coords) { requestPosition(); setMessage('Primero obtén una posición válida y vuelve a guardar.'); return; }
    const id = uuid();
    let mediaId = null;
    if (photoFile) {
      try { await saveMedia(id, photoFile); mediaId = id; }
      catch { setMessage('La observación se guardará, pero la evidencia no pudo almacenarse en este navegador.'); }
    }
    const item = {
      id,
      categoria: category,
      prioridad: priority,
      nota: note.trim(),
      lat: coords.lat,
      lon: coords.lon,
      precision: accuracy,
      altitud: coords.alt,
      rumbo: coords.heading ?? orientation,
      fecha: new Date().toISOString(),
      sessionId: active?.id || null,
      brigadista: profile.nombre || 'Sin identificar',
      brigada: profile.brigada || '',
      dispositivo: deviceId,
      conectadoAlCapturar: online,
      estado: 'local',
      mediaId,
      fotoNombre: photoFile?.name || null,
      fotoTipo: photoFile?.type || null
    };
    setObservations(prev => [item, ...prev]);
    setNote('');
    setPriority('Informativa');
    setPhotoFile(null);
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoPreview('');
    if (fileRef.current) fileRef.current.value = '';
    setMessage('Observación almacenada localmente con trazabilidad de dispositivo y precisión GPS.');
    setMode('campo');
  };

  const openEvidence = async mediaId => {
    try {
      const item = await getMedia(mediaId);
      if (!item?.blob) { setMessage('No se encontró la evidencia en este dispositivo.'); return; }
      if (evidenceUrl) URL.revokeObjectURL(evidenceUrl);
      setEvidenceUrl(URL.createObjectURL(item.blob));
    } catch { setMessage('No fue posible abrir la evidencia local.'); }
  };
  const closeEvidence = () => {
    if (evidenceUrl) URL.revokeObjectURL(evidenceUrl);
    setEvidenceUrl('');
  };

  const syncServer = async () => {
    if (!API_URL) { setMessage('Servidor central aún no configurado. Los registros siguen seguros en este dispositivo; usa Exportar respaldo.'); return; }
    if (!online) { setMessage('Sin conexión. No se intentó enviar nada.'); return; }
    const pendingObs = observations.filter(o => o.estado !== 'enviado');
    const pendingSessions = sessions.filter(s => s.estado !== 'enviado');
    if (!pendingObs.length && !pendingSessions.length) { setMessage('No hay registros pendientes de envío.'); return; }
    setMessage('Enviando datos al servidor central…');
    try {
      const response = await fetch(`${API_URL}/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dispositivo: deviceId, perfil: profile, observaciones: pendingObs, recorridos: pendingSessions })
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const sentAt = new Date().toISOString();
      setObservations(prev => prev.map(o => o.estado === 'enviado' ? o : { ...o, estado: 'enviado', enviadoAt: sentAt }));
      setSessions(prev => prev.map(s => s.estado === 'enviado' ? s : { ...s, estado: 'enviado', enviadoAt: sentAt }));
      setMessage('Servidor confirmó la recepción de los registros.');
    } catch (err) {
      setMessage(`El servidor no confirmó el envío (${err.message}). Nada fue marcado como enviado.`);
    }
  };

  const activateOrientation = async () => {
    try {
      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        const granted = await DeviceOrientationEvent.requestPermission();
        if (granted !== 'granted') throw new Error('permiso denegado');
      }
      const handler = e => {
        const heading = Number.isFinite(e.webkitCompassHeading) ? e.webkitCompassHeading : (Number.isFinite(e.alpha) ? (360 - e.alpha) % 360 : null);
        if (heading !== null) setOrientation(Math.round(heading));
      };
      if (orientationHandler.current) window.removeEventListener('deviceorientation', orientationHandler.current);
      orientationHandler.current = handler;
      window.addEventListener('deviceorientation', handler, true);
      setMessage('Sensor de orientación activado para esta sesión.');
    } catch {
      setMessage('El dispositivo no permitió acceso al sensor de orientación.');
    }
  };

  const installApp = async () => {
    if (installPrompt) {
      installPrompt.prompt();
      await installPrompt.userChoice.catch(() => null);
      setInstallPrompt(null);
      return;
    }
    const isiOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    setMessage(isiOS ? 'En iPhone: Safari → Compartir → Añadir a pantalla de inicio.' : 'En el menú del navegador busca “Instalar aplicación” o “Agregar a pantalla principal”.');
  };

  const exportBackup = () => {
    download(`sltm-respaldo-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ version: 2, dispositivo: deviceId, perfil: profile, observaciones, recorridos: sessions, recorridoActivo: active }, null, 2), 'application/json');
  };
  const exportGeo = () => {
    download(`sltm-geodatos-${new Date().toISOString().slice(0, 10)}.geojson`, JSON.stringify(toGeoJSON(observations, sessions, active), null, 2), 'application/geo+json');
  };

  const storageUsed = storageInfo?.usage ? `${(storageInfo.usage / 1024 / 1024).toFixed(1)} MB` : '—';
  const storageQuota = storageInfo?.quota ? `${(storageInfo.quota / 1024 / 1024).toFixed(0)} MB` : '—';

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">SL</div>
          <div><strong>Sistema de Levantamiento Territorial</strong><span>Captura móvil distribuida</span></div>
        </div>
        <nav>
          <Nav current={mode} id="resumen" onClick={setMode}>Resumen</Nav>
          <Nav current={mode} id="campo" onClick={setMode}>Levantamiento</Nav>
          <Nav current={mode} id="observacion" onClick={setMode}>Registrar observación</Nav>
          <Nav current={mode} id="datos" onClick={setMode}>Historial y datos</Nav>
          <Nav current={mode} id="sistema" onClick={setMode}>Sistema</Nav>
        </nav>
        <div className="sidebar-footer">
          <div className="device-code">{deviceId}</div>
          <div className="connection"><span className={online ? 'dot online' : 'dot'} />{online ? 'Con conexión' : 'Modo sin conexión'}</div>
        </div>
      </aside>

      <main>
        <header className="topbar">
          <div><p className="eyebrow">SLTM · OPERACIÓN DE CAMPO</p><h1>{titleFor(mode)}</h1></div>
          <div className="top-actions">
            <span className={`quality ${quality.cls}`}>GPS {quality.label}{Number.isFinite(accuracy) ? ` · ±${Math.round(accuracy)} m` : ''}</span>
            <button className="icon-button" onClick={installApp}>Instalar</button>
          </div>
        </header>
        <div className="message-bar" role="status"><span>{message}</span><span className={online ? 'net online-text' : 'net'}>{online ? 'EN LÍNEA' : 'SIN CONEXIÓN'}</span></div>

        {mode === 'resumen' && <Dashboard sessions={sessions} observations={observations} pending={pending} distance={completedDistance} active={active} onStart={startTrack} onPoint={() => { setMode('observacion'); requestPosition(); }} onSystem={() => setMode('sistema')} profile={profile} />}

        {mode === 'campo' && (
          <section className="field-layout">
            <div className="map-panel panel">
              <TerritoryMap coords={coords} points={activePoints} observations={observations.filter(o => !active || !o.sessionId || o.sessionId === active.id)} focusToken={focusToken} />
              <div className="map-toolbar">
                <button onClick={() => { requestPosition(); setFocusToken(t => t + 1); }}>Centrar en mí</button>
                <span>{tracking ? '● CAPTURANDO' : active ? 'PAUSADO' : 'SIN SESIÓN'}</span>
              </div>
            </div>
            <div className="side-stack">
              <div className="panel controls">
                <div className="section-heading"><div><p className="eyebrow">SESIÓN ACTUAL</p><h2>{active?.nombre || 'Sin levantamiento activo'}</h2></div><span className={`session-state ${tracking ? 'live' : ''}`}>{tracking ? 'ACTIVO' : active ? 'PAUSADO' : '—'}</span></div>
                <div className="live-grid">
                  <Readout label="Distancia" value={active ? formatDistance(currentDistance) : '—'} />
                  <Readout label="Puntos válidos" value={activePoints.length} />
                  <Readout label="Precisión media" value={currentAccuracy ? `±${Math.round(currentAccuracy)} m` : '—'} />
                  <Readout label="Lecturas descartadas" value={rejected} />
                </div>
                {!active ? <button className="primary full" onClick={startTrack}>Iniciar levantamiento</button> : !tracking ? <button className="primary full" onClick={() => { beginWatch(); setMessage('Levantamiento reanudado.'); }}>Reanudar</button> : <button className="secondary full" onClick={pauseTrack}>Pausar</button>}
                {active && <><button className="secondary full" onClick={() => setMode('observacion')}>Registrar observación</button><button className="finish full" onClick={finishTrack}>Finalizar y guardar recorrido</button></>}
              </div>
              <div className="panel telemetry">
                <div className="section-heading"><h3>Telemetría</h3><button className="text-button" onClick={requestPosition}>Actualizar</button></div>
                <Sensor label="Latitud" value={coords ? formatCoord(coords.lat) : '—'} />
                <Sensor label="Longitud" value={coords ? formatCoord(coords.lon) : '—'} />
                <Sensor label="Precisión" value={accuracy ? `±${Math.round(accuracy)} m` : '—'} />
                <Sensor label="Velocidad" value={Number.isFinite(coords?.speed) ? `${(coords.speed * 3.6).toFixed(1)} km/h` : '—'} />
                <Sensor label="Rumbo" value={Number.isFinite(coords?.heading) ? `${Math.round(coords.heading)}°` : Number.isFinite(orientation) ? `${orientation}°` : '—'} />
                <button className="quiet full" onClick={activateOrientation}>Activar orientación</button>
              </div>
            </div>
          </section>
        )}

        {mode === 'observacion' && (
          <section className="observation-layout">
            <div className="panel form-panel">
              <div className="section-heading"><div><p className="eyebrow">REGISTRO GEOREFERENCIADO</p><h2>Nueva observación</h2></div><span className={`quality ${quality.cls}`}>{accuracy ? `±${Math.round(accuracy)} m` : 'GPS pendiente'}</span></div>
              <label>Categoría técnica</label>
              <div className="category-grid">{CATEGORIES.map(c => <button key={c} className={category === c ? 'category active' : 'category'} onClick={() => setCategory(c)}>{c}</button>)}</div>
              <label>Prioridad de revisión</label>
              <div className="priority-row">{PRIORITIES.map(p => <button key={p} className={`priority-button ${priority === p ? `active ${p.toLowerCase()}` : ''}`} onClick={() => setPriority(p)}>{p}</button>)}</div>
              <label htmlFor="nota">Nota técnica</label>
              <textarea id="nota" value={note} onChange={e => setNote(e.target.value)} placeholder="Describe el hallazgo de forma verificable: ubicación, condición y evidencia relevante…" />
              <div className="location-box">
                <div><span>Coordenada</span><strong>{coords ? `${formatCoord(coords.lat)}, ${formatCoord(coords.lon)}` : 'Sin lectura'}</strong></div>
                <div><span>Precisión</span><strong>{accuracy ? `±${Math.round(accuracy)} m` : '—'}</strong></div>
              </div>
              <div className="action-row"><button className="secondary" onClick={requestPosition}>Actualizar ubicación</button><button className="primary" onClick={addObservation}>Guardar registro</button></div>
            </div>
            <div className="panel evidence-panel">
              <p className="eyebrow">EVIDENCIA DE CAMPO</p><h2>Fotografía</h2>
              <div className={`photo-frame ${photoPreview ? 'has-photo' : ''}`}>{photoPreview ? <img src={photoPreview} alt="Vista previa de evidencia" /> : <><div className="camera-symbol">◎</div><strong>Sin evidencia seleccionada</strong><p>La imagen se guarda en el dispositivo mediante almacenamiento local estructurado.</p></>}</div>
              <label className="camera-button">Abrir cámara<input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={onPhoto} /></label>
              {photoFile && <div className="file-meta"><span>{photoFile.name}</span><span>{(photoFile.size / 1024 / 1024).toFixed(2)} MB</span></div>}
            </div>
          </section>
        )}

        {mode === 'datos' && (
          <section>
            <div className="data-header">
              <div><p className="eyebrow">HISTORIAL LOCAL</p><h2>Datos capturados</h2></div>
              <div className="segmented"><button className={dataTab === 'observaciones' ? 'active' : ''} onClick={() => setDataTab('observaciones')}>Observaciones · {observations.length}</button><button className={dataTab === 'recorridos' ? 'active' : ''} onClick={() => setDataTab('recorridos')}>Recorridos · {sessions.length}</button></div>
            </div>
            {dataTab === 'observaciones' ? <ObservationList observations={observations} onEvidence={openEvidence} /> : <SessionList sessions={sessions} />}
          </section>
        )}

        {mode === 'sistema' && (
          <section className="system-grid">
            <div className="panel system-card">
              <p className="eyebrow">IDENTIFICACIÓN DE CAMPO</p><h2>Brigadista y equipo</h2>
              <label>Nombre o clave del brigadista</label><input value={profile.nombre} onChange={e => setProfile(p => ({ ...p, nombre: e.target.value }))} placeholder="Ej. BR-014 / Álvaro Murúa" />
              <label>Brigada o equipo</label><input value={profile.brigada} onChange={e => setProfile(p => ({ ...p, brigada: e.target.value }))} placeholder="Ej. Brigada Centro" />
              <div className="device-box"><span>Identificador del dispositivo</span><strong>{deviceId}</strong></div>
            </div>
            <div className="panel system-card">
              <p className="eyebrow">INTEGRIDAD LOCAL</p><h2>Estado técnico</h2>
              <Sensor label="HTTPS / contexto seguro" value={window.isSecureContext ? 'Correcto' : 'No disponible'} />
              <Sensor label="Conectividad" value={online ? 'Con conexión' : 'Trabajo sin conexión'} />
              <Sensor label="Almacenamiento usado" value={storageUsed} />
              <Sensor label="Cuota estimada" value={storageQuota} />
              <Sensor label="Servidor central" value={API_URL ? 'Configurado' : 'No configurado'} />
              <button className="secondary full" onClick={installApp}>Instalar en este dispositivo</button>
            </div>
            <div className="panel system-card">
              <p className="eyebrow">RESPALDO</p><h2>Exportación técnica</h2>
              <p>JSON y GeoJSON respaldan los metadatos y geodatos. Las fotografías permanecen guardadas localmente en este dispositivo.</p>
              <button className="secondary full" onClick={exportBackup}>Exportar respaldo JSON</button>
              <button className="secondary full" onClick={exportGeo}>Exportar GeoJSON</button>
            </div>
            <div className="panel system-card">
              <p className="eyebrow">SINCRONIZACIÓN CENTRAL</p><h2>Estado verificable</h2>
              <p>{API_URL ? 'La app tiene un servidor configurado. Sólo marcará registros como enviados después de recibir confirmación HTTP.' : 'Aún no existe un servidor central configurado. Ningún registro se mostrará falsamente como sincronizado.'}</p>
              <div className="sync-count"><strong>{pending}</strong><span>registros pendientes</span></div>
              <button className="primary full" onClick={syncServer} disabled={!API_URL}>Enviar al servidor</button>
            </div>
          </section>
        )}
      </main>

      <nav className="mobile-nav">
        <Nav current={mode} id="resumen" onClick={setMode}>Resumen</Nav>
        <Nav current={mode} id="campo" onClick={setMode}>Campo</Nav>
        <Nav current={mode} id="observacion" onClick={setMode}>Registrar</Nav>
        <Nav current={mode} id="datos" onClick={setMode}>Datos</Nav>
        <Nav current={mode} id="sistema" onClick={setMode}>Sistema</Nav>
      </nav>

      {evidenceUrl && <div className="modal" onClick={closeEvidence}><div className="modal-card" onClick={e => e.stopPropagation()}><img src={evidenceUrl} alt="Evidencia de campo" /><button onClick={closeEvidence}>Cerrar evidencia</button></div></div>}
    </div>
  );
}

function titleFor(mode) {
  return ({ resumen: 'Centro de operación', campo: 'Levantamiento territorial', observacion: 'Registro de campo', datos: 'Historial y control', sistema: 'Configuración del sistema' })[mode] || 'SLTM';
}
function Nav({ current, id, onClick, children }) { return <button className={current === id ? 'active' : ''} onClick={() => onClick(id)}>{children}</button>; }
function Readout({ label, value }) { return <div className="readout"><span>{label}</span><strong>{value}</strong></div>; }
function Sensor({ label, value }) { return <div className="sensor-row"><span>{label}</span><strong>{value}</strong></div>; }

function Dashboard({ sessions, observations, pending, distance, active, onStart, onPoint, onSystem, profile }) {
  return <section>
    <div className="metric-grid">
      <Metric label="Recorridos" value={sessions.length} detail="finalizados localmente" />
      <Metric label="Distancia levantada" value={formatDistance(distance)} detail="histórico local" />
      <Metric label="Observaciones" value={observations.length} detail="registros georreferenciados" />
      <Metric label="Pendientes" value={pending} detail="sin confirmación central" />
    </div>
    <div className="dashboard-grid">
      <div className="panel hero-panel">
        <div className="hero-copy"><p className="eyebrow">CAPTURA TERRITORIAL DISTRIBUIDA</p><h2>Un dispositivo de campo, no un formulario.</h2><p>Registra recorridos, evidencia, precisión GPS y observaciones estructuradas. Los datos permanecen disponibles aun cuando se pierde la conexión.</p></div>
        <div className="action-row"><button className="primary" onClick={onStart}>{active ? 'Continuar levantamiento' : 'Iniciar levantamiento'}</button><button className="secondary" onClick={onPoint}>Registrar punto</button></div>
      </div>
      <div className="panel readiness-card">
        <p className="eyebrow">PREPARACIÓN DE JORNADA</p><h3>{profile.nombre ? `Operador: ${profile.nombre}` : 'Identifica al brigadista antes de salir'}</h3>
        <Checklist ok={Boolean(profile.nombre)} text="Brigadista identificado" />
        <Checklist ok={window.isSecureContext} text="Conexión segura para GPS y cámara" />
        <Checklist ok={Boolean(navigator.geolocation)} text="Geolocalización disponible" />
        <Checklist ok={Boolean(window.indexedDB)} text="Almacenamiento de evidencia disponible" />
        <button className="text-button" onClick={onSystem}>Revisar configuración →</button>
      </div>
    </div>
    <div className="panel recent-panel">
      <div className="section-heading"><div><p className="eyebrow">ACTIVIDAD RECIENTE</p><h3>Últimos levantamientos</h3></div><span>{sessions.length ? `${sessions.length} guardados` : 'Sin historial'}</span></div>
      {sessions.length ? <div className="recent-list">{sessions.slice(0, 4).map(s => <div className="recent-item" key={s.id}><div><strong>{s.nombre}</strong><span>{new Date(s.startedAt).toLocaleString('es-MX')}</span></div><div><strong>{formatDistance(routeDistance(s.points))}</strong><span>{s.points.length} puntos</span></div></div>)}</div> : <div className="empty">El primer recorrido finalizado aparecerá aquí.</div>}
    </div>
  </section>;
}
function Metric({ label, value, detail }) { return <div className="metric"><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>; }
function Checklist({ ok, text }) { return <div className="check-row"><span className={ok ? 'check ok' : 'check'}>{ok ? '✓' : '!'}</span><span>{text}</span></div>; }

function ObservationList({ observations, onEvidence }) {
  if (!observations.length) return <div className="panel empty">Todavía no hay observaciones capturadas.</div>;
  return <div className="panel records-panel"><div className="records">{observations.map(o => <article key={o.id} className="record">
    <div className="record-main"><div className="record-tags"><span className="record-type">{o.categoria}</span><span className={`priority-tag ${o.prioridad?.toLowerCase()}`}>{o.prioridad}</span></div><strong>{o.nota || 'Sin nota adicional'}</strong><small>{formatCoord(o.lat)}, {formatCoord(o.lon)} · ±{Math.round(o.precision || 0)} m · {o.dispositivo}</small></div>
    <div className="record-meta"><span>{new Date(o.fecha).toLocaleString('es-MX')}</span><span className={o.estado === 'enviado' ? 'synced' : 'pending'}>{o.estado === 'enviado' ? 'Enviado' : 'Local'}</span>{o.mediaId && <button className="text-button" onClick={() => onEvidence(o.mediaId)}>Ver evidencia</button>}</div>
  </article>)}</div></div>;
}
function SessionList({ sessions }) {
  if (!sessions.length) return <div className="panel empty">Todavía no hay recorridos finalizados.</div>;
  return <div className="session-list">{sessions.map(s => <article className="panel session-card" key={s.id}><div><span className="record-type">{s.estado === 'enviado' ? 'Enviado' : 'Local'}</span><h3>{s.nombre}</h3><p>{s.brigadista} {s.brigada ? `· ${s.brigada}` : ''}</p></div><div className="session-stats"><Readout label="Distancia" value={formatDistance(routeDistance(s.points))} /><Readout label="Duración" value={formatDuration(new Date(s.endedAt) - new Date(s.startedAt))} /><Readout label="Puntos" value={s.points.length} /><Readout label="Precisión media" value={averageAccuracy(s.points) ? `±${Math.round(averageAccuracy(s.points))} m` : '—'} /></div></article>)}</div>;
}

createRoot(document.getElementById('root')).render(<App />);
