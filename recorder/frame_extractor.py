import subprocess
import os

# Intervalo por defecto para frames ambientales (segundos)
DEFAULT_INTERVAL_S = 10


def _ffmpeg_frame(video_path, t_s, out_path):
    """Extrae un frame del video en el segundo t_s y lo guarda como JPEG."""
    cmd = [
        "ffmpeg", "-y",
        "-ss", str(max(0.0, t_s)),
        "-i", video_path,
        "-vframes", "1",
        "-q:v", "3",        # calidad JPEG: 1=mejor, 31=peor
        out_path
    ]
    result = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return result.returncode == 0 and os.path.exists(out_path)


def extract_frames(video_path, events, session_dir, interval_s=DEFAULT_INTERVAL_S):
    """
    Extrae frames del video y genera eventos 'screenshot'.

    Criterios:
      1. page_load  → frame al momento en que cargo la pagina
      2. speech     → frame al inicio de cada frase del usuario
      3. Ambient    → un frame cada interval_s segundos (contexto visual)

    Parametros:
      video_path   ruta al screen.mp4
      events       lista de eventos (session.json ya mergeado con speech)
      session_dir  carpeta de la sesion
      interval_s   segundos entre frames ambientales (default 10)

    Retorna lista de eventos 'screenshot' para agregar al session.json.
    """
    frames_dir = os.path.join(session_dir, "frames")
    os.makedirs(frames_dir, exist_ok=True)

    times_all = [e["time"] for e in events if "time" in e]
    if not times_all:
        return []

    duration = max(times_all)

    # ── Momentos a capturar ────────────────────────────────────────────────────
    # dict: tiempo_redondeado → {"trigger": ..., "url": ..., "text": ...}
    captures = {}

    # 1. page_load
    for e in events:
        if e.get("type") == "page_load":
            t   = round(e["time"], 1)
            url = e.get("data", {}).get("url", "")
            captures[t] = {"trigger": "page_load", "url": url, "text": ""}

    # 2. speech — frame al inicio de cada frase del usuario
    for e in events:
        if e.get("type") == "speech":
            t    = round(e["time"], 1)
            text = e.get("data", {}).get("text", "")
            # Si ya hay un capture muy cercano (<1s) lo reemplazamos con prioridad speech
            captures[t] = {"trigger": "speech", "url": "", "text": text}

    # 3. Ambient — cada interval_s segundos
    t = 0.0
    while t <= duration + 0.1:
        key = round(t, 1)
        if key not in captures:
            captures[key] = {"trigger": "ambient", "url": "", "text": ""}
        t += interval_s

    # ── Extraer frames ────────────────────────────────────────────────────────
    screenshot_events = []

    for t_s in sorted(captures):
        meta  = captures[t_s]
        fname = f"frame_{t_s:.1f}.jpg"
        fpath = os.path.join(frames_dir, fname)

        ok = _ffmpeg_frame(video_path, t_s, fpath)
        if not ok:
            print(f"[WARN] No se pudo extraer frame en t={t_s}s")
            continue

        data = {
            "frame":   f"frames/{fname}",
            "trigger": meta["trigger"],
        }
        if meta["url"]:
            data["url"] = meta["url"]
        if meta["text"]:
            data["text"] = meta["text"]

        screenshot_events.append({
            "time":   t_s,
            "source": "video",
            "type":   "screenshot",
            "data":   data,
        })

        print(f"[FRAME] {fname}  ({meta['trigger']})")

    print(f"[OK] {len(screenshot_events)} frames extraidos en {frames_dir}")
    return screenshot_events
