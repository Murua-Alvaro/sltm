import React, { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './field-v4.css';
import { getMedia, saveMedia } from './mediaDb';

const DEFAULT_CENTER = [23.2494, -106.4111];
const API_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const CATEGORIES = ['Arbolado','Drenaje','Banqueta','Anuncio','Residuo','Obra','Predio','Vialidad','Vegetación','Alumbrado','Accesibilidad','Otro'];
const PRIORITIES = ['Informativa','Revisión','Prioritaria'];
const KEYS = {
  sessions: 'sltm_recorridos_v2',
  active: 'sltm_recorrido_activo_v2',
  observations: 'sltm_observaciones_v2',
  profile: 'sltm_perfil_v2',
  device: 'sltm_dispositivo_v2'
};

const uuid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const finite = value => Number.isFinite(value);
const load = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); } catch { return fallback; } };
const save = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };
const fmtCoord = value => finite(value) ? value.toFixed(6) : '—';
const fmtAlt = value => finite(value) ? `${value.toFixed(1)} m` : '—';
const fmtDistance = value => !finite(value) ? '—' : value >= 1000 ? `${(value / 1000).toFixed(2)} km` : `${Math.round(value)} m`;
const fmtDuration = ms => {
  if (!finite(ms) || ms < 0) return '—';
  const seconds = Math.floor(ms / 1000);
  const s = seconds % 60;
  const minutes = Math.floor(seconds / 60);
  const m = minutes % 60;
  const h = Math.floor(minutes / 60);
  return h ? `${h} h ${m} min` : minutes ? `${minutes} min ${String(s).padStart(2,'0')} s` : `${s} s`;
};
const median = values => {
  const arr = values.filter(finite).sort((a,b) => a-b);
  if (!arr.length) return null;
  const mid = Math.floor(arr.length / 2);
  return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
};
const haversine = (a,b) => {
  if (!a || !b) return 0;
  const R = 6371000;
  const rad = value => value * Math.PI / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const lat1 = rad(a.lat);
  const lat2 = rad(b.lat);
  const q = Math.sin(dLat/2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon/2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(q));
};
const routeDistance = points => (points || []).slice(1).reduce((sum, point, index) => sum + haversine(points[index], point), 0);
const avgAccuracy = points => {
  const values = (points || []).map(point => point.accuracy).filter(finite);
  return values.length ? values.reduce((a,b) => a + b, 0) / values.length : null;
};
const verticalQuality = (altitude, accuracy) => {
  if (!finite(altitude)) return { label:'Sin cota', cls:'neutral' };
  if (!finite(accuracy)) return { label:'Indicativa', cls:'warn' };
  if (accuracy <= 4) return { label:'Buena', cls:'good' };
  if (accuracy <= 10) return { label:'Media', cls:'warn' };
  return { label:'Baja', cls:'bad' };
};
const gpsQuality = accuracy => {
  if (!finite(accuracy)) return { label:'Sin lectura', cls:'neutral' };
  if (accuracy <= 8) return { label:'Alta', cls:'good' };
  if (accuracy <= 20) return { label:'Media', cls:'warn' };
  return { label:'Baja', cls:'bad' };
};

function useStoredState(key, initial) {
  const [value, setValue] = useState(() => load(key, initial));
  useEffect(() => save(key, value), [key, value]);
  return [value, setValue];
}

function getDeviceId() {
  const current = localStorage.getItem(KEYS.device);
  if (current) return current;
  const id = `DISP-${uuid().slice(0,8).toUpperCase()}`;
  localStorage.setItem(KEYS.device, id);
  return id;
}

function toPoint(position) {
  return {
    lat: position.coords.latitude,
    lon: position.coords.longitude,
    alt: position.coords.altitude,
    altAccuracy: position.coords.altitudeAccuracy,
    accuracy: position.coords.accuracy,
    speed: position.coords.speed,
    heading: position.coords.heading,
    at: new Date(position.timestamp).toISOString()
  };
}

function FieldMap({ coords, points = [], observations = [], focusToken = 0 }) {
  const node = useRef(null);
  const map = useRef(null);
  const route = useRef(null);
  const current = useRef(null);
  const obs = useRef(null);

  useEffect(() => {
    if (!node.current || map.current) return;
    const instance = L.map(node.current, { zoomControl:false }).setView(DEFAULT_CENTER, 12);
    L.control.zoom({ position:'bottomright' }).addTo(instance);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom:20, attribution:'&copy; OpenStreetMap' }).addTo(instance);
    map.current = instance;
    setTimeout(() => instance.invalidateSize(), 0);
    return () => { instance.remove(); map.current = null; };
  }, []);

  useEffect(() => {
    if (!map.current) return;
    route.current?.remove();
    if (points.length > 1) route.current = L.polyline(points.map(p => [p.lat,p.lon]), { color:'#315443', weight:5, opacity:.94 }).addTo(map.current);
  }, [points]);

  useEffect(() => {
    if (!map.current) return;
    obs.current?.remove();
    const group = L.layerGroup();
    observations.forEach(item => {
      const color = item.prioridad === 'Prioritaria' ? '#994637' : item.prioridad === 'Revisión' ? '#956629' : '#315443';
      L.circleMarker([item.lat,item.lon], { radius:5, color, fillColor:color, fillOpacity:.88, weight:2 }).bindTooltip(item.categoria).addTo(group);
    });
    group.addTo(map.current);
    obs.current = group;
  }, [observations]);

  useEffect(() => {
    if (!map.current || !coords) return;
    current.current?.remove();
    current.current = L.circleMarker([coords.lat,coords.lon], { radius:8, color:'#fff', fillColor:'#1e5f82', fillOpacity:1, weight:3 }).addTo(map.current);
  }, [coords]);

  useEffect(() => {
    if (!map.current || !coords || !focusToken) return;
    map.current.flyTo([coords.lat,coords.lon], 18, { duration:.5 });
  }, [focusToken, coords]);

  return <div ref={node} className="v4-map" />;
}

export default function AppV4() {
  const [mode, setMode] = useState('resumen');
  const [sessions, setSessions] = useStoredState(KEYS.sessions, []);
  const [active, setActive] = useStoredState(KEYS.active, null);
  const [observations, setObservations] = useStoredState(KEYS.observations, []);
  const [profile, setProfile] = useStoredState(KEYS.profile, { nombre:'', brigada:'' });
  const [deviceId] = useState(getDeviceId);
  const [coords, setCoords] = useState(null);
  const [tracking, setTracking] = useState(false);
  const [rejected, setRejected] = useState(0);
  const [orientation, setOrientation] = useState({ heading:null, pitch:null, roll:null });
  const [online, setOnline] = useState(navigator.onLine);
  const [message, setMessage] = useState('Sistema listo para operación web.');
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [now, setNow] = useState(Date.now());
  const [focusToken, setFocusToken] = useState(0);
  const [category, setCategory] = useState('Arbolado');
  const [priority, setPriority] = useState('Informativa');
  const [note, setNote] = useState('');
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState('');
  const [evidenceUrl, setEvidenceUrl] = useState('');

  const watchRef = useRef(null);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const wakeRef = useRef(null);
  const orientationHandler = useRef(null);

  const points = active?.points || [];
  const distance = useMemo(() => routeDistance(points), [points]);
  const avgGps = useMemo(() => avgAccuracy(points), [points]);
  const recentAltitude = useMemo(() => median([...points.slice(-5).map(p => p.alt), coords?.alt]), [points, coords]);
  const baseAltitude = finite(active?.baseAltitude) ? active.baseAltitude : finite(points[0]?.alt) ? points[0].alt : null;
  const desnivel = finite(recentAltitude) && finite(baseAltitude) ? recentAltitude - baseAltitude : null;
  const floorHeight = active?.floorHeight || 3.1;
  const floor = finite(desnivel) ? Math.round(desnivel / floorHeight) : null;
  const vQuality = verticalQuality(recentAltitude, coords?.altAccuracy);
  const gQuality = gpsQuality(coords?.accuracy);
  const elapsed = active ? fmtDuration(now - new Date(active.startedAt).getTime()) : '—';
  const slope = useMemo(() => {
    if (points.length < 2) return null;
    const a = points[points.length - 2];
    const b = points[points.length - 1];
    if (!finite(a.alt) || !finite(b.alt)) return null;
    const horizontal = haversine(a,b);
    return horizontal > .5 ? ((b.alt - a.alt) / horizontal) * 100 : null;
  }, [points]);

  useEffect(() => {
    const onlineHandler = () => setOnline(true);
    const offlineHandler = () => setOnline(false);
    window.addEventListener('online', onlineHandler);
    window.addEventListener('offline', offlineHandler);
    return () => {
      window.removeEventListener('online', onlineHandler);
      window.removeEventListener('offline', offlineHandler);
      stopGps(); stopCamera(); releaseWakeLock();
      if (orientationHandler.current) window.removeEventListener('deviceorientation', orientationHandler.current, true);
    };
  }, []);

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);

  useEffect(() => {
    if (cameraReady && videoRef.current && streamRef.current && videoRef.current.srcObject !== streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(() => {});
    }
  }, [cameraReady, active, mode]);

  useEffect(() => {
    const onVisibility = () => { if (document.visibilityState === 'visible' && tracking) requestWakeLock(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [tracking]);

  function setPoint(position) {
    const point = toPoint(position);
    setCoords(point);
    return point;
  }

  function appendPoint(point) {
    setActive(prev => {
      if (!prev) return prev;
      if (finite(point.accuracy) && point.accuracy > 65) { setRejected(value => value + 1); return prev; }
      const list = prev.points || [];
      const last = list[list.length - 1];
      if (last) {
        const d = haversine(last, point);
        const dt = Math.max((new Date(point.at) - new Date(last.at)) / 1000, .001);
        if (d < 1.5 && dt < 8) return prev;
        if (d > 100 && d / dt > 55) { setRejected(value => value + 1); return prev; }
      }
      return {
        ...prev,
        baseAltitude: finite(prev.baseAltitude) ? prev.baseAltitude : point.alt,
        points:[...list,point],
        updatedAt:new Date().toISOString()
      };
    });
  }

  function requestPosition() {
    if (!navigator.geolocation) { setMessage('Geolocalización no disponible.'); return; }
    navigator.geolocation.getCurrentPosition(
      position => { setPoint(position); setMessage('Posición actualizada.'); },
      error => setMessage(`No fue posible obtener ubicación: ${error.message || 'revisa permisos.'}`),
      { enableHighAccuracy:true, maximumAge:0, timeout:15000 }
    );
  }

  function startGps() {
    if (!navigator.geolocation || watchRef.current !== null) return;
    watchRef.current = navigator.geolocation.watchPosition(
      position => appendPoint(setPoint(position)),
      error => setMessage(`Seguimiento GPS interrumpido: ${error.message || 'sin lectura.'}`),
      { enableHighAccuracy:true, maximumAge:500, timeout:20000 }
    );
    setTracking(true);
  }

  function stopGps() {
    if (watchRef.current !== null && navigator.geolocation) navigator.geolocation.clearWatch(watchRef.current);
    watchRef.current = null;
    setTracking(false);
  }

  async function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) { setCameraError('La cámara no está disponible en este navegador.'); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video:{ facingMode:{ ideal:'environment' }, width:{ ideal:1280 }, height:{ ideal:720 } }, audio:false });
      streamRef.current = stream;
      setCameraReady(true);
      setCameraError('');
    } catch (error) {
      setCameraReady(false);
      setCameraError(error?.message || 'No se pudo abrir la cámara.');
    }
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraReady(false);
  }

  async function requestWakeLock() {
    try { if ('wakeLock' in navigator && !wakeRef.current) wakeRef.current = await navigator.wakeLock.request('screen'); } catch {}
  }

  async function releaseWakeLock() {
    try { await wakeRef.current?.release(); } catch {}
    wakeRef.current = null;
  }

  async function requestOrientation() {
    try {
      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        const permission = await DeviceOrientationEvent.requestPermission();
        if (permission !== 'granted') return;
      }
      if (orientationHandler.current) window.removeEventListener('deviceorientation', orientationHandler.current, true);
      const handler = event => {
        const raw = finite(event.webkitCompassHeading) ? event.webkitCompassHeading : finite(event.alpha) ? (360 - event.alpha) % 360 : null;
        setOrientation({
          heading: finite(raw) ? Math.round(raw) : null,
          pitch: finite(event.beta) ? Number(event.beta.toFixed(1)) : null,
          roll: finite(event.gamma) ? Number(event.gamma.toFixed(1)) : null
        });
      };
      orientationHandler.current = handler;
      window.addEventListener('deviceorientation', handler, true);
    } catch {}
  }

  function startSurvey() {
    const nowDate = new Date();
    if (!active) {
      setActive({
        id:uuid(),
        nombre:`Levantamiento ${nowDate.toLocaleDateString('es-MX')} ${nowDate.toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit'})}`,
        startedAt:nowDate.toISOString(),
        endedAt:null,
        points:[],
        baseAltitude:finite(coords?.alt) ? coords.alt : null,
        floorHeight:3.1,
        brigadista:profile.nombre || 'Sin identificar',
        brigada:profile.brigada || '',
        dispositivo:deviceId,
        estado:'local'
      });
    }
    setRejected(0);
    setNow(Date.now());
    setMode('campo');
    startGps();
    startCamera();
    requestOrientation();
    requestWakeLock();
    setMessage('Levantamiento activo: cámara, GPS y telemetría en ejecución.');
  }

  function pauseSurvey() {
    stopGps();
    setMessage('Levantamiento pausado; la sesión permanece abierta.');
  }

  function resumeSurvey() {
    startGps(); startCamera(); requestOrientation(); requestWakeLock();
    setMessage('Levantamiento reanudado.');
  }

  function finishSurvey() {
    if (!active) return;
    stopGps(); stopCamera(); releaseWakeLock();
    const ended = { ...active, endedAt:new Date().toISOString(), estado:'local' };
    setSessions(prev => [ended,...prev]);
    setActive(null);
    setMessage(`Levantamiento guardado: ${fmtDistance(routeDistance(ended.points))}, ${ended.points.length} puntos.`);
  }

  async function addObservation() {
    if (!coords) { requestPosition(); setMessage('Obtén una ubicación válida antes de guardar.'); return; }
    const id = uuid();
    let mediaId = null;
    if (photoFile) {
      try { await saveMedia(id, photoFile); mediaId = id; } catch {}
    }
    const item = {
      id, categoria:category, prioridad:priority, nota:note.trim(),
      lat:coords.lat, lon:coords.lon, precision:coords.accuracy,
      altitud:coords.alt, altitudPrecision:coords.altAccuracy,
      rumbo:coords.heading ?? orientation.heading,
      fecha:new Date().toISOString(), sessionId:active?.id || null,
      brigadista:profile.nombre || 'Sin identificar', brigada:profile.brigada || '', dispositivo:deviceId,
      estado:'local', mediaId, fotoNombre:photoFile?.name || null
    };
    setObservations(prev => [item,...prev]);
    setCategory('Arbolado'); setPriority('Informativa'); setNote(''); setPhotoFile(null);
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoPreview('');
    setMessage('Observación guardada y vinculada a la sesión.');
    setMode('campo');
  }

  async function openEvidence(id) {
    try {
      const item = await getMedia(id);
      if (!item?.blob) return;
      if (evidenceUrl) URL.revokeObjectURL(evidenceUrl);
      setEvidenceUrl(URL.createObjectURL(item.blob));
    } catch {}
  }

  async function syncNow() {
    if (!API_URL) { setMessage('El servidor central aún no está configurado; el navegador conserva una copia temporal.'); return; }
    if (!online) { setMessage('Sin internet: no se intentó enviar.'); return; }
    const pendingObs = observations.filter(item => item.estado !== 'enviado');
    const pendingSessions = sessions.filter(item => item.estado !== 'enviado');
    try {
      const response = await fetch(`${API_URL}/sync`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ dispositivo:deviceId, perfil:profile, observaciones:pendingObs, recorridos:pendingSessions }) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const sentAt = new Date().toISOString();
      setObservations(prev => prev.map(item => item.estado === 'enviado' ? item : { ...item, estado:'enviado', enviadoAt:sentAt }));
      setSessions(prev => prev.map(item => item.estado === 'enviado' ? item : { ...item, estado:'enviado', enviadoAt:sentAt }));
      setMessage('Servidor confirmó la recepción.');
    } catch (error) { setMessage(`El servidor no confirmó el envío: ${error.message}.`); }
  }

  return <div className="v4-shell">
    <aside className="v4-sidebar">
      <div className="v4-brand"><div>SL</div><span><strong>SLTM</strong><small>Levantamiento territorial</small></span></div>
      <nav>
        <Nav active={mode==='resumen'} onClick={() => setMode('resumen')}>Resumen</Nav>
        <Nav active={mode==='campo'} onClick={() => setMode('campo')}>Levantamiento</Nav>
        <Nav active={mode==='observacion'} onClick={() => setMode('observacion')}>Registrar</Nav>
        <Nav active={mode==='datos'} onClick={() => setMode('datos')}>Datos</Nav>
        <Nav active={mode==='sistema'} onClick={() => setMode('sistema')}>Sistema</Nav>
      </nav>
      <div className="v4-sidefoot"><span className={online?'v4-dot on':'v4-dot'} />{online?'Con internet':'Sin internet'}<small>{deviceId}</small></div>
    </aside>

    <main className="v4-main">
      <header className="v4-topbar">
        <div><p>SLTM · OPERACIÓN WEB</p><h1>{title(mode)}</h1></div>
        <div className={`v4-quality ${gQuality.cls}`}>GPS {gQuality.label}{finite(coords?.accuracy)?` · ±${Math.round(coords.accuracy)} m`:''}</div>
      </header>
      <div className="v4-message"><span>{message}</span><strong>{online?'EN LÍNEA':'SIN CONEXIÓN'}</strong></div>

      {mode==='resumen' && <Dashboard sessions={sessions} observations={observations} active={active} onStart={startSurvey} onField={() => setMode('campo')} profile={profile} />}
      {mode==='campo' && <FieldScreen active={active} tracking={tracking} onStart={startSurvey} onPause={pauseSurvey} onResume={resumeSurvey} onFinish={finishSurvey} onObservation={() => setMode('observacion')} coords={coords} points={points} observations={observations} rejected={rejected} distance={distance} avgGps={avgGps} elapsed={elapsed} recentAltitude={recentAltitude} baseAltitude={baseAltitude} desnivel={desnivel} floor={floor} floorHeight={floorHeight} verticalQuality={vQuality} slope={slope} orientation={orientation} cameraReady={cameraReady} cameraError={cameraError} videoRef={videoRef} onCamera={cameraReady?stopCamera:startCamera} onPosition={requestPosition} onFocus={() => setFocusToken(value => value+1)} focusToken={focusToken} onSetBase={() => setActive(prev => prev ? {...prev,baseAltitude:recentAltitude} : prev)} onFloorHeight={value => setActive(prev => prev ? {...prev,floorHeight:value} : prev)} />}
      {mode==='observacion' && <ObservationScreen coords={coords} category={category} setCategory={setCategory} priority={priority} setPriority={setPriority} note={note} setNote={setNote} photoPreview={photoPreview} onPhoto={file => { setPhotoFile(file); if (photoPreview) URL.revokeObjectURL(photoPreview); setPhotoPreview(file?URL.createObjectURL(file):''); }} onPosition={requestPosition} onSave={addObservation} />}
      {mode==='datos' && <DataScreen sessions={sessions} observations={observations} onEvidence={openEvidence} />}
      {mode==='sistema' && <SystemScreen profile={profile} setProfile={setProfile} deviceId={deviceId} online={online} apiReady={Boolean(API_URL)} onSync={syncNow} />}
    </main>

    <nav className="v4-mobile-nav">
      <Nav active={mode==='resumen'} onClick={() => setMode('resumen')}>Inicio</Nav>
      <Nav active={mode==='campo'} onClick={() => setMode('campo')}>Campo</Nav>
      <Nav active={mode==='observacion'} onClick={() => setMode('observacion')}>Registrar</Nav>
      <Nav active={mode==='datos'} onClick={() => setMode('datos')}>Datos</Nav>
      <Nav active={mode==='sistema'} onClick={() => setMode('sistema')}>Sistema</Nav>
    </nav>

    {evidenceUrl && <div className="v4-modal" onClick={() => { URL.revokeObjectURL(evidenceUrl); setEvidenceUrl(''); }}><div onClick={event => event.stopPropagation()}><img src={evidenceUrl} alt="Evidencia"/><button onClick={() => { URL.revokeObjectURL(evidenceUrl); setEvidenceUrl(''); }}>Cerrar</button></div></div>}
  </div>;
}

function title(mode) { return ({resumen:'Centro de operación',campo:'Levantamiento territorial',observacion:'Registro de campo',datos:'Historial y datos',sistema:'Sistema'})[mode] || 'SLTM'; }
function Nav({ active, onClick, children }) { return <button className={active?'active':''} onClick={onClick}>{children}</button>; }

function Dashboard({ sessions, observations, active, onStart, onField, profile }) {
  const distance = sessions.reduce((sum,item) => sum + routeDistance(item.points),0);
  return <section>
    <div className="v4-metrics">
      <Metric label="Recorridos" value={sessions.length}/><Metric label="Distancia" value={fmtDistance(distance)}/><Metric label="Observaciones" value={observations.length}/><Metric label="Sesión" value={active?'Abierta':'Cerrada'}/>
    </div>
    <div className="v4-dashboard-grid">
      <div className="v4-panel v4-hero"><p>CAPTURA TERRITORIAL DISTRIBUIDA</p><h2>El teléfono funciona como instrumento de campo.</h2><span>Cámara, recorrido, telemetría, cota relativa y registro estructurado desde el navegador. No necesitas instalar una aplicación.</span><div><button className="v4-primary" onClick={active?onField:onStart}>{active?'Continuar levantamiento':'Iniciar levantamiento'}</button><button className="v4-secondary" onClick={onField}>Abrir campo</button></div></div>
      <div className="v4-panel v4-ready"><h3>Preparación</h3><Check ok={Boolean(profile.nombre)} text="Brigadista identificado"/><Check ok={window.isSecureContext} text="HTTPS activo"/><Check ok={Boolean(navigator.geolocation)} text="GPS disponible"/><Check ok={Boolean(navigator.mediaDevices?.getUserMedia)} text="Cámara disponible"/></div>
    </div>
  </section>;
}
function Metric({ label, value }) { return <div><span>{label}</span><strong>{value}</strong></div>; }
function Check({ ok, text }) { return <div className="v4-check"><b>{ok?'✓':'!'}</b><span>{text}</span></div>; }

function FieldScreen(props) {
  const { active,tracking,onStart,onPause,onResume,onFinish,onObservation,coords,points,observations,rejected,distance,avgGps,elapsed,recentAltitude,baseAltitude,desnivel,floor,floorHeight,verticalQuality,slope,orientation,cameraReady,cameraError,videoRef,onCamera,onPosition,onFocus,focusToken,onSetBase,onFloorHeight } = props;
  if (!active) return <section className="v4-field-pre">
    <div className="v4-panel v4-pre-card"><div><p>MODO PREPARACIÓN</p><h2>Listo para iniciar levantamiento</h2><span>Al tocar iniciar se activarán cámara, GPS continuo, orientación, pantalla activa y la instrumentación visual.</span><div><button className="v4-primary" onClick={onStart}>Iniciar levantamiento</button><button className="v4-secondary" onClick={onPosition}>Actualizar posición</button></div></div><div className="v4-pre-status"><Info label="Ubicación" value={coords?`${fmtCoord(coords.lat)}, ${fmtCoord(coords.lon)}`:'Pendiente'}/><Info label="Precisión" value={finite(coords?.accuracy)?`±${Math.round(coords.accuracy)} m`:'—'}/><Info label="Cota" value={fmtAlt(coords?.alt)}/></div></div>
    <div className="v4-panel v4-map-wrap"><div className="v4-panel-head"><div><p>REFERENCIA ESPACIAL</p><h3>Ubicación previa</h3></div><span>Sin sesión activa</span></div><div className="v4-map-box"><FieldMap coords={coords} points={[]} observations={observations} focusToken={focusToken}/></div></div>
  </section>;

  return <section className="v4-field-active">
    <div className="v4-panel v4-instrument">
      <div className="v4-panel-head"><div><p>INSTRUMENTACIÓN EN VIVO</p><h2>Cámara y telemetría</h2></div><div className="v4-head-actions"><span className={tracking?'v4-live on':'v4-live'}>{tracking?'CAPTURANDO':'PAUSADO'}</span><button className="v4-secondary" onClick={onCamera}>{cameraReady?'Ocultar cámara':'Activar cámara'}</button></div></div>
      <div className="v4-camera-grid">
        <div className="v4-camera-shell">
          {cameraReady?<video ref={videoRef} autoPlay muted playsInline/>:<div className="v4-camera-empty"><b>◎</b><strong>Cámara no activa</strong><span>{cameraError || 'La vista aparecerá aquí cuando el navegador autorice la cámara.'}</span></div>}
          <div className="v4-hud"><div className="v4-hud-top"><em>{tracking?'REC':'PAUSE'}</em><em>GPS {finite(coords?.accuracy)?`±${Math.round(coords.accuracy)} m`:'—'}</em><em className={verticalQuality.cls}>Vertical {verticalQuality.label}</em><em>{elapsed}</em><em>Rumbo {finite(coords?.heading)?`${Math.round(coords.heading)}°`:finite(orientation.heading)?`${orientation.heading}°`:'—'}</em></div><div className="v4-hud-bottom"><Info label="Altura" value={fmtAlt(recentAltitude)}/><Info label="Desnivel" value={finite(desnivel)?`${desnivel>=0?'+':''}${desnivel.toFixed(1)} m`:'—'}/><Info label="Nivel" value={finite(floor)?`${floor>=0?'+':''}${floor}`:'—'}/></div></div>
        </div>
        <div className="v4-instrument-stack"><AltitudeProfile points={points} baseAltitude={baseAltitude} currentAltitude={recentAltitude} desnivel={desnivel}/><FloorTower floor={floor} floorHeight={floorHeight} currentAltitude={recentAltitude} baseAltitude={baseAltitude} desnivel={desnivel} onSetBase={onSetBase} onFloorHeight={onFloorHeight}/></div>
      </div>
    </div>

    <div className="v4-panel v4-indicators"><div className="v4-panel-head"><div><p>INDICADORES DE CAMPO</p><h3>Lecturas operativas</h3></div><button className="v4-link" onClick={onPosition}>Actualizar</button></div><div className="v4-indicator-grid"><Indicator label="Distancia" value={fmtDistance(distance)} detail="recorrido activo"/><Indicator label="Tiempo" value={elapsed} detail="sesión"/><Indicator label="Puntos válidos" value={points.length} detail="aceptados"/><Indicator label="Precisión media" value={finite(avgGps)?`±${Math.round(avgGps)} m`:'—'} detail="GPS"/><Indicator label="Descartadas" value={rejected} detail="control de calidad"/><Indicator label="Velocidad" value={finite(coords?.speed)?`${(coords.speed*3.6).toFixed(1)} km/h`:'—'} detail="instantánea"/><Indicator label="Pendiente" value={finite(slope)?`${slope.toFixed(1)} %`:'—'} detail="tramo reciente"/><Indicator label="Cota base" value={fmtAlt(baseAltitude)} detail="referencia"/><Indicator label="Pitch" value={finite(orientation.pitch)?`${orientation.pitch}°`:'—'} detail="longitudinal"/><Indicator label="Roll" value={finite(orientation.roll)?`${orientation.roll}°`:'—'} detail="transversal"/><Indicator label="Precisión vertical" value={finite(coords?.altAccuracy)?`±${coords.altAccuracy.toFixed(1)} m`:'—'} detail={verticalQuality.label}/><Indicator label="Nivel relativo" value={finite(floor)?`${floor>=0?'+':''}${floor}`:'—'} detail={`${floorHeight.toFixed(1)} m/nivel`}/></div><div className="v4-actions">{tracking?<button className="v4-secondary" onClick={onPause}>Pausar</button>:<button className="v4-primary" onClick={onResume}>Reanudar</button>}<button className="v4-secondary" onClick={onObservation}>Registrar observación</button><button className="v4-danger" onClick={onFinish}>Finalizar y guardar</button><button className="v4-quiet" onClick={onFocus}>Centrar mapa</button></div></div>

    <div className="v4-panel v4-map-wrap"><div className="v4-panel-head"><div><p>REFERENCIA ESPACIAL</p><h3>Mapa del recorrido</h3></div><span>{tracking?'Sesión en curso':'Sesión pausada'}</span></div><div className="v4-map-box"><FieldMap coords={coords} points={points} observations={observations.filter(item => !item.sessionId || item.sessionId===active.id)} focusToken={focusToken}/></div></div>
  </section>;
}

function AltitudeProfile({ points, baseAltitude, currentAltitude, desnivel }) {
  const values = [...points.map(item => item.alt),currentAltitude].filter(finite);
  const min = values.length ? Math.min(...values) : null;
  const max = values.length ? Math.max(...values) : null;
  const range = finite(min)&&finite(max) ? Math.max(max-min,.1) : 1;
  const path = values.length>1 ? values.map((value,index) => `${index?'L':'M'} ${(index/(values.length-1))*100} ${100-((value-min)/range)*100}`).join(' ') : '';
  return <div className="v4-telemetry-card"><div className="v4-mini-head"><h3>Perfil vertical</h3><span>{values.length?`${values.length} lecturas`:'Sin serie'}</span></div><div className="v4-profile-meta"><Info label="Base" value={fmtAlt(baseAltitude)}/><Info label="Desnivel" value={finite(desnivel)?`${desnivel>=0?'+':''}${desnivel.toFixed(1)} m`:'—'}/></div><div className="v4-profile-plot">{values.length>1?<svg viewBox="0 0 100 100" preserveAspectRatio="none"><path d={`${path} L 100 100 L 0 100 Z`} className="fill"/><path d={path} className="line"/></svg>:<span>El perfil aparecerá al desplazarte.</span>}<b className="top">{fmtAlt(max)}</b><b className="bottom">{fmtAlt(min)}</b></div></div>;
}
function FloorTower({ floor, floorHeight, currentAltitude, baseAltitude, desnivel, onSetBase, onFloorHeight }) {
  const level = finite(floor)?floor:0;
  const floors = Array.from({length:7},(_,index)=>level+3-index);
  return <div className="v4-telemetry-card"><div className="v4-mini-head"><h3>Nivel relativo</h3><button className="v4-link" onClick={onSetBase}>Fijar base</button></div><div className="v4-tower-layout"><div className="v4-tower">{floors.map(item => <div key={item} className={item===level?'active':''}><span>{item>0?`+${item}`:item}</span>{item===level&&<i/>}</div>)}</div><div className="v4-tower-data"><Info label="Cota actual" value={fmtAlt(currentAltitude)}/><Info label="Referencia" value={fmtAlt(baseAltitude)}/><Info label="Desnivel" value={finite(desnivel)?`${desnivel>=0?'+':''}${desnivel.toFixed(1)} m`:'—'}/><div className="v4-floor-height"><span>Altura por nivel</span><strong>{floorHeight.toFixed(1)} m</strong><input type="range" min="2.6" max="4.2" step="0.1" value={floorHeight} onChange={event=>onFloorHeight(Number(event.target.value))}/></div></div></div></div>;
}
function Indicator({ label, value, detail }) { return <div className="v4-indicator"><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>; }
function Info({ label, value }) { return <div className="v4-info"><span>{label}</span><strong>{value}</strong></div>; }

function ObservationScreen({ coords,category,setCategory,priority,setPriority,note,setNote,photoPreview,onPhoto,onPosition,onSave }) {
  return <section className="v4-observation"><div className="v4-panel v4-form"><div className="v4-panel-head"><div><p>REGISTRO GEOREFERENCIADO</p><h2>Nueva observación</h2></div><button className="v4-secondary" onClick={onPosition}>Actualizar ubicación</button></div><label>Categoría</label><div className="v4-chips">{CATEGORIES.map(item=><button className={category===item?'active':''} onClick={()=>setCategory(item)} key={item}>{item}</button>)}</div><label>Prioridad</label><div className="v4-priority">{PRIORITIES.map(item=><button className={priority===item?'active':''} onClick={()=>setPriority(item)} key={item}>{item}</button>)}</div><label>Nota técnica</label><textarea value={note} onChange={event=>setNote(event.target.value)} placeholder="Describe el hallazgo de manera verificable…"/><div className="v4-location"><Info label="Coordenada" value={coords?`${fmtCoord(coords.lat)}, ${fmtCoord(coords.lon)}`:'Pendiente'}/><Info label="Precisión" value={finite(coords?.accuracy)?`±${Math.round(coords.accuracy)} m`:'—'}/></div><button className="v4-primary" onClick={onSave}>Guardar observación</button></div><div className="v4-panel v4-evidence"><p>EVIDENCIA</p><h2>Fotografía</h2><div className="v4-photo">{photoPreview?<img src={photoPreview} alt="Vista previa"/>:<span>Sin evidencia seleccionada</span>}</div><label className="v4-camera-button">Abrir cámara<input type="file" accept="image/*" capture="environment" onChange={event=>onPhoto(event.target.files?.[0]||null)}/></label></div></section>;
}

function DataScreen({ sessions,observations,onEvidence }) {
  return <section className="v4-data"><div className="v4-panel"><div className="v4-panel-head"><div><p>HISTORIAL</p><h2>Recorridos</h2></div><span>{sessions.length}</span></div>{sessions.length?sessions.map(item=><article className="v4-record" key={item.id}><div><strong>{item.nombre}</strong><span>{new Date(item.startedAt).toLocaleString('es-MX')} · {item.brigadista}</span></div><div><b>{fmtDistance(routeDistance(item.points))}</b><span>{item.points.length} puntos</span></div></article>):<div className="v4-empty">Sin recorridos guardados.</div>}</div><div className="v4-panel"><div className="v4-panel-head"><div><p>REGISTROS</p><h2>Observaciones</h2></div><span>{observations.length}</span></div>{observations.length?observations.map(item=><article className="v4-record" key={item.id}><div><strong>{item.categoria} · {item.prioridad}</strong><span>{item.nota||'Sin nota'} · {fmtCoord(item.lat)}, {fmtCoord(item.lon)}</span></div><div>{item.mediaId&&<button className="v4-link" onClick={()=>onEvidence(item.mediaId)}>Ver foto</button>}<span>{new Date(item.fecha).toLocaleString('es-MX')}</span></div></article>):<div className="v4-empty">Sin observaciones.</div>}</div></section>;
}

function SystemScreen({ profile,setProfile,deviceId,online,apiReady,onSync }) {
  return <section className="v4-system"><div className="v4-panel v4-form"><p>IDENTIFICACIÓN</p><h2>Brigada</h2><label>Brigadista</label><input value={profile.nombre} onChange={event=>setProfile(prev=>({...prev,nombre:event.target.value}))} placeholder="Nombre o clave"/><label>Brigada</label><input value={profile.brigada} onChange={event=>setProfile(prev=>({...prev,brigada:event.target.value}))} placeholder="Equipo de campo"/><Info label="Dispositivo" value={deviceId}/></div><div className="v4-panel"><p>CONEXIÓN</p><h2>Estado técnico</h2><div className="v4-system-list"><Info label="Internet" value={online?'Disponible':'Sin conexión'}/><Info label="Contexto seguro" value={window.isSecureContext?'Correcto':'No disponible'}/><Info label="Servidor central" value={apiReady?'Configurado':'Pendiente'}/><Info label="Modo" value="Navegador web"/></div><button className="v4-primary" onClick={onSync} disabled={!apiReady}>Sincronizar ahora</button></div></section>;
}