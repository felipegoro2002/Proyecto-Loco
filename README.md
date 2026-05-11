# Proyecto Loco

Herramienta de automatizacion de tareas con IA. El sistema graba lo que hace el usuario (pantalla, audio, browser, inputs del sistema), comprime y estructura los eventos, y los entrega a una IA para que pueda entender y replicar la tarea.

---

## Estructura del proyecto

```
/
├── Extension/              # Extension de Chrome que captura eventos del browser
│   ├── manifest.json
│   ├── background.js       # Filtra y reenvía network requests al recorder
│   └── content.js          # Captura clicks, scroll, inputs, dwell time, etc.
│
├── recorder/               # Backend Python que orquesta la grabacion
│   ├── main.py             # Punto de entrada: arranca y detiene la sesion
│   ├── event_manager.py    # Almacena y timestampea todos los eventos
│   ├── input_listener.py   # Captura teclado y mouse del sistema (pynput)
│   ├── browser_server.py   # Servidor Flask que recibe eventos de la extension
│   ├── video_recorder.py   # Graba pantalla + audio con ffmpeg
│   ├── transcribe.py       # Transcribe el audio con Whisper
│   ├── frame_extractor.py  # Extrae frames del video en momentos clave
│   └── compressor.py       # Comprime y filtra la sesion para la IA
│
└── docs/
    ├── generate_schema.js                      # Script para regenerar el .docx
    └── Esquema de Eventos - Proyecto Loco.docx # Referencia completa de eventos
```

---

## Como usar

### 1. Instalar dependencias

```bash
pip install flask flask-cors pynput pywin32 psutil openai-whisper
```

Requiere tambien **ffmpeg** en el PATH. En Windows, la forma mas rapida es con winget:

```bash
winget install ffmpeg
```

Despues de instalarlo, cerrar y reabrir la terminal para que el PATH se actualice. Verificar con `ffmpeg -version`.

### 2. Cargar la extension en Chrome

1. Ir a `chrome://extensions`
2. Activar "Modo desarrollador"
3. "Cargar sin empaquetar" → seleccionar la carpeta `Extension/`

> Recargar la extension cada vez que se modifique `background.js` o `content.js`.

### 3. Grabar una sesion

```bash
cd recorder
python main.py
```

Presionar **ENTER** para detener la grabacion.

> Si el puerto 5000 ya esta en uso, Flask falla al arrancar y la extension no puede enviar eventos. Verificar con `netstat -ano | findstr :5000`. Si hay un proceso ocupando el puerto, terminarlo o cambiar el puerto en `browser_server.py` y en `background.js` (`fetch('http://localhost:PUERTO/event', ...)`).
 Al finalizar se generan:

```
recorder/data/<session-id>/
├── screen.mp4              # Video de pantalla con audio
├── audio.wav               # Audio extraido
├── session.json            # Todos los eventos en crudo
├── session_compressed.json # Eventos filtrados y comprimidos para la IA
└── frames/                 # Frames JPEG extraidos del video
    ├── frame_0.0.jpg       # Frame de speech (frase del usuario)
    ├── frame_10.0.jpg      # Frame ambiental (cada 10s)
    ├── frame_14.5.jpg      # Frame de page_load
    └── ...
```

El intervalo de frames ambientales se puede cambiar:

```python
record_session(frame_interval_s=5)   # mas denso
record_session(frame_interval_s=30)  # menos frames
```

---

## Pipeline de eventos

```
Usuario actua
    │
    ├── input_listener.py  →  clicks, teclado, scroll, drag (sistema)
    └── content.js         →  clicks, inputs, dwell time, hover, network (browser)
                │
                ▼
         background.js  (pre-filtro de network en el browser)
           - Solo APIs del mismo dominio raiz que la pagina activa
           - Descarta tracking, analytics y CDNs cross-origin
           - Descarta infraestructura RPC interna (Google Workspace, etc.)
                │
                ▼
         EventManager  (normaliza timestamps, fuente)
                │
                ├── transcribe.py  →  eventos speech (Whisper small)
                │
                ├── frame_extractor.py  →  eventos screenshot
                │     - page_load: frame al cargar cada pagina
                │     - speech: frame al inicio de cada frase
                │     - ambient: frame cada N segundos
                │
                ▼
         session.json  (todos los eventos en crudo)
                │
                ▼
         compressor.py
           - network    → descarta paths de tracking del mismo sitio
           - scroll     → agrupa rafagas en scroll_summary (browser + sistema)
           - element_read → filtra breadcrumbs, paginacion; deduplica
           - hover      → solo tags semanticos con texto real (>= 800ms)
           - reading_pause → descarta si scroll_pct < 5% (nav noise)
           - focus/blur/keydown/time_on_page → descartados siempre
           - page_load/summary en redirects → descarta google.com/url
           - page_summary con duration < 500ms → descarta (bounce/redirect)
                │
                ▼
    session_compressed.json  →  IA
    frames/*.jpg             →  disponibles para analisis visual opcional
```

---

## Tipos de eventos principales

| Fuente  | Tipo             | Descripcion |
|---------|------------------|-------------|
| system  | `typed`          | Texto escrito (buffer de 1.2s con backspace aplicado) |
| system  | `shortcut`       | Atajos de teclado (Ctrl+C, Alt+Tab, etc.) |
| system  | `click`          | Click del mouse con ventana activa |
| system  | `double_click`   | Doble click |
| system  | `drag`           | Arrastre con coordenadas y duracion |
| system  | `scroll_summary` | Rafaga de scroll comprimida (sistema o browser) |
| browser | `page_load`      | Carga de pagina con URL y titulo |
| browser | `click`          | Click con tag, texto, xpath y URL |
| browser | `input`          | Valor de campo de formulario (debounce 800ms) |
| browser | `hover`          | Hover intencional (>= 800ms) sobre elemento semantico |
| browser | `element_read`   | Elemento visible por mas de 1500ms (dwell time) |
| browser | `reading_pause`  | Snapshot de elementos visibles al pausar el scroll |
| browser | `page_summary`   | Resumen estructurado al salir (h1, precio, botones) |
| browser | `spa_navigation`  | Navegacion en apps de una sola pagina (history.pushState / popstate) |
| browser | `hash_navigation` | Cambio de hash en la URL (#seccion) |
| browser | `text_select`     | Texto seleccionado con el mouse (> 2 caracteres) |
| browser | `copy`            | Texto copiado con Ctrl+C o clic derecho > Copiar |
| browser | `paste`           | Texto pegado en un elemento del DOM |
| browser | `network`         | APIs del mismo dominio (filtradas por background.js + compressor) |
| speech  | `speech`         | Transcripcion del audio del usuario (Whisper small) |
| video   | `screenshot`     | Frame del video en momentos clave (page_load, speech, ambient) |

Ver el detalle completo de campos en `docs/Esquema de Eventos - Proyecto Loco.docx`.

### Sobre el filtro de network

El sistema usa un enfoque estructural (no blacklist de dominios) para capturar solo APIs utiles:

- **background.js**: solo deja pasar requests del mismo dominio raiz que la pagina activa, con paths de API (`/api/`, `/graphql`, etc.). Elimina todo lo cross-origin (tracking, ads, analytics) automaticamente para cualquier sitio.
- **compressor.py**: segunda pasada que descarta paths de telemetria del propio sitio y residuos que pasaron por coincidencia de substring.

Esto funciona para cualquier sitio sin necesitar conocer el dominio de antemano.

### Sobre los screenshots

Los frames estan disponibles en `frames/` pero la IA **no esta obligada a analizarlos**. El `session_compressed.json` ya contiene suficiente informacion textual para entender la tarea en la mayoria de los casos. Los screenshots son un recurso adicional que la IA puede consultar selectivamente cuando necesite confirmar algo visual — por ejemplo, verificar el contenido de una pagina, leer un precio que no fue capturado por el browser, o entender el estado de una app de escritorio. Esto mantiene el costo de procesamiento bajo control.

---

## Reduccion tipica

Una sesion de ~1 minuto genera aproximadamente:

| Etapa | Eventos |
|-------|---------|
| Crudo (`session.json`) | 800-1000 |
| Comprimido (`session_compressed.json`) | 180-250 |
| Reduccion | ~75-80% |

Los eventos mas frecuentes en crudo que se comprimen son: `scroll` (agrupados en `scroll_summary`), `network` (filtrado cross-origin y tracking), `focus`/`blur`/`keydown` (descartados).

---

## Fase actual: Fase 1 — Captura

El proyecto esta en Fase 1: grabacion y estructuracion de sesiones de usuario. El objetivo es producir un `session_compressed.json` y un conjunto de `frames/` que una IA pueda leer y consultar para entender que tarea realizo el usuario y replicarla.
