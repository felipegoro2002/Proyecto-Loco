// Reenvía eventos del content script al servidor local
chrome.runtime.onMessage.addListener((message, sender) => {
  fetch('http://localhost:5000/event', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ source: 'browser', ...message }),
  }).catch(() => {}); // silencia errores si el servidor no está corriendo
});

// Captura network requests (XHR/fetch de la página)
chrome.webRequest.onCompleted.addListener(
  (details) => {
    // Filtra solo requests de páginas (no de la extensión misma)
    if (details.initiator?.startsWith('chrome-extension')) return;
    // Filtra solo los interesantes (no imágenes, fuentes, analytics)
    const url = details.url;
    if (/\.(png|jpg|jpeg|gif|svg|ico|woff|woff2|css)(\?|$)/i.test(url)) return;
    if (/google-analytics|googletagmanager|doubleclick|facebook\.net/i.test(url)) return;

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