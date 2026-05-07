# recorder/main.py

import threading
import json

from event_manager import EventManager
from input_listener import start_listeners
from browser_server import create_app
from video_recorder import start_video_recording, stop_video_recording, extract_audio
from transcribe import transcribe_audio
from compressor import compress_session
from frame_extractor import extract_frames


def record_session(frame_interval_s=10):
    manager = EventManager()
    session_dir = manager.get_dir()

    # inputs
    start_listeners(manager)

    # servidor extension
    app = create_app(manager)
    server_thread = threading.Thread(
        target=lambda: app.run(port=5000, use_reloader=False)
    )
    server_thread.daemon = True
    server_thread.start()

    # video (microfono detectado automaticamente)
    video_path = f"{session_dir}/screen.mp4"
    video_proc = start_video_recording(video_path)

    print("\n[REC] Grabando sesion...")
    print(">>> Presiona ENTER para detener\n")

    try:
        input()
    except KeyboardInterrupt:
        print("\n[WARN] Interrumpido por Ctrl+C")

    print("[STOP] Deteniendo grabacion...")
    stop_video_recording(video_proc)

    # ── Construir session.json ────────────────────────────────────────────────
    audio_path = f"{session_dir}/audio.wav"
    audio_ok   = extract_audio(video_path, audio_path)

    if audio_ok:
        speech_events = transcribe_audio(audio_path)
        events = sorted(manager.events + speech_events, key=lambda e: e["time"])
        print(f"[OK] Eventos totales: {len(events)} ({len(speech_events)} de audio)")
    else:
        events = manager.events
        print("[SKIP] Transcripcion omitida (no hay audio).")

    # ── Extraer frames del video ──────────────────────────────────────────────
    print(f"[FRAME] Extrayendo frames (intervalo: {frame_interval_s}s)...")
    screenshot_events = extract_frames(video_path, events, session_dir, frame_interval_s)
    if screenshot_events:
        events = sorted(events + screenshot_events, key=lambda e: e["time"])

    session_file = f"{session_dir}/session.json"
    with open(session_file, "w", encoding="utf-8") as f:
        json.dump(events, f, indent=2, ensure_ascii=False)

    print(f"[OK] Sesion guardada en: {session_dir}  ({len(events)} eventos)")

    # ── Comprimir para la IA ──────────────────────────────────────────────────
    compress_session(session_dir)


if __name__ == "__main__":
    record_session()
