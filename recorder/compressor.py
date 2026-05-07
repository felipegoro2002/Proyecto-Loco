import re
import json

# ── Filtro de network ──────────────────────────────────────────────────────────
#
# background.js ya filtra todo lo cross-origin (tracking, ads, Google internals,
# otras tabs). El compressor solo necesita limpiar lo que se cuele:
# recursos estáticos y paths de telemetría del propio sitio.

_NOISE_PATHS = re.compile(
    r'/pixel|/beacon|/collect(\?|$)|/track(\?|$)|'
    r'/telemetry|/metrics(\?|$)|/stat(s)?(\?|$)|'
    r'/gen_204|/ping(\?|$)|/log(\?|$)|heartbeat|'
    r'/melidata|snoopy\.|ces/v1|ces/statsc|'
    r'longpolling|longpoll|webchannel|/_/|'
    # Infraestructura RPC de Google Workspace (clients6.google.com y subdominios -pa.)
    # Pasa background.js porque comparte root domain google.com con docs/drive
    r'clients\d+\.google\.com|'
    # Residual que puede pasar el filtro de background.js por coincidencia de substring
    r'/recommendations\?|/adn/api|/api/stats|'   # ML recommendations, ads, YT stats
    r'/scripts/|/spreadsheets/|/drive/log|'       # Google Docs internals
    r'\.(js|css|woff2?|ttf|otf|eot|png|jpg|jpeg|gif|webp|svg|ico|wasm|map)(\?|$)',
    re.IGNORECASE
)

def _is_noise_network(event):
    url = event.get("data", {}).get("url", "")
    return bool(_NOISE_PATHS.search(url))


# ── Compresión de scroll ───────────────────────────────────────────────────────

_SCROLL_GAP_S = 2.0  # segundos de pausa para considerar nuevo grupo

def _compress_scroll_group(group):
    """Convierte N eventos de scroll en un único scroll_summary.

    Maneja dos tipos de scroll:
      - system (input_listener): tiene delta_x / delta_y
      - browser (content.js):   tiene from_y / to_y / viewport_pct / url
    """
    first     = group[0]
    last      = group[-1]
    first_data = first.get("data", {})
    last_data  = last.get("data", {})

    is_browser = "from_y" in first_data  # scroll viene de content.js

    if is_browser:
        # Delta real = desplazamiento total desde el primer from_y al último to_y
        total_dy = last_data.get("to_y", 0) - first_data.get("from_y", 0)
        total_dx = 0
        direction = last_data.get("direction", "down")
        extra = {
            "from_y":       first_data.get("from_y"),
            "to_y":         last_data.get("to_y"),
            "viewport_pct": last_data.get("viewport_pct"),
            "url":          last_data.get("url", ""),
        }
    else:
        total_dy = sum(e["data"].get("delta_y", 0) for e in group)
        total_dx = sum(e["data"].get("delta_x", 0) for e in group)
        if total_dy < 0:
            direction = "down"
        elif total_dy > 0:
            direction = "up"
        else:
            direction = "horizontal"
        extra = {
            "app":          first_data.get("app", ""),
            "window_title": first_data.get("window_title", ""),
        }

    summary = {
        "time":   first["time"],
        "source": first.get("source", "system"),
        "type":   "scroll_summary",
        "data": {
            "direction":    direction,
            "delta_y":      round(total_dy, 1),
            "delta_x":      round(total_dx, 1),
            "scroll_count": len(group),
            "duration_s":   round(last["time"] - first["time"], 2),
        }
    }
    summary["data"].update(extra)
    return summary


# Texto de SPAN que sugiere precio (contiene $ o dígitos con separador)
_PRICE_RE = re.compile(r'[\$\€\£]|^\d[\d\.,]+$')


def _element_key(event):
    data = event.get("data", {})
    return (data.get("xpath", ""), data.get("url", ""))


# ── Compresor principal ────────────────────────────────────────────────────────

# Texto de breadcrumb: todo minúsculas, sin precio, sin mayúsculas iniciales
# Ejemplo: "camara wifi", "hogar", "camaras de vigilancia"
_BREADCRUMB_RE = re.compile(r'^[a-záéíóúüñ\s]+$', re.IGNORECASE)

def _is_relevant_element_read(data):
    """Filtra element_read que son breadcrumbs, paginación o links de nav genéricos."""
    tag  = data.get("tag", "")
    text = (data.get("text") or "").strip()

    # Solo aplicar filtro extra a links
    if tag != "A":
        return True

    # Descartar paginación: texto que es solo dígitos (1, 2, 3, 10...)
    if re.match(r'^\d+$', text):
        return False

    # Descartar si el texto es solo minúsculas/espacios (breadcrumb típico)
    # y no contiene precio ni mayúsculas propias
    if _BREADCRUMB_RE.match(text) and not _PRICE_RE.search(text):
        return False

    return True


# ── Filtro de hover ───────────────────────────────────────────────────────────

# Tags que vale la pena registrar en hover (el usuario inspeccionó algo)
_HOVER_KEEP_TAGS = {"H1", "H2", "H3", "H4", "A", "BUTTON", "SPAN", "IMG",
                    "INPUT", "SELECT", "LABEL"}

# Duración mínima de hover para que sea intencional (ms)
_HOVER_MIN_MS = 800

def _is_relevant_hover(event):
    data     = event.get("data", {})
    tag      = data.get("tag", "")
    text     = (data.get("text") or "").strip()
    dur      = data.get("duration_ms", 0)
    aria     = data.get("aria", "")

    # Descartar hovers muy cortos (pasó el cursor de largo)
    if dur < _HOVER_MIN_MS:
        return False

    # Descartar tags contenedor sin texto semántico
    if tag not in _HOVER_KEEP_TAGS:
        return False

    # Descartar si no hay texto ni aria-label (elemento mudo)
    if not text and not aria:
        return False

    # Descartar texto vacío / solo espacios / solo &nbsp;
    clean = re.sub(r'[\xa0\s]+', '', text)
    if not clean:
        return False

    return True


# Tipos de eventos que son ruido puro — nunca aportan valor a la IA
# (time_on_page ya no lo genera content.js; se mantiene por compatibilidad con sesiones viejas)
_DROP_TYPES = {"focus", "blur", "keydown", "time_on_page"}

# Dominios de redirect que generan page_load sin contenido útil
_REDIRECT_DOMAINS = re.compile(r'https?://(www\.)?google\.com/url\?', re.IGNORECASE)


def compress(events):
    """
    Aplica las siguientes transformaciones:
      1. network       → solo APIs del mismo dominio; descarta tracking y recursos
      2. scroll        → agrupa ráfagas en scroll_summary
                         maneja scrolls de sistema (delta_y) y browser (from_y/to_y)
                         descarta scrolls con movimiento nulo
      3. element_read  → filtra breadcrumbs y paginación, deduplica por xpath+url
      4. hover         → solo tags semánticos con texto real y duración >= 800ms
      5. reading_pause → descarta si scroll_pct < 5 (top de página = nav noise)
      6. focus/blur/keydown/time_on_page → descarta siempre (ruido puro)
      7. page_load/page_summary/screenshot en redirects → descarta google.com/url
      8. page_summary  → descarta si duration_ms < 500ms (bounce/redirect)
      9. api_response  → pasa directo (datos estructurados de producto)
    """
    result        = []
    seen_elements = set()

    i = 0
    while i < len(events):
        event = events[i]
        etype = event.get("type")

        # 0a. Tipos de ruido puro — descartar siempre
        if etype in _DROP_TYPES:
            i += 1
            continue

        # 0b. page_load, page_summary y screenshot en dominios de redirect — descartar
        if etype in ("page_load", "page_summary", "screenshot"):
            url = event.get("data", {}).get("url", "")
            if url and _REDIRECT_DOMAINS.match(url):
                i += 1
                continue

        # 1. element_read — filtrar breadcrumbs y deduplicar
        if etype == "element_read":
            data = event.get("data", {})
            if _is_relevant_element_read(data):
                key = _element_key(event)
                if key not in seen_elements:
                    seen_elements.add(key)
                    result.append(event)
            i += 1
            continue

        # 1c. hover — solo elementos semánticos con texto real
        if etype == "hover":
            if _is_relevant_hover(event):
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
            # Descartar scrolls con movimiento nulo
            # Para browser scrolls verificar también from_y/to_y por si delta_y=0
            d = summary["data"]
            has_movement = (
                d["delta_y"] != 0 or d["delta_x"] != 0
                or (d.get("from_y") is not None and d.get("from_y") != d.get("to_y"))
            )
            if has_movement:
                result.append(summary)
            i = j
            continue

        # 4. page_summary — descartar si la duración es menor a 500ms (redirect o bounce)
        if etype == "page_summary":
            if event.get("data", {}).get("duration_ms", 0) < 500:
                i += 1
                continue
            result.append(event)
            i += 1
            continue

        # 5. reading_pause — descartar si está al tope de la página (nav noise)
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
