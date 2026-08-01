import os
import uuid
import httpx
import subprocess
from pathlib import Path
from typing import List, Dict
from fastapi import FastAPI, Request, HTTPException, Response
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel


app = FastAPI()

# Configuration
TRANSCRIPTION_SERVER_URL = "http://homie_whisper:8080/inference"
OLLAMA_HOST_URL = "http://homie_ollama:11434"
TTS_HOST_URL = "http://homie_tts:5001"
LLM_NAME = os.getenv("LLM_NAME")
print("LLM_NAME var:", LLM_NAME)

if LLM_NAME is None:
    raise RuntimeError("LLM_NAME is not set")

http_client = httpx.AsyncClient(timeout=300.0)

# --- GLOBAL CONVERSATION HISTORY (Single User) ---
conversation_history: List[Dict] = []
MAX_HISTORY = 40  # Prevent unbounded memory growth

def trim_history():
    global conversation_history
    if len(conversation_history) > MAX_HISTORY:
        conversation_history = conversation_history[-MAX_HISTORY:]

@app.on_event("shutdown")
async def shutdown_event():
    await http_client.aclose()

@app.get("/")
def root():
    return FileResponse(Path("index.html"))

@app.get("/history")
async def get_history():
    """Returns the current global conversation history."""
    return JSONResponse(content={"messages": conversation_history})

class Message(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    messages: List[Message]

class ChatMessage(BaseModel):
    message: str

# --- Helpers ---
async def call_ollama(messages: List[Dict]) -> str:
    ollama_payload = {"model": LLM_NAME, "messages": messages, "stream": False}
    ollama_url = f"{OLLAMA_HOST_URL}/api/chat"
    try:
        print(f"[Proxy] Sending to Ollama: {len(messages)} messages")
        ollama_resp = await http_client.post(ollama_url, json=ollama_payload)
        ollama_resp.raise_for_status()
        ollama_result = ollama_resp.json()
        return ollama_result.get("message", {}).get("content", "")
    except httpx.RequestError as e:
        raise HTTPException(status_code=502, detail=f"Ollama unreachable: {e}")
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=502, detail=f"Ollama error: {e.response.text}")

async def call_tts(text: str) -> bytes:
    tts_url = f"{TTS_HOST_URL}/upload"
    try:
        tts_resp = await http_client.post(
            tts_url, content=text.encode('utf-8'),
            headers={"Content-Type": "text/plain; charset=utf-8"}, timeout=300.0
        )
        tts_resp.raise_for_status()
        return tts_resp.content
    except httpx.RequestError as e:
        raise HTTPException(status_code=502, detail=f"TTS unreachable: {e}")
    except httpx.HTTPStatusError as e:
        try: detail = f"TTS error: {(await e.response.aread()).decode()}"
        except: detail = f"TTS error: {e.response.status_code}"
        raise HTTPException(status_code=502, detail=detail)

# --- Endpoints ---

@app.post("/chat")
async def chat_endpoint(chat_request: ChatRequest):
    """
    Text Chat:
    1. Frontend sends ENTIRE current conversation.
    2. Backend REPLACES global history with frontend payload (Sync).
    3. Calls Ollama.
    4. Appends Assistant reply to global history.
    5. Returns reply.
    """
    global conversation_history

    # 1. Sync: Frontend is source of truth for UI state
    frontend_history = [msg.dict() for msg in chat_request.messages]
    conversation_history = frontend_history

    # 2. Call LLM
    llm_text = await call_ollama(conversation_history)

    # 3. Update Global History
    conversation_history.append({"role": "assistant", "content": llm_text})
    trim_history()

    print("Ollama response:", llm_text)
    return JSONResponse(content={"response": llm_text})

@app.post("/tts")
async def tts_endpoint(chat_message: ChatMessage):
    """Simple TTS proxy. No history interaction."""
    text = chat_message.message
    if not text: raise HTTPException(status_code=400, detail="No message provided")

    audio_bytes = await call_tts(text)
    return Response(content=audio_bytes, media_type="audio/wav", headers={
        "Content-Disposition": "inline; filename=response.wav",
        "Cache-Control": "no-cache", "Content-Length": str(len(audio_bytes))
    })

@app.post("/upload")
async def upload_audio(request: Request):
    """
    Voice Chat:
    1. Convert Audio -> Text.
    2. Append User to GLOBAL history.
    3. Call Ollama with GLOBAL history.
    4. Append Assistant to GLOBAL history.
    5. TTS -> Return Audio.
    """
    global conversation_history

    # 1. Get Audio
    audio_data = await request.body()
    if not audio_data: raise HTTPException(status_code=400, detail="No audio data received")

    # 2. Convert WebM -> WAV (16khz mono for Whisper)
    try:
        proc = subprocess.run(
            ["ffmpeg", "-y", "-i", "pipe:0", "-vn", "-acodec", "pcm_s16le", "-ar", "16000", "-f", "wav", "pipe:1"],
            input=audio_data, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True
        )
    except subprocess.CalledProcessError as e:
        print("FFmpeg Error:", e.stderr.decode("utf-8", errors="replace"))
        raise HTTPException(status_code=500, detail="Audio conversion failed")

    wav_data = proc.stdout
    filename = f"recording_{uuid.uuid4().hex}.wav"

    # 3. Transcribe
    try:
        files = {"file": (filename, wav_data, "audio/wav")}
        resp = await http_client.post(TRANSCRIPTION_SERVER_URL, files=files)
        resp.raise_for_status()
        transcription_result = resp.json()
    except httpx.RequestError as e:
        raise HTTPException(status_code=502, detail=f"Transcription server unreachable: {e}")
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=502, detail=f"Transcription server error: {e.response.text}")

    user_prompt = transcription_result.get("text")
    print("User Prompt:", user_prompt)
    if not user_prompt: raise HTTPException(status_code=500, detail="Transcription empty")

    # 4. Append User -> Call Ollama (with full context)
    conversation_history.append({"role": "user", "content": user_prompt})

    llm_text = await call_ollama(conversation_history)

    # 5. Append Assistant -> Save
    conversation_history.append({"role": "assistant", "content": llm_text})
    trim_history()

    print("Ollama response:", llm_text)

    # 6. TTS & Return
    audio_bytes = await call_tts(llm_text)
    return Response(content=audio_bytes, media_type="audio/wav", headers={
        "Content-Disposition": "inline; filename=response.wav",
        "Cache-Control": "no-cache", "Content-Length": str(len(audio_bytes))
    })

app.mount("/static", StaticFiles(directory="static", html=True), name="static")
