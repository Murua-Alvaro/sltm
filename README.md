# Sistema de Levantamiento Territorial

Aplicación web progresiva (PWA) para captura territorial georreferenciada desde celular y revisión en computadora.

## Primera versión funcional

- diseño responsive para teléfono y escritorio;
- instalación como PWA;
- captura de ubicación GPS de alta precisión disponible en navegador;
- seguimiento continuo de recorrido;
- observaciones puntuales georreferenciadas;
- categorías iniciales: arbolado, drenaje, banquetas, anuncios, residuos, obras, predios, vialidad y vegetación;
- almacenamiento local para trabajo de campo;
- interfaz de sincronización preparada para una API posterior;
- acceso a cámara mediante el selector nativo del dispositivo.

## Desarrollo

```bash
npm install
npm run dev
```

## Compilación

```bash
npm run build
```

El resultado se genera en `dist/` y puede publicarse como sitio estático en Render.

## Arquitectura prevista

La PWA será el cliente móvil/escritorio. En la siguiente etapa se añadirá una API para usuarios, brigadas, misiones, recorridos, observaciones, archivos y control de calidad; posteriormente se incorporarán detección automática y comparación temporal.
