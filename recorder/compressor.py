"""
Compresor de sesiones.

Aplica una pipeline de transforms declarativos al stream de eventos.
Cada transform: list[Event] -> list[Event], pura, sin estado compartido.
Orden definido en `PIPELINE`. Para agregar/quitar pasos, tocar solo PIPELINE.
"""
import re
import json


# ── Constantes de filtros ─────────────────────────────────────────────────────

# Tipos de eventos que son ruido puro — nunca aportan valor a la IA.
# (time_on_page ya no lo genera content.js; se mantiene por compatibilidad con sesiones viejas)
_DROP_TYPES = {"focus", "blur", "keydown", "time_on_page"}

# Dominios de redirect que generan page_load sin contenido útil
_REDIRECT_DOMAINS_RE = re.compile(r"https?://(www\.)?google\.com/url\?", re.IGNORECASE)

# Network: paths de telemetría/tracking que pasan el filtro de background.js
# por coincidencia de substring con el root domain.
_NOISE_NETWORK_RE = re.compile(
    r"/pixel|/beacon|/collect(\?|$)|/track(\?|$)|"
    r"/telemetry|/metrics(\?|$)|/stat(s)?(\?|$)|"
    r"/gen_204|/ping(\?|$)|/log(\?|$)|heartbeat|"
    r"/melidata|snoopy\.|ces/v1|ces/statsc|"
    r"longpolling|longpoll|webchannel|/_/|"
    r"clients\d+\.google\.com|"
    r"/recommendations\?|/adn/api|/api/stats|"
    r"/scripts/|/spreadsheets/|/drive/log|"
    r"\.(js|css|woff2?|ttf|otf|eot|png|jpg|jpeg|gif|webp|svg|ico|wasm|map)(\?|$)",
    re.IGNORECASE,
)

# element_read: texto que es solo dígitos (paginación)
_PAGINATION_RE = re.compile(r"^\d+$")
# breadcrumb: solo minúsculas/espacios sin precio ni mayúsculas
_BREADCRUMB_RE = re.compile(r"^[a-záéíóúüñ\s]+$", re.IGNORECASE)
# precio: contiene moneda o número con separador
_PRICE_RE      = re.compile(r"[\$€£]|^\d[\d\.,]+$")

# Hover: tags que vale la pena registrar y umbral mínimo
_HOVER_KEEP_TAGS = {"H1", "H2", "H3", "H4", "A", "BUTTON", "SPAN", "IMG",
                    "INPUT", "SELECT", "LABEL"}
_HOVER_MIN_MS    = 800

# Scroll: gap máximo para considerar una ráfaga continua
_SCROLL_GAP_S = 2.0


# ── Helpers de acceso ─────────────────────────────────────────────────────────

def _type(ev):       return ev.get("type", "")
def _data(ev):       return ev.get("data", {}) or {}
def _url(ev):        return _data(ev).get("url", "")
def _xpath(ev):
    data = _data(ev)
    selectors = data.get("selectors") or {}
    return selectors.get("xpath") or data.get("xpath", "")


# ── Transforms ────────────────────────────────────────────────────────────────

def drop_noise_types(events):
    """Descarta eventos cuyo tipo no aporta nada (focus/blur/keydown)."""
    return [e for e in events if _type(e) not in _DROP_TYPES]


def drop_redirect_pages(events):
    """Descarta page_load/page_summary/screenshot en redirects (google.com/url)."""
    out = []
    for e in events:
        if _type(e) in ("page_load", "page_summary", "screenshot"):
            if _REDIRECT_DOMAINS_RE.match(_url(e)):
                continue
        out.append(e)
    return out


def drop_short_page_summary(events, min_ms=500):
    """Descarta page_summary con duration_ms muy corto (bounce/redirect)."""
    return [
        e for e in events
        if _type(e) != "page_summary" or _data(e).get("duration_ms", 0) >= min_ms
    ]


def filter_network(events):
    """Descarta network requests de telemetría/recursos estáticos."""
    return [
        e for e in events
        if _type(e) != "network" or not _NOISE_NETWORK_RE.search(_url(e))
    ]


def _is_relevant_element_read(data):
    """Mantiene element_read solo si no es breadcrumb ni paginación."""
    tag  = data.get("tag", "")
    text = (data.get("text") or "").strip()
    if tag != "A":
        return True
    if _PAGINATION_RE.match(text):
        return False
    if _BREADCRUMB_RE.match(text) and not _PRICE_RE.search(text):
        return False
    return True


def filter_element_read(events):
    """Descarta breadcrumbs/paginación y deduplica por (xpath, url)."""
    seen = set()
    out  = []
    for e in events:
        if _type(e) != "element_read":
            out.append(e)
            continue
        data = _data(e)
        if not _is_relevant_element_read(data):
            continue
        key = (_xpath(e), data.get("url", ""))
        if key in seen:
            continue
        seen.add(key)
        out.append(e)
    return out


def filter_hover(events):
    """Mantiene solo hovers sobre tags semánticos con texto real y duración >= umbral."""
    out = []
    for e in events:
        if _type(e) != "hover":
            out.append(e)
            continue
        data = _data(e)
        if data.get("duration_ms", 0) < _HOVER_MIN_MS:
            continue
        if data.get("tag", "") not in _HOVER_KEEP_TAGS:
            continue
        text = (data.get("text") or "").strip()
        aria = data.get("aria", "")
        if not text and not aria:
            continue
        if not re.sub(r"[\xa0\s]+", "", text):
            continue
        out.append(e)
    return out


def filter_reading_pause(events, min_pct=5):
    """Descarta reading_pause cerca del tope de la página (ruido de navegación)."""
    return [
        e for e in events
        if _type(e) != "reading_pause" or _data(e).get("scroll_pct", 0) >= min_pct
    ]


# Tope de elementos en un reading_pause. La extensión nueva ya tiene su propio cap
# (PAUSE_MAX_ELEMENTS en content.js), pero esto protege sesiones viejas y sirve
# como segunda línea de defensa contra DOMs anómalos.
_READING_PAUSE_MAX_ELEMENTS = 25


def cap_reading_pause_elements(events):
    """Trunca el array `elements` de reading_pause a un tope razonable."""
    out = []
    for e in events:
        if _type(e) != "reading_pause":
            out.append(e)
            continue
        data = dict(_data(e))
        elements = data.get("elements") or []
        if len(elements) > _READING_PAUSE_MAX_ELEMENTS:
            data["elements"] = elements[:_READING_PAUSE_MAX_ELEMENTS]
            data["elements_truncated_from"] = len(elements)
        out.append({**e, "data": data})
    return out


def _compress_scroll_group(group):
    """Convierte N eventos de scroll contiguos en un único scroll_summary."""
    first      = group[0]
    last       = group[-1]
    first_data = _data(first)
    last_data  = _data(last)
    is_browser = "from_y" in first_data

    if is_browser:
        total_dy  = last_data.get("to_y", 0) - first_data.get("from_y", 0)
        total_dx  = 0
        direction = last_data.get("direction", "down")
        extra = {
            "from_y":       first_data.get("from_y"),
            "to_y":         last_data.get("to_y"),
            "viewport_pct": last_data.get("viewport_pct"),
            "url":          last_data.get("url", ""),
        }
    else:
        total_dy = sum(_data(e).get("delta_y", 0) for e in group)
        total_dx = sum(_data(e).get("delta_x", 0) for e in group)
        direction = "down" if total_dy < 0 else "up" if total_dy > 0 else "horizontal"
        extra = {
            "app":          first_data.get("app", ""),
            "window_title": first_data.get("window_title", ""),
        }

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
            **extra,
        },
    }


def compress_scroll(events):
    """Agrupa ráfagas de scroll contiguas y descarta scrolls sin movimiento neto."""
    out = []
    i = 0
    while i < len(events):
        if _type(events[i]) != "scroll":
            out.append(events[i])
            i += 1
            continue

        group = [events[i]]
        j = i + 1
        while j < len(events) and _type(events[j]) == "scroll" \
                and events[j]["time"] - group[-1]["time"] <= _SCROLL_GAP_S:
            group.append(events[j])
            j += 1

        summary = _compress_scroll_group(group)
        d = summary["data"]
        has_movement = (
            d["delta_y"] != 0
            or d["delta_x"] != 0
            or (d.get("from_y") is not None and d.get("from_y") != d.get("to_y"))
        )
        if has_movement:
            out.append(summary)
        i = j
    return out


# ── Pipeline ──────────────────────────────────────────────────────────────────

PIPELINE = [
    drop_noise_types,
    drop_redirect_pages,
    drop_short_page_summary,
    filter_network,
    filter_element_read,
    filter_hover,
    filter_reading_pause,
    cap_reading_pause_elements,
    compress_scroll,
]


def compress(events):
    """Aplica la PIPELINE en orden. Cada transform es independiente y testeable."""
    for transform in PIPELINE:
        events = transform(events)
    return events


# ── Reshape: acciones vs contenido de página ───────────────────────────────────

_ACTION_TYPES = {
    "click", "double_click", "drag",
    "typed", "shortcut", "key",
    "input", "hover",
    "text_select", "copy", "paste",
    "scroll_summary",
    "speech", "screenshot",
    "page_load", "spa_navigation", "hash_navigation",
    "api_response",
}

def reshape(events):
    """
    Reorganiza la lista filtrada en { actions, pages }.

      actions — lo que el usuario hizo, en orden cronológico. Cada acción
                lleva `page_index` apuntando a la página activa al momento.
                page_load / spa_navigation actúan como anclas temporales.

      pages   — una entrada por URL visitada (por tab) con contexto
                estructurado: JSON-LD / meta / headings (context),
                elementos leídos, pausas de lectura, network calls y
                datos de page_summary.

    Multi-tab: cada `tab_id` mantiene su propia "página activa". Eventos
    sin tab_id (system events legacy) caen al último page global.
    """
    actions = []
    pages   = []
    current_by_tab = {}  # tab_id -> page dict activa en ese tab
    last_page = None     # última página abierta (cualquier tab), fallback

    def _close_page(page, t_exit=None):
        if page is None:
            return
        if t_exit and "time_exit" not in page:
            page["time_exit"] = t_exit
        page.pop("_seen", None)
        for key in ("elements_read", "reading_pauses", "network"):
            if not page.get(key):
                page.pop(key, None)
        if not page.get("context"):
            page.pop("context", None)
        pages.append(page)

    def _resolve_page(tab_id):
        """Página activa para un evento: por tab si está, sino la última global."""
        if tab_id is not None and tab_id in current_by_tab:
            return current_by_tab[tab_id]
        return last_page

    for event in events:
        etype  = _type(event)
        data   = _data(event)
        tab_id = data.get("tab_id")

        # 1. Lifecycle de páginas — page_load / spa_navigation abren una nueva
        if etype in ("page_load", "spa_navigation"):
            prev = current_by_tab.pop(tab_id, None)
            _close_page(prev, event["time"])
            new_page = {
                "url":        data.get("url", ""),
                "title":      data.get("title", ""),
                "time_enter": event["time"],
                "context":    data.get("context"),
                "elements_read":  [],
                "reading_pauses": [],
                "network":        [],
                "_seen":          set(),
            }
            if tab_id is not None:
                new_page["tab_id"] = tab_id
            current_by_tab[tab_id] = new_page
            last_page = new_page
            # fall-through: page_load/spa_navigation también van a actions

        # 2. Eventos de contenido de página (no se duplican en actions)
        if etype == "page_summary":
            page = _resolve_page(tab_id)
            if page is not None:
                page["time_exit"]   = event["time"]
                page["duration_ms"] = data.get("duration_ms")
                for field in ("h1", "price", "availability", "buttons", "sections"):
                    if data.get(field):
                        page[field] = data[field]
            continue

        if etype == "element_read":
            page = _resolve_page(tab_id)
            if page is not None:
                key = (_xpath(event), _url(event))
                if key not in page["_seen"]:
                    page["_seen"].add(key)
                    entry = {"tag": data.get("tag", ""), "text": " ".join((data.get("text") or "").split())}
                    if data.get("aria"):     entry["aria"]     = data["aria"]
                    if data.get("href"):     entry["href"]     = data["href"]
                    if data.get("dwell_ms"): entry["dwell_ms"] = data["dwell_ms"]
                    page["elements_read"].append(entry)
            continue

        if etype == "reading_pause":
            page = _resolve_page(tab_id)
            if page is not None:
                page["reading_pauses"].append({
                    "time":       event["time"],
                    "scroll_pct": data.get("scroll_pct"),
                    "elements":   [
                        {k: v for k, v in {"tag": e.get("tag"), "text": e.get("text")}.items() if v}
                        for e in data.get("elements", [])
                    ],
                })
            continue

        if etype == "network":
            page = _resolve_page(tab_id)
            if page is not None:
                net_url = data.get("url", "")
                if not _REDIRECT_DOMAINS_RE.match(net_url):
                    page["network"].append({
                        "time":   event["time"],
                        "method": data.get("method", ""),
                        "url":    net_url,
                        "status": data.get("status"),
                    })
            continue

        # 3. Acciones del usuario — anotamos referencia a página activa
        if etype in _ACTION_TYPES:
            page = _resolve_page(tab_id)
            if etype in ("page_load", "spa_navigation"):
                action = {
                    "time":   event["time"],
                    "source": event.get("source"),
                    "type":   etype,
                    "data":   {
                        "url":      data.get("url", ""),
                        "title":    data.get("title", ""),
                        "referrer": data.get("referrer", ""),
                    },
                }
            else:
                action = dict(event)
            action["_page_ref"] = page
            actions.append(action)

    # Cerrar páginas todavía abiertas al final de la sesión
    for page in list(current_by_tab.values()):
        _close_page(page)
    current_by_tab.clear()

    # Resolver page_index: map id(page) -> índice en `pages`
    page_to_idx = {id(p): i for i, p in enumerate(pages)}
    for action in actions:
        ref = action.pop("_page_ref", None)
        if ref is not None:
            idx = page_to_idx.get(id(ref))
            if idx is not None:
                action["page_index"] = idx

    return {"actions": actions, "pages": pages}


# ── Entrada desde archivo ─────────────────────────────────────────────────────

def compress_session(session_dir):
    input_path  = f"{session_dir}/session.json"
    output_path = f"{session_dir}/session_compressed.json"

    with open(input_path, encoding="utf-8") as f:
        events = json.load(f)

    original  = len(events)
    filtered  = compress(events)
    reduced   = len(filtered)
    pct       = round((1 - reduced / original) * 100) if original else 0

    result    = reshape(filtered)
    n_actions = len(result["actions"])
    n_pages   = len(result["pages"])

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2, ensure_ascii=False)

    print(f"[ZIP] {original} -> {reduced} eventos  ({pct}% reduccion)")
    print(f"[OK] {n_actions} acciones | {n_pages} paginas -> {output_path}")

    return output_path


# ── CLI — reprocesar una sesión ya grabada ────────────────────────────────────
#
# Uso:
#   python -m compressor <session_dir>
#   python compressor.py <session_dir>
#
# Útil cuando tocamos transforms o reshape() y queremos regenerar el
# session_compressed.json sin volver a grabar.

if __name__ == "__main__":
    import sys
    import os

    if len(sys.argv) != 2:
        print("Uso: python -m compressor <session_dir>")
        sys.exit(1)

    session_dir = sys.argv[1]
    if not os.path.isdir(session_dir):
        print(f"[ERR] No existe el directorio: {session_dir}")
        sys.exit(1)

    if not os.path.isfile(f"{session_dir}/session.json"):
        print(f"[ERR] Falta session.json en: {session_dir}")
        sys.exit(1)

    compress_session(session_dir)
