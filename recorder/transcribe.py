import whisper

def transcribe_audio(audio_path):
    print("Cargando modelo Whisper...")
    model = whisper.load_model("base")

    print("Transcribiendo...")
    result = model.transcribe(audio_path, language="es")

    text = result["text"]

    print("\nTranscripción:\n", text)

    return text