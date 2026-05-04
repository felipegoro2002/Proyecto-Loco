# recorder/main.py

import threading
import sys

from event_manager import EventManager
from input_listener import start_listeners
from browser_server import create_app
from video_recorder import start_video_recording, stop_video_recording, extract_audio
from transcribe import transcribe_audio
import json

def record_session():
    manager = EventManager()

    # 🖱️ inputs
    start_listeners(manager)

    # 🌐 servidor extensión
    app = create_app(manager)
    server_thread = threading.Thread(
        target=lambda: app.run(port=5000, use_reloader=False)
    )
    server_thread.daemon = True
    server_thread.start()

    # 🎥 video (micrófono detectado automáticamente)
    video_path = f"{manager.session_dir}/screen.mp4"
    video_proc = start_video_recording(video_path)

    print("\n🔴 Grabando sesión...")
    print("👉 Presiona ENTER para detener\n")

    try:
        input()
    except KeyboardInterrupt:
        print("\n⚠️ Interrumpido por Ctrl+C")

    print("⏹️ Deteniendo grabación...")

    stop_video_recording(video_proc)

    session_path = manager.save()
    print(f"📁 Eventos guardados: {len(manager.events)}")

    video_path = f"{session_path}/screen.mp4"
    audio_path = f"{session_path}/audio.wav"

    audio_ok = extract_audio(video_path, audio_path)

    if audio_ok:
        speech_events = transcribe_audio(audio_path)
        merged = sorted(manager.events + speech_events, key=lambda e: e["time"])
        with open(f"{session_path}/session.json", "w", encoding="utf-8") as f:
            json.dump(merged, f, indent=2, ensure_ascii=False)
        print(f"📝 Sesión unificada guardada ({len(merged)} eventos).")
    else:
        with open(f"{session_path}/session.json", "w", encoding="utf-8") as f:
            json.dump(manager.events, f, indent=2, ensure_ascii=False)
        print("⏭️ Transcripción omitida (no hay audio).")

    print("✅ Sesión guardada en:", session_path)


if __name__ == "__main__":
    record_session()
