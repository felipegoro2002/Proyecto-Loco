import re
import json

# ── Filtro de network ──────────────────────────────────────────────────────────

# Dominios completos que son 100% ruido
_NOISE_DOMAINS = re.compile(
    r'(^|\.)('
    # Publicidad Google
    r'googlesyndication\.com|googleadservices\.com|googletagservices\.com|'
    r'adtrafficquality\.google|doubleclick\.net|'
    # CDNs de imágenes / assets
    r'mlstatic\.com|walmartimages\.com|gstatic\.com|googleusercontent\.com|'
    # Analytics y telemetría de terceros
    r'tiktok\.com|facebook\.net|facebook\.com|'
    r'nr-data\.net|newrelic\.com|segment\.io|mixpanel\.com|'
    r'hotjar\.com|clarity\.ms|medallia\.com|'
    # Google internals sin valor para el usuario
    r'clients6\.google\.com|play\.google\.com'
    r')($|/)',
    re.IGNORECASE
)

# Paths que son tracking/telemetría aunque vengan de dominios útiles
_NOISE_PATHS = re.compile(
    r'/gen_204|/log(\?|$)|/tr/(\?|$)|'
    r'/pixel/|/telemetry|/metrics(\?|$)|/traces(\?|$)|'
    r'/sodar|safeframe|/RotateCookiesPage|'
    r'longpolling|longpoll|/poll(\?|$)|'
    r'webchannel/events|/_/|/idv/|'
    r'heartbeat|/ping(\?|$)|'
    r'/melidata/tracks|ces/v1/telemetry|ces/statsc|'
    r'\.(woff2?|ttf|otf|eot|css|webp|png|jpg|jpeg|gif|ico|svg)(\?|$)',
    re.IGNORECASE
)

def _is_noise_network(event):
    url = event.get("data", {}).get("url", "")
    # Extraer solo el dominio para checar la lista de dominios
    domain_match = re.search(r'https?://([^/]+)', url)
    domain = domain_match.group(1) if domain_match else ""
    return bool(_NOISE_DOMAINS.search(domain)) or bool(_NOISE_PATHS.search(url))


# ── Compresión de scroll ───────────────────────────────────────────────────────

_SCROLL_GAP_S = 2.0  # segundos de pausa para considerar nuevo grupo

def _compress_scroll_group(group):
    """Convierte N eventos de scroll en un único scroll_summary."""
    first = group[0]
    last  = group[-1]
    data  = first.get("data", {})

    total_dy = sum(e["data"].get("delta_y", 0) for e in group)
    total_dx = sum(e["data"].get("delta_x", 0) for e in group)

    if total_dy < 0:
        direction = "down"
    elif total_dy > 0:
        direction = "up"
    else:
        direction = "horizontal"

    return {
        "time":   first["time"],
        "source": first.get("source", "system"),
        "type":   "scroll_summary",
        "data": {
            "direction":    direction,
            "delta_y":      round(total_dy, 1),
            "delta_x":      round(total_dx, 1),
            "scroll_count": len(group),
            "duration_s":   round(last["time"] - first["time"], 2),
            "app":          data.get("app", ""),
            "window_title": data.get("window_title", ""),
        }
    }


# ── Filtro de element_visible ─────────────────────────────────────────────────

# Tags que nunca aportan valor semántico
_EV_SKIP_TAGS = {"DIV", "SECTION", "ARTICLE", "ASIDE", "HEADER",
                 "FOOTER", "NAV", "MAIN", "LI", "UL", "OL"}

# Tags siempre valiosos sin condiciones
_EV_KEEP_TAGS = {"H1", "H2", "H3", "H4", "H5", "H6", "S"}

# Texto mínimo para considerar un A o BUTTON relevante
_MIN_TEXT_LEN = 3

# Palabras en texto de A que indican links de navegación sin valor
_NAV_NOISE_RE = re.compile(
    r'^(ver (m[aá]s|todo|menos)|siguiente|anterior|cerrar|close|'
    r'menu|inicio|home|back|volver|compartir|share|\d+)$',
    re.IGNORECASE
)

# Texto de SPAN que sugiere precio (contiene $ o dígitos con separador)
_PRICE_RE = re.compile(r'[\$\€\£]|^\d[\d\.,]+$')


def _is_relevant_element(data):
    tag  = data.get("tag", "")
    text = data.get("text", "").strip()

    # Descartar tags de contenedor
    if tag in _EV_SKIP_TAGS:
        return False

    # Siempre conservar headings y precios tachados
    if tag in _EV_KEEP_TAGS:
        return True

    # Botones: conservar si tienen texto útil
    if tag == "BUTTON":
        return len(text) >= _MIN_TEXT_LEN

    # Links: conservar si tienen texto real y no son nav genérico
    if tag == "A":
        return len(text) >= _MIN_TEXT_LEN and not _NAV_NOISE_RE.match(text)

    # SPAN: conservar solo si parece precio
    if tag == "SPAN":
        return bool(_PRICE_RE.search(text))

    # Resto de tags (INPUT, SELECT, custom elements…): conservar
    return True


def _element_key(event):
    data = event.get("data", {})
    return (data.get("xpath", ""), data.get("url", ""))


# ── Compresor principal ────────────────────────────────────────────────────────

# Texto de breadcrumb: todo minúsculas, sin precio, sin mayúsculas iniciales
# Ejemplo: "camara wifi", "hogar", "camaras de vigilancia"
_BREADCRUMB_RE = re.compile(r'^[a-záéíóúüñ\s]+$', re.IGNORECASE)

def _is_relevant_element_read(data):
    """Filtra element_read que son breadcrumbs o links de nav genéricos."""
    tag  = data.get("tag", "")
    text = (data.get("text") or "").strip()

    # Solo aplicar filtro extra a links
    if tag != "A":
        return True

    # Descartar si el texto es solo minúsculas/espacios (breadcrumb típico)
    # y no contiene precio ni mayúsculas propias
    if _BREADCRUMB_RE.match(text) and not _PRICE_RE.search(text):
        return False

    return True


def compress(events):
    """
    Aplica cuatro transformaciones:
      1. network       → elimina polling, analytics y heartbeats
      2. scroll        → agrupa ráfagas consecutivas en scroll_summary
                         descarta scrolls con delta_x=0 y delta_y=0
      3. element_visible → deduplica, conserva solo la primera aparición
      4. element_read  → filtra breadcrumbs, deduplica
      5. reading_pause → descarta si scroll_pct < 5 (top de página = nav noise)
    """
    result        = []
    seen_elements = set()

    i = 0
    while i < len(events):
        event = events[i]
        etype = event.get("type")

        # 1. element_visible (legacy) — filtrar y deduplicar
        if etype == "element_visible":
            data = event.get("data", {})
            if _is_relevant_element(data):
                key = _element_key(event)
                if key not in seen_elements:
                    seen_elements.add(key)
                    result.append(event)
            i += 1
            continue

        # 1b. element_read — filtrar breadcrumbs y deduplicar
        if etype == "element_read":
            data = event.get("data", {})
            if _is_relevant_element_read(data):
                key = _element_key(event)
                if key not in seen_elements:
                    seen_elements.add(key)
                    result.append(event)
            i += 1
            continue

        # 2. network — filtrar ruido
        if etype == "network":
            if not _is_noise_network(event):
                result.append(event)
            i += 1
            continue

        # 3. scroll — agrupar ráfagas contiguas y descartar scrolls vacíos
        if etype == "scroll":
            group = [event]
            j = i + 1
            while j < len(events):
                nxt = events[j]
                if (nxt.get("type") == "scroll"
                        and nxt["time"] - group[-1]["time"] <= _SCROLL_GAP_S):
                    group.append(nxt)
                    j += 1
                else:
                    break
            summary = _compress_scroll_group(group)
            # Descartar scrolls con movimiento nulo (horizontal noise)
            if summary["data"]["delta_y"] != 0 or summary["data"]["delta_x"] != 0:
                result.append(summary)
            i = j
            continue

        # 4. reading_pause — descartar si está al tope de la página (nav noise)
        if etype == "reading_pause":
            data = event.get("data", {})
            if data.get("scroll_pct", 0) >= 5:
                result.append(event)
            i += 1
            continue

        # Resto de eventos — pasar tal cual
        result.append(event)
        i += 1

    return result


# ── Entrada desde archivo ──────────────────────────────────────────────────────

def compress_session(session_dir):
    input_path  = f"{session_dir}/session.json"
    output_path = f"{session_dir}/session_compressed.json"

    with open(input_path, encoding="utf-8") as f:
        events = json.load(f)

    original  = len(events)
    compressed = compress(events)
    reduced   = len(compressed)
    pct       = round((1 - reduced / original) * 100) if original else 0

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(compressed, f, indent=2, ensure_ascii=False)

    print(f"[ZIP] {original} -> {reduced} eventos  ({pct}% reduccion)")
    print(f"[OK] Comprimido: {output_path}")

    return output_path
