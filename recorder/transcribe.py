import whisper

def transcribe_audio(audio_path):
    print("Cargando modelo Whisper...")
    model = whisper.load_model("base")

    print("Transcribiendo...")
    result = model.transcribe(audio_path, language="es")

    segments = [
        {
            "time": round(seg["start"], 3),
            "type": "speech",
            "data": {
                "text": seg["text"].strip(),
                "end": round(seg["end"], 3)
            }
        }
        for seg in result["segments"]
    ]

    return segments