import React,{useEffect,useMemo,useRef,useState}from'react';
import L from'leaflet';
import'leaflet/dist/leaflet.css';
import'./real-site.css';

const DEFAULT_CENTER=[23.2494,-106.4111];
const finite=v=>Number.isFinite(Number(v));
const fmt=(v,d=0)=>finite(v)?Number(v).toLocaleString('es-MX',{maximumFractionDigits:d}):'—';
const rad=x=>x*Math.PI/180;
const hav=(a,b)=>{const R=6371000,dLat=rad(b.lat-a.lat),dLng=rad(b.lng-a.lng),la1=rad(a.lat),la2=rad(b.lat);const h=Math.sin(dLat/2)**2+Math.cos(la1)*Math.cos(la2)*Math.sin(dLng/2)**2;return 2*R*Math.asin(Math.sqrt(h))};
const pointInPoly=(p,poly)=>{if(!p||!poly?.length)return false;let inside=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const yi=poly[i][0],xi=poly[i][1],yj=poly[j][0],xj=poly[j][1];const hit=((yi>p.lat)!==(yj>p.lat))&&(p.lng<(xj-xi)*(p.lat-yi)/(yj-yi+1e-12)+xi);if(hit)inside=!inside}return inside};
const metric=poly=>{if(!poly||poly.length<3)return{area:0,perimeter:0,ew:0,ns:0};const lat0=rad(poly.reduce((s,p)=>s+p[0],0)/poly.length),xy=poly.map(([lat,lng])=>({x:lng*111320*Math.cos(lat0),y:lat*110540}));let s=0;for(let i=0;i<xy.length;i++){const a=xy[i],b=xy[(i+1)%xy.length];s+=a.x*b.y-b.x*a.y}let per=0;for(let i=0;i<poly.length;i++)per+=hav({lat:poly[i][0],lng:poly[i][1]},{lat:poly[(i+1)%poly.length][0],lng:poly[(i+1)%poly.length][1]});const xs=xy.map(p=>p.x),ys=xy.map(p=>p.y);return{area:Math.abs(s)/2,perimeter:per,ew:Math.max(...xs)-Math.min(...xs),ns:Math.max(...ys)-Math.min(...ys)}};
const compactAddress=a=>[a.road||a.pedestrian||a.neighbourhood||a.suburb,a.city||a.town||a.municipality||a.county,a.state].filter(Boolean).join(' · ');
const geomToPoly=g=>{if(!g)return null;if(g.type==='Polygon')return g.coordinates?.[0]?.map(([lng,lat])=>[lat,lng])||null;if(g.type==='MultiPolygon'){const rings=g.coordinates?.map(x=>x?.[0]).filter(Boolean)||[];if(!rings.length)return null;const ring=rings.sort((a,b)=>b.length-a.length)[0];return ring.map(([lng,lat])=>[lat,lng])}return null};

function useSensors(){
 const[heading,setHeading]=useState(null),[tilt,setTilt]=useState({pitch:null,roll:null}),[motion,setMotion]=useState(null),[enabled,setEnabled]=useState(false);
 useEffect(()=>{if(!enabled)return;const o=e=>{const h=finite(e.webkitCompassHeading)?Number(e.webkitCompassHeading):(finite(e.alpha)?(360-Number(e.alpha))%360:null);if(finite(h))setHeading(h);setTilt({pitch:finite(e.beta)?Number(e.beta):null,roll:finite(e.gamma)?Number(e.gamma):null})};const m=e=>{const a=e.accelerationIncludingGravity||e.acceleration;if(a&&finite(a.x)&&finite(a.y)&&finite(a.z))setMotion(Math.sqrt(a.x*a.x+a.y*a.y+a.z*a.z))};window.addEventListener('deviceorientation',o,true);window.addEventListener('devicemotion',m,true);return()=>{window.removeEventListener('deviceorientation',o,true);window.removeEventListener('devicemotion',m,true)}},[enabled]);
 const enable=async()=>{let ok=true;try{if(typeof DeviceOrientationEvent!=='undefined'&&typeof DeviceOrientationEvent.requestPermission==='function')ok=(await DeviceOrientationEvent.requestPermission())==='granted'}catch{ok=false}try{if(typeof DeviceMotionEvent!=='undefined'&&typeof DeviceMotionEvent.requestPermission==='function')await DeviceMotionEvent.requestPermission()}catch{}setEnabled(ok||true)};
 return{heading,tilt,motion,enabled,enable};
}

async function reverseLookup(gps){
 const u=`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${gps.lat}&lon=${gps.lng}&zoom=18&addressdetails=1&polygon_geojson=1`;
 const r=await fetch(u,{headers:{'Accept-Language':'es'}});if(!r.ok)throw new Error('No se pudo resolver la dirección');return r.json();
}

async function osmContext(gps){
 const q=`[out:json][timeout:12];(way(around:140,${gps.lat},${gps.lng})[landuse];way(around:140,${gps.lat},${gps.lng})[building];way(around:140,${gps.lat},${gps.lng})[amenity];way(around:140,${gps.lat},${gps.lng})[leisure];way(around:140,${gps.lat},${gps.lng})[tourism];);out tags geom;`;
 const r=await fetch(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(q)}`);if(!r.ok)throw new Error('Sin respuesta cartográfica OSM');const j=await r.json();
 const polys=(j.elements||[]).filter(e=>e.type==='way'&&e.geometry?.length>=4).map(e=>{const poly=e.geometry.map(p=>[p.lat,p.lon]);const m=metric(poly);const tags=e.tags||{};const kind=tags.landuse?'Uso de suelo':tags.building?'Edificación':tags.amenity?'Equipamiento':tags.leisure?'Área recreativa':'Elemento cartográfico';return{id:`osm-${e.id}`,poly,tags,kind,area:m.area,contains:pointInPoly(gps,poly)}}).filter(x=>x.area>12&&x.area<250000);
 const containing=polys.filter(x=>x.contains).sort((a,b)=>{const pa=a.tags.landuse?0:a.tags.building?2:1,pb=b.tags.landuse?0:b.tags.building?2:1;return pa-pb||a.area-b.area})[0]||null;
 return{containing,nearby:polys.sort((a,b)=>a.area-b.area).slice(0,24)};
}

async function inegiMazatlan(gps){
 const inBox=gps.lat>23.02&&gps.lat<23.55&&gps.lng>-106.68&&gps.lng<-106.15;if(!inBox)return null;
 const ctl=new AbortController();const timer=setTimeout(()=>ctl.abort(),15000);
 try{const r=await fetch('https://gaia.inegi.org.mx/wscatgeo/v2/geo/mza/25/012/0001/U',{signal:ctl.signal});if(!r.ok)return null;const j=await r.json();const features=j.features||j?.data?.features||[];for(const f of features){const poly=geomToPoly(f.geometry);if(poly&&pointInPoly(gps,poly)){const p=f.properties||{};return{poly,properties:p,label:`Manzana ${p.cve_mza||p.CVE_MZA||'INEGI'}`,source:'INEGI · Marco Geoestadístico'}}}return null}catch{return null}finally{clearTimeout(timer)}
}

function MapPanel({gps,accuracy,official,detected,nearby,userPoly,walkTrack,drawMode,onMapPoint,base,setBase}){
 const host=useRef(null),mapRef=useRef(null),layers=useRef(null),tile=useRef(null),fitted=useRef(false);
 useEffect(()=>{const m=L.map(host.current,{zoomControl:false,attributionControl:true}).setView(DEFAULT_CENTER,13);L.control.zoom({position:'bottomright'}).addTo(m);layers.current=L.layerGroup().addTo(m);mapRef.current=m;setTimeout(()=>m.invalidateSize(),80);return()=>m.remove()},[]);
 useEffect(()=>{const m=mapRef.current;if(!m)return;if(tile.current)m.removeLayer(tile.current);tile.current=base==='sat'?L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:20,attribution:'Tiles © Esri'}):L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:20,attribution:'© OpenStreetMap'});tile.current.addTo(m)},[base]);
 useEffect(()=>{const m=mapRef.current;if(!m)return;const h=e=>{if(drawMode==='tap')onMapPoint?.({lat:e.latlng.lat,lng:e.latlng.lng})};m.on('click',h);return()=>m.off('click',h)},[drawMode,onMapPoint]);
 useEffect(()=>{const m=mapRef.current,g=layers.current;if(!m||!g)return;g.clearLayers();nearby.forEach(n=>L.polygon(n.poly,{color:'#758980',weight:1,fillOpacity:.025,opacity:.35}).addTo(g));if(detected?.poly)L.polygon(detected.poly,{color:'#d7b56d',weight:2,dashArray:'6 5',fillColor:'#d7b56d',fillOpacity:.08}).bindTooltip(`${detected.kind||'Área cartográfica'} · ${fmt(metric(detected.poly).area)} m²`).addTo(g);if(official?.poly)L.polygon(official.poly,{color:'#62a57d',weight:3,fillColor:'#62a57d',fillOpacity:.08}).bindTooltip(official.label||'Manzana INEGI').addTo(g);if(userPoly?.length>=2){L.polyline([...userPoly,userPoly.length>=3?userPoly[0]:null].filter(Boolean),{color:'#f4f1e9',weight:4}).addTo(g);userPoly.forEach((p,i)=>L.circleMarker(p,{radius:5,color:'#101612',weight:2,fillColor:'#f4f1e9',fillOpacity:1}).bindTooltip(`Punto ${i+1}`).addTo(g))}if(walkTrack?.length>1)L.polyline(walkTrack.map(p=>[p.lat,p.lng]),{color:'#ffffff',weight:3,dashArray:'3 5',opacity:.8}).addTo(g);if(gps){if(accuracy)L.circle([gps.lat,gps.lng],{radius:accuracy,color:'#7a9587',weight:1,fillColor:'#7a9587',fillOpacity:.06}).addTo(g);L.circleMarker([gps.lat,gps.lng],{radius:8,color:'#fff',weight:3,fillColor:'#15201a',fillOpacity:1}).bindTooltip('Tu posición').addTo(g);if(!fitted.current){m.setView([gps.lat,gps.lng],19);fitted.current=true}else m.panTo([gps.lat,gps.lng],{animate:true,duration:.35})}},[gps,accuracy,official,detected,nearby,userPoly,walkTrack]);
 return <div className="rs-map-wrap"><div ref={host} className="rs-map"/><div className="rs-map-switch"><button className={base==='street'?'active':''} onClick={()=>setBase('street')}>Calles</button><button className={base==='sat'?'active':''} onClick={()=>setBase('sat')}>Satélite</button></div>{drawMode==='tap'&&<div className="rs-map-hint">Toca las esquinas del terreno en orden</div>}</div>
}

function Pill({children,tone=''}){return <span className={`rs-pill ${tone}`}>{children}</span>}

export default function RealSiteApp(){
 const[gps,setGps]=useState(null),[gpsError,setGpsError]=useState(''),[locating,setLocating]=useState(false),[watching,setWatching]=useState(false),[scanState,setScanState]=useState('idle'),[address,setAddress]=useState(null),[detected,setDetected]=useState(null),[nearby,setNearby]=useState([]),[official,setOfficial]=useState(null),[userPoly,setUserPoly]=useState([]),[mode,setMode]=useState('auto'),[walking,setWalking]=useState(false),[walkTrack,setWalkTrack]=useState([]),[base,setBase]=useState('street'),[findings,setFindings]=useState([]),[photos,setPhotos]=useState([]),[panel,setPanel]=useState('site');
 const watchId=useRef(null),lastWalk=useRef(null),sensors=useSensors();
 const activePoly=userPoly.length>=3?userPoly:official?.poly||detected?.poly||null;
 const metrics=useMemo(()=>metric(activePoly),[activePoly]);
 const source=userPoly.length>=3?(mode==='walk'?'Perímetro levantado con GPS':mode==='corner'?'Esquinas registradas en campo':'Polígono dibujado por usuario'):official?.poly?'Manzana oficial INEGI':detected?.poly?`${detected.kind} · OpenStreetMap`:'Sin polígono';
 const position=()=>new Promise((resolve,reject)=>{if(!navigator.geolocation)return reject(new Error('Este dispositivo no expone GPS al navegador'));navigator.geolocation.getCurrentPosition(p=>resolve(p),reject,{enableHighAccuracy:true,timeout:18000,maximumAge:0})});
 const applyPos=p=>{const g={lat:p.coords.latitude,lng:p.coords.longitude,accuracy:p.coords.accuracy,altitude:p.coords.altitude,speed:p.coords.speed,heading:p.coords.heading,at:new Date().toISOString()};setGps(g);setGpsError('');return g};
 const startWatch=()=>{if(watchId.current||!navigator.geolocation)return;watchId.current=navigator.geolocation.watchPosition(p=>{const g=applyPos(p);if(walking&&(!lastWalk.current||hav(lastWalk.current,g)>=2.5)){setWalkTrack(x=>[...x,g]);lastWalk.current=g}},e=>setGpsError(e.message),{enableHighAccuracy:true,maximumAge:300,timeout:20000});setWatching(true)};
 const stopWatch=()=>{if(watchId.current){navigator.geolocation.clearWatch(watchId.current);watchId.current=null}setWatching(false)};
 useEffect(()=>()=>{if(watchId.current)navigator.geolocation.clearWatch(watchId.current)},[]);
 useEffect(()=>{if(!walking)return;lastWalk.current=null},[walking]);
 useEffect(()=>{if(!walking)return;startWatch()},[walking]);

 const locate=async()=>{setLocating(true);try{const p=await position();const g=applyPos(p);startWatch();return g}catch(e){setGpsError(e.message||'No se pudo obtener la ubicación');return null}finally{setLocating(false)}};
 const scan=async()=>{let g=gps;if(!g)g=await locate();if(!g)return;setScanState('scanning');setOfficial(null);setDetected(null);setNearby([]);try{const addr=await reverseLookup(g);setAddress(addr)}catch{}try{const osm=await osmContext(g);setDetected(osm.containing);setNearby(osm.nearby)}catch{}setScanState('inegi');const ing=await inegiMazatlan(g);if(ing)setOfficial(ing);setScanState('done');sensors.enable().catch(()=>{});};
 const setDelimitation=m=>{setMode(m);setUserPoly([]);setWalkTrack([]);setWalking(false)};
 const addCurrentCorner=async()=>{let g=gps;if(!g)g=await locate();if(g)setUserPoly(x=>[...x,[g.lat,g.lng]])};
 const closeWalk=()=>{if(walkTrack.length>=3){const simplified=[];walkTrack.forEach(p=>{const q=[p.lat,p.lng];if(!simplified.length||hav({lat:simplified.at(-1)[0],lng:simplified.at(-1)[1]},p)>=4)simplified.push(q)});setUserPoly(simplified);setWalking(false)}};
 const mapPoint=p=>setUserPoly(x=>[...x,[p.lat,p.lng]]);
 const addFinding=type=>{if(!gps)return;setFindings(x=>[{id:Date.now(),type,note:'',lat:gps.lat,lng:gps.lng,at:new Date().toISOString()},...x])};
 const updateFinding=(id,note)=>setFindings(x=>x.map(f=>f.id===id?{...f,note}:f));
 const addPhoto=e=>{const f=e.target.files?.[0];if(!f)return;setPhotos(x=>[{id:Date.now(),name:f.name,size:f.size,lat:gps?.lat??null,lng:gps?.lng??null,at:new Date().toISOString(),url:URL.createObjectURL(f)},...x]);e.target.value=''};
 const exportSession=()=>{const data={createdAt:new Date().toISOString(),location:gps,address:address?.display_name||null,polygon:activePoly,polygonSource:source,metrics,findings,photos:photos.map(({url,...p})=>p),sensors:{heading:sensors.heading,tilt:sensors.tilt,motion:sensors.motion},official:official?.properties||null};const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`SLTM_${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(a.href)};
 const openMaps=()=>gps&&window.open(`https://www.google.com/maps?q=${gps.lat},${gps.lng}`,'_blank','noopener,noreferrer');
 const accuracyTone=!gps?'':gps.accuracy<=6?'good':gps.accuracy<=15?'mid':'warn';

 return <main className="rs-shell">
   <header className="rs-top"><div><span className="rs-brand">SLTM</span><span className="rs-brand-sub">Sistema de Levantamiento Territorial Móvil</span></div><div className="rs-live"><i className={gps?'on':''}/>{gps?'GPS activo':'GPS sin activar'}</div></header>
   <section className="rs-hero"><div><span className="rs-kicker">DEMO DE CAMPO · DETECCIÓN AUTOMÁTICA</span><h1>Abre el teléfono. SLTM detecta dónde estás y convierte el sitio en información territorial.</h1><p>GPS, cartografía, división geoestadística, delimitación del terreno, sensores, evidencia y métricas en una sola sesión.</p></div><div className="rs-hero-actions"><button className="rs-primary" onClick={scan} disabled={locating||scanState==='scanning'||scanState==='inegi'}>{scanState==='scanning'?'Leyendo entorno…':scanState==='inegi'?'Buscando manzana INEGI…':gps?'Escanear entorno':'Detectar mi ubicación'}</button><button className="rs-secondary" onClick={locate}>{locating?'Ubicando…':'Solo GPS'}</button></div></section>

   <nav className="rs-tabs"><button className={panel==='site'?'active':''} onClick={()=>setPanel('site')}>Sitio</button><button className={panel==='field'?'active':''} onClick={()=>setPanel('field')}>Delimitar</button><button className={panel==='evidence'?'active':''} onClick={()=>setPanel('evidence')}>Evidencia <b>{findings.length+photos.length||''}</b></button><button className={panel==='device'?'active':''} onClick={()=>setPanel('device')}>Teléfono</button></nav>

   <section className="rs-layout">
    <MapPanel gps={gps} accuracy={gps?.accuracy} official={official} detected={detected} nearby={nearby} userPoly={userPoly} walkTrack={walkTrack} drawMode={mode==='tap'?'tap':''} onMapPoint={mapPoint} base={base} setBase={setBase}/>
    <aside className="rs-panel">
      {panel==='site'&&<>
        <div className="rs-panel-head"><div><span className="rs-eyebrow">UBICACIÓN ACTUAL</span><h2>{address?compactAddress(address.address||{}):gps?'Coordenada detectada':'Activa el GPS para comenzar'}</h2></div>{gps&&<button className="rs-icon-btn" onClick={openMaps}>↗ Maps</button>}</div>
        {gps&&<div className="rs-coords"><span>{gps.lat.toFixed(6)}</span><span>{gps.lng.toFixed(6)}</span><Pill tone={accuracyTone}>± {fmt(gps.accuracy,1)} m</Pill></div>}
        {gpsError&&<div className="rs-alert">{gpsError}</div>}
        <div className="rs-source-card"><div><span>Polígono activo</span><strong>{source}</strong></div><Pill tone={official?'good':userPoly.length>=3?'good':detected?'mid':''}>{official?'Oficial':userPoly.length>=3?'Campo':detected?'Cartográfico':'Pendiente'}</Pill></div>
        <div className="rs-metrics"><div><span>Área</span><strong>{metrics.area?`${fmt(metrics.area)} m²`:'—'}</strong><small>{metrics.area>=10000?`${fmt(metrics.area/10000,2)} ha`:''}</small></div><div><span>Perímetro</span><strong>{metrics.perimeter?`${fmt(metrics.perimeter,1)} m`:'—'}</strong></div><div><span>E–O aprox.</span><strong>{metrics.ew?`${fmt(metrics.ew,1)} m`:'—'}</strong></div><div><span>N–S aprox.</span><strong>{metrics.ns?`${fmt(metrics.ns,1)} m`:'—'}</strong></div></div>
        {official&&<div className="rs-insight"><span>DIVISIÓN OFICIAL DETECTADA</span><strong>{official.label}</strong><p>{official.properties?.nom_loc||'Mazatlán'} · AGEB {official.properties?.cve_ageb||'—'} · Manzana {official.properties?.cve_mza||'—'}</p><small>Marco Geoestadístico INEGI. Esto representa una manzana geoestadística, no necesariamente un predio catastral.</small></div>}
        {!official&&detected&&<div className="rs-insight amber"><span>ÁREA CARTOGRÁFICA INMEDIATA</span><strong>{detected.kind}</strong><p>{detected.tags?.name||detected.tags?.landuse||detected.tags?.building||'Polígono de OpenStreetMap'} · {fmt(detected.area)} m²</p><small>No se presenta como límite catastral. Puedes sustituirlo delimitando el terreno en campo.</small></div>}
        <button className="rs-wide" onClick={()=>setPanel('field')}>Delimitar este terreno →</button>
      </>}

      {panel==='field'&&<>
        <div className="rs-panel-head"><div><span className="rs-eyebrow">DELIMITACIÓN</span><h2>Define el terreno real</h2></div></div>
        <p className="rs-copy">Usa el método que mejor funcione en el sitio. SLTM recalcula el polígono en cuanto registra tres o más puntos.</p>
        <div className="rs-methods"><button className={mode==='walk'?'active':''} onClick={()=>setDelimitation('walk')}><b>01</b><strong>Caminar perímetro</strong><span>El GPS traza el borde mientras recorres el terreno.</span></button><button className={mode==='corner'?'active':''} onClick={()=>setDelimitation('corner')}><b>02</b><strong>Marcar esquinas</strong><span>Llega a cada vértice y registra tu posición.</span></button><button className={mode==='tap'?'active':''} onClick={()=>setDelimitation('tap')}><b>03</b><strong>Dibujar en mapa</strong><span>Toca las esquinas directamente sobre el mapa.</span></button></div>
        {mode==='walk'&&<div className="rs-control-card"><div><span>Puntos de ruta</span><strong>{walkTrack.length}</strong></div><div><span>Distancia</span><strong>{fmt(walkTrack.slice(1).reduce((s,p,i)=>s+hav(walkTrack[i],p),0),1)} m</strong></div>{!walking?<button className="rs-primary" onClick={()=>{setWalkTrack([]);setUserPoly([]);setWalking(true);startWatch()}}>Iniciar perímetro</button>:<button className="rs-stop" onClick={closeWalk}>Cerrar polígono</button>}</div>}
        {mode==='corner'&&<div className="rs-control-card"><div><span>Esquinas</span><strong>{userPoly.length}</strong></div><button className="rs-primary" onClick={addCurrentCorner}>+ Registrar esta esquina</button></div>}
        {mode==='tap'&&<div className="rs-control-card"><div><span>Vértices</span><strong>{userPoly.length}</strong></div><span className="rs-muted">Toca el mapa para añadir puntos.</span></div>}
        {userPoly.length>0&&<div className="rs-row"><button className="rs-secondary" onClick={()=>setUserPoly(x=>x.slice(0,-1))}>Deshacer punto</button><button className="rs-secondary" onClick={()=>setUserPoly([])}>Limpiar</button></div>}
        {userPoly.length>=3&&<div className="rs-result"><span>TERRENO DELIMITADO</span><strong>{fmt(metric(userPoly).area)} m²</strong><small>{fmt(metric(userPoly).perimeter,1)} m de perímetro · {userPoly.length} vértices</small></div>}
      </>}

      {panel==='evidence'&&<>
        <div className="rs-panel-head"><div><span className="rs-eyebrow">EVIDENCIA GEOREFERENCIADA</span><h2>Registra lo que encuentras</h2></div></div>
        <div className="rs-quick-findings">{['Acceso','Drenaje','Servicios','Obstáculo','Vegetación','Topografía'].map(t=><button key={t} disabled={!gps} onClick={()=>addFinding(t)}>+ {t}</button>)}</div>
        <label className={`rs-camera ${!gps?'disabled':''}`}><input type="file" accept="image/*" capture="environment" onChange={addPhoto} disabled={!gps}/><span>◉</span><div><strong>Tomar fotografía</strong><small>Se guarda con coordenada y hora de la sesión</small></div></label>
        <div className="rs-evidence-list">{photos.map(p=><div className="rs-photo" key={p.id}><img src={p.url} alt="Evidencia"/><div><strong>Fotografía</strong><small>{p.lat?.toFixed(5)}, {p.lng?.toFixed(5)}</small></div></div>)}{findings.map(f=><div className="rs-finding" key={f.id}><div><Pill>{f.type}</Pill><small>{f.lat.toFixed(5)}, {f.lng.toFixed(5)}</small></div><input placeholder="Añade una nota…" value={f.note} onChange={e=>updateFinding(f.id,e.target.value)}/></div>)}</div>
        {(findings.length||photos.length)?<button className="rs-wide" onClick={exportSession}>Exportar sesión JSON</button>:<div className="rs-empty">Aún no hay evidencia. Los registros se anclan a tu posición GPS actual.</div>}
      </>}

      {panel==='device'&&<>
        <div className="rs-panel-head"><div><span className="rs-eyebrow">SENSORES DEL TELÉFONO</span><h2>El dispositivo también mide</h2></div><button className="rs-icon-btn" onClick={sensors.enable}>Activar</button></div>
        <div className="rs-device-grid"><div><span>Rumbo</span><strong>{finite(sensors.heading)?`${fmt(sensors.heading,0)}°`:'—'}</strong></div><div><span>Altitud GPS</span><strong>{finite(gps?.altitude)?`${fmt(gps.altitude,1)} m`:'—'}</strong></div><div><span>Inclinación</span><strong>{finite(sensors.tilt.pitch)?`${fmt(sensors.tilt.pitch,1)}°`:'—'}</strong></div><div><span>Balanceo</span><strong>{finite(sensors.tilt.roll)?`${fmt(sensors.tilt.roll,1)}°`:'—'}</strong></div><div><span>Movimiento</span><strong>{finite(sensors.motion)?`${fmt(sensors.motion,1)} m/s²`:'—'}</strong></div><div><span>Velocidad GPS</span><strong>{finite(gps?.speed)?`${fmt(gps.speed*3.6,1)} km/h`:'—'}</strong></div></div>
        <div className="rs-tech"><strong>Qué usa SLTM</strong><p>Geolocalización de alta precisión, orientación del dispositivo, acelerómetro, cámara y cartografía web. En iPhone los sensores requieren autorización explícita.</p></div>
        <div className="rs-tech"><strong>Qué no afirma</strong><p>Un polígono OSM o una manzana INEGI no equivale automáticamente a propiedad catastral. La delimitación de campo sirve para diagnóstico preliminar, no sustituye topografía certificada.</p></div>
        <div className="rs-row"><button className="rs-secondary" onClick={watching?stopWatch:startWatch}>{watching?'Detener GPS continuo':'GPS continuo'}</button>{gps&&<button className="rs-secondary" onClick={openMaps}>Abrir en Maps</button>}</div>
      </>}
    </aside>
   </section>
   <footer className="rs-footer"><span>SLTM · Demo de campo</span><span>GPS + INEGI + OpenStreetMap + sensores móviles</span></footer>
 </main>
}
