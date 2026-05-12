const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, HeadingLevel, BorderStyle, WidthType, ShadingType,
} = require('docx');
const fs = require('fs');

const BORDER = { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" };
const BORDERS = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };
const MARGINS = { top: 80, bottom: 80, left: 120, right: 120 };
const W = 9360; // content width US Letter 1" margins

function h(text, level) {
  return new Paragraph({ heading: level, children: [new TextRun(text)] });
}

function p(text, opts = {}) {
  return new Paragraph({ children: [new TextRun({ text, ...opts })] });
}

function mono(text) {
  return new TextRun({ text, font: "Courier New", size: 18 });
}

function code(lines) {
  return new Paragraph({
    children: [new TextRun({
      text: Array.isArray(lines) ? lines.join("\n") : lines,
      font: "Courier New", size: 17
    })]
  });
}

function note(text) {
  return new Paragraph({
    spacing: { before: 60 },
    children: [new TextRun({
      text, size: 18, color: "555555", font: "Courier New"
    })]
  });
}

function headerRow(cols, widths) {
  return new TableRow({
    tableHeader: true,
    children: cols.map((text, i) => new TableCell({
      borders: BORDERS,
      margins: MARGINS,
      width: { size: widths[i], type: WidthType.DXA },
      shading: { fill: "2E4057", type: ShadingType.CLEAR },
      children: [new Paragraph({
        alignment: AlignmentType.LEFT,
        children: [new TextRun({ text, bold: true, color: "FFFFFF", size: 20 })]
      })]
    }))
  });
}

function row(cols, widths, shade = false) {
  return new TableRow({
    children: cols.map((text, i) => new TableCell({
      borders: BORDERS,
      margins: MARGINS,
      width: { size: widths[i], type: WidthType.DXA },
      shading: { fill: shade ? "F5F5F5" : "FFFFFF", type: ShadingType.CLEAR },
      children: [new Paragraph({ children: [mono(text)] })]
    }))
  });
}

function eventTable(title, color, rows_data, cols = ["Campo", "Tipo", "Descripcion"], widths = [1800, 1400, 6160]) {
  return [
    new Paragraph({
      spacing: { before: 300, after: 100 },
      children: [new TextRun({ text: title, bold: true, size: 24, color })]
    }),
    new Table({
      width: { size: W, type: WidthType.DXA },
      columnWidths: widths,
      rows: [
        headerRow(cols, widths),
        ...rows_data.map((r, i) => row(r, widths, i % 2 === 1))
      ]
    })
  ];
}

// ── Contenido ──────────────────────────────────────────────────────────────────

const sections_content = [

  // Portada
  h("Esquema de Eventos — Proyecto Loco", HeadingLevel.HEADING_1),
  p("Referencia completa de los eventos generados por el recorder y del formato final que recibe la IA.", { size: 22, color: "555555" }),
  p("Fase 1: captura y estructuracion de sesiones de usuario.", { size: 20, color: "777777" }),
  p(""),

  // ── 1. Pipeline ─────────────────────────────────────────────────────────────
  h("1. Pipeline general", HeadingLevel.HEADING_2),
  p("Tres fuentes convergen en session.json. Despues compressor.py filtra y reshape() reorganiza la salida en dos arrays: acciones cronologicas y paginas con contenido."),
  p(""),
  code([
    "  Usuario actua",
    "      |",
    "      +-- input_listener.py  -->  clicks, teclado, scroll, drag         (system)",
    "      +-- content.js         -->  clicks, inputs, dwell, navegacion     (browser)",
    "      +-- video_recorder.py  -->  screen.mp4 + audio.wav                (video)",
    "                |",
    "                v",
    "         background.js  (pre-filtro de network)",
    "           - Solo APIs del mismo dominio raiz que la pagina activa",
    "           - Descarta cross-origin: tracking, ads, analytics, recursos estaticos",
    "           - Descarta RPC interna de Google Workspace (clients<N>.google.com)",
    "                |",
    "                v",
    "         browser_server.py + EventManager",
    "           - Normaliza time relativo, source, type",
    "           - clean_event_data() filtra campos no declarados en schema.py",
    "                |",
    "                +-- transcribe.py      -->  speech    (Whisper, autodetect)",
    "                +-- frame_extractor.py -->  screenshot (page_load / speech / ambient)",
    "                |",
    "                v",
    "         session.json  (eventos en crudo, lista plana ordenada por time)",
    "                |",
    "                v",
    "         compressor.py — PIPELINE declarativa",
    "           drop_noise_types         (focus/blur/keydown/time_on_page)",
    "           drop_redirect_pages      (page_load/summary/screenshot en google.com/url)",
    "           drop_short_page_summary  (duration < 500ms)",
    "           filter_network           (tracking de mismo sitio que paso el filtro)",
    "           filter_element_read      (breadcrumb / paginacion / dedup global)",
    "           filter_hover             (>=800ms, solo tags semanticos con texto)",
    "           filter_reading_pause     (scroll_pct < 5%)",
    "           cap_reading_pause_elements (tope 25 elementos)",
    "           compress_scroll          (rafagas contiguas -> scroll_summary)",
    "                |",
    "                v",
    "         reshape() — separa acciones de contenido",
    "                |",
    "                v",
    "    session_compressed.json  =  { actions: [...], pages: [...] }  -->  IA",
  ]),
  p(""),

  // ── 2. Fuentes ──────────────────────────────────────────────────────────────
  h("2. Fuentes de eventos", HeadingLevel.HEADING_2),
  new Table({
    width: { size: W, type: WidthType.DXA },
    columnWidths: [1600, 2800, 4960],
    rows: [
      headerRow(["source", "Modulo", "Descripcion"], [1600, 2800, 4960]),
      row(["system",  "input_listener.py",              "Teclado y mouse globales (pynput)"],                [1600, 2800, 4960], false),
      row(["browser", "content.js + browser_server.py", "Eventos del DOM y network via extension Chrome"],   [1600, 2800, 4960], true),
      row(["speech",  "transcribe.py (Whisper)",        "Transcripcion del audio del microfono (autodetect)"], [1600, 2800, 4960], false),
      row(["video",   "frame_extractor.py",             "Frames JPEG extraidos del screen.mp4"],             [1600, 2800, 4960], true),
    ]
  }),
  p(""),

  // ── 3. Sistema ──────────────────────────────────────────────────────────────
  h("3. Eventos del sistema", HeadingLevel.HEADING_2),

  ...eventTable("3.1 typed — texto escrito", "1a6b3c", [
    ["text", "string", "Buffer acumulado de 1.2s con backspace aplicado"],
    ["app", "string", "Proceso activo (ej: chrome.exe)"],
    ["window_title", "string", "Titulo de la ventana activa"],
  ]),

  ...eventTable("3.2 key — tecla especial suelta", "1a6b3c", [
    ["key", "string", "Enter / Tab / Escape / Arrow* / F1..F12 / etc."],
    ["app, window_title", "string", "Ventana activa al momento de la pulsacion"],
  ]),

  ...eventTable("3.3 shortcut — atajo con modificadores", "1a6b3c", [
    ["keys", "string", "Combinacion (ej: Ctrl+C, Alt+Tab, Ctrl+Shift+T)"],
    ["app, window_title", "string", "Ventana activa"],
  ]),

  ...eventTable("3.4 click / double_click", "1a6b3c", [
    ["x, y", "int", "Coordenadas en pantalla"],
    ["button", "string", "Button.left / Button.right / Button.middle"],
    ["app, window_title", "string", "Ventana activa"],
  ]),
  note("  click acepta tambien los campos de browser (tag, text, selectors...) cuando viene del DOM."),

  ...eventTable("3.5 drag", "1a6b3c", [
    ["from_x, from_y", "int", "Coordenada de inicio del arrastre"],
    ["to_x, to_y", "int", "Coordenada de fin"],
    ["button", "string", "Boton del mouse"],
    ["duration_ms", "int", "Duracion del drag (descarta < 200ms)"],
    ["app, window_title", "string", "Ventana activa"],
  ]),
  note("  Umbral: 30 px de movimiento Y >=200 ms de duracion. Filtra flicks accidentales."),

  ...eventTable("3.6 scroll_summary (comprimido)", "1a6b3c", [
    ["direction", "string", "down / up / horizontal"],
    ["delta_y, delta_x", "float", "Suma de desplazamiento en el grupo"],
    ["scroll_count", "int", "Cantidad de eventos de scroll agrupados"],
    ["duration_s", "float", "Duracion total del grupo en segundos"],
    ["from_y, to_y, viewport_pct, url", "—", "Solo si la rafaga es de browser"],
    ["app, window_title", "string", "Solo si la rafaga es de sistema"],
  ]),
  note("  compress_scroll agrupa eventos scroll contiguos (gap <= 2s) y descarta sumarios sin movimiento neto."),

  p(""),

  // ── 4. Browser — campos base ────────────────────────────────────────────────
  h("4. Eventos del browser", HeadingLevel.HEADING_2),

  p("Casi todos los eventos del browser incluyen los siguientes campos base (extraidos por elInfo() en content.js):", { bold: true }),
  new Table({
    width: { size: W, type: WidthType.DXA },
    columnWidths: [1800, 1400, 6160],
    rows: [
      headerRow(["Campo", "Tipo", "Descripcion"], [1800, 1400, 6160]),
      row(["tag",        "string",       "Tag HTML (H1, BUTTON, A, INPUT, SPAN...)"],                       [1800, 1400, 6160], false),
      row(["text",       "string",       "innerText del elemento, truncado a 120 chars"],                   [1800, 1400, 6160], true),
      row(["role",       "string",       "Atributo role o tagName en minusculas"],                          [1800, 1400, 6160], false),
      row(["aria",       "string",       "aria-label del elemento"],                                        [1800, 1400, 6160], true),
      row(["href",       "string|null",  "URL del anchor mas cercano"],                                     [1800, 1400, 6160], false),
      row(["url",        "string",       "URL de la pagina al momento del evento"],                         [1800, 1400, 6160], true),
      row(["selectors",  "object",       "{ testid, id, name, css, xpath } ordenados por estabilidad"],     [1800, 1400, 6160], false),
      row(["id_auto",    "string",       "id del elemento si parece auto-generado (j_idt, view_24...)"],    [1800, 1400, 6160], true),
      row(["classes",    "string",       "className del elemento"],                                         [1800, 1400, 6160], false),
      row(["data_attrs", "object",       "Todos los atributos data-* del elemento (si los hay)"],           [1800, 1400, 6160], true),
    ]
  }),
  note([
    "  selectors.testid > selectors.id > selectors.name > selectors.css > selectors.xpath",
    "  La IA debe usar el primero no vacio. xpath es ultimo recurso porque rompe ante cambios de DOM.",
    "  getXPath() y getCssPath() saltan ids inestables (j_idt, view_24, css-xyz, ng-*, mat-*, etc.)",
  ].join("\n")),

  ...eventTable("4.1 page_load", "0066cc", [
    ["url", "string", "URL cargada"],
    ["title", "string", "document.title"],
    ["referrer", "string", "URL de origen"],
    ["context", "object|null", "Datos estructurados de la pagina — ver seccion 5"],
  ]),

  ...eventTable("4.2 spa_navigation", "0066cc", [
    ["url", "string", "Nueva URL tras history.pushState / popstate"],
    ["title", "string", "document.title actualizado"],
    ["context", "object|null", "Datos estructurados de la pagina — ver seccion 5"],
  ]),
  note("  Se dispara 300ms despues del cambio de URL para dar tiempo a que la SPA renderice el nuevo DOM."),

  ...eventTable("4.3 hash_navigation", "0066cc", [
    ["url", "string", "URL con el nuevo fragment (#seccion)"],
    ["title", "string", "document.title"],
  ]),

  ...eventTable("4.4 click", "0066cc", [
    ["x, y", "int", "Coordenadas del click en el viewport"],
    ["button", "string", "left / right / middle"],
    ["...campos base", "", "tag, text, selectors, href, etc."],
  ]),

  ...eventTable("4.5 input", "0066cc", [
    ["value", "string", "Valor actual del campo (debounce 800ms)"],
    ["input_type", "string", "Tipo del input (text, email, search, password...)"],
    ["...campos base", "", "tag, selectors, etc."],
  ]),

  ...eventTable("4.6 hover", "0066cc", [
    ["duration_ms", "int", "Tiempo del cursor sobre el elemento (capture y compressor: >=800ms)"],
    ["x, y", "int", "Coordenadas del cursor al salir del elemento"],
    ["...campos base", "", "tag, text, selectors..."],
  ]),
  note("  El compressor descarta hovers sobre tags no semanticos y los sin texto/aria."),

  ...eventTable("4.7 element_read (dwell time)", "0066cc", [
    ["dwell_ms", "int", "Tiempo visible en viewport (>=1500ms, cap 5000ms)"],
    ["...campos base", "", "tag, text, selectors, etc."],
  ]),
  note([
    "  Se emite cuando el elemento estuvo visible >=1500ms (threshold 50% del bbox).",
    "  Se descartan elementos dentro de nav/header/footer (chrome del sitio, ruido).",
    "  El compressor dedup por (xpath, url) y descarta breadcrumbs/paginacion.",
  ].join("\n")),

  ...eventTable("4.8 reading_pause", "0066cc", [
    ["scroll_pct", "int", "Posicion de scroll en porcentaje (0-100)"],
    ["elements", "array", "Hasta 25 elementos visibles {tag, text, aria}"],
    ["url", "string", "URL de la pagina"],
  ]),
  note([
    "  Snapshot al detenerse el scroll 1500ms. Filtra elementos diminutos (< 800 px2)",
    "  y dedup por (tag, text). isReallyVisible() chequea display/visibility/opacity/bbox.",
    "  El compressor descarta pausas con scroll_pct < 5% (cerca del tope = navegacion).",
  ].join("\n")),

  ...eventTable("4.9 page_summary (al salir de la pagina)", "0066cc", [
    ["url", "string", "URL de la pagina"],
    ["title", "string", "Titulo"],
    ["duration_ms", "int", "Tiempo total en la pagina"],
    ["h1", "string", "Texto del heading principal (whitespace colapsado, max 200)"],
    ["price", "string", "Precio detectado (regex sobre clases CSS de precio)"],
    ["availability", "string", "Disponibilidad / stock detectado"],
    ["buttons", "string[]", "Hasta 6 CTAs reales (no atajos de teclado, fuera de site chrome)"],
    ["sections", "string[]", "Hasta 8 textos de h2/h3 fuera de site chrome"],
  ]),

  ...eventTable("4.10 text_select", "0066cc", [
    ["selected_text", "string", "Texto seleccionado con el mouse (max 300)"],
    ["url", "string", "URL de la pagina"],
  ]),

  ...eventTable("4.11 copy", "0066cc", [
    ["text", "string", "Texto copiado al clipboard (max 300)"],
    ["url", "string", "URL de la pagina"],
  ]),

  ...eventTable("4.12 paste", "0066cc", [
    ["text", "string", "Texto pegado (max 300)"],
    ["...campos base", "", "Campos del elemento destino del pegado"],
  ]),

  ...eventTable("4.13 network (filtrado en dos etapas)", "0066cc", [
    ["url", "string", "URL del request"],
    ["method", "string", "GET / POST / etc."],
    ["status", "int", "Codigo HTTP"],
    ["tab_url", "string", "Origen del request (initiator)"],
  ]),
  note([
    "  Etapa 1 (background.js): solo APIs del mismo dominio raiz que la pagina activa,",
    "    descarta recursos estaticos, tracking y RPC interna de Google Workspace.",
    "  Etapa 2 (compressor.py): segunda pasada de paths de telemetria del propio sitio.",
    "  Etapa 3 (reshape): descarta tambien google.com/url al asignar al array de network de la pagina.",
  ].join("\n")),

  ...eventTable("4.14 api_response (interceptor fetch/XHR)", "0066cc", [
    ["url", "string", "URL de la API"],
    ["body", "string", "Primeros 3000 bytes del JSON de respuesta"],
    ["page_url", "string", "URL de la pagina que disparo el request"],
  ]),
  note([
    "  Solo si la URL matchea patrones de API de producto (/graphql, /pdp, /p/api...)",
    "  y el body contiene name|price|title|stock|product. Intercepta fetch() y XHR.",
    "  Limitacion: no captura requests hechos desde service workers o respuestas SSR.",
  ].join("\n")),

  p(""),

  // ── 5. context ──────────────────────────────────────────────────────────────
  h("5. context — extractPageContext()", HeadingLevel.HEADING_2),
  p("Datos estructurados que ya estan en el HTML de la pagina, leidos al disparar page_load / spa_navigation. No requiere interceptar red."),
  p(""),
  new Table({
    width: { size: W, type: WidthType.DXA },
    columnWidths: [1800, 1400, 6160],
    rows: [
      headerRow(["Clave", "Tipo", "Descripcion"], [1800, 1400, 6160]),
      row(["product",     "object",  "JSON-LD schema.org/Product: name, description, sku, brand, rating, reviewCount, price, currency, availability"], [1800, 1400, 6160], false),
      row(["breadcrumbs", "string[]","JSON-LD BreadcrumbList o fallback al DOM (.breadcrumb a, etc.)"],                                                  [1800, 1400, 6160], true),
      row(["meta",        "object",  "Open Graph: og:description, product:price:amount, product:price:currency"],                                       [1800, 1400, 6160], false),
      row(["headings",    "array",   "Hasta 15 headings {level, text} (h1/h2/h3)"],                                                                     [1800, 1400, 6160], true),
    ]
  }),
  note("  context puede ser null si la pagina no tiene ninguno de estos datos."),

  p(""),

  // ── 6. screenshot ───────────────────────────────────────────────────────────
  h("6. Eventos de video (screenshot)", HeadingLevel.HEADING_2),
  p("frame_extractor.py extrae JPEGs del video en tres momentos clave y los agrega como eventos screenshot."),
  p(""),
  code([
    "  page_load  ->  frame al instante en que cargo cada pagina",
    "  speech     ->  frame al inicio de cada frase del usuario",
    "  ambient    ->  frame cada N segundos (default: 10s)",
  ]),
  p(""),
  ...eventTable("screenshot", "5C4033", [
    ["frame",   "string", "Ruta relativa al JPEG (ej: frames/frame_13.5.jpg)"],
    ["trigger", "string", "page_load | speech | ambient"],
    ["url",     "string", "URL de la pagina (solo en page_load)"],
    ["text",    "string", "Frase del usuario (solo en speech)"],
  ]),
  note([
    "  Los frames estan disponibles en session/frames/ pero la IA no esta obligada",
    "  a analizarlos. El session_compressed.json ya tiene suficiente informacion textual",
    "  para la mayoria de los casos. Los screenshots son un recurso adicional para",
    "  consultas selectivas (verificar contenido visual, leer un precio que el browser",
    "  no capturo, entender el estado de una app de escritorio).",
  ].join("\n")),

  p(""),

  // ── 7. speech ───────────────────────────────────────────────────────────────
  h("7. Evento de audio (speech)", HeadingLevel.HEADING_2),
  ...eventTable("speech — transcripcion Whisper", "8B0000", [
    ["text", "string", "Texto transcripto del segmento"],
    ["end",  "float",  "Segundo de fin del segmento (start = event.time)"],
  ]),
  note("  Modelo: Whisper small con autodeteccion de idioma (language=None)."),

  p(""),

  // ── 8. Estructura del session_compressed.json ───────────────────────────────
  h("8. Estructura del session_compressed.json", HeadingLevel.HEADING_2),
  p("Despues de compress() + reshape(), la salida es un objeto con dos arrays:"),
  p(""),
  code([
    "{",
    '  "actions": [ ... ],  // cronologico, lo que el usuario hizo',
    '  "pages":   [ ... ]   // una entrada por URL visitada con contexto',
    "}",
  ]),
  p(""),

  p("8.1 actions", { bold: true }),
  p("Lista cronologica de acciones del usuario. Cada item conserva el shape original del evento (time, source, type, data). Tipos incluidos:"),
  code([
    "  click, double_click, drag, typed, shortcut, key,",
    "  input, hover, text_select, copy, paste,",
    "  scroll_summary, speech, screenshot,",
    "  page_load, spa_navigation, hash_navigation, api_response",
  ]),
  note("  page_load y spa_navigation actuan como anclas temporales: marcan el cambio entre paginas."),

  p(""),
  p("8.2 pages", { bold: true }),
  p("Una entrada por URL visitada. Acumula todo lo que es \"contenido de pagina\" en lugar de \"accion del usuario\":"),
  new Table({
    width: { size: W, type: WidthType.DXA },
    columnWidths: [2200, 1400, 5760],
    rows: [
      headerRow(["Campo", "Tipo", "Descripcion"], [2200, 1400, 5760]),
      row(["url, title",       "string",  "URL y titulo de la pagina"],                                       [2200, 1400, 5760], false),
      row(["time_enter, time_exit", "float", "Segundos de entrada y salida"],                                 [2200, 1400, 5760], true),
      row(["duration_ms",      "int",     "Tiempo total (viene de page_summary)"],                            [2200, 1400, 5760], false),
      row(["context",          "object",  "Datos estructurados (product, breadcrumbs, meta, headings)"],      [2200, 1400, 5760], true),
      row(["h1, price, availability", "string", "Resumen del DOM al salir (page_summary)"],                   [2200, 1400, 5760], false),
      row(["buttons, sections","string[]","CTAs y headings detectados al salir"],                             [2200, 1400, 5760], true),
      row(["elements_read",    "array",   "{tag, text, aria?, href?, dwell_ms?} dedup por xpath en la pagina"], [2200, 1400, 5760], false),
      row(["reading_pauses",   "array",   "{time, scroll_pct, elements:[{tag, text}]}"],                      [2200, 1400, 5760], true),
      row(["network",          "array",   "{time, method, url, status} de APIs reales del sitio"],            [2200, 1400, 5760], false),
    ]
  }),
  note([
    "  Los arrays vacios se eliminan en el output final.",
    "  network excluye URLs de google.com/url (redirects) al asignarse a la pagina.",
  ].join("\n")),

  p(""),
  p("8.3 Ejemplo de salida", { bold: true }),
  code([
    "{",
    '  "actions": [',
    '    { "time": 0.8, "source": "browser", "type": "page_load",',
    '      "data": { "url": "https://www.mercadolibre.com.mx/...", "title": "Camara TP-Link",',
    '                "referrer": "https://www.google.com/" } },',
    '    { "time": 3.1, "source": "speech",  "type": "speech",',
    '      "data": { "text": "Estoy buscando una camara de seguridad", "end": 5.2 } },',
    '    { "time": 7.4, "source": "browser", "type": "click",',
    '      "data": { "tag": "BUTTON", "text": "Comprar ahora",',
    '                "selectors": { "testid": "buy-now", "css": "button.buy-now",',
    '                               "xpath": "//*[@id=\\"buy-now\\"]" } } }',
    '  ],',
    '  "pages": [',
    '    { "url": "https://www.mercadolibre.com.mx/...",',
    '      "title": "Camara TP-Link Tapo",',
    '      "time_enter": 0.8, "time_exit": 42.1, "duration_ms": 41300,',
    '      "context": {',
    '        "product": { "name": "Camara TP-Link Tapo C200", "price": "899",',
    '                     "currency": "MXN", "availability": "InStock" },',
    '        "breadcrumbs": ["Electronica", "Camaras de Seguridad"]',
    '      },',
    '      "h1": "Camara TP-Link Tapo C200",',
    '      "price": "$ 899",',
    '      "buttons": ["Comprar ahora", "Agregar al carrito"],',
    '      "elements_read": [',
    '        { "tag": "H1", "text": "Camara TP-Link Tapo C200", "dwell_ms": 5162 }',
    '      ]',
    '    }',
    '  ]',
    "}",
  ]),

  p(""),

  // ── 9. Resumen de valor para la IA ──────────────────────────────────────────
  h("9. Resumen — valor de cada evento para la IA", HeadingLevel.HEADING_2),
  new Table({
    width: { size: W, type: WidthType.DXA },
    columnWidths: [2400, 1600, 1600, 3760],
    rows: [
      headerRow(["Tipo", "source", "Frecuencia", "Valor para la IA"], [2400, 1600, 1600, 3760]),
      row(["speech",          "speech",  "Baja",     "Muy alto — explicita la intencion del usuario"],         [2400, 1600, 1600, 3760], false),
      row(["page_load + context", "browser", "Baja", "Muy alto — datos estructurados de la pagina"],           [2400, 1600, 1600, 3760], true),
      row(["page_summary",    "browser", "1/pagina", "Muy alto — h1, precio, CTAs, secciones"],                [2400, 1600, 1600, 3760], false),
      row(["typed",           "system",  "Media",    "Alto — captura el texto que el usuario escribio"],       [2400, 1600, 1600, 3760], true),
      row(["click",           "browser", "Media",    "Alto — selectors estables para Playwright"],             [2400, 1600, 1600, 3760], false),
      row(["element_read",    "browser", "Media",    "Alto — que leyo el usuario (dwell time)"],               [2400, 1600, 1600, 3760], true),
      row(["input",           "browser", "Baja",     "Alto — valor final de campos de formulario"],            [2400, 1600, 1600, 3760], false),
      row(["reading_pause",   "browser", "Baja",     "Medio — contexto visual al pausar el scroll"],           [2400, 1600, 1600, 3760], true),
      row(["shortcut",        "system",  "Baja",     "Medio — acciones rapidas (Ctrl+C, Alt+Tab...)"],         [2400, 1600, 1600, 3760], false),
      row(["scroll_summary",  "ambos",   "Media",    "Bajo — confirma navegacion vertical"],                   [2400, 1600, 1600, 3760], true),
      row(["hover",           "browser", "Baja",     "Bajo — solo si la IA necesita confirmar intencion"],     [2400, 1600, 1600, 3760], false),
      row(["network",         "browser", "Alta",     "Bajo — util solo si se necesita inspeccionar APIs"],     [2400, 1600, 1600, 3760], true),
      row(["api_response",    "browser", "Variable", "Variable — datos crudos de APIs interceptadas"],         [2400, 1600, 1600, 3760], false),
      row(["text_select / copy / paste", "browser", "Baja", "Medio — que leyo o transcribio el usuario"],       [2400, 1600, 1600, 3760], true),
      row(["screenshot",      "video",   "Media",    "Opcional — recurso visual on-demand para la IA"],        [2400, 1600, 1600, 3760], false),
    ]
  }),
];

const doc = new Document({
  styles: {
    default: { document: { run: { font: "Calibri", size: 22 } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 36, bold: true, font: "Calibri", color: "1a1a2e" },
        paragraph: { spacing: { before: 200, after: 200 }, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 26, bold: true, font: "Calibri", color: "2E4057" },
        paragraph: { spacing: { before: 300, after: 100 }, outlineLevel: 1 } },
    ]
  },
  sections: [{
    properties: {
      page: {
        size: { width: 12240, height: 15840 },
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }
      }
    },
    children: sections_content
  }]
});

Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync("docs/Esquema de Eventos - Proyecto Loco.docx", buf);
  console.log("[OK] docs/Esquema de Eventos - Proyecto Loco.docx generado");
});
