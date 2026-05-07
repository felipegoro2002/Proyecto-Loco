// Reenvía eventos del content script al servidor local
chrome.runtime.onMessage.addListener((message, sender) => {
  fetch('http://localhost:5000/event', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ source: 'browser', ...message }),
  }).catch(() => {}); // silencia errores si el servidor no está corriendo
});

// ── Filtro de network — enfoque estructural, no blacklist ─────────────────────
//
// En lugar de mantener una lista infinita de dominios malos, solo capturamos
// requests que estructuralmente son APIs útiles:
//   1. Vienen del mismo dominio raíz que la página (filtra todo lo cross-origin:
//      tracking, ads, analytics de terceros, internals de otras tabs)
//   2. La URL parece una llamada a API (tiene /api/, /graphql, /v2/, etc.)
//   3. No es un recurso estático (.js, .css, imágenes, fuentes)
//
// Esto funciona para cualquier sitio sin necesitar conocer el dominio de antemano.

function _getRootDomain(hostname) {
  // Devuelve las últimas 2 partes: api.mercadolibre.com → mercadolibre.com
  // Maneja TLDs compuestos (com.mx, co.uk) quedándose con las últimas 3 partes
  const parts = hostname.split('.');
  if (parts.length > 2 && parts[parts.length - 2].length <= 3) {
    return parts.slice(-3).join('.');  // ej: walmart.com.mx
  }
  return parts.slice(-2).join('.');    // ej: mercadolibre.com
}

const _RESOURCE_RE  = /\.(js|css|html|htm|woff2?|ttf|otf|eot|png|jpg|jpeg|gif|webp|svg|ico|wasm|map)(\?|$)/i;
const _API_PATH_RE  = /\/api\/|\/graphql|\/rest\/|\/v\d+\/|\/query|deferred|pdp|orchestra|search|product|item|catalog/i;
const _NOISE_PATH_RE = /\/pixel|\/beacon|\/collect|\/track|\/log\?|\/ping\?|\/telemetry|\/metrics\?|\/stat(s)?\?|melidata|snoopy/i;

// Infraestructura RPC interna de Google Workspace (Docs, Drive, Sheets…).
// Comparte root domain con google.com pero nunca es relevante para tareas de usuario.
// Se identifica por patrón estructural: clients\d+.google.com y sus subdominios.
const _GOOGLE_RPC_RE = /^([a-z-]+-pa\.)?clients\d+\.google\.com$/i;

function _isRelevantApiCall(url, initiator) {
  try {
    const urlObj  = new URL(url);
    const urlHost = urlObj.hostname;
    const urlRoot = _getRootDomain(urlHost);

    // Descartar infraestructura RPC de Google Workspace (patrón estructural)
    if (_GOOGLE_RPC_RE.test(urlHost)) return false;

    // Mismo dominio raíz que la página que hizo el request
    if (initiator) {
      const initRoot = _getRootDomain(new URL(initiator).hostname);
      if (urlRoot !== initRoot) return false;
    }

    const path = urlObj.pathname + urlObj.search;

    // Descartar recursos estáticos (nunca son datos útiles)
    if (_RESOURCE_RE.test(path)) return false;

    // Descartar paths de tracking aunque vengan del mismo dominio
    if (_NOISE_PATH_RE.test(path)) return false;

    // Conservar solo si la ruta parece una API — query params solos no alcanzan
    if (!_API_PATH_RE.test(path)) return false;

    return true;
  } catch (_) {
    return false;
  }
}

// Captura network requests — solo APIs del mismo dominio que la página activa
chrome.webRequest.onCompleted.addListener(
  (details) => {
    if (details.initiator?.startsWith('chrome-extension')) return;
    if (!_isRelevantApiCall(details.url, details.initiator)) return;

    fetch('http://localhost:5000/event', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source:    'browser',
        type:      'network',
        time:      Date.now(),
        method:    details.method,
        url:       details.url,
        status:    details.statusCode,
        tab_url:   details.initiator || '',
      }),
    }).catch(() => {});
  },
  { urls: ['<all_urls>'] }
);
