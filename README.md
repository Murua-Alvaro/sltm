# SLTM — Sistema de Levantamiento Territorial Móvil

Aplicación web progresiva para captura territorial georreferenciada desde celular y revisión desde computadora.

## Versión 0.2

- mapa cartográfico real con OpenStreetMap y Leaflet;
- recorridos GPS persistentes como sesiones independientes;
- pausa, reanudación y finalización de levantamientos;
- filtrado básico de lecturas GPS de muy baja calidad;
- distancia recorrida, duración, precisión media y número de puntos;
- observaciones con categoría, prioridad, nota, coordenada y precisión;
- evidencia fotográfica persistente en IndexedDB;
- identificación de brigadista, brigada y dispositivo;
- captura y almacenamiento local aun sin conexión;
- exportación JSON y GeoJSON;
- sincronización central preparada mediante `VITE_API_URL`, sin marcar datos como enviados hasta recibir confirmación real del servidor;
- interfaz responsive para operación móvil y revisión en escritorio;
- instalación como PWA en Android e iOS compatibles.

## Desarrollo

```bash
npm install
npm run dev
```

## Producción

```bash
npm run build
```

Render publica `dist/` y despliega automáticamente desde `main`.

## Alcance técnico

SLTM es una herramienta de levantamiento preliminar y operativo. La precisión depende del dispositivo, condiciones GNSS, permisos del navegador y metodología de campo. No sustituye topografía certificada ni dictámenes técnicos especializados.
