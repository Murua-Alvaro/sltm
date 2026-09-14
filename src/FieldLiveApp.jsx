import React,{useEffect,useMemo,useRef,useState}from'react';
import L from'leaflet';
import'leaflet/dist/leaflet.css';
import'./field-live.css';
import{saveMedia,getMedia}from'./mediaDb';
import{queueTerrain,queueVisitBundle,flushQueue,pingApi,pullWorkspace,getSyncSnapshot,openRemoteEvidence,exportGeoJsonUrl}from'./api';

const STORE='sltm_live_terrains_v1';
const DRAFT='sltm_live_mission_v1';
const now=()=>new Date().toISOString();
const today=()=>now().slice(0,10);
const fmt=n=>new Intl.NumberFormat('es-MX',{maximumFractionDigits:0}).format(Number(n)||0);
const uid=p=>`${p}-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
const hav=(a,b)=>{const R=6371000,dLat=(b.lat-a.lat)*Math.PI/180,dLon=(b.lng-a.lng)*Math.PI/180,la1=a.lat*Math.PI/180,la2=b.lat*Math.PI/180;const h=Math.sin(dLat/2)**2+Math.cos(la1)*Math.cos(la2)*Math.sin(dLon/2)**2;return 2*R*Math.asin(Math.sqrt(h))};
const routeDistance=pts=>pts.slice(1).reduce((s,p,i)=>s+hav(pts[i],p),0);
const polyArea=ll=>{if(ll.length<3)return 0;const lat0=ll.reduce((s,p)=>s+p[0],0)/ll.length*Math.PI/180,pts=ll.map(([lat,lng])=>({x:lng*111320*Math.cos(lat0),y:lat*110540}));let a=0;pts.forEach((p,i)=>{const q=pts[(i+1)%pts.length];a+=p.x*q.y-q.x*p.y});return Math.abs(a)/2};
const qualityLabel=a=>!Number.isFinite(a)?'SIN GPS':a<=8?'MUY BUENA':a<=15?'BUENA':a<=25?'UTILIZABLE':'BAJA';

function useGps(active){
 const [gps,setGps]=useState(null),[error,setError]=useState('');
 useEffect(()=>{if(!active||!navigator.geolocation)return;let id=navigator.geolocation.watchPosition(p=>{setError('');setGps({lat:p.coords.latitude,lng:p.coords.longitude,alt:p.coords.altitude,acc:p.coords.accuracy,speed:p.coords.speed,at:now()})},e=>setError(e.message),{enableHighAccuracy:true,maximumAge:500,timeout:20000});return()=>navigator.geolocation.clearWatch(id)},[active]);
 return{gps,error};
}

function LiveMap({terrain,track=[],gps,onClickPoint,follow=false}){
 const host=useRef(null),map=useRef(null),layers=useRef({});
 useEffect(()=>{const m=L.map(host.current,{zoomControl:false}).setView([23.2494,-106.4111],13);L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:20,attribution:'© OpenStreetMap'}).addTo(m);L.control.zoom({position:'bottomright'}).addTo(m);map.current=m;return()=>m.remove()},[]);
 useEffect(()=>{const m=map.current;if(!m)return;Object.values(layers.current).forEach(x=>x&&m.removeLayer(x));layers.current={};if(terrain?.poly?.length>=3)layers.current.terrain=L.polygon(terrain.poly,{color:'#17231c',weight:2,fillColor:'#8da595',fillOpacity:.18}).addTo(m);if(track.length){layers.current.track=L.polyline(track.map(p=>[p.lat,p.lng]),{color:'#111',weight:3}).addTo(m);track.forEach((p,i)=>{if(i===0||i===track.length-1||i%8===0)L.circleMarker([p.lat,p.lng],{radius:3,color:'#111',fillColor:'#fff',fillOpacity:1,weight:1}).addTo(m)});}if(gps){layers.current.gps=L.circleMarker([gps.lat,gps.lng],{radius:6,color:'#fff',fillColor:'#111',fillOpacity:1,weight:2}).addTo(m);layers.current.acc=L.circle([gps.lat,gps.lng],{radius:gps.acc||0,color:'#75837b',weight:1,fillOpacity:.03}).addTo(m);if(follow)m.setView([gps.lat,gps.lng],Math.max(m.getZoom(),17));}if(onClickPoint){m.off('click');m.on('click',e=>onClickPoint({lat:e.latlng.lat,lng:e.latlng.lng}))}},[terrain,track,gps,onClickPoint,follow]);
 return <div ref={host} className="live-map"/>;
}

function SyncBadge(){const[s,setS]=useState(()=>getSyncSnapshot());useEffect(()=>{const h=e=>setS(v=>({...v,...e.detail}));window.addEventListener('sltm-sync',h);pingApi();flushQueue();return()=>window.removeEventListener('sltm-sync',h)},[]);const label=!s.online?'OFFLINE':s.syncing?'SINCRONIZANDO…':s.pending?`${s.pending} PENDIENTES`:s.backend?'SINCRONIZADO':'CONECTANDO';return <div className={`sync ${!s.online?'off':''}`}>{label}</div>}

function NewTerrain({onSaved,onCancel}){
 const[step,setStep]=useState(1),[name,setName]=useState(''),[purpose,setPurpose]=useState('revisión general'),[recording,setRecording]=useState(false),[track,setTrack]=useState([]),[note,setNote]=useState('');
 const{gps,error}=useGps(step>=2);const last=useRef(null);
 useEffect(()=>{if(!recording||!gps)return;const moved=!last.current?Infinity:hav(last.current,gps);const plausible=!last.current||moved<Math.max(80,(gps.acc||20)*4);if(gps.acc<=25&&plausible&&(!last.current||moved>=3)){last.current=gps;setTrack(v=>[...v,gps])}},[recording,gps]);
 const perimeter=routeDistance(track),closure=track.length>2?hav(track[0],track.at(-1)):null,area=track.length>=4?polyArea(track.map(p=>[p.lat,p.lng])):0;
 const canClose=track.length>=4&&closure!=null;
 const save=()=>{if(!canClose||!name.trim())return;const id=uid('T');const poly=track.map(p=>[p.lat,p.lng]);const terrain={id,name:name.trim(),status:'Activo',use:'Sin clasificar',area,perimeter,createdAt:now(),last:today(),purpose,note,poly,center:[poly.reduce((s,p)=>s+p[0],0)/poly.length,poly.reduce((s,p)=>s+p[1],0)/poly.length],source:'gps_walk',sourceAccuracy:{avg:track.reduce((s,p)=>s+(p.acc||0),0)/track.length,max:Math.max(...track.map(p=>p.acc||0)),closure}};queueTerrain(terrain);onSaved(terrain)};
 return <div className="wizard"><div className="wizard-head"><div><span>NUEVO TERRENO REAL</span><h2>{step===1?'Define la visita':step===2?'Adquiere posición':'Camina el perímetro'}</h2></div><button onClick={onCancel}>Cancelar</button></div>
 {step===1&&<div className="wizard-body"><label>Nombre del terreno<input autoFocus value={name} onChange={e=>setName(e.target.value)} placeholder="Ej. Predio acceso norte"/></label><label>Motivo de levantamiento<select value={purpose} onChange={e=>setPurpose(e.target.value)}><option>revisión general</option><option>posible relleno</option><option>cambio de cobertura</option><option>drenaje / escurrimiento</option><option>vegetación</option><option>factibilidad física</option></select></label><label>Nota inicial<textarea value={note} onChange={e=>setNote(e.target.value)} placeholder="Qué quieres verificar mañana"/></label><button className="primary large" disabled={!name.trim()} onClick={()=>setStep(2)}>Usar GPS del celular</button></div>}
 {step===2&&<div className="wizard-grid"><div className="map-card"><LiveMap gps={gps} follow/></div><div className="gps-card"><span>PRECISIÓN ACTUAL</span><strong>{gps?`±${Math.round(gps.acc)} m`:'Buscando…'}</strong><b>{qualityLabel(gps?.acc)}</b><p>{gps?.acc<=25?'Ya puedes comenzar un levantamiento preliminar.':'Espera a que mejore la señal o busca cielo abierto.'}</p>{error&&<em>{error}</em>}<button className="primary large" disabled={!gps||gps.acc>25} onClick={()=>{setTrack([]);last.current=null;setRecording(true);setStep(3)}}>Comenzar perímetro</button></div></div>}
 {step===3&&<div className="walk-layout"><div className="map-card"><LiveMap track={track} gps={gps} follow/></div><aside className="walk-panel"><span>LEVANTAMIENTO EN CURSO</span><h3>{name}</h3><div className="walk-kpis"><K l="Recorrido" v={`${perimeter.toFixed(0)} m`}/><K l="Puntos GPS" v={track.length}/><K l="Precisión" v={gps?`±${Math.round(gps.acc)} m`:'—'}/><K l="Cierre" v={closure!=null?`${closure.toFixed(0)} m`:'—'}/><K l="Área preliminar" v={area?`${fmt(area)} m²`:'—'}/></div><div className="instruction">{!gps?'Esperando GPS…':gps.acc>25?'Precisión baja: espera antes de seguir.':track.length<4?'Camina por el lindero del terreno.':closure>20?'Continúa hasta acercarte al punto donde comenzaste.':'Ya puedes cerrar el perímetro.'}</div><button className="primary large" disabled={!canClose} onClick={save}>Cerrar y guardar terreno</button><p className="legal">Área y perímetro son estimaciones operativas con GNSS del teléfono. No sustituyen deslinde ni topografía.</p></aside></div>}
 </div>
}

function Inspection({terrain,onDone,onBack}){
 const[active,setActive]=useState(false),[track,setTrack]=useState([]),[obs,setObs]=useState([]),[photos,setPhotos]=useState([]),[kind,setKind]=useState('relleno'),[note,setNote]=useState('');const{gps,error}=useGps(active);const last=useRef(null);
 useEffect(()=>{try{const d=JSON.parse(localStorage.getItem(DRAFT)||'null');if(d?.terrainId===terrain.id){setTrack(d.track||[]);setObs(d.obs||[]);setPhotos(d.photos||[])}}catch{}},[terrain.id]);
 useEffect(()=>{if(active||track.length||obs.length||photos.length)localStorage.setItem(DRAFT,JSON.stringify({terrainId:terrain.id,track,obs,photos,savedAt:now()}))},[active,terrain.id,track,obs,photos]);
 useEffect(()=>{if(!active||!gps)return;const moved=!last.current?Infinity:hav(last.current,gps);if(gps.acc<=30&&(!last.current||moved>=4)){last.current=gps;setTrack(v=>[...v,gps])}},[active,gps]);
 const addObs=()=>{if(!gps)return;setObs(v=>[...v,{id:uid('O'),kind,note,lat:gps.lat,lng:gps.lng,alt:gps.alt,acc:gps.acc,at:now()}]);setNote('')};
 const addPhoto=async e=>{const f=e.target.files?.[0];if(!f)return;const id=uid('E');await saveMedia(id,f);setPhotos(v=>[...v,{id,at:now(),gps,kind}]);e.target.value=''};
 const dist=routeDistance(track);const quality=Math.min(100,(gps?.acc<=15?30:gps?.acc<=25?20:10)+Math.min(obs.length*10,30)+Math.min(photos.length*15,30)+(dist>=30?10:0));
 const finish=()=>{const visit={id:uid('V'),date:today(),startedAt:track[0]?.at||now(),endedAt:now(),mode:'inspection',purpose:terrain.purpose,track,points:obs,evidence:photos,distance:dist,avgAcc:track.length?track.reduce((s,p)=>s+(p.acc||0),0)/track.length:null,quality};queueVisitBundle(terrain.id,visit);localStorage.removeItem(DRAFT);onDone(visit)};
 return <div className="inspection"><div className="inspection-head"><button onClick={onBack}>← Terrenos</button><div><span>INSPECCIÓN REAL</span><h2>{terrain.name}</h2><p>{terrain.purpose}</p></div><div className="gps-pill">{gps?`GPS ±${Math.round(gps.acc)} m`:'GPS —'}</div></div><div className="inspection-grid"><div><LiveMap terrain={terrain} track={track} gps={gps} follow={active}/><div className="capture-bar">{!active?<button className="primary large" onClick={()=>setActive(true)}>Iniciar recorrido</button>:<><select value={kind} onChange={e=>setKind(e.target.value)}><option value="relleno">Relleno / corte</option><option value="drenaje">Drenaje / escurrimiento</option><option value="vegetacion">Vegetación</option><option value="construccion">Construcción</option><option value="residuo">Residuo</option><option value="acceso">Acceso</option><option value="suelo">Suelo</option><option value="otro">Otro</option></select><input value={note} onChange={e=>setNote(e.target.value)} placeholder="Observación breve"/><button onClick={addObs} disabled={!gps}>+ Observación</button><label className="photo-btn">+ Foto<input type="file" accept="image/*" capture="environment" onChange={addPhoto}/></label><button className="primary" onClick={finish}>Cerrar visita</button></>}</div>{error&&<div className="error">{error}</div>}</div><aside><span>CONTROL DE VISITA</span><div className="visit-stats"><K l="Recorrido" v={`${dist.toFixed(0)} m`}/><K l="Observaciones" v={obs.length}/><K l="Fotos" v={photos.length}/><K l="Calidad" v={`${quality}/100`}/></div><div className="guide"><strong>Qué hacer ahora</strong><p>{!active?'Pulsa Iniciar recorrido.':!gps?'Esperando ubicación…':gps.acc>25?'Espera una señal GPS más estable.':obs.length<2?'Registra al menos dos hechos relevantes.':photos.length<2?'Toma fotografías desde dos posiciones.':'Ya tienes una visita básica documentada.'}</p></div><div className="obs-list">{obs.slice().reverse().map(o=><div key={o.id}><b>{o.kind}</b><span>{o.note||'Sin nota'}</span><em>±{Math.round(o.acc)} m</em></div>)}</div></aside></div></div>
}

export default function FieldLiveApp(){
 const[terrains,setTerrains]=useState(()=>{try{return JSON.parse(localStorage.getItem(STORE)||'[]')}catch{return[]}}),[view,setView]=useState('home'),[selectedId,setSelectedId]=useState(null),[loading,setLoading]=useState(true),[lastVisit,setLastVisit]=useState(null);
 useEffect(()=>localStorage.setItem(STORE,JSON.stringify(terrains)),[terrains]);
 useEffect(()=>{(async()=>{try{const remote=await pullWorkspace();if(remote.terrains?.length){const by=new Map(terrains.map(t=>[t.id,t]));remote.terrains.forEach(t=>by.set(t.id,{...by.get(t.id),...t}));setTerrains([...by.values()])}}catch{}finally{setLoading(false)}})()},[]);
 const selected=terrains.find(t=>t.id===selectedId)||null;
 const addTerrain=t=>{setTerrains(v=>[...v,t]);setSelectedId(t.id);setView('inspect')};
 const onVisit=v=>{setLastVisit(v);setTerrains(xs=>xs.map(t=>t.id===selectedId?{...t,last:today(),visitsCount:(t.visitsCount||0)+1}:t));setView('summary')};
 const geo=exportGeoJsonUrl();
 return <div className="field-app"><header className="field-top"><div><span>SLTM · CAMPO REAL</span><h1>Inventario territorial</h1></div><div><SyncBadge/></div></header>
 {view==='home'&&<main className="home"><section className="hero"><span>SIN DATOS SIMULADOS</span><h2>Lo que aparezca aquí debe venir del teléfono o de tu inventario real.</h2><p>Primero levantas un terreno caminando su perímetro. Después haces visitas de inspección y agregas evidencia georreferenciada.</p><div className="hero-actions"><button className="primary large" onClick={()=>setView('new')}>+ Levantar terreno real</button>{geo&&terrains.length>0&&<a href={geo} target="_blank" rel="noreferrer">Exportar GeoJSON</a>}</div></section><section className="real-list"><div className="list-head"><h3>Terrenos reales</h3><span>{loading?'Sincronizando…':`${terrains.length} registrados`}</span></div>{!loading&&terrains.length===0?<div className="empty"><strong>Aún no hay terrenos.</strong><p>Eso es intencional. Mañana, el primer registro aparecerá cuando hagas un levantamiento con tu propio GPS.</p></div>:terrains.map(t=><button key={t.id} onClick={()=>{setSelectedId(t.id);setView('inspect')}}><div><b>{t.name}</b><span>{fmt(t.area)} m² · {fmt(t.perimeter)} m perímetro</span></div><em>{t.last||t.createdAt?.slice(0,10)}</em></button>)}</section></main>}
 {view==='new'&&<NewTerrain onSaved={addTerrain} onCancel={()=>setView('home')}/>} 
 {view==='inspect'&&selected&&<Inspection terrain={selected} onDone={onVisit} onBack={()=>setView('home')}/>} 
 {view==='summary'&&selected&&lastVisit&&<main className="summary"><span>VISITA GUARDADA</span><h2>{selected.name}</h2><div className="summary-grid"><K l="Recorrido" v={`${lastVisit.distance.toFixed(0)} m`}/><K l="Observaciones" v={lastVisit.points.length}/><K l="Fotografías" v={lastVisit.evidence.length}/><K l="Precisión media" v={lastVisit.avgAcc?`±${lastVisit.avgAcc.toFixed(0)} m`:'—'}/><K l="Calidad" v={`${lastVisit.quality}/100`}/></div><p>La visita quedó primero en el teléfono y entra a sincronización con el servidor cuando hay conexión.</p><button className="primary large" onClick={()=>setView('home')}>Volver al inventario</button></main>}
 </div>
}
function K({l,v}){return <div className="mini-k"><span>{l}</span><strong>{v}</strong></div>}
