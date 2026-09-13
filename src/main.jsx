import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const CATEGORIES = [
  'Arbolado', 'Drenaje', 'Banqueta', 'Anuncio', 'Residuo',
  'Obra', 'Predio', 'Vialidad', 'Vegetación', 'Otro'
];

const STORAGE_KEY = 'sltm_observaciones';
const TRACK_KEY = 'sltm_ultimo_recorrido';

function formatCoord(value) {
  return Number.isFinite(value) ? value.toFixed(6) : '—';
}

function loadJSON(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
  } catch {
    return fallback;
  }
}

function App() {
  const [mode, setMode] = useState('inicio');
  const [coords, setCoords] = useState(null);
  const [accuracy, setAccuracy] = useState(null);
  const [watchId, setWatchId] = useState(null);
  const [track, setTrack] = useState(() => loadJSON(TRACK_KEY, []));
  const [observations, setObservations] = useState(() => loadJSON(STORAGE_KEY, []));
  const [category, setCategory] = useState('Arbolado');
  const [note, setNote] = useState('');
  const [message, setMessage] = useState('Listo para iniciar levantamiento.');
  const [online, setOnline] = useState(navigator.onLine);
  const [photoName, setPhotoName] = useState('');
  const photoRef = useRef(null);

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      if (watchId !== null && navigator.geolocation) navigator.geolocation.clearWatch(watchId);
    };
  }, [watchId]);

  useEffect(() => localStorage.setItem(STORAGE_KEY, JSON.stringify(observations)), [observations]);
  useEffect(() => localStorage.setItem(TRACK_KEY, JSON.stringify(track)), [track]);

  const stats = useMemo(() => ({
    puntos: track.length,
    observaciones: observations.length,
    pendientes: observations.filter(o => !o.sincronizado).length,
    precision: accuracy ? `±${Math.round(accuracy)} m` : '—'
  }), [track, observations, accuracy]);

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

  const requestPosition = () => {
    if (!navigator.geolocation) {
      setMessage('Este dispositivo no expone geolocalización al navegador.');
      return;
    }
    setMessage('Obteniendo posición…');
    navigator.geolocation.getCurrentPosition(
      p => {
        updatePosition(p);
        setMessage('Posición registrada.');
      },
      () => setMessage('No fue posible obtener la ubicación. Revisa los permisos del dispositivo.'),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    );
  };

  const startTrack = () => {
    if (!navigator.geolocation || watchId !== null) return;
    setTrack([]);
    const id = navigator.geolocation.watchPosition(
      p => {
        const next = updatePosition(p);
        setTrack(prev => [...prev, next]);
      },
      () => setMessage('Se perdió la señal de ubicación. El levantamiento continuará guardado localmente.'),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 }
    );
    setWatchId(id);
    setMode('recorrido');
    setMessage('Levantamiento activo. Recorre el tramo y registra incidencias cuando sea necesario.');
  };

  const stopTrack = () => {
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    setWatchId(null);
    setMessage(`Recorrido detenido. ${track.length} posiciones capturadas.`);
  };

  const addObservation = () => {
    if (!coords) {
      requestPosition();
      setMessage('Primero necesitamos una posición válida. Cuando aparezca la coordenada, guarda de nuevo.');
      return;
    }
    const item = {
      id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
      categoria: category,
      nota: note.trim(),
      lat: coords.lat,
      lon: coords.lon,
      precision: accuracy,
      foto: photoName || null,
      fecha: new Date().toISOString(),
      sincronizado: false
    };
    setObservations(prev => [item, ...prev]);
    setNote('');
    setPhotoName('');
    if (photoRef.current) photoRef.current.value = '';
    setMessage('Observación guardada en este dispositivo.');
  };

  const syncLocal = () => {
    if (!online) {
      setMessage('Sin conexión. Los datos permanecen almacenados localmente.');
      return;
    }
    setObservations(prev => prev.map(o => ({ ...o, sincronizado: true })));
    setMessage('Datos locales listos. La sincronización con servidor se conectará al habilitar la API.');
  };

  const clearTrack = () => {
    if (watchId !== null) stopTrack();
    setTrack([]);
    setMessage('Recorrido local limpiado.');
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">SL</div>
          <div><strong>Levantamiento Territorial</strong><span>Sistema móvil distribuido</span></div>
        </div>
        <nav>
          <NavButton current={mode} id="inicio" onClick={setMode}>Centro de operación</NavButton>
          <NavButton current={mode} id="recorrido" onClick={setMode}>Levantamiento</NavButton>
          <NavButton current={mode} id="observacion" onClick={setMode}>Observación puntual</NavButton>
          <NavButton current={mode} id="datos" onClick={setMode}>Datos capturados</NavButton>
        </nav>
        <div className="connection"><span className={online ? 'dot online' : 'dot'} />{online ? 'Con conexión' : 'Modo sin conexión'}</div>
      </aside>

      <main>
        <header className="topbar">
          <div>
            <p className="eyebrow">SISTEMA DE CAMPO</p>
            <h1>{mode === 'inicio' ? 'Centro de operación' : mode === 'recorrido' ? 'Levantamiento territorial' : mode === 'observacion' ? 'Observación puntual' : 'Datos capturados'}</h1>
          </div>
          <div className="status-pill">{message}</div>
        </header>

        {mode === 'inicio' && (
          <section>
            <div className="metric-grid">
              <Metric label="Puntos GPS" value={stats.puntos} detail="último recorrido" />
              <Metric label="Observaciones" value={stats.observaciones} detail="almacenadas" />
              <Metric label="Pendientes" value={stats.pendientes} detail="por sincronizar" />
              <Metric label="Precisión" value={stats.precision} detail="última lectura" />
            </div>
            <div className="two-column">
              <div className="panel hero-panel">
                <p className="eyebrow">CAPTURA DISTRIBUIDA</p>
                <h2>El territorio se levanta caminándolo.</h2>
                <p>Registra trayectoria, posición y evidencia desde el teléfono. La misma aplicación cambia de comportamiento en computadora para revisión y control.</p>
                <div className="action-row">
                  <button className="primary" onClick={startTrack}>Iniciar levantamiento</button>
                  <button className="secondary" onClick={() => { setMode('observacion'); requestPosition(); }}>Registrar punto</button>
                </div>
              </div>
              <div className="panel sensor-panel">
                <div className="panel-heading"><h3>Estado del dispositivo</h3><button onClick={requestPosition}>Actualizar</button></div>
                <SensorRow label="Latitud" value={coords ? formatCoord(coords.lat) : 'Sin lectura'} />
                <SensorRow label="Longitud" value={coords ? formatCoord(coords.lon) : 'Sin lectura'} />
                <SensorRow label="Precisión GPS" value={accuracy ? `±${Math.round(accuracy)} m` : '—'} />
                <SensorRow label="Conectividad" value={online ? 'Disponible' : 'Trabajo local'} />
              </div>
            </div>
          </section>
        )}

        {mode === 'recorrido' && (
          <section className="field-layout">
            <div className="panel map-placeholder">
              <div className="map-grid" />
              <div className="route-line" />
              <div className="map-overlay">
                <span className={watchId !== null ? 'recording' : ''}>{watchId !== null ? '● REGISTRANDO' : 'RECORRIDO DETENIDO'}</span>
                <strong>{track.length}</strong>
                <small>posiciones capturadas</small>
              </div>
              {coords && <div className="location-card">{formatCoord(coords.lat)}, {formatCoord(coords.lon)} · ±{Math.round(accuracy || 0)} m</div>}
            </div>
            <div className="panel controls">
              <h3>Control de recorrido</h3>
              <p>La trayectoria se almacena en el teléfono aunque la conexión falle.</p>
              <button className="primary full" onClick={watchId === null ? startTrack : stopTrack}>{watchId === null ? 'Reanudar recorrido' : 'Finalizar recorrido'}</button>
              <button className="secondary full" onClick={() => setMode('observacion')}>Añadir observación</button>
              <button className="quiet full" onClick={clearTrack}>Limpiar recorrido local</button>
              <div className="mini-readout"><span>Precisión</span><strong>{accuracy ? `±${Math.round(accuracy)} m` : '—'}</strong></div>
              <div className="mini-readout"><span>Última lectura</span><strong>{coords ? new Date(coords.at).toLocaleTimeString('es-MX', { hour:'2-digit', minute:'2-digit', second:'2-digit' }) : '—'}</strong></div>
            </div>
          </section>
        )}

        {mode === 'observacion' && (
          <section className="field-layout">
            <div className="panel form-panel">
              <p className="eyebrow">REGISTRO GEOREFERENCIADO</p>
              <h2>Nueva observación</h2>
              <label>Categoría</label>
              <div className="category-grid">
                {CATEGORIES.map(c => <button key={c} className={category === c ? 'category active' : 'category'} onClick={() => setCategory(c)}>{c}</button>)}
              </div>
              <label htmlFor="nota">Nota técnica</label>
              <textarea id="nota" value={note} onChange={e => setNote(e.target.value)} placeholder="Describe únicamente lo necesario para validar el hallazgo…" />
              <div className="coord-box">
                <span>Ubicación</span>
                <strong>{coords ? `${formatCoord(coords.lat)}, ${formatCoord(coords.lon)}` : 'Pendiente'}</strong>
                <small>{accuracy ? `Precisión estimada ±${Math.round(accuracy)} m` : 'Solicita ubicación antes de registrar'}</small>
              </div>
              <div className="action-row">
                <button className="secondary" onClick={requestPosition}>Obtener ubicación</button>
                <button className="primary" onClick={addObservation}>Guardar observación</button>
              </div>
            </div>
            <div className="panel camera-panel">
              <div className="camera-frame">
                <span>Evidencia visual</span>
                <strong>{photoName || 'Sin archivo seleccionado'}</strong>
                <p>La captura usa la cámara trasera cuando el navegador móvil lo permite.</p>
              </div>
              <label className="camera-button">Abrir cámara<input ref={photoRef} type="file" accept="image/*" capture="environment" onChange={e => setPhotoName(e.target.files?.[0]?.name || '')} /></label>
            </div>
          </section>
        )}

        {mode === 'datos' && (
          <section className="panel table-panel">
            <div className="panel-heading"><div><p className="eyebrow">CONTROL DE CALIDAD</p><h2>Observaciones locales</h2></div><button onClick={syncLocal}>Sincronizar</button></div>
            {observations.length === 0 ? <div className="empty">Todavía no hay observaciones capturadas.</div> : (
              <div className="records">
                {observations.map(o => (
                  <article key={o.id} className="record">
                    <div><span className="record-type">{o.categoria}</span><strong>{o.nota || 'Sin nota adicional'}</strong><small>{formatCoord(o.lat)}, {formatCoord(o.lon)}{o.foto ? ` · ${o.foto}` : ''}</small></div>
                    <div className="record-meta"><span>{new Date(o.fecha).toLocaleString('es-MX')}</span><span className={o.sincronizado ? 'synced' : 'pending'}>{o.sincronizado ? 'Sincronizado' : 'Pendiente'}</span></div>
                  </article>
                ))}
              </div>
            )}
          </section>
        )}
      </main>

      <nav className="mobile-nav">
        <NavButton current={mode} id="inicio" onClick={setMode}>Inicio</NavButton>
        <NavButton current={mode} id="recorrido" onClick={setMode}>Recorrido</NavButton>
        <NavButton current={mode} id="observacion" onClick={setMode}>Registrar</NavButton>
        <NavButton current={mode} id="datos" onClick={setMode}>Datos</NavButton>
      </nav>
    </div>
  );
}

function NavButton({ current, id, onClick, children }) {
  return <button className={current === id ? 'active' : ''} onClick={() => onClick(id)}>{children}</button>;
}
function Metric({ label, value, detail }) {
  return <div className="metric"><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>;
}
function SensorRow({ label, value }) {
  return <div className="sensor-row"><span>{label}</span><strong>{value}</strong></div>;
}

createRoot(document.getElementById('root')).render(<App />);
