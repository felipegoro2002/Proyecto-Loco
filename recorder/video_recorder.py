import subprocess

def get_default_microphone():
    """
    Detecta automáticamente el primer micrófono disponible en Windows
    usando ffmpeg -list_devices. Retorna None si no hay ninguno.
    """
    try:
        result = subprocess.run(
            ["ffmpeg", "-list_devices", "true", "-f", "dshow", "-i", "dummy"],
            stderr=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
            text=True,
            encoding="utf-8",
            errors="replace"
        )
        output = result.stderr

        in_audio = False
        for line in output.splitlines():
            if "DirectShow audio devices" in line:
                in_audio = True
                continue
            if in_audio:
                match = re.search(r'"([^"]+)"', line)
                if match:
                    name = match.group(1)
                    print(f"🎤 Micrófono detectado: {name}")
                    return name

    except Exception as e:
        print(f"⚠️ Error detectando micrófono: {e}")

    return None

def start_video_recording(output_path):
    cmd = [
        "ffmpeg",
        "-y",
        "-f", "gdigrab",
        "-i", "desktop",
        "-f", "dshow",
        "-i", "audio=Microphone Array (Intel® Smart Sound Technology for Digital Microphones)",
        "-vcodec", "libx264",
        "-preset", "ultrafast",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        output_path
    ]

    return subprocess.Popen(cmd, stdin=subprocess.PIPE)

def stop_video_recording(process):
    process.stdin.write(b"q")
    process.stdin.flush()
    process.wait()

def extract_audio(video_path, audio_path):
    cmd = [
        "ffmpeg",
        "-y",
        "-i", video_path,
        "-vn",
        "-acodec", "pcm_s16le",
        "-ar", "16000",
        "-ac", "1",           # mono
        audio_path
    ]

    subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    print(f"Audio extraído en: {audio_path}")