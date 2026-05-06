from pynput import mouse, keyboard
import win32gui
import win32process
import psutil
import threading
import time
import ctypes


# ── Ventana activa ─────────────────────────────────────────────────────────────

def _get_window_title(hwnd):
    """Obtiene el título usando GetWindowTextW (Unicode nativo) vía ctypes."""
    length = ctypes.windll.user32.GetWindowTextLengthW(hwnd)
    if length == 0:
        return ""
    buf = ctypes.create_unicode_buffer(length + 1)
    ctypes.windll.user32.GetWindowTextW(hwnd, buf, length + 1)
    return buf.value


def get_active_window():
    """Devuelve el proceso y título de la ventana que tiene el foco."""
    try:
        hwnd  = win32gui.GetForegroundWindow()
        title = _get_window_title(hwnd)
        _, pid = win32process.GetWindowThreadProcessId(hwnd)
        app   = psutil.Process(pid).name()
        return {"app": app, "window_title": title}
    except Exception:
        return {"app": "unknown", "window_title": ""}


# ── Teclas de modificación y especiales ────────────────────────────────────────

_MODIFIERS = {
    keyboard.Key.ctrl,   keyboard.Key.ctrl_l,  keyboard.Key.ctrl_r,
    keyboard.Key.alt,    keyboard.Key.alt_l,   keyboard.Key.alt_r,
    keyboard.Key.shift,  keyboard.Key.shift_l, keyboard.Key.shift_r,
    keyboard.Key.cmd,    keyboard.Key.cmd_l,   keyboard.Key.cmd_r,
}

_SPECIAL = {
    keyboard.Key.enter:     "Enter",
    keyboard.Key.tab:       "Tab",
    keyboard.Key.esc:       "Escape",
    keyboard.Key.backspace: "Backspace",
    keyboard.Key.delete:    "Delete",
    keyboard.Key.space:     " ",
    keyboard.Key.up:        "ArrowUp",
    keyboard.Key.down:      "ArrowDown",
    keyboard.Key.left:      "ArrowLeft",
    keyboard.Key.right:     "ArrowRight",
    keyboard.Key.home:      "Home",
    keyboard.Key.end:       "End",
    keyboard.Key.page_up:   "PageUp",
    keyboard.Key.page_down: "PageDown",
    keyboard.Key.f1:  "F1",  keyboard.Key.f2:  "F2",  keyboard.Key.f3:  "F3",
    keyboard.Key.f4:  "F4",  keyboard.Key.f5:  "F5",  keyboard.Key.f6:  "F6",
    keyboard.Key.f7:  "F7",  keyboard.Key.f8:  "F8",  keyboard.Key.f9:  "F9",
    keyboard.Key.f10: "F10", keyboard.Key.f11: "F11", keyboard.Key.f12: "F12",
}

# Umbral para considerar dos clicks como doble-click
_DOUBLE_CLICK_MS  = 500
_DOUBLE_CLICK_PX  = 10

# Umbral para considerar movimiento como drag
_DRAG_THRESHOLD_PX = 8


# ── Listeners ──────────────────────────────────────────────────────────────────

def start_listeners(manager):
    pressed_modifiers = set()
    text_buffer       = []
    flush_timer       = None
    buffer_lock       = threading.Lock()

    # Estado para doble-click
    last_click = {"t": 0.0, "x": 0, "y": 0, "button": None}

    # Estado para drag
    drag_state = {"active": False, "dragging": False,
                  "x": 0, "y": 0, "t": 0.0}

    # ── Helpers ──────────────────────────────────────────────────────────────

    def active_modifiers():
        mods = []
        if pressed_modifiers & {keyboard.Key.ctrl, keyboard.Key.ctrl_l, keyboard.Key.ctrl_r}:
            mods.append("Ctrl")
        if pressed_modifiers & {keyboard.Key.alt, keyboard.Key.alt_l, keyboard.Key.alt_r}:
            mods.append("Alt")
        if pressed_modifiers & {keyboard.Key.shift, keyboard.Key.shift_l, keyboard.Key.shift_r}:
            mods.append("Shift")
        if pressed_modifiers & {keyboard.Key.cmd, keyboard.Key.cmd_l, keyboard.Key.cmd_r}:
            mods.append("Win")
        return mods

    def flush_buffer(window=None):
        nonlocal flush_timer
        with buffer_lock:
            if flush_timer:
                flush_timer.cancel()
                flush_timer = None
            if not text_buffer:
                return
            text = "".join(text_buffer)
            text_buffer.clear()
        manager.add_event("system", "typed", {
            "text": text,
            **(window or get_active_window()),
        })

    def schedule_flush(delay=1.2):
        nonlocal flush_timer
        if flush_timer:
            flush_timer.cancel()
        t = threading.Timer(delay, flush_buffer)
        t.daemon = True
        t.start()
        flush_timer = t

    # ── Teclado ───────────────────────────────────────────────────────────────

    def on_press(key):
        if key in _MODIFIERS:
            pressed_modifiers.add(key)
            return

        mods   = active_modifiers()
        window = get_active_window()

        # Shortcut con modificadores (Ctrl+C, Alt+Tab, Ctrl+Shift+T…)
        if mods:
            flush_buffer(window)
            if key in _SPECIAL:
                key_name = _SPECIAL[key].replace(" ", "Space")
            else:
                try:
                    key_name = (key.char or str(key)).upper()
                except AttributeError:
                    key_name = str(key)
            manager.add_event("system", "shortcut", {
                "keys": "+".join(mods + [key_name]),
                **window,
            })
            return

        if key == keyboard.Key.space:
            with buffer_lock:
                text_buffer.append(" ")
            schedule_flush(1.5)
            return

        if key == keyboard.Key.backspace:
            with buffer_lock:
                if text_buffer:
                    text_buffer.pop()
                    schedule_flush(1.2)
            return

        if key == keyboard.Key.enter:
            flush_buffer(window)
            manager.add_event("system", "key", {"key": "Enter", **window})
            return

        if key in _SPECIAL:
            flush_buffer(window)
            manager.add_event("system", "key", {"key": _SPECIAL[key], **window})
            return

        # Carácter imprimible → acumular
        try:
            char = key.char
            if char:
                with buffer_lock:
                    text_buffer.append(char)
                schedule_flush(1.2)
        except AttributeError:
            pass

    def on_release(key):
        pressed_modifiers.discard(key)

    # ── Mouse — click / doble-click ───────────────────────────────────────────

    def on_click(x, y, button, pressed):
        btn_str = str(button)

        if pressed:
            # Registrar inicio para detección de drag
            drag_state.update({
                "active":   True,
                "dragging": False,
                "x": x, "y": y,
                "t": time.time(),
            })

            flush_buffer()
            window = get_active_window()
            now    = time.time()

            # ¿Doble-click?
            is_double = (
                btn_str == last_click["button"]
                and (now - last_click["t"]) * 1000 < _DOUBLE_CLICK_MS
                and abs(x - last_click["x"]) < _DOUBLE_CLICK_PX
                and abs(y - last_click["y"]) < _DOUBLE_CLICK_PX
            )

            event_type = "double_click" if is_double else "click"
            manager.add_event("system", event_type, {
                "x": x, "y": y, "button": btn_str, **window,
            })

            last_click.update({"t": now, "x": x, "y": y, "button": btn_str})

        else:
            # Botón soltado → ¿fue drag?
            if drag_state["active"] and drag_state["dragging"]:
                window = get_active_window()
                manager.add_event("system", "drag", {
                    "from_x":     drag_state["x"],
                    "from_y":     drag_state["y"],
                    "to_x":       x,
                    "to_y":       y,
                    "button":     btn_str,
                    "duration_ms": round((time.time() - drag_state["t"]) * 1000),
                    **window,
                })
            drag_state["active"]   = False
            drag_state["dragging"] = False

    # ── Mouse — movimiento (detecta drag) ────────────────────────────────────

    def on_move(x, y):
        if drag_state["active"] and not drag_state["dragging"]:
            dx = abs(x - drag_state["x"])
            dy = abs(y - drag_state["y"])
            if dx > _DRAG_THRESHOLD_PX or dy > _DRAG_THRESHOLD_PX:
                drag_state["dragging"] = True

    # ── Mouse — scroll ────────────────────────────────────────────────────────

    def on_scroll(x, y, dx, dy):
        window = get_active_window()
        manager.add_event("system", "scroll", {
            "x":         x,
            "y":         y,
            "delta_x":   dx,
            "delta_y":   dy,
            "direction": "down" if dy < 0 else "up",
            **window,
        })

    # ── Iniciar ───────────────────────────────────────────────────────────────

    mouse.Listener(
        on_click=on_click,
        on_move=on_move,
        on_scroll=on_scroll,
    ).start()

    keyboard.Listener(
        on_press=on_press,
        on_release=on_release,
    ).start()
