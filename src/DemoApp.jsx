import React, { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './demo.css';

const SITES = [
  {
    id: 'marina',
    name: 'Predio Marina Norte',
    sector: 'Expansión urbana · Mazatlán',
    center: [23.2867, -106.4558],
    poly: [[23.2882,-106.4581],[23.2892,-106.4542],[23.2869,-106.4528],[23.2846,-106.4551],[23.2852,-106.4580]],
    condition: 82,
    accessibility: 91,
    opportunity: 88,
    risk: 26,
    tags: ['Acceso vehicular', 'Frente amplio', 'Servicios cercanos'],
    insight: 'Sitio con conectividad alta y geometría favorable para un levantamiento rápido. Conviene documentar drenaje superficial y condición del borde poniente.',
    findings: [
      { id:'m1', type:'Acceso', priority:'Baja', note:'Acceso principal transitable y con visibilidad suficiente.', at:[23.2862,-106.4571] },
      { id:'m2', type:'Drenaje', priority:'Media', note:'Depresión ligera en el borde poniente; revisar escurrimiento en lluvia.', at:[23.2877,-106.4572] },
      { id:'m3', type:'Infraestructura', priority:'Baja', note:'Red eléctrica visible sobre vialidad de acceso.', at:[23.2854,-106.4553] }
    ]
  },
  {
    id: 'centro',
    name: 'Manzana Centro Histórico',
    sector: 'Consolidación urbana · Mazatlán',
    center: [23.1985, -106.4217],
    poly: [[23.1994,-106.4230],[23.1995,-106.4208],[23.1976,-106.4206],[23.1975,-106.4229]],
    condition: 74,
    accessibility: 96,
    opportunity: 76,
    risk: 41,
    tags: ['Alta conectividad', 'Entorno consolidado', 'Intervención sensible'],
    insight: 'La accesibilidad es excelente, pero la evaluación debe priorizar interferencias, patrimonio urbano y compatibilidad con el entorno inmediato.',
    findings: [
      { id:'c1', type:'Movilidad', priority:'Media', note:'Flujo peatonal alto en dos frentes de la manzana.', at:[23.1987,-106.4228] },
      { id:'c2', type:'Entorno', priority:'Alta', note:'Fachadas y elementos urbanos que requieren registro previo a intervención.', at:[23.1992,-106.4216] }
    ]
  },
  {
    id: 'sur',
    name: 'Reserva Urbana Sur',
    sector: 'Suelo de transición · Mazatlán',
    center: [23.1578, -106.3923],
    poly: [[23.1600,-106.3950],[23.1608,-106.3907],[23.1577,-106.3887],[23.1547,-106.3908],[23.1556,-106.3951]],
    condition: 67,
    accessibility: 63,
    opportunity: 81,
    risk: 48,
    tags: ['Reserva amplia', 'Conectividad media', 'Requiere verificación'],
    insight: 'El potencial físico es alto, aunque el recorrido debe confirmar accesos, pendientes, escurrimientos y disponibilidad real de infraestructura.',
    findings: [
      { id:'s1', type:'Acceso', priority:'Media', note:'Camino de ingreso sin pavimentar; accesibilidad variable.', at:[23.1561,-106.3943] },
      { id:'s2', type:'Topografía', priority:'Media', note:'Cambio de nivel perceptible hacia el extremo sureste.', at:[23.1555,-106.3909] },
      { id:'s3', type:'Vegetación', priority:'Baja', note:'Cobertura baja y discontinua en el interior.', at:[23.1588,-106.3910] }
    ]
  }
];

const hav = (a,b) => {
  const R=6371000, p1=a[0]*Math.PI/180, p2=b[0]*Math.PI/180;
  const dp=(b[0]-a[0])*Math.PI/180, dl=(b[1]-a[1])*Math.PI/180;
  const h=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
  return 2*R*Math.asin(Math.sqrt(h));
};

const perimeter = poly => poly.reduce((s,p,i)=>s+hav(p,poly[(i+1)%poly.length]),0);
const areaApprox = poly => {
  const lat0=poly.reduce((s,p)=>s+p[0],0)/poly.length*Math.PI/180;
  const pts=poly.map(([lat,lng])=>[lng*111320*Math.cos(lat0),lat*110540]);
  let a=0; pts.forEach((p,i)=>{const q=pts[(i+1)%pts.length];a+=p[0]*q[1]-q[0]*p[1]});
  return Math.abs(a)/2;
};
const fmt = (n,d=0)=>Number(n).toLocaleString('es-MX',{maximumFractionDigits:d});
const lerp=(a,b,t)=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];

function makeRoute(poly){
  const edge=[];
  poly.forEach((p,i)=>{const q=poly[(i+1)%poly.length];for(let j=0;j<7;j++)edge.push(lerp(p,q,j/7))});
  const c=[poly.reduce((s,p)=>s+p[0],0)/poly.length,poly.reduce((s,p)=>s+p[1],0)/poly.length];
  const inside=[];
  for(let i=0;i<=8;i++)inside.push(lerp(poly[0],c,i/8));
  for(let i=1;i<=8;i++)inside.push(lerp(c,poly[Math.floor(poly.length/2)],i/8));
  return [...edge, poly[0], ...inside];
}

function useLiveLocation(active){
  const [pos,setPos]=useState(null);
  const [error,setError]=useState('');
  useEffect(()=>{
    if(!active || !navigator.geolocation) return;
    const id=navigator.geolocation.watchPosition(
      p=>{setError('');setPos({lat:p.coords.latitude,lng:p.coords.longitude,acc:p.coords.accuracy,speed:p.coords.speed});},
      e=>setError(e.message),
      {enableHighAccuracy:true,maximumAge:1000,timeout:15000}
    );
    return()=>navigator.geolocation.clearWatch(id);
  },[active]);
  return {pos,error};
}

function MapPanel({site, route, progress, findings, livePos, selectedFinding}){
  const el=useRef(null), map=useRef(null), layer=useRef(null);
  useEffect(()=>{
    const m=L.map(el.current,{zoomControl:false,attributionControl:false}).setView(site.center,16);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:20}).addTo(m);
    L.control.zoom({position:'bottomright'}).addTo(m);
    layer.current=L.layerGroup().addTo(m); map.current=m;
    setTimeout(()=>m.invalidateSize(),80);
    return()=>m.remove();
  },[]);
  useEffect(()=>{
    const m=map.current,g=layer.current; if(!m||!g)return;
    g.clearLayers();
    const poly=L.polygon(site.poly,{color:'#d7f36a',weight:2.5,fillColor:'#d7f36a',fillOpacity:.08}).addTo(g);
    const done=Math.max(0,Math.min(route.length,progress));
    if(route.length>1)L.polyline(route,{color:'#809289',weight:2,dashArray:'7 7',opacity:.65}).addTo(g);
    if(done>1)L.polyline(route.slice(0,done),{color:'#f7faf8',weight:4,opacity:.95}).addTo(g);
    findings.forEach((f,i)=>{
      const active=selectedFinding===f.id;
      L.circleMarker(f.at,{radius:active?9:6,color:active?'#fff':'#17211c',weight:2,fillColor:f.priority==='Alta'?'#ff8d7a':f.priority==='Media'?'#f0ca68':'#d7f36a',fillOpacity:1})
       .bindTooltip(`<b>${f.type}</b><br>${f.note}`,{direction:'top'}).addTo(g);
    });
    if(done>0&&route[done-1])L.circleMarker(route[done-1],{radius:7,color:'#fff',weight:2,fillColor:'#101713',fillOpacity:1}).addTo(g);
    if(livePos){
      L.circle([livePos.lat,livePos.lng],{radius:livePos.acc||8,color:'#80a694',weight:1,fillOpacity:.05}).addTo(g);
      L.circleMarker([livePos.lat,livePos.lng],{radius:7,color:'#fff',weight:2,fillColor:'#111713',fillOpacity:1}).bindTooltip('Tu ubicación').addTo(g);
    }
    m.fitBounds(poly.getBounds(),{padding:[35,35],maxZoom:17});
  },[site,route,progress,findings,livePos,selectedFinding]);
  return <div ref={el} className="demo-map" />;
}

function Metric({label,value,sub,accent}){
  return <div className={`metric ${accent?'metric-accent':''}`}><span>{label}</span><strong>{value}</strong><small>{sub}</small></div>
}

function ScoreBar({label,value,reverse=false}){
  const status=reverse?(value<35?'Favorable':value<55?'Atención':'Revisar'):(value>82?'Alta':value>68?'Media-alta':'Media');
  return <div className="score-row"><div><span>{label}</span><b>{status}</b></div><div className="score-track"><i style={{width:`${value}%`}} /></div><strong>{value}</strong></div>
}

function FindingModal({onClose,onSave,site}){
  const [type,setType]=useState('Infraestructura'),[priority,setPriority]=useState('Media'),[note,setNote]=useState('');
  const save=()=>{
    const jitter=()=> (Math.random()-.5)*.0012;
    onSave({id:`f-${Date.now()}`,type,priority,note:note.trim()||'Observación registrada durante la demo.',at:[site.center[0]+jitter(),site.center[1]+jitter()]});
  };
  return <div className="modal-bg" onMouseDown={e=>e.target===e.currentTarget&&onClose()}><div className="modal-card"><div className="modal-head"><div><span className="eyebrow">NUEVO HALLAZGO</span><h3>Registrar evidencia</h3></div><button onClick={onClose}>×</button></div><label>Tipo<select value={type} onChange={e=>setType(e.target.value)}><option>Infraestructura</option><option>Acceso</option><option>Drenaje</option><option>Topografía</option><option>Vegetación</option><option>Entorno</option><option>Movilidad</option></select></label><div className="prio"><span>Prioridad</span><div>{['Baja','Media','Alta'].map(p=><button key={p} className={priority===p?'active':''} onClick={()=>setPriority(p)}>{p}</button>)}</div></div><label>Nota<textarea value={note} onChange={e=>setNote(e.target.value)} placeholder="¿Qué observaste en el sitio?" /></label><button className="primary wide" onClick={save}>Guardar hallazgo</button></div></div>
}

export default function DemoApp(){
  const [siteId,setSiteId]=useState(SITES[0].id),[tab,setTab]=useState('campo'),[mode,setMode]=useState('demo');
  const [running,setRunning]=useState(false),[progress,setProgress]=useState(0),[findings,setFindings]=useState(SITES[0].findings),[modal,setModal]=useState(false),[selectedFinding,setSelectedFinding]=useState(null),[sessionStart,setSessionStart]=useState(null);
  const site=useMemo(()=>SITES.find(s=>s.id===siteId)||SITES[0],[siteId]);
  const route=useMemo(()=>makeRoute(site.poly),[site]);
  const {pos:livePos,error:liveError}=useLiveLocation(mode==='live'&&running);
  const area=useMemo(()=>areaApprox(site.poly),[site]);
  const per=useMemo(()=>perimeter(site.poly),[site]);
  const routeDist=useMemo(()=>route.slice(1).reduce((s,p,i)=>s+hav(route[i],p),0),[route]);
  const pct=Math.round(progress/route.length*100);

  useEffect(()=>{
    setFindings(site.findings); setProgress(0); setRunning(false); setSelectedFinding(null); setSessionStart(null);
  },[siteId]);

  useEffect(()=>{
    if(!running||mode!=='demo')return;
    const id=setInterval(()=>setProgress(p=>{
      if(p>=route.length){clearInterval(id);setRunning(false);return route.length}
      return p+1;
    }),150);
    return()=>clearInterval(id);
  },[running,mode,route.length]);

  const start=()=>{
    if(mode==='demo'&&progress>=route.length)setProgress(0);
    if(!sessionStart)setSessionStart(new Date());
    setRunning(true);
  };
  const reset=()=>{setProgress(0);setRunning(false);setSessionStart(null);setFindings(site.findings)};
  const saveFinding=f=>{setFindings(x=>[...x,f]);setSelectedFinding(f.id);setModal(false)};
  const exportDemo=()=>{
    const payload={app:'SLTM',mode,site:site.name,createdAt:new Date().toISOString(),geometry:site.poly,route:route.slice(0,progress),findings};
    const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`sltm-${site.id}-demo.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  };

  return <div className="demo-shell">
    <header className="topbar">
      <div className="brand"><div className="brand-mark">S</div><div><strong>SLTM</strong><span>Sistema de Levantamiento Territorial Móvil</span></div></div>
      <div className="top-actions"><span className="status-dot"><i/> DEMO OPERATIVA</span><button className="ghost" onClick={exportDemo}>Exportar</button></div>
    </header>

    <main className="workspace">
      <aside className="sidebar">
        <div className="sidebar-intro"><span className="eyebrow">LEVANTAMIENTO DE CAMPO</span><h1>Del recorrido al diagnóstico, en una sola sesión.</h1><p>Una demo diseñada para enseñar valor en minutos: geometría, recorrido, evidencia y lectura territorial del sitio.</p></div>

        <div className="mode-switch"><button className={mode==='demo'?'active':''} onClick={()=>{setMode('demo');setRunning(false)}}>Demo guiada</button><button className={mode==='live'?'active':''} onClick={()=>{setMode('live');setRunning(false)}}>GPS real</button></div>

        <label className="site-select"><span>Sitio de demostración</span><select value={siteId} onChange={e=>setSiteId(e.target.value)}>{SITES.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>

        <div className="site-card"><div className="site-title"><div><span>{site.sector}</span><strong>{site.name}</strong></div><b>{site.opportunity}</b></div><div className="tag-row">{site.tags.map(t=><span key={t}>{t}</span>)}</div></div>

        <nav className="tabs"><button className={tab==='campo'?'active':''} onClick={()=>setTab('campo')}><b>01</b><span>Campo<small>Recorrido y captura</small></span></button><button className={tab==='diagnostico'?'active':''} onClick={()=>setTab('diagnostico')}><b>02</b><span>Diagnóstico<small>Lectura inmediata</small></span></button><button className={tab==='evidencia'?'active':''} onClick={()=>setTab('evidencia')}><b>03</b><span>Evidencia<small>Hallazgos del sitio</small></span></button></nav>

        <div className="sidebar-bottom"><div><span>Estado de sesión</span><strong>{progress>=route.length?'Recorrido completo':running?'Capturando':'Listo para iniciar'}</strong></div><div className="progress"><i style={{width:`${pct}%`}}/></div><small>{pct}% · {progress} de {route.length} puntos de muestra</small></div>
      </aside>

      <section className="content">
        {tab==='campo' && <div className="field-layout">
          <div className="map-wrap">
            <MapPanel site={site} route={route} progress={progress} findings={findings} livePos={livePos} selectedFinding={selectedFinding}/>
            <div className="map-overlay top-left"><span>PRECISIÓN</span><strong>{mode==='live'&&livePos?`±${fmt(livePos.acc)} m`:'± 4.8 m'}</strong></div>
            <div className="map-overlay top-right"><span>COBERTURA</span><strong>{pct}%</strong></div>
            <div className="map-legend"><span><i className="line done"/> recorrido capturado</span><span><i className="line planned"/> ruta sugerida</span><span><i className="point"/> hallazgo</span></div>
          </div>
          <div className="field-panel">
            <div className="panel-head"><div><span className="eyebrow">SESIÓN ACTIVA</span><h2>{site.name}</h2></div><span className={`live-pill ${running?'on':''}`}><i/>{running?'EN CURSO':'EN ESPERA'}</span></div>
            <div className="metric-grid"><Metric label="Área estimada" value={`${fmt(area/10000,2)} ha`} sub="Geometría de referencia"/><Metric label="Perímetro" value={`${fmt(per)} m`} sub="Borde del sitio"/><Metric label="Ruta sugerida" value={`${fmt(routeDist)} m`} sub="Borde + cruce interior"/><Metric label="Hallazgos" value={findings.length} sub="Evidencia georreferenciada" accent/></div>
            <div className="instruction"><span>{running?'02':'01'}</span><div><strong>{running?'Recorre y documenta':'Inicia el levantamiento'}</strong><p>{mode==='demo'?'La demo simula un recorrido GNSS y va construyendo la trayectoria sobre el terreno.':'Activa el GPS del dispositivo y camina el sitio; SLTM irá registrando la posición.'}</p></div></div>
            {liveError&&<div className="warning">GPS: {liveError}. Puedes volver a “Demo guiada” para presentar sin permisos de ubicación.</div>}
            <div className="action-stack"><button className="primary" onClick={start} disabled={running}>{progress>0&&progress<route.length?'Continuar recorrido':progress>=route.length?'Repetir demo':'Iniciar recorrido'}</button><button className="secondary" onClick={()=>setRunning(false)} disabled={!running}>Pausar</button><button className="secondary" onClick={()=>setModal(true)}>+ Registrar hallazgo</button></div>
            <button className="reset" onClick={reset}>Reiniciar sesión</button>
          </div>
        </div>}

        {tab==='diagnostico' && <div className="diagnostic-page">
          <div className="page-head"><div><span className="eyebrow">LECTURA TERRITORIAL INMEDIATA</span><h2>Diagnóstico preliminar del sitio</h2><p>Convierte el levantamiento en una lectura accionable para decidir qué revisar después.</p></div><div className="big-score"><span>OPORTUNIDAD</span><strong>{site.opportunity}</strong><small>/ 100</small></div></div>
          <div className="diagnostic-grid"><div className="score-card"><h3>Perfil del sitio</h3><ScoreBar label="Condición física" value={site.condition}/><ScoreBar label="Accesibilidad" value={site.accessibility}/><ScoreBar label="Oportunidad" value={site.opportunity}/><ScoreBar label="Riesgo observado" value={site.risk} reverse/><div className="score-note"><span>Lectura SLTM</span><p>{site.insight}</p></div></div><div className="summary-card"><span className="eyebrow">RESUMEN DE CAMPO</span><h3>{findings.length} hallazgos registrados</h3><div className="summary-list"><div><span>Alta prioridad</span><strong>{findings.filter(f=>f.priority==='Alta').length}</strong></div><div><span>Prioridad media</span><strong>{findings.filter(f=>f.priority==='Media').length}</strong></div><div><span>Ruta cubierta</span><strong>{pct}%</strong></div><div><span>Precisión demo</span><strong>4.8 m</strong></div></div><button className="primary wide" onClick={()=>setTab('evidencia')}>Ver evidencia</button></div></div>
          <div className="next-card"><div><span className="eyebrow">SIGUIENTE PASO</span><h3>Pasar de levantamiento preliminar a verificación dirigida.</h3></div><p>SLTM no intenta sustituir un estudio técnico. Su valor en la demo es mostrar dónde concentrar la siguiente visita, qué evidencia falta y qué elementos requieren validación especializada.</p></div>
        </div>}

        {tab==='evidencia' && <div className="evidence-page">
          <div className="page-head evidence-head"><div><span className="eyebrow">BITÁCORA GEOREFERENCIADA</span><h2>Evidencia de campo</h2><p>Cada hallazgo conserva ubicación, prioridad y nota para revisión posterior.</p></div><button className="primary" onClick={()=>setModal(true)}>+ Nuevo hallazgo</button></div>
          <div className="evidence-layout"><div className="evidence-list">{findings.map((f,i)=><button key={f.id} className={`finding ${selectedFinding===f.id?'active':''}`} onClick={()=>setSelectedFinding(f.id)}><div className={`finding-index p-${f.priority.toLowerCase()}`}>{String(i+1).padStart(2,'0')}</div><div><div className="finding-top"><strong>{f.type}</strong><span>{f.priority}</span></div><p>{f.note}</p><small>{f.at[0].toFixed(5)}, {f.at[1].toFixed(5)}</small></div></button>)}</div><div className="evidence-map"><MapPanel site={site} route={route} progress={progress} findings={findings} selectedFinding={selectedFinding}/></div></div>
        </div>}
      </section>
    </main>
    {modal&&<FindingModal site={site} onClose={()=>setModal(false)} onSave={saveFinding}/>} 
  </div>
}
