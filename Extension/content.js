// ── Helpers ───────────────────────────────────────────────────────────────────

// id "auto-generado" típico: view_24, j_idt123, _r0, etc. Inestables entre renders.
const _AUTO_ID_RE = /^(view_|j_idt|_r|jsx-|css-|ember|mat-|ng-|react-|ext-)|\d{3,}$|^[a-z]+[-_]?\d+$/i;
const _NOISE_CLASS_RE = /^([a-z]\d|_|css-|jsx-|emotion-|ng-|sc-)/i;  // clases generadas

function _isStableId(id) {
  return !!id && !_AUTO_ID_RE.test(id) && id.length < 60;
}

function getXPath(el) {
  if (_isStableId(el.id)) return `//*[@id="${el.id}"]`;
  if (el === document.body) return '/html/body';
  if (!el.parentNode) return '';
  let ix = 0;
  const siblings = el.parentNode.childNodes;
  for (let i = 0; i < siblings.length; i++) {
    const s = siblings[i];
    if (s === el)
      return getXPath(el.parentNode) + '/' + el.tagName + '[' + (ix + 1) + ']';
    if (s.nodeType === 1 && s.tagName === el.tagName) ix++;
  }
  return '';
}

// CSS selector estable. Prefiere id estable; si no, encadena tag + clases estables hasta 4 niveles.
function getCssPath(el) {
  if (_isStableId(el.id)) return `#${CSS.escape(el.id)}`;
  const parts = [];
  let cur = el;
  for (let depth = 0; cur && cur.nodeType === 1 && depth < 4; depth++) {
    if (_isStableId(cur.id)) {
      parts.unshift(`#${CSS.escape(cur.id)}`);
      break;
    }
    let s = cur.tagName.toLowerCase();
    const cls = (typeof cur.className === 'string' ? cur.className : '').trim();
    if (cls) {
      const stable = cls.split(/\s+/)
        .filter(c => c.length > 2 && c.length < 40 && !_NOISE_CLASS_RE.test(c))
        .slice(0, 2);
      if (stable.length) s += '.' + stable.map(CSS.escape).join('.');
    }
    parts.unshift(s);
    cur = cur.parentElement;
  }
  return parts.join(' > ');
}

// ── Redacción de campos sensibles ─────────────────────────────────────────────
//
// Heurísticas para detectar inputs que pueden contener secretos (passwords,
// tarjetas, CVV, tokens, identificadores fiscales). Los valores se reemplazan
// con "[REDACTED]" antes de enviarse al recorder. Conservamos `value_length`
// para que la IA pueda saber qué se escribió (cuántos chars) sin ver el valor.
//
// Conocida limitacion: los eventos `typed` del sistema (pynput) no pasan por
// aqui, asi que tipear una contrasena puede quedar reflejado en system events.
// Solucion futura: que content.js avise al recorder via Flask para que el
// system listener pause el buffer durante el foco en campos sensibles.

const _SENSITIVE_TYPE_RE         = /^password$/i;
const _SENSITIVE_AUTOCOMPLETE_RE = /^(current-password|new-password|one-time-code|cc-number|cc-csc|cc-exp(-month|-year)?)$/i;
// Coincidencia en name/id/aria-label/placeholder; tokens separados por _, -, espacios o limites.
const _SENSITIVE_NAME_RE         = /(^|[_\-\s])(password|passwd|pwd|secret|token|api[_-]?key|cvv|cvc|csc|card[_-]?(number|num)|ccnum|expir|ssn|sin|dni|cuit|tax[_-]?id|pin)($|[_\-\s])/i;

function _isSensitiveField(el) {
  if (!el || !el.tagName) return false;
  if (_SENSITIVE_TYPE_RE.test(el.type || '')) return true;
  if (_SENSITIVE_AUTOCOMPLETE_RE.test(el.getAttribute('autocomplete') || '')) return true;
  const hint = ` ${el.name || ''} ${el.id || ''} ${el.getAttribute('aria-label') || ''} ${el.getAttribute('placeholder') || ''} `;
  return _SENSITIVE_NAME_RE.test(hint);
}

function _redactedValue(raw) {
  return { value: '[REDACTED]', value_length: (raw || '').length, redacted: true };
}

// ── Form context ──────────────────────────────────────────────────────────────
//
// Detecta el <form> ancestro (o [role="form"]) para que la IA pueda agrupar
// inputs por formulario y entender que pertenece al mismo submit.

function _formInfo(el) {
  const form = el.closest('form, [role="form"]');
  if (!form) return null;
  const info  = {};
  const id    = _isStableId(form.id) ? form.id : '';
  const name  = form.getAttribute('name') || '';
  const action = form.getAttribute('action') || '';
  if (id)     info.form_id     = id;
  if (name)   info.form_name   = name;
  if (action) info.form_action = action;
  return Object.keys(info).length ? info : null;
}

// ── Label asociado al elemento ────────────────────────────────────────────────
//
// Orden de búsqueda: aria-labelledby > <label for> > <label> envolvente.
// 80 chars de tope para no inflar el evento si el label tiene texto largo.

function _findLabel(el) {
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const ref = document.getElementById(labelledBy);
    if (ref?.innerText) return ref.innerText.trim().slice(0, 80);
  }
  if (_isStableId(el.id)) {
    try {
      const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (lbl?.innerText) return lbl.innerText.trim().slice(0, 80);
    } catch (_) { /* selector mal formado */ }
  }
  const wrappingLabel = el.closest('label');
  if (wrappingLabel?.innerText) return wrappingLabel.innerText.trim().slice(0, 80);
  return '';
}

function elInfo(el) {
  if (!el || !el.tagName) return {};

  // Atributos data-* y testid (los más estables para Playwright)
  const dataAttrs = {};
  let testid = '';
  for (const attr of el.attributes || []) {
    if (!attr.name.startsWith('data-')) continue;
    dataAttrs[attr.name] = attr.value;
    if (/^data-(testid|test-id|cy|qa)$/i.test(attr.name)) testid = attr.value;
  }

  const info = {
    tag:     el.tagName,
    text:    (el.innerText || '').slice(0, 120),
    role:    el.getAttribute('role') || el.tagName.toLowerCase(),
    aria:    el.getAttribute('aria-label') || '',
    href:    el.closest('a')?.href || null,
    url:     window.location.href,
    // Selectores ordenados de más a menos estable (Playwright los usa así)
    selectors: {
      testid,
      id:     _isStableId(el.id) ? el.id : '',
      name:   el.getAttribute('name') || '',
      css:    getCssPath(el),
      xpath:  getXPath(el),
    },
    // Conservar id "auto" por si la IA quiere usarlo igual
    id_auto:    el.id && !_isStableId(el.id) ? el.id : '',
    classes:    typeof el.className === 'string' ? el.className : '',
    data_attrs: Object.keys(dataAttrs).length ? dataAttrs : undefined,
  };

  // Form context: cualquier elemento dentro de un <form> hereda esta info.
  const formCtx = _formInfo(el);
  if (formCtx) Object.assign(info, formCtx);

  // Label y placeholder: solo relevantes para inputs / textarea / select.
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) {
    const label = _findLabel(el);
    const placeholder = el.getAttribute('placeholder') || '';
    if (label)       info.label       = label;
    if (placeholder) info.placeholder = placeholder;
  }

  return info;
}

function send(type, data) {
  chrome.runtime.sendMessage({ type, ...data, time: Date.now() });
}

// ── Interceptor de APIs de producto ──────────────────────────────────────────
//
// Captura respuestas JSON de APIs de producto (GraphQL, REST) para dar a la IA
// datos estructurados (nombre, precio, stock) sin depender del DOM.
// Solo captura las primeras 3KB para mantener el tamaño bajo control.
// La IA puede decidir si analizar o ignorar estos datos según la tarea.

const _PRODUCT_API_RE = /\/(graphql|orchestra\/api|orchestra\/pdp|p\/api|pdp\/graphql|rest\/search|product|item|deferred)[/?]/i;
const _PRODUCT_DATA_RE = /name|price|title|stock|product|precio|nombre/i;
const _API_MAX_BYTES  = 3000;

// ── Interceptor fetch ─────────────────────────────────────────────────────────
const _originalFetch = window.fetch.bind(window);
window.fetch = async function (...args) {
  const response = await _originalFetch(...args);
  try {
    const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
    if (_PRODUCT_API_RE.test(url)) {
      const clone = response.clone();
      const text  = await clone.text();
      if (text && _PRODUCT_DATA_RE.test(text.slice(0, 500))) {
        send('api_response', {
          url,
          body: text.slice(0, _API_MAX_BYTES),
          page_url: window.location.href,
        });
      }
    }
  } catch (_) {}
  return response;
};

// ── Interceptor XHR ───────────────────────────────────────────────────────────
// MercadoLibre y otros sitios pueden usar XMLHttpRequest en lugar de fetch
const _origXHROpen = XMLHttpRequest.prototype.open;
const _origXHRSend = XMLHttpRequest.prototype.send;

XMLHttpRequest.prototype.open = function(method, url, ...rest) {
  this._xhrUrl = url;
  return _origXHROpen.call(this, method, url, ...rest);
};

XMLHttpRequest.prototype.send = function(...args) {
  if (this._xhrUrl && _PRODUCT_API_RE.test(this._xhrUrl)) {
    this.addEventListener('load', function() {
      try {
        const text = this.responseText || '';
        if (text && _PRODUCT_DATA_RE.test(text.slice(0, 500))) {
          send('api_response', {
            url:      this._xhrUrl,
            body:     text.slice(0, _API_MAX_BYTES),
            page_url: window.location.href,
          });
        }
      } catch (_) {}
    });
  }
  return _origXHRSend.apply(this, args);
};

// ── Click ─────────────────────────────────────────────────────────────────────

document.addEventListener('click', (e) => {
  const el     = e.target;
  const anchor = el.closest('a');
  const data   = { ...elInfo(el), x: e.clientX, y: e.clientY };

  if (anchor?.href && !anchor.target) {
    e.preventDefault();
    send('click', data);
    setTimeout(() => { window.location.href = anchor.href; }, 80);
  } else {
    send('click', data);
  }
});

// ── Input ─────────────────────────────────────────────────────────────────────

let inputTimer = null;
document.addEventListener('input', (e) => {
  const el = e.target;
  if (!['INPUT', 'TEXTAREA'].includes(el.tagName)) return;
  clearTimeout(inputTimer);
  inputTimer = setTimeout(() => {
    const payload = { ...elInfo(el), input_type: el.type || '' };
    if (_isSensitiveField(el)) {
      Object.assign(payload, _redactedValue(el.value));
    } else {
      payload.value = el.value;
    }
    send('input', payload);
  }, 800);
});

// ── Scroll ────────────────────────────────────────────────────────────────────

let scrollFrom  = window.scrollY;
let scrollTimer = null;
let scrollT0    = null;

window.addEventListener('scroll', () => {
  if (scrollT0 === null) { scrollFrom = window.scrollY; scrollT0 = Date.now(); }
  clearTimeout(scrollTimer);
  scrollTimer = setTimeout(() => {
    const toY = window.scrollY;
    const max = document.body.scrollHeight - window.innerHeight;
    send('scroll', {
      from_y:       Math.round(scrollFrom),
      to_y:         Math.round(toY),
      direction:    toY >= scrollFrom ? 'down' : 'up',
      viewport_pct: max > 0 ? Math.round((toY / max) * 100) : 0,
      duration_ms:  Date.now() - scrollT0,
      url:          window.location.href,
    });
    scrollFrom = toY; scrollT0 = null;
  }, 300);
}, { passive: true });

// ── Hover ─────────────────────────────────────────────────────────────────────

const HOVER_MIN_MS = 800;
let hoverEl = null, hoverT = null;

document.addEventListener('mouseover', (e) => { hoverEl = e.target; hoverT = Date.now(); });
document.addEventListener('mouseout',  (e) => {
  if (!hoverEl || !hoverT) return;
  const dur = Date.now() - hoverT;
  if (dur >= HOVER_MIN_MS)
    send('hover', { ...elInfo(hoverEl), x: e.clientX, y: e.clientY, duration_ms: dur });
  hoverEl = null; hoverT = null;
});

// ── Texto seleccionado ────────────────────────────────────────────────────────

document.addEventListener('mouseup', () => {
  const sel = window.getSelection()?.toString().trim();
  if (sel && sel.length > 2)
    send('text_select', { selected_text: sel.slice(0, 300), url: window.location.href });
});

// ── Copy / Paste ──────────────────────────────────────────────────────────────

document.addEventListener('copy', () => {
  const sel = window.getSelection()?.toString().trim();
  if (sel) send('copy', { text: sel.slice(0, 300), url: window.location.href });
});

document.addEventListener('paste', (e) => {
  const text = e.clipboardData?.getData('text') || '';
  if (!text) return;
  const payload = { ...elInfo(e.target) };
  if (_isSensitiveField(e.target)) {
    payload.text         = '[REDACTED]';
    payload.text_length  = text.length;
    payload.redacted     = true;
  } else {
    payload.text = text.slice(0, 300);
  }
  send('paste', payload);
});

// ── Dwell time — reemplaza element_visible ────────────────────────────────────
//
// En lugar de reportar "el elemento entró al viewport", esperamos a que
// el usuario lo haya tenido visible al menos DWELL_MS milisegundos.
// Eso filtra elementos que el usuario simplemente scrolleó sin leer.

const DWELL_MS      = 1500;   // tiempo mínimo visible para considerar "leído"
const DWELL_MAX_MS  = 5000;   // tope: por encima asumimos que el elemento es siempre visible (header/footer)
const SELECTORS     = ['h1','h2','h3','button','a','[role="button"]','[class*="price"]','[class*="precio"]'];
const dwellMap      = new Map();  // element → timestamp de entrada al viewport
const reportedDwell = new Set();  // xpath → ya reportado (evita duplicados)

// Descarta elementos dentro de chrome del sitio (nav, header, footer).
// Esos elementos siempre están visibles y reportan dwell falso de varios segundos.
function _isInSiteChrome(el) {
  return !!el.closest('nav, header, footer, [role="navigation"], [role="banner"], [role="contentinfo"]');
}

const dwellObserver = new IntersectionObserver((entries) => {
  const now = Date.now();
  for (const entry of entries) {
    const el  = entry.target;
    const key = getXPath(el);

    if (entry.isIntersecting) {
      // Elemento entró al viewport → registrar momento
      dwellMap.set(el, now);
    } else {
      // Elemento salió del viewport → calcular cuánto tiempo estuvo
      const start = dwellMap.get(el);
      dwellMap.delete(el);
      if (!start) continue;

      const dwell_ms = now - start;
      if (dwell_ms < DWELL_MS) continue;          // scrolleó rápido, ignorar
      if (reportedDwell.has(key)) continue;        // ya reportado
      if (_isInSiteChrome(el)) continue;           // header/nav/footer = ruido

      const text = el.innerText?.trim() || '';
      if (!text) continue;                         // sin texto visible, ignorar

      reportedDwell.add(key);
      send('element_read', {
        ...elInfo(el),
        dwell_ms: Math.min(dwell_ms, DWELL_MAX_MS),
      });
    }
  }
}, { threshold: 0.5 });

function observeElements() {
  document.querySelectorAll(SELECTORS.join(',')).forEach(el => {
    // No re-observar si ya está siendo trackeado o ya fue reportado
    if (dwellMap.has(el)) return;
    const key = getXPath(el);
    if (reportedDwell.has(key)) return;
    if (_isInSiteChrome(el)) return;
    dwellObserver.observe(el);
  });
}

observeElements();
// Re-observar cuando el DOM cambia (SPAs, contenido dinámico)
// Debounce para no llamar en cada micro-cambio del DOM
let mutationTimer = null;
new MutationObserver(() => {
  clearTimeout(mutationTimer);
  mutationTimer = setTimeout(observeElements, 500);
}).observe(document.body, { childList: true, subtree: true });

// ── Reading pause — snapshot al pausar el scroll ──────────────────────────────
//
// Cuando el usuario deja de scrollear 1.5s, captura los elementos importantes
// que están en pantalla en ese momento (el usuario los está leyendo).

const PAUSE_MS = 1500;
const PAUSE_MAX_ELEMENTS = 25;     // tope de elementos por snapshot
const PAUSE_MIN_AREA_PX  = 800;    // descarta elementos diminutos (típicamente íconos del nav)
let pauseTimer = null;
let lastPausePct = -1;  // evita disparar si no hubo scroll real desde el último pause

function isReallyVisible(el) {
  if (!el.offsetParent && getComputedStyle(el).position !== 'fixed') return false;
  const cs = getComputedStyle(el);
  if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) < 0.1) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 4 || r.height < 4) return false;
  if (r.bottom < -r.height * 0.3) return false;
  if (r.top > window.innerHeight + r.height * 0.3) return false;
  return true;
}

function getVisibleElements() {
  const seen = new Set();
  const out  = [];
  for (const el of document.querySelectorAll(SELECTORS.join(','))) {
    if (!isReallyVisible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width * r.height < PAUSE_MIN_AREA_PX) continue;
    const text = (el.innerText || '').trim().slice(0, 120);
    if (text.length < 3) continue;
    const key = `${el.tagName}|${text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ tag: el.tagName, text, aria: el.getAttribute('aria-label') || '' });
    if (out.length >= PAUSE_MAX_ELEMENTS) break;
  }
  return out;
}

window.addEventListener('scroll', () => {
  clearTimeout(pauseTimer);
  pauseTimer = setTimeout(() => {
    const max = document.body.scrollHeight - window.innerHeight;
    const pct = max > 0 ? Math.round((window.scrollY / max) * 100) : 0;

    // No disparar si estamos en la misma posición que el último pause (±3%)
    if (Math.abs(pct - lastPausePct) < 3) return;
    lastPausePct = pct;

    const elements = getVisibleElements();
    if (elements.length === 0) return;

    send('reading_pause', {
      url:        window.location.href,
      scroll_pct: pct,
      elements,
    });
  }, PAUSE_MS);
}, { passive: true });

// ── Extracción de contexto estructurado de la página ─────────────────────────
//
// Lee datos ya presentes en el HTML: JSON-LD (estándar SEO), meta tags Open
// Graph, breadcrumbs del DOM y jerarquía de headings. No intercepta red.
// Complementa page_summary con datos estructurados disponibles desde el inicio.

function extractPageContext() {
  const ctx = {};

  // 1. JSON-LD — datos estructurados estándar (Google exige esto a los e-commerce)
  const schemas = [...document.querySelectorAll('script[type="application/ld+json"]')]
    .map(s => { try { return JSON.parse(s.textContent); } catch (_) { return null; } })
    .filter(Boolean);

  const flat = schemas.flatMap(s => Array.isArray(s['@graph']) ? s['@graph'] : [s]);

  const productSchema = flat.find(s => ['Product', 'ProductGroup'].includes(s['@type']));
  if (productSchema) {
    const offers = Array.isArray(productSchema.offers) ? productSchema.offers[0] : productSchema.offers;
    const p = {};
    if (productSchema.name)        p.name        = String(productSchema.name).slice(0, 200);
    if (productSchema.description) p.description = String(productSchema.description).slice(0, 400);
    if (productSchema.sku)         p.sku         = String(productSchema.sku).slice(0, 60);
    if (productSchema.brand?.name) p.brand       = productSchema.brand.name;
    if (productSchema.aggregateRating) {
      p.rating      = productSchema.aggregateRating.ratingValue;
      p.reviewCount = productSchema.aggregateRating.reviewCount;
    }
    if (offers) {
      if (offers.price)         p.price        = offers.price;
      if (offers.priceCurrency) p.currency     = offers.priceCurrency;
      if (offers.availability)  p.availability = offers.availability.split('/').pop();
    }
    if (Object.keys(p).length) ctx.product = p;
  }

  const bcSchema = flat.find(s => s['@type'] === 'BreadcrumbList');
  if (bcSchema?.itemListElement) {
    const bc = bcSchema.itemListElement.map(item => item.name || item.item?.name || '').filter(Boolean);
    if (bc.length) ctx.breadcrumbs = bc;
  }

  // 2. Breadcrumbs del DOM (fallback)
  if (!ctx.breadcrumbs) {
    const bcEls = [...document.querySelectorAll(
      '[class*="breadcrumb"] a, [aria-label*="breadcrumb"] a, ' +
      '[class*="Breadcrumb"] a, [itemtype*="BreadcrumbList"] [itemprop="name"]'
    )];
    const bc = bcEls.map(el => el.innerText.trim()).filter(t => t && t.length < 80);
    if (bc.length) ctx.breadcrumbs = bc;
  }

  // 3. Meta tags Open Graph
  const metaMap = {};
  [['og:description', 'property'], ['product:price:amount', 'property'], ['product:price:currency', 'property']]
    .forEach(([key, attr]) => {
      const el = document.querySelector(`meta[${attr}="${key}"]`);
      if (el?.content) metaMap[key] = el.content.slice(0, 200);
    });
  if (Object.keys(metaMap).length) ctx.meta = metaMap;

  // 4. Jerarquía de headings
  const headings = [...document.querySelectorAll('h1, h2, h3')]
    .map(h => ({ level: h.tagName, text: h.innerText.trim().slice(0, 120) }))
    .filter(h => h.text.length > 1).slice(0, 15);
  if (headings.length) ctx.headings = headings;

  return Object.keys(ctx).length ? ctx : null;
}


// ── Page load / navegación ────────────────────────────────────────────────────

let pageLoadTime = Date.now();

send('page_load', {
  url:      window.location.href,
  title:    document.title,
  referrer: document.referrer,
  context:  extractPageContext(),
});

// Navegación SPA via history.pushState (React, Vue, Next.js, etc.)
// Espera 300ms para que la SPA renderice el nuevo contenido antes de leer el DOM
const _pushState = history.pushState.bind(history);
history.pushState = function (...args) {
  _pushState(...args);
  setTimeout(() => {
    send('spa_navigation', { url: window.location.href, title: document.title, context: extractPageContext() });
  }, 300);
};
window.addEventListener('popstate', () => {
  setTimeout(() => {
    send('spa_navigation', { url: window.location.href, title: document.title, context: extractPageContext() });
  }, 300);
});
window.addEventListener('hashchange', () => {
  send('hash_navigation', { url: window.location.href, title: document.title });
});

// ── Page summary al salir ─────────────────────────────────────────────────────
//
// Antes de salir de la página, resume el contenido clave que estaba disponible.
// Mucho más útil para la IA que N eventos element_visible sueltos.

// Patrones para detectar precios reales (no "No disponible" ni "Free trial")
const _PRICE_PATTERN  = /([\$€£¥]\s*\d[\d.,]*|\d[\d.,]+\s*(?:USD|EUR|MXN|ARS|MX\$|US\$))/i;
const _STOCK_PATTERN  = /(disponible|en stock|in stock|agotado|sin stock|out of stock|no disponible|sold out|temporalmente no disponible)/i;
const _SHORTCUT_TOKEN = /(mayús|shift|alt|ctrl|cmd|command|⌘|⇧|⌥|⌃)\s*\+/i;

// Limpia un texto: colapsa whitespace y trunca
function _clean(text, max = 200) {
  return (text || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

// ¿El texto del botón es un atajo de teclado en vez de un CTA real?
// Ej: "Agregar al carrito\nmayús\n+\nalt\n+\nK" → no es un CTA, es una hint.
function _looksLikeKeyboardShortcut(text) {
  return _SHORTCUT_TOKEN.test(text) || /\b[a-z]\b/i.test(text.split('\n').pop() || '');
}

function _extractPrice() {
  // Buscar entre elementos típicos de precio, devolver el primer match de la regex
  const candidates = document.querySelectorAll(
    '[class*="price"],[class*="precio"],[class*="Price"],[class*="Precio"],[itemprop="price"],[data-price]'
  );
  for (const el of candidates) {
    const txt = (el.innerText || '').trim();
    const m   = txt.match(_PRICE_PATTERN);
    if (m) return _clean(m[0], 30);
  }
  return '';
}

function _extractStock() {
  const candidates = document.querySelectorAll(
    '[id*="availability"],[class*="availability"],[class*="stock"],[id*="outOfStock"]'
  );
  for (const el of candidates) {
    const txt = (el.innerText || '').trim();
    const m   = txt.match(_STOCK_PATTERN);
    if (m) return _clean(m[0], 50);
  }
  return '';
}

window.addEventListener('beforeunload', () => {
  const duration_ms = Date.now() - pageLoadTime;

  const h1 = _clean(document.querySelector('h1')?.innerText, 200);

  // Botones reales: con texto, no hints de atajos de teclado, no dentro del chrome del sitio
  const buttons = [...document.querySelectorAll('button,[role="button"]')]
    .filter(b => !_isInSiteChrome(b))
    .map(b => _clean(b.innerText, 60))
    .filter(t => t.length > 2 && t.length < 60 && !_looksLikeKeyboardShortcut(t))
    .slice(0, 6);

  // Secciones: h2/h3 fuera de nav/header/footer
  const sections = [...document.querySelectorAll('h2,h3')]
    .filter(h => !_isInSiteChrome(h))
    .map(h => _clean(h.innerText, 80))
    .filter(t => t.length > 3)
    .slice(0, 8);

  send('page_summary', {
    url:         window.location.href,
    title:       document.title,
    duration_ms,
    h1,
    price:       _extractPrice(),
    availability: _extractStock(),
    buttons,
    sections,
  });

});
