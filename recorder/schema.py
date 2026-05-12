"""
Schema de eventos centralizado.

Cada tipo declara los campos que tiene permitido tener en `data`.
event_manager pasa cada evento por `clean_event_data` antes de guardarlo —
elimina campos desconocidos (ruido), preserva la forma del JSON.

No es una validación estricta de tipos: solo un whitelist de campos para
mantener `session.json` predecible y limpio para el LLM/Playwright downstream.

Si un tipo no está en el schema, el evento pasa intacto (no se rompe la grabación
si la extensión manda un tipo nuevo; se loguea para que lo agreguemos despues).
"""

# Campos comunes (window context) que pueden venir en cualquier evento system
_WINDOW_FIELDS = ("app", "window_title")

# Campos de elemento DOM (vienen del browser via content.js elInfo())
_ELEMENT_FIELDS = (
    "tag", "text", "role", "aria", "href", "url",
    "selectors", "id_auto", "classes", "data_attrs",
)

# Identificador de pestaña del browser (lo adjunta background.js).
# Permite reconstruir workflows multi-pestaña en el compresor.
_TAB = ("tab_id",)

SCHEMA = {
    # ── system events ─────────────────────────────────────────────────────────
    "typed":         ("text", *_WINDOW_FIELDS),
    "key":           ("key", *_WINDOW_FIELDS),
    "shortcut":      ("keys", *_WINDOW_FIELDS),
    "click":         ("x", "y", "button", *_WINDOW_FIELDS,
                      *_TAB, *_ELEMENT_FIELDS),  # los browser clicks tambien usan este type
    "double_click":  ("x", "y", "button", *_WINDOW_FIELDS),
    "drag":          ("from_x", "from_y", "to_x", "to_y", "button", "duration_ms", *_WINDOW_FIELDS),
    "scroll":        ("x", "y", "delta_x", "delta_y", "direction",
                      "from_y", "to_y", "viewport_pct", "duration_ms", "url",
                      *_WINDOW_FIELDS),
    "scroll_summary": ("direction", "delta_y", "delta_x", "scroll_count", "duration_s",
                       "from_y", "to_y", "viewport_pct", "url", *_WINDOW_FIELDS),

    # ── browser events (content.js) ────────────────────────────────────────────
    "page_load":      (*_TAB, "url", "title", "referrer", "description", "context"),
    "spa_navigation": (*_TAB, "url", "title", "context"),
    "hash_navigation":(*_TAB, "url", "title"),
    "page_summary":   (*_TAB, "url", "title", "duration_ms", "h1",
                       "price", "availability", "buttons", "sections"),
    "input":          (*_TAB, *_ELEMENT_FIELDS, "value", "input_type"),
    "hover":          (*_TAB, *_ELEMENT_FIELDS, "x", "y", "duration_ms"),
    "element_read":   (*_TAB, *_ELEMENT_FIELDS, "dwell_ms"),
    "reading_pause":  (*_TAB, "url", "scroll_pct", "elements"),
    "text_select":    (*_TAB, "selected_text", "url"),
    "copy":           (*_TAB, "text", "url"),
    "paste":          (*_TAB, *_ELEMENT_FIELDS, "text"),
    "network":        (*_TAB, "method", "url", "status", "tab_url"),
    "api_response":   (*_TAB, "url", "body", "page_url"),

    # ── speech / video ─────────────────────────────────────────────────────────
    "speech":      ("text", "end"),
    "screenshot":  ("frame", "trigger", "url", "text"),
}


def clean_event_data(event_type, data):
    """Filtra `data` dejando solo los campos declarados en SCHEMA para ese tipo.

    Si el tipo es desconocido, devuelve `data` intacto (no se pierde info de
    grabación si aparece un evento nuevo).
    """
    if not isinstance(data, dict):
        return data
    allowed = SCHEMA.get(event_type)
    if allowed is None:
        return data
    return {k: v for k, v in data.items() if k in allowed and v not in (None, "", [], {})}


def is_known_type(event_type):
    return event_type in SCHEMA
