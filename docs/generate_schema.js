const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, HeadingLevel, BorderStyle, WidthType, ShadingType,
  VerticalAlign, LevelFormat, Header, PageNumber
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

function hr() {
  return new Paragraph({
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: "CCCCCC", space: 1 } },
    children: []
  });
}

function mono(text) {
  return new TextRun({ text, font: "Courier New", size: 18 });
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

function eventTable(title, color, rows_data, cols, widths) {
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
  p("Referencia completa de todos los tipos de eventos generados por el recorder.", { size: 22, color: "555555" }),
  p("Fase 1: Captura de sesiones de usuario para automatizacion con IA.", { size: 20, color: "777777" }),
  p(""),

  // Pipeline
  h("1. Pipeline general", HeadingLevel.HEADING_2),
  p("El sistema combina tres fuentes de captura que convergen en un archivo JSON comprimido:"),
  p(""),
  new Paragraph({
    children: [new TextRun({
      text: [
        "  Usuario actua",
        "      |",
        "      +-- input_listener.py  -->  clicks, teclado, scroll, drag  (sistema)",
        "      +-- content.js         -->  browser events, dwell time, network",
        "      +-- video_recorder.py  -->  screen.mp4 + audio.wav",
        "                |",
        "                v",
        "         EventManager  (normaliza timestamps y fuente)",
        "                |",
        "                v",
        "         session.json  (eventos en crudo)",
        "                |",
        "                v",
        "         compressor.py",
        "           - Filtra network noise (analytics, CDNs, polling)",
        "           - Agrupa rafagas de scroll  -->  scroll_summary",
        "           - Filtra element_read de breadcrumbs",
        "           - Descarta reading_pause con scroll_pct < 5%",
        "                |",
        "                v",
        "    session_compressed.json  -->  IA",
      ].join("\n"),
      font: "Courier New", size: 17
    })]
  }),
  p(""),

  // Fuentes
  h("2. Fuentes de eventos", HeadingLevel.HEADING_2),
  new Table({
    width: { size: W, type: WidthType.DXA },
    columnWidths: [2000, 2500, 4860],
    rows: [
      headerRow(["Fuente", "Modulo", "Descripcion"], [2000, 2500, 4860]),
      row(["system", "input_listener.py", "Teclado y mouse globales via pynput"], [2000, 2500, 4860], false),
      row(["browser", "content.js + browser_server.py", "Eventos del DOM via extension Chrome"], [2000, 2500, 4860], true),
      row(["speech", "transcribe.py (Whisper small)", "Transcripcion del audio del microfono"], [2000, 2500, 4860], false),
    ]
  }),
  p(""),

  // Eventos sistema
  h("3. Eventos del sistema", HeadingLevel.HEADING_2),

  ...eventTable("3.1 typed — texto escrito", "1a6b3c",
    [
      ["text", "string", "Texto acumulado (buffer 1.2s, backspace aplicado)"],
      ["app", "string", "Nombre del proceso activo  (ej: chrome.exe)"],
      ["window_title", "string", "Titulo de la ventana activa"],
    ],
    ["Campo", "Tipo", "Descripcion"], [1800, 1400, 6160]
  ),

  ...eventTable("3.2 shortcut — atajo de teclado", "1a6b3c",
    [
      ["keys", "string", "Combinacion  (ej: Ctrl+C, Alt+Tab, Ctrl+Shift+T)"],
      ["app", "string", "Proceso activo"],
      ["window_title", "string", "Titulo de ventana"],
    ],
    ["Campo", "Tipo", "Descripcion"], [1800, 1400, 6160]
  ),

  ...eventTable("3.3 click / double_click", "1a6b3c",
    [
      ["x, y", "int", "Coordenadas en pantalla"],
      ["button", "string", "Button.left / Button.right"],
      ["app", "string", "Proceso activo"],
      ["window_title", "string", "Titulo de ventana"],
    ],
    ["Campo", "Tipo", "Descripcion"], [1800, 1400, 6160]
  ),

  ...eventTable("3.4 drag", "1a6b3c",
    [
      ["from_x, from_y", "int", "Coordenada de inicio del arrastre"],
      ["to_x, to_y", "int", "Coordenada de fin"],
      ["button", "string", "Boton del mouse"],
      ["duration_ms", "int", "Duracion del drag en milisegundos"],
      ["app", "string", "Proceso activo"],
      ["window_title", "string", "Titulo de ventana"],
    ],
    ["Campo", "Tipo", "Descripcion"], [1800, 1400, 6160]
  ),

  ...eventTable("3.5 scroll_summary (comprimido)", "1a6b3c",
    [
      ["direction", "string", "up / down / horizontal"],
      ["delta_y", "float", "Suma de desplazamiento vertical"],
      ["delta_x", "float", "Suma de desplazamiento horizontal"],
      ["scroll_count", "int", "Cantidad de eventos de scroll agrupados"],
      ["duration_s", "float", "Duracion total del grupo en segundos"],
      ["app", "string", "Proceso activo"],
      ["window_title", "string", "Titulo de ventana"],
    ],
    ["Campo", "Tipo", "Descripcion"], [1800, 1400, 6160]
  ),

  p(""),

  // Eventos browser
  h("4. Eventos del browser", HeadingLevel.HEADING_2),

  p("Todos los eventos del browser incluyen los campos base:", { bold: true }),
  new Table({
    width: { size: W, type: WidthType.DXA },
    columnWidths: [1800, 1400, 6160],
    rows: [
      headerRow(["Campo", "Tipo", "Descripcion"], [1800, 1400, 6160]),
      row(["tag", "string", "Tag HTML del elemento (H1, BUTTON, A, SPAN...)"], [1800, 1400, 6160], false),
      row(["text", "string", "innerText del elemento (max 120 chars)"], [1800, 1400, 6160], true),
      row(["id", "string", "Atributo id del elemento"], [1800, 1400, 6160], false),
      row(["xpath", "string", "XPath unico del elemento en el DOM"], [1800, 1400, 6160], true),
      row(["role", "string", "Atributo role o tagName en minusculas"], [1800, 1400, 6160], false),
      row(["aria", "string", "aria-label del elemento"], [1800, 1400, 6160], true),
      row(["href", "string|null", "URL del anchor mas cercano"], [1800, 1400, 6160], false),
      row(["url", "string", "URL de la pagina actual"], [1800, 1400, 6160], true),
    ]
  }),

  ...eventTable("4.1 page_load", "0066cc",
    [
      ["url", "string", "URL de la pagina cargada"],
      ["title", "string", "document.title"],
      ["referrer", "string", "URL de origen"],
      ["description", "string", "Meta description de la pagina"],
    ],
    ["Campo", "Tipo", "Descripcion"], [1800, 1400, 6160]
  ),

  ...eventTable("4.2 spa_navigation / hash_navigation", "0066cc",
    [
      ["url", "string", "Nueva URL tras la navegacion SPA"],
      ["title", "string", "document.title actualizado"],
    ],
    ["Campo", "Tipo", "Descripcion"], [1800, 1400, 6160]
  ),

  ...eventTable("4.3 click", "0066cc",
    [
      ["x, y", "int", "Coordenadas del click en el viewport"],
      ["...campos base", "", "tag, text, id, xpath, role, aria, href, url"],
    ],
    ["Campo", "Tipo", "Descripcion"], [1800, 1400, 6160]
  ),

  ...eventTable("4.4 input", "0066cc",
    [
      ["value", "string", "Valor actual del campo (debounce 800ms)"],
      ["input_type", "string", "Tipo del input (text, email, search...)"],
      ["...campos base", "", "tag, text, id, xpath, url"],
    ],
    ["Campo", "Tipo", "Descripcion"], [1800, 1400, 6160]
  ),

  ...eventTable("4.5 element_read  (reemplaza element_visible)", "0066cc",
    [
      ["dwell_ms", "int", "Tiempo que el elemento estuvo visible (minimo 1500ms)"],
      ["...campos base", "", "tag, text, id, xpath, role, aria, href, url"],
    ],
    ["Campo", "Tipo", "Descripcion"], [1800, 1400, 6160]
  ),
  new Paragraph({
    spacing: { before: 60 },
    children: [new TextRun({
      text: "  Solo se emite cuando el usuario tuvo el elemento visible al menos 1500ms (dwell time).\n  Filtrado adicional en compressor: se descartan links de breadcrumb (solo minusculas, sin precio).",
      size: 18, color: "555555", font: "Courier New"
    })]
  }),

  ...eventTable("4.6 reading_pause", "0066cc",
    [
      ["scroll_pct", "int", "Posicion de scroll en porcentaje (0-100)"],
      ["elements", "array", "Lista de elementos visibles en pantalla al pausar el scroll"],
      ["elements[].tag", "string", "Tag del elemento"],
      ["elements[].text", "string", "Texto visible (max 120 chars)"],
      ["elements[].aria", "string", "aria-label"],
      ["url", "string", "URL de la pagina"],
    ],
    ["Campo", "Tipo", "Descripcion"], [1800, 1400, 6160]
  ),
  new Paragraph({
    spacing: { before: 60 },
    children: [new TextRun({
      text: "  Se emite cuando el scroll se detiene 1500ms. Filtrado en compressor: se descarta si scroll_pct < 5%.",
      size: 18, color: "555555", font: "Courier New"
    })]
  }),

  ...eventTable("4.7 page_summary  (al salir de la pagina)", "0066cc",
    [
      ["url", "string", "URL de la pagina"],
      ["title", "string", "Titulo de la pagina"],
      ["duration_ms", "int", "Tiempo total en la pagina en ms"],
      ["h1", "string", "Texto del heading principal (max 200 chars)"],
      ["price", "string", "Precio detectado por clase CSS (max 50 chars)"],
      ["buttons", "string[]", "Textos de los primeros 6 botones visibles"],
      ["sections", "string[]", "Textos de los primeros 8 headings h2/h3"],
    ],
    ["Campo", "Tipo", "Descripcion"], [1800, 1400, 6160]
  ),

  ...eventTable("4.8 hover", "0066cc",
    [
      ["duration_ms", "int", "Tiempo que el cursor estuvo sobre el elemento (minimo 600ms)"],
      ["x, y", "int", "Coordenadas del cursor al salir del elemento"],
      ["...campos base", "", "tag, text, id, xpath, role, aria, href, url"],
    ],
    ["Campo", "Tipo", "Descripcion"], [1800, 1400, 6160]
  ),

  ...eventTable("4.9 text_select / copy / paste", "0066cc",
    [
      ["selected_text / text", "string", "Texto seleccionado o en clipboard (max 300 chars)"],
      ["url", "string", "URL de la pagina (text_select y copy)"],
      ["...campos base", "", "Campos del elemento destino (solo paste)"],
    ],
    ["Campo", "Tipo", "Descripcion"], [1800, 1400, 6160]
  ),

  ...eventTable("4.10 keydown", "0066cc",
    [
      ["key", "string", "Tecla especial (Enter, Escape, Tab, ArrowUp, ArrowDown)"],
      ["ctrl, shift", "bool", "Modificadores activos"],
      ["focused", "object", "Elemento con foco (campos base)"],
    ],
    ["Campo", "Tipo", "Descripcion"], [1800, 1400, 6160]
  ),

  ...eventTable("4.11 network  (filtrado por compressor)", "0066cc",
    [
      ["url", "string", "URL del request"],
      ["method", "string", "GET / POST / etc."],
      ["status", "int", "Codigo HTTP de respuesta"],
      ["type", "string", "Tipo de recurso (xhr, fetch, document...)"],
    ],
    ["Campo", "Tipo", "Descripcion"], [1800, 1400, 6160]
  ),
  new Paragraph({
    spacing: { before: 60 },
    children: [new TextRun({
      text: "  El compressor descarta: analytics, CDNs de imagenes, polling, heartbeats,\n  y archivos estaticos (.woff2, .css, .webp, .png, etc.).",
      size: 18, color: "555555", font: "Courier New"
    })]
  }),

  p(""),

  // Speech
  h("5. Evento de audio (speech)", HeadingLevel.HEADING_2),
  ...eventTable("speech — transcripcion de Whisper", "8B0000",
    [
      ["text", "string", "Texto transcripto del segmento de audio"],
      ["start", "float", "Segundo de inicio del segmento en el audio"],
      ["end", "float", "Segundo de fin del segmento"],
    ],
    ["Campo", "Tipo", "Descripcion"], [1800, 1400, 6160]
  ),
  new Paragraph({
    spacing: { before: 60 },
    children: [new TextRun({
      text: "  Modelo: Whisper small. El tiempo del evento se alinea con el inicio de la grabacion.",
      size: 18, color: "555555", font: "Courier New"
    })]
  }),

  p(""),

  // Estructura del JSON
  h("6. Estructura de un evento en session_compressed.json", HeadingLevel.HEADING_2),
  new Paragraph({
    children: [new TextRun({
      text: [
        '{',
        '  "time":   27.4,          // segundos desde inicio de sesion',
        '  "source": "browser",     // "system" | "browser" | "speech"',
        '  "type":   "element_read",',
        '  "data": {',
        '    "tag":      "H1",',
        '    "text":     "Camara de Seguridad TP-Link Tapo Smart",',
        '    "xpath":    "//*[@id=\'item-title\']",',
        '    "url":      "https://www.mercadolibre.com.mx/...",',
        '    "dwell_ms": 5162',
        '  }',
        '}',
      ].join("\n"),
      font: "Courier New", size: 17
    })]
  }),

  p(""),

  // Tabla resumen
  h("7. Resumen de tipos por frecuencia tipica", HeadingLevel.HEADING_2),
  new Table({
    width: { size: W, type: WidthType.DXA },
    columnWidths: [2400, 2000, 2000, 2960],
    rows: [
      headerRow(["Tipo", "Fuente", "Frecuencia", "Valor para la IA"], [2400, 2000, 2000, 2960]),
      row(["speech",          "speech",  "Baja",     "Muy alto — explica la intencion"],        [2400, 2000, 2000, 2960], false),
      row(["page_summary",    "browser", "1/pagina", "Muy alto — resumen estructurado"],        [2400, 2000, 2000, 2960], true),
      row(["page_load",       "browser", "Baja",     "Alto — trackea navegacion"],              [2400, 2000, 2000, 2960], false),
      row(["typed",           "system",  "Media",    "Alto — captura input del usuario"],       [2400, 2000, 2000, 2960], true),
      row(["element_read",    "browser", "Media",    "Alto — que leyo el usuario"],             [2400, 2000, 2000, 2960], false),
      row(["click",           "browser", "Media",    "Medio — que selecciono"],                 [2400, 2000, 2000, 2960], true),
      row(["reading_pause",   "browser", "Baja",     "Medio — contexto de pantalla"],           [2400, 2000, 2000, 2960], false),
      row(["shortcut",        "system",  "Baja",     "Medio — acciones rapidas"],               [2400, 2000, 2000, 2960], true),
      row(["text_select",     "browser", "Baja",     "Medio — que leyo con atencion"],          [2400, 2000, 2000, 2960], false),
      row(["scroll_summary",  "system",  "Media",    "Bajo — confirma navegacion vertical"],    [2400, 2000, 2000, 2960], true),
      row(["hover",           "browser", "Alta",     "Bajo — puede ser ruido"],                 [2400, 2000, 2000, 2960], false),
      row(["network",         "browser", "Muy alta", "Bajo — util solo para APIs clave"],       [2400, 2000, 2000, 2960], true),
      row(["drag",            "system",  "Baja",     "Contextual — segun la app"],              [2400, 2000, 2000, 2960], false),
    ]
  }),
];

const doc = new Document({
  styles: {
    default: {
      document: { run: { font: "Calibri", size: 22 } }
    },
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
