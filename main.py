import os
import uuid
import httpx
import subprocess
from pathlib import Path
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles


app = FastAPI()

# Configuration
TRANSCRIPTION_SERVER_URL = "http://homie_whisper:8080/inference"
OLLAMA_HOST_URL = "http://homie_ollama:11434"
TTS_HOST_URL = "http://homie_tts:5001"
LLM_NAME = os.getenv("LLM_NAME")
print("LLM_NAME var:", LLM_NAME)

if LLM_NAME is None:
    raise RuntimeError("LLM_NAME is not set")
print("log_level:", "warning")

http_client = httpx.AsyncClient(timeout=300.0)

@app.on_event("shutdown")
async def shutdown_event():
    await http_client.aclose()

@app.get("/")
def root():
    return FileResponse(Path("index.html"))

@app.post("/upload")
async def upload_audio(request: Request):
    """
    1. Receives audio (webm) from browser.
    2. Forwards to Transcription Server.
    3. Sends prompt to Ollama.
    4. Returns complete audio response from tts model.
    """
    audio_data = await request.body()
    if not audio_data:
        raise HTTPException(status_code=400, detail="No audio data received")

    try:
        proc = subprocess.run(
            [
                "ffmpeg",
                "-i", "pipe:0",
                "-vn",
                "-acodec", "pcm_s16le",
                "-f", "wav",
                "pipe:1",
            ],
            input=audio_data,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=True,
        )
    except subprocess.CalledProcessError as e:
        print("SubpError: ", e.stderr.decode("utf-8", errors="replace"))
        raise HTTPException(status_code=500, detail="Audio conversion failed")

    wav_data = proc.stdout

    filename = f"recording_{uuid.uuid4().hex}" + ".wav"

    # 1. Forward Audio -> Transcription Server
    try:
        files = {"file": (filename, wav_data, "audio/wav")}
        print(f"[Proxy] Sending {len(wav_data)} bytes to Transcription Server: {TRANSCRIPTION_SERVER_URL}")
        resp = await http_client.post(TRANSCRIPTION_SERVER_URL, files=files)
        resp.raise_for_status()
        transcription_result = resp.json()
    except httpx.RequestError as e:
        raise HTTPException(status_code=502, detail=f"Transcription server unreachable: {e}")
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=502, detail=f"Transcription server error: {e.response.text}")

    # 2. Extract Prompt
    user_prompt = transcription_result.get("text")
    print("User Prompt: ", transcription_result)
    if not user_prompt:
        raise HTTPException(
            status_code=500,
            detail=f"Transcription server did not return a 'text' field. Got: {transcription_result}"
        )
    print(f"[Proxy] Received prompt: {user_prompt[:100]}...")

    # 3. Forward Prompt -> Ollama
    ollama_payload = {
        "model": LLM_NAME,
        "prompt": user_prompt,
        "stream": False
    }

    try:
        ollama_url = f"{OLLAMA_HOST_URL}/api/generate"
        print(f"[Proxy] Sending to Ollama: {ollama_url}")
        ollama_resp = await http_client.post(ollama_url, json=ollama_payload)
        ollama_resp.raise_for_status()
        ollama_result = ollama_resp.json()
        llm_text = ollama_result.get("response", "")
    except httpx.RequestError as e:
        raise HTTPException(status_code=502, detail=f"Ollama unreachable at {OLLAMA_HOST_URL}: {e}")
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=502, detail=f"Ollama error: {e.response.text}")

    print("Ollama response: ", llm_text)

    # 4. Get complete TTS from Kokoro -> Return as single response
    tts_url = f"{TTS_HOST_URL}/upload"

    try:
        print(f"[Proxy] Requesting TTS from Kokoro: {tts_url}")
        tts_resp = await http_client.post(
            tts_url,
            content=llm_text.encode('utf-8'),
            headers={"Content-Type": "text/plain; charset=utf-8"},
            timeout=300.0
        )
        tts_resp.raise_for_status()

        # Return complete audio response directly
        return Response(
            content=tts_resp.content,
            media_type="audio/wav",
            headers={
                "Content-Disposition": "inline; filename=response.wav",
                "Cache-Control": "no-cache, no-store, must-revalidate",
                "Pragma": "no-cache",
                "Expires": "0",
                "Content-Length": str(len(tts_resp.content)),
            }
        )
    except httpx.RequestError as e:
        raise HTTPException(status_code=502, detail=f"tts unreachable: {e}")
    except httpx.HTTPStatusError as e:
        try:
            err_body = await e.response.aread()
            detail = f"tts error: {err_body.decode()}"
        except Exception:
            detail = f"tts error: {e.response.status_code}"
        raise HTTPException(status_code=502, detail=detail)

app.mount("/static", StaticFiles(directory="static", html=True), name="static")
