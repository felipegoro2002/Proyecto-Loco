import subprocess
import re

def get_default_microphone():
    try:
        result = subprocess.run(
            ["ffmpeg", "-list_devices", "true", "-f", "dshow", "-i", "dummy"],
            stderr=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
            text=True,
            encoding="utf-8",
            errors="replace"
        )
        for line in result.stderr.splitlines():
            if "(audio)" in line:
                match = re.search(r'"([^"]+)"', line)
                if match:
                    name = match.group(1)
                    print(f"[MIC] Microfono detectado: {name}")
                    return name
    except Exception as e:
        print(f"[WARN] Error detectando microfono: {e}")
    return None

def start_video_recording(output_path):
    mic = get_default_microphone()

    cmd = [
        "ffmpeg",
        "-y",
        "-f", "gdigrab",
        "-i", "desktop",
    ]

    if mic:
        cmd += ["-f", "dshow", "-i", f"audio={mic}"]
    else:
        print("[WARN] No se encontro microfono. Grabando solo video.")

    cmd += [
        "-vcodec", "libx264",
        "-preset", "ultrafast",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        output_path
    ]

    return subprocess.Popen(
        cmd,
        stdin=subprocess.PIPE,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL
    )


def stop_video_recording(process):
    try:
        process.stdin.write(b"q")
        process.stdin.flush()
        process.wait(timeout=10)
    except Exception as e:
        print(f"[WARN] Error deteniendo grabacion: {e}")
        process.kill()


def extract_audio(video_path, audio_path):
    cmd = [
        "ffmpeg",
        "-y",
        "-i", video_path,
        "-vn",
        "-acodec", "pcm_s16le",
        "-ar", "16000",
        "-ac", "1",
        audio_path
    ]

    result = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)

    if result.returncode == 0:
        print(f"[OK] Audio extraido en: {audio_path}")
        return True
    else:
        print("[WARN] No se pudo extraer audio (puede que el video no tenga pista de audio).")
        return False