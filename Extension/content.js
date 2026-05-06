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
  const el = e.target;
  const anchor = el.closest('a');
  const data = { ...elInfo(el), x: e.clientX, y: e.clientY };

  if (anchor?.href && !anchor.target) {
    e.preventDefault();
    send('click', data);
    setTimeout(() => { window.location.href = anchor.href; }, 80);
  } else {
    send('click', data);
  }
});

// ── Input ─────────────────────────────────────────────────────────────────────

// Throttle: solo manda si cambia y no más de 1 vez por segundo
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

document.addEventListener('focusin', (e) => {
  if (FOCUSABLE.includes(e.target.tagName))
    send('focus', elInfo(e.target));
});

document.addEventListener('focusout', (e) => {
  if (FOCUSABLE.includes(e.target.tagName))
    send('blur', elInfo(e.target));
});

// ── Scroll ────────────────────────────────────────────────────────────────────

let scrollFrom  = window.scrollY;
let scrollTimer = null;
let scrollT0    = null;

window.addEventListener('scroll', () => {
  if (scrollT0 === null) { scrollFrom = window.scrollY; scrollT0 = Date.now(); }
  clearTimeout(scrollTimer);
  scrollTimer = setTimeout(() => {
    const toY  = window.scrollY;
    const max  = document.body.scrollHeight - window.innerHeight;
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

document.addEventListener('mouseover', (e) => {
  hoverEl = e.target; hoverT = Date.now();
});

document.addEventListener('mouseout', (e) => {
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
  const el   = e.target;
  if (text) send('paste', { text: text.slice(0, 300), ...elInfo(el) });
});

// ── Teclas especiales en contexto ─────────────────────────────────────────────

const SPECIAL_KEYS = ['Enter', 'Escape', 'Tab', 'ArrowUp', 'ArrowDown'];

document.addEventListener('keydown', (e) => {
  if (!SPECIAL_KEYS.includes(e.key)) return;
  const el = document.activeElement;
  send('keydown', {
    key:     e.key,
    ctrl:    e.ctrlKey,
    shift:   e.shiftKey,
    focused: elInfo(el),
  });
});

// ── Visibility de elementos importantes ───────────────────────────────────────

// Observa precios, botones, headings, links — elementos que el usuario "vio"
const reportedElements = new Set();

const IO = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    const el = entry.target;
    const key = getXPath(el);
    if (reportedElements.has(key)) { IO.unobserve(el); continue; }
    reportedElements.add(key);
    send('element_visible', {
      ...elInfo(el),
      viewport_pct: Math.round(entry.intersectionRatio * 100),
    });
    IO.unobserve(el);
  }
}, { threshold: 0.5 });

function observeImportantElements() {
  const selectors = ['h1', 'h2', 'h3', 'button', 'a', '[role="button"]', 'price', '[class*="price"]', '[class*="precio"]'];
  document.querySelectorAll(selectors.join(',')).forEach(el => IO.observe(el));
}

// Corre al cargar y de nuevo si el DOM cambia (SPAs)
observeImportantElements();
new MutationObserver(observeImportantElements).observe(document.body, { childList: true, subtree: true });

// ── Page load / navegación ────────────────────────────────────────────────────

// Tiempo en página
let pageLoadTime = Date.now();

send('page_load', {
  url:         window.location.href,
  title:       document.title,
  referrer:    document.referrer,
  description: document.querySelector('meta[name="description"]')?.content || '',
});

window.addEventListener('hashchange', () => {
  send('hash_navigation', { url: window.location.href, title: document.title });
});

// Tiempo en página al salir
window.addEventListener('beforeunload', () => {
  send('time_on_page', {
    url:        window.location.href,
    duration_ms: Date.now() - pageLoadTime,
  });
});