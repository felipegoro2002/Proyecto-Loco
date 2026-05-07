// ── Helpers ───────────────────────────────────────────────────────────────────

function getXPath(el) {
  if (el.id) return `//*[@id="${el.id}"]`;
  if (el === document.body) return '/html/body';
  let ix = 0;
  const siblings = el.parentNode.childNodes;
  for (let i = 0; i < siblings.length; i++) {
    const s = siblings[i];
    if (s === el)
      return getXPath(el.parentNode) + '/' + el.tagName + '[' + (ix + 1) + ']';
    if (s.nodeType === 1 && s.tagName === el.tagName) ix++;
  }
}

function elInfo(el) {
  if (!el || !el.tagName) return {};
  return {
    tag:     el.tagName,
    text:    el.innerText?.slice(0, 120) || '',
    id:      el.id || '',
    classes: typeof el.className === 'string' ? el.className : '',
    xpath:   getXPath(el),
    role:    el.getAttribute('role') || el.tagName.toLowerCase(),
    aria:    el.getAttribute('aria-label') || '',
    href:    el.closest('a')?.href || null,
    url:     window.location.href,
  };
}

function send(type, data) {
  chrome.runtime.sendMessage({ type, ...data, time: Date.now() });
}

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
    send('input', { ...elInfo(el), value: el.value, input_type: el.type || '' });
  }, 800);
});

// ── Focus / Blur ──────────────────────────────────────────────────────────────

const FOCUSABLE = ['INPUT', 'TEXTAREA', 'SELECT', 'A', 'BUTTON'];

document.addEventListener('focusin',  (e) => { if (FOCUSABLE.includes(e.target.tagName)) send('focus', elInfo(e.target)); });
document.addEventListener('focusout', (e) => { if (FOCUSABLE.includes(e.target.tagName)) send('blur',  elInfo(e.target)); });

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

const HOVER_MIN_MS = 600;
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
  if (text) send('paste', { text: text.slice(0, 300), ...elInfo(e.target) });
});

// ── Teclas especiales en contexto ─────────────────────────────────────────────

const SPECIAL_KEYS = ['Enter', 'Escape', 'Tab', 'ArrowUp', 'ArrowDown'];

document.addEventListener('keydown', (e) => {
  if (!SPECIAL_KEYS.includes(e.key)) return;
  send('keydown', { key: e.key, ctrl: e.ctrlKey, shift: e.shiftKey, focused: elInfo(document.activeElement) });
});

// ── Dwell time — reemplaza element_visible ────────────────────────────────────
//
// En lugar de reportar "el elemento entró al viewport", esperamos a que
// el usuario lo haya tenido visible al menos DWELL_MS milisegundos.
// Eso filtra elementos que el usuario simplemente scrolleó sin leer.

const DWELL_MS      = 1500;   // tiempo mínimo visible para considerar "leído"
const SELECTORS     = ['h1','h2','h3','button','a','[role="button"]','[class*="price"]','[class*="precio"]'];
const dwellMap      = new Map();  // element → timestamp de entrada al viewport
const reportedDwell = new Set();  // xpath → ya reportado (evita duplicados)

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
      reportedDwell.add(key);

      const text = el.innerText?.trim() || '';
      if (!text) continue;                         // sin texto visible, ignorar

      send('element_read', {
        ...elInfo(el),
        dwell_ms,
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
let pauseTimer = null;
let lastPausePct = -1;  // evita disparar si no hubo scroll real desde el último pause

function getVisibleElements() {
  const vTop    = window.scrollY;
  const vBottom = vTop + window.innerHeight;

  return document.querySelectorAll(SELECTORS.join(','))
    // Solo elementos completamente o mayoritariamente visibles
    .values()
    ? [...document.querySelectorAll(SELECTORS.join(','))].filter(el => {
        const r = el.getBoundingClientRect();
        return r.top >= -r.height * 0.3 && r.bottom <= window.innerHeight + r.height * 0.3;
      }).map(el => ({
        tag:  el.tagName,
        text: el.innerText?.trim().slice(0, 120) || '',
        aria: el.getAttribute('aria-label') || '',
      })).filter(e => e.text.length > 2)
    : [];
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

// ── Page load / navegación ────────────────────────────────────────────────────

let pageLoadTime = Date.now();

send('page_load', {
  url:         window.location.href,
  title:       document.title,
  referrer:    document.referrer,
  description: document.querySelector('meta[name="description"]')?.content || '',
});

// Navegación SPA via history.pushState (React, Vue, Next.js, etc.)
const _pushState = history.pushState.bind(history);
history.pushState = function (...args) {
  _pushState(...args);
  send('spa_navigation', { url: window.location.href, title: document.title });
};
window.addEventListener('popstate', () => {
  send('spa_navigation', { url: window.location.href, title: document.title });
});
window.addEventListener('hashchange', () => {
  send('hash_navigation', { url: window.location.href, title: document.title });
});

// ── Page summary al salir ─────────────────────────────────────────────────────
//
// Antes de salir de la página, resume el contenido clave que estaba disponible.
// Mucho más útil para la IA que N eventos element_visible sueltos.

window.addEventListener('beforeunload', () => {
  const duration_ms = Date.now() - pageLoadTime;

  // Heading principal
  const h1 = document.querySelector('h1')?.innerText?.trim().slice(0, 200) || '';

  // Precio principal (busca patrones comunes)
  const priceEl = document.querySelector('[class*="price"],[class*="precio"],[class*="Price"],[class*="Precio"]');
  const price   = priceEl?.innerText?.trim().slice(0, 50) || '';

  // Botones de acción visibles (CTA)
  const buttons = [...document.querySelectorAll('button,[role="button"]')]
    .map(b => b.innerText?.trim())
    .filter(t => t && t.length > 2 && t.length < 60)
    .slice(0, 6);

  // Headings h2 visibles (secciones leídas)
  const sections = [...document.querySelectorAll('h2,h3')]
    .map(h => h.innerText?.trim().slice(0, 80))
    .filter(t => t && t.length > 3)
    .slice(0, 8);

  send('page_summary', {
    url:         window.location.href,
    title:       document.title,
    duration_ms,
    h1,
    price,
    buttons,
    sections,
  });

  // También enviar time_on_page para compatibilidad
  send('time_on_page', { url: window.location.href, duration_ms });
});
