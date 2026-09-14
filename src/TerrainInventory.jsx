import React, {useEffect,useMemo,useRef,useState} from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './terrain-inventory.css';

const STORE='sltm_terrain_inventory_v1';
const DEMO=[
 {id:'T-001',name:'Predio Estero Norte',status:'Monitoreo',use:'Mixto',area:12840,slope:3.8,permeable:72,built:8,access:82,eco:88,dev:68,change:14,last:'2026-09-08',center:[23.2665,-106.4215],poly:[[23.2671,-106.4224],[23.2672,-106.4208],[23.2661,-106.4205],[23.2658,-106.4220]],tags:['humedal cercano','relleno observado'],visits:3,points:9},
 {id:'T-002',name:'Lote Marina Oriente',status:'Disponible',use:'Urbano',area:7420,slope:1.9,permeable:41,built:0,access:94,eco:55,dev:89,change:3,last:'2026-09-02',center:[23.2588,-106.4109],poly:[[23.2593,-106.4117],[23.2594,-106.4103],[23.2583,-106.4102],[23.2581,-106.4114]],tags:['frente vial','sin construcción'],visits:2,points:7},
 {id:'T-003',name:'Reserva Cerritos',status:'Revisión',use:'Borde urbano',area:21400,slope:6.4,permeable:91,built:2,access:63,eco:93,dev:52,change:22,last:'2026-09-11',center:[23.3034,-106.4781],poly:[[23.3042,-106.4791],[23.3044,-106.4770],[23.3026,-106.4767],[23.3024,-106.4788]],tags:['vegetación','cambio reciente'],visits:4,points:13},
 {id:'T-004',name:'Plataforma Sur',status:'En obra',use:'Industrial',area:9650,slope:2.5,permeable:18,built:27,access:88,eco:38,dev:84,change:37,last:'2026-09-12',center:[23.1968,-106.4017],poly:[[23.1975,-106.4025],[23.1973,-106.4007],[23.1961,-106.4009],[23.1960,-106.4024]],tags:['relleno','plataforma'],visits:5,points:16},
 {id:'T-005',name:'Predio Arroyo Seco',status:'Monitoreo',use:'Periurbano',area:15600,slope:8.7,permeable:84,built:5,access:58,eco:90,dev:49,change:9,last:'2026-08-28',center:[23.2441,-106.3657],poly:[[23.2450,-106.3667],[23.2448,-106.3648],[23.2432,-106.3649],[23.2430,-106.3666]],tags:['escurrimiento','talud'],visits:2,points:8}
];

const fmt=n=>new Intl.NumberFormat('es-MX').format(Math.round(n||0));
const polygonAreaMeters=(latlngs)=>{
 if(latlngs.length<3)return 0; const lat0=latlngs.reduce((s,p)=>s+p[0],0)/latlngs.length*Math.PI/180;
 const pts=latlngs.map(([lat,lng])=>({x:lng*111320*Math.cos(lat0),y:lat*110540})); let a=0;
 pts.forEach((p,i)=>{const q=pts[(i+1)%pts.length];a+=p.x*q.y-q.x*p.y}); return Math.abs(a)/2;
};
function deriveScores(t){
 const eco=Math.round(Math.max(0,Math.min(100,t.permeable*.58+(100-t.built)*.16+(100-Math.min(t.change,100))*.18+(100-Math.min(t.slope*5,100))*.08)));
 const dev=Math.round(Math.max(0,Math.min(100,t.access*.38+(100-Math.min(t.slope*7,100))*.24+(100-t.built)*.12+(100-Math.min(t.eco||eco,100))*.08+76*.18)));
 return {...t,eco:t.eco??eco,dev:t.dev??dev};
}

function MapPanel({terrains,selectedId,onSelect,onCreate}){
 const host=useRef(null),mapRef=useRef(null),layerRef=useRef(null),drawRef=useRef([]),drawingRef=useRef(false);
 useEffect(()=>{
  const map=L.map(host.current,{zoomControl:false}).setView([23.2494,-106.4111],12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:20,attribution:'© OpenStreetMap'}).addTo(map);
  L.control.zoom({position:'bottomright'}).addTo(map); mapRef.current=map; layerRef.current=L.layerGroup().addTo(map);
  const click=e=>{if(!drawingRef.current)return; drawRef.current=[...drawRef.current,[e.latlng.lat,e.latlng.lng]]; renderDraw();}; map.on('click',click);
  return()=>{map.off('click',click);map.remove()};
 },[]);
 const renderDraw=()=>{const map=mapRef.current;if(!map)return; map.eachLayer(l=>{if(l.options?.pane==='markerPane'&&l.__drawTmp)map.removeLayer(l)}); const pts=drawRef.current; pts.forEach(p=>{const m=L.circleMarker(p,{radius:6,color:'#111',fillColor:'#fff',fillOpacity:1,weight:2}).addTo(map);m.__drawTmp=true}); if(pts.length>1){const p=L.polyline(pts,{color:'#111',dashArray:'6 5',weight:2}).addTo(map);p.__drawTmp=true}}
 useEffect(()=>{
  const g=layerRef.current;if(!g)return;g.clearLayers();terrains.forEach(t=>{const sel=t.id===selectedId;const p=L.polygon(t.poly,{color:sel?'#111':'#58655d',weight:sel?3:1.5,fillColor:sel?'#d9e0db':'#bfc9c2',fillOpacity:sel?.38:.22}).addTo(g);p.on('click',()=>onSelect(t.id));p.bindTooltip(`<b>${t.id}</b> · ${t.name}<br>${fmt(t.area)} m²`)});
 },[terrains,selectedId]);
 const startDraw=()=>{drawingRef.current=true;drawRef.current=[];renderDraw()};
 const finishDraw=()=>{if(drawRef.current.length<3)return; const poly=[...drawRef.current],area=polygonAreaMeters(poly);onCreate(poly,area);drawingRef.current=false;drawRef.current=[];renderDraw()};
 return <div className="map-wrap"><div ref={host} className="map"/><div className="map-actions"><button onClick={startDraw}>Dibujar nuevo terreno</button><button onClick={finishDraw}>Cerrar polígono</button></div></div>
}

function FieldVisit({terrain,onSave}){
 const [active,setActive]=useState(false),[gps,setGps]=useState(null),[points,setPoints]=useState([]),[kind,setKind]=useState('borde'),[note,setNote]=useState(''); const watch=useRef(null);
 useEffect(()=>()=>{if(watch.current!=null)navigator.geolocation?.clearWatch(watch.current)},[]);
 const start=()=>{if(!navigator.geolocation)return;setActive(true);watch.current=navigator.geolocation.watchPosition(p=>setGps({lat:p.coords.latitude,lng:p.coords.longitude,alt:p.coords.altitude,acc:p.coords.accuracy,altAcc:p.coords.altitudeAccuracy}),()=>{}, {enableHighAccuracy:true,maximumAge:500,timeout:20000})};
 const add=()=>{if(!gps)return;setPoints(v=>[...v,{...gps,kind,note,at:new Date().toISOString()}]);setNote('')};
 const finish=()=>{if(watch.current!=null)navigator.geolocation.clearWatch(watch.current);watch.current=null;setActive(false);onSave(points);setPoints([])};
 return <div className="visit-box"><div className="visit-head"><div><span>LEVANTAMIENTO DE CAMPO</span><strong>{terrain.name}</strong></div><b>{active?'ACTIVO':'LISTO'}</b></div>
 <div className="visit-grid"><div><span>GPS</span><strong>{gps?`±${Math.round(gps.acc)} m`:'—'}</strong></div><div><span>Cota</span><strong>{Number.isFinite(gps?.alt)?`${gps.alt.toFixed(1)} m`:'—'}</strong></div><div><span>Puntos</span><strong>{points.length}</strong></div></div>
 {!active?<button className="primary" onClick={start}>Iniciar visita</button>:<><div className="field-row"><select value={kind} onChange={e=>setKind(e.target.value)}><option>borde</option><option>suelo</option><option>construcción</option><option>vegetación</option><option>drenaje</option><option>relleno</option><option>evidencia</option></select><input value={note} onChange={e=>setNote(e.target.value)} placeholder="nota opcional"/></div><div className="field-actions"><button onClick={add} disabled={!gps}>Registrar punto 3D</button><label className="camera-file">Tomar foto<input type="file" accept="image/*" capture="environment"/></label><button className="primary" onClick={finish}>Finalizar</button></div></>}
 <p>Los puntos guardan latitud, longitud, cota GNSS, precisión, tipo y hora. La cota es indicativa en teléfonos convencionales.</p></div>
}

export default function TerrainInventory(){
 const [terrains,setTerrains]=useState(()=>{try{return JSON.parse(localStorage.getItem(STORE))||DEMO}catch{return DEMO}});const [selectedId,setSelectedId]=useState('T-001');const [lens,setLens]=useState('doble');const [query,setQuery]=useState('');const [tab,setTab]=useState('inventario');
 useEffect(()=>localStorage.setItem(STORE,JSON.stringify(terrains)),[terrains]);
 const terrains2=useMemo(()=>terrains.map(deriveScores),[terrains]); const selected=terrains2.find(t=>t.id===selectedId)||terrains2[0];
 const filtered=terrains2.filter(t=>(t.name+t.id+t.use+t.status+t.tags.join(' ')).toLowerCase().includes(query.toLowerCase()));
 const createTerrain=(poly,area)=>{const id=`T-${String(terrains.length+1).padStart(3,'0')}`;const center=[poly.reduce((s,p)=>s+p[0],0)/poly.length,poly.reduce((s,p)=>s+p[1],0)/poly.length];const t=deriveScores({id,name:`Terreno ${id}`,status:'Nuevo',use:'Sin clasificar',area,slope:0,permeable:100,built:0,access:50,change:0,last:new Date().toISOString().slice(0,10),center,poly,tags:['levantamiento nuevo'],visits:0,points:0});setTerrains(v=>[...v,t]);setSelectedId(id)};
 const saveVisit=pts=>{if(!pts.length)return;setTerrains(v=>v.map(t=>t.id===selectedId?{...t,visits:(t.visits||0)+1,points:(t.points||0)+pts.length,last:new Date().toISOString().slice(0,10),fieldPoints:[...(t.fieldPoints||[]),...pts]}:t))};
 const reset=()=>{localStorage.removeItem(STORE);setTerrains(DEMO);setSelectedId('T-001')};
 return <div className="app"><header><div><span className="eyebrow">SLTM · INVENTARIO TERRITORIAL</span><h1>Terrenos</h1><p>Un mismo expediente físico para evaluación ambiental, desarrollo y seguimiento de cambios.</p></div><div className="header-actions"><button className={lens==='ecologia'?'active':''} onClick={()=>setLens('ecologia')}>Ecología</button><button className={lens==='desarrollo'?'active':''} onClick={()=>setLens('desarrollo')}>Desarrollo</button><button className={lens==='doble'?'active':''} onClick={()=>setLens('doble')}>Vista doble</button></div></header>
 <nav><button className={tab==='inventario'?'active':''} onClick={()=>setTab('inventario')}>Inventario</button><button className={tab==='campo'?'active':''} onClick={()=>setTab('campo')}>Campo</button><button className={tab==='cambios'?'active':''} onClick={()=>setTab('cambios')}>Cambios</button><button onClick={reset}>Restablecer demo</button></nav>
 {tab==='inventario'&&<main className="layout"><aside className="inventory"><div className="search"><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar terreno, uso o condición"/><b>{filtered.length}</b></div><div className="cards">{filtered.map(t=><button key={t.id} className={`terrain-card ${t.id===selectedId?'selected':''}`} onClick={()=>setSelectedId(t.id)}><div><span>{t.id}</span><em>{t.status}</em></div><strong>{t.name}</strong><p>{fmt(t.area)} m² · {t.use}</p><div className="score-row"><i>Eco {t.eco}</i><i>Des {t.dev}</i><i>Δ {t.change}%</i></div></button>)}</div></aside>
 <section className="map-section"><MapPanel terrains={terrains2} selectedId={selectedId} onSelect={setSelectedId} onCreate={createTerrain}/></section>
 <aside className="detail"><div className="detail-head"><span>{selected.id}</span><h2>{selected.name}</h2><p>{selected.status} · última visita {selected.last}</p></div><div className="kpis"><K label="Superficie" value={`${fmt(selected.area)} m²`}/><K label="Pendiente" value={`${selected.slope}%`}/><K label="Permeable" value={`${selected.permeable}%`}/><K label="Construido" value={`${selected.built}%`}/></div>
 {(lens==='ecologia'||lens==='doble')&&<section className="lens eco"><div><span>LECTURA ECOLÓGICA</span><strong>{selected.eco}/100</strong></div><Meter v={selected.eco}/><p>{selected.permeable>=70?'Alta proporción de superficie permeable. ':''}{selected.change>=20?'Cambio reciente relevante; priorizar verificación de campo. ':''}{selected.tags.join(' · ')}</p></section>}
 {(lens==='desarrollo'||lens==='doble')&&<section className="lens dev"><div><span>LECTURA DE DESARROLLO</span><strong>{selected.dev}/100</strong></div><Meter v={selected.dev}/><p>Acceso {selected.access}/100 · pendiente {selected.slope}% · ocupación actual {selected.built}%. Índice orientativo para priorizar revisión física, no valuación.</p></section>}
 <section className="facts"><h3>Expediente físico</h3><div><span>Visitas</span><b>{selected.visits}</b></div><div><span>Puntos de campo</span><b>{selected.points}</b></div><div><span>Cambio observado</span><b>{selected.change}%</b></div><div><span>Uso</span><b>{selected.use}</b></div></section></aside></main>}
 {tab==='campo'&&<main className="field-page"><section className="field-map"><MapPanel terrains={terrains2} selectedId={selectedId} onSelect={setSelectedId} onCreate={createTerrain}/></section><FieldVisit terrain={selected} onSave={saveVisit}/><section className="point-log"><h3>Puntos registrados</h3>{(selected.fieldPoints||[]).slice().reverse().map((p,i)=><div key={i}><span>{p.kind}</span><b>{p.lat.toFixed(6)}, {p.lng.toFixed(6)}</b><em>{Number.isFinite(p.alt)?`${p.alt.toFixed(1)} m`:''} · ±{Math.round(p.acc)} m</em></div>)}{!(selected.fieldPoints||[]).length&&<p>Inicia una visita y registra puntos para crear la evidencia espacial del terreno.</p>}</section></main>}
 {tab==='cambios'&&<main className="changes"><div className="change-hero"><span>SEGUIMIENTO TEMPORAL</span><h2>Prioriza dónde volver a campo</h2><p>La demo ordena los terrenos por intensidad de cambio declarada/observada. Después puede alimentarse con comparación satelital o reconstrucción 3D.</p></div>{[...terrains2].sort((a,b)=>b.change-a.change).map(t=><button className="change-row" key={t.id} onClick={()=>{setSelectedId(t.id);setTab('campo')}}><div><span>{t.id}</span><strong>{t.name}</strong></div><Meter v={t.change}/><b>{t.change}%</b><em>{t.change>=20?'Revisar':'Estable'}</em></button>)}</main>}
 </div>
}
function K({label,value}){return <div><span>{label}</span><strong>{value}</strong></div>}
function Meter({v}){return <div className="meter"><i style={{width:`${Math.max(0,Math.min(100,v))}%`}}/></div>}
