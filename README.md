# Proyecto Loco

Herramienta de automatizacion de tareas con IA. El sistema graba lo que hace el usuario (pantalla, audio, browser, inputs del sistema), comprime y estructura los eventos, y los entrega a una IA para que pueda entender y replicar la tarea.

---

## Estructura del proyecto

```
/
├── Extension/              # Extension de Chrome que captura eventos del browser
│   ├── manifest.json
│   ├── background.js       # Recibe mensajes del content script y los envia al recorder
│   └── content.js          # Captura clicks, scroll, inputs, dwell time, etc.
│
├── recorder/               # Backend Python que orquesta la grabacion
│   ├── main.py             # Punto de entrada: arranca y detiene la sesion
│   ├── event_manager.py    # Almacena y timestampea todos los eventos
│   ├── input_listener.py   # Captura teclado y mouse del sistema (pynput)
│   ├── browser_server.py   # Servidor Flask que recibe eventos de la extension
│   ├── video_recorder.py   # Graba pantalla + audio con ffmpeg
│   ├── transcribe.py       # Transcribe el audio con Whisper
│   └── compressor.py       # Comprime y filtra la sesion para la IA
│
└── docs/
    └── Esquema de Eventos - Proyecto Loco.docx   # Referencia de todos los tipos de eventos
```

---

## Como usar

### 1. Instalar dependencias

```bash
pip install flask pynput pywin32 psutil openai-whisper
```

Requiere tambien **ffmpeg** en el PATH.

### 2. Cargar la extension en Chrome

1. Ir a `chrome://extensions`
2. Activar "Modo desarrollador"
3. "Cargar sin empaquetar" -> seleccionar la carpeta `Extension/`

### 3. Grabar una sesion

```bash
cd recorder
python main.py
```

Presionar **ENTER** para detener la grabacion. Al finalizar se generan:

```
recorder/data/<session-id>/
├── screen.mp4              # Video de pantalla con audio
├── audio.wav               # Audio extraido
├── session.json            # Todos los eventos en crudo
└── session_compressed.json # Eventos filtrados y comprimidos para la IA
```

---

## Pipeline de eventos

```
Usuario actua
    │
    ├── input_listener.py  →  clicks, teclado, scroll, drag (sistema)
    └── content.js         →  clicks, inputs, dwell time, network (browser)
                │
                ▼
         EventManager  (normaliza timestamps, fuente)
                │
                ▼
         session.json  (eventos en crudo)
                │
                ▼
         compressor.py
           - Filtra network noise (analytics, CDNs, polling)
           - Agrupa rafagas de scroll en scroll_summary
           - Filtra element_read de breadcrumbs y nav generico
           - Descarta reading_pause al tope de la pagina
                │
                ▼
    session_compressed.json  →  IA
```

---

## Tipos de eventos principales

| Fuente  | Tipo             | Descripcion |
|---------|------------------|-------------|
| system  | `typed`          | Texto escrito (buffer de 1.2s) |
| system  | `shortcut`       | Atajos de teclado (Ctrl+C, etc.) |
| system  | `click`          | Click del mouse con ventana activa |
| system  | `double_click`   | Doble click |
| system  | `drag`           | Arrastre con coordenadas y duracion |
| system  | `scroll_summary` | Rafaga de scroll comprimida |
| browser | `page_load`      | Carga de pagina con URL y titulo |
| browser | `click`          | Click con tag, texto, xpath y URL |
| browser | `input`          | Valor de campo de formulario |
| browser | `element_read`   | Elemento visible por mas de 1500ms (dwell time) |
| browser | `reading_pause`  | Snapshot de elementos visibles al pausar el scroll |
| browser | `page_summary`   | Resumen estructurado al salir (h1, precio, botones) |
| browser | `spa_navigation` | Navegacion en apps de una sola pagina |
| browser | `network`        | Requests HTTP (filtrados por el compressor) |
| speech  | `speech`         | Transcripcion del audio del usuario (Whisper) |

Ver el detalle completo de campos en `docs/Esquema de Eventos - Proyecto Loco.docx`.

---

## Fase actual: Fase 1 — Captura

El proyecto esta en Fase 1: grabacion y estructuracion de sesiones de usuario. El objetivo es producir un `session_compressed.json` que una IA pueda leer para entender que tarea realizo el usuario y replicarla.
