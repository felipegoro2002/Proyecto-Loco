# recorder/main.py

import threading

from event_manager import EventManager
from input_listener import start_listeners
from browser_server import create_app
from video_recorder import start_video_recording, stop_video_recording
from video_recorder import extract_audio
from transcribe import transcribe_audio

def record_session():
    manager = EventManager()

    # 🖱️ inputs
    start_listeners(manager)

    # 🌐 servidor extensión
    app = create_app(manager)
    server_thread = threading.Thread(
        target=lambda: app.run(port=5000)
    )
    server_thread.daemon = True
    server_thread.start()

    # 🎥 video
    video_path = f"{manager.session_dir}/screen.mp4"
    video_proc = start_video_recording(video_path)

    print("\n🔴 Grabando sesión...")
    print("👉 Presiona ENTER para detener\n")

    input()  # 👈 aquí esperas al usuario

    print("⏹️ Deteniendo grabación...")

    # detener video correctamente
    stop_video_recording(video_proc)

    # guardar eventos
    session_path = manager.save()

    video_path = f"{session_path}/screen.mp4"
    audio_path = f"{session_path}/audio.wav"

    extract_audio(video_path, audio_path)

    # 🧠 TRANSCRIBIR
    transcript = transcribe_audio(audio_path)

    # 💾 guardar texto
    with open(f"{session_path}/transcript.txt", "w", encoding="utf-8") as f:
        f.write(transcript)

    print("✅ Sesión guardada en:", session_path)

    return session_path


if __name__ == "__main__":
    record_session()