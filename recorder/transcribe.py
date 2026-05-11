import whisper


def transcribe_audio(audio_path, model_size="small", language=None):
    print(f"[WHISPER] Cargando modelo '{model_size}'...")
    model = whisper.load_model(model_size)

    print("Transcribiendo...")
    result = model.transcribe(audio_path, language=language)  # None → autodetect

    segments = [
        {
            "time":   round(seg["start"], 3),
            "source": "speech",                  # ← consistente con el resto de eventos
            "type":   "speech",
            "data": {
                "text": seg["text"].strip(),
                "end":  round(seg["end"], 3),
            },
        }
        for seg in result["segments"]
    ]

    return segments
