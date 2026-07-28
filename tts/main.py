from kokoro import KPipeline
import soundfile as sf
import numpy as np
from fastapi import FastAPI, Request, HTTPException, Response
import io

app = FastAPI()
pipeline = KPipeline(lang_code='a')

@app.post("/upload")
async def upload_audio(request: Request):
    raw_data = await request.body()
    text_data = raw_data.decode("utf-8")
    if not text_data:
        raise HTTPException(status_code=400, detail="No text data received")

    generator = pipeline(text_data, voice='af_heart')

    # Collect all audio chunks in a list
    audio_chunks = []
    for i, (gs, ps, audio) in enumerate(generator):
        print(f"Chunk {i}: {gs} | {ps}")
        audio_chunks.append(audio)

    if not audio_chunks:
        raise HTTPException(status_code=500, detail="No audio generated")

    # Concatenate all chunks into a single numpy array
    full_audio = np.concatenate(audio_chunks)

    # Write to in-memory buffer as WAV
    buffer = io.BytesIO()
    sf.write(buffer, full_audio, 24000, format='WAV')
    buffer.seek(0)

    # Return raw audio bytes with correct media type
    return Response(content=buffer.read(), media_type="audio/wav")
