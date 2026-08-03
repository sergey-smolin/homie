# Local first Voice Chat AI Assistant

Includes fully local setup for three parts of a voice enabled AI assistant:
a speach recognition model, an LLM, and a text-to-speech model. The development and testing
was done on Linux. Uses Docker/Podman Compose. Any docker command in this readme can be substituted for podman

It combines:
- **Whisper.cpp** for high-quality speech-to-text transcription (depends on the model)
- **Ollama** for local LLM inference
- **Kokoro** for natural text-to-speech synthesis
- **The main script** for managing the whole process

All components run locally with no external API dependencies, ensuring privacy and offline capability.

## Setup Instructions

1. **Configure Environment**
   - Rename `.env.example` to `.env`
   - Specify `PROJECT_PATH` in the `.env` file so that bind mounts are resolved properly
   - Specify the speech recognition file name in `STT_MODEL` variable `.env` file
   - Specify `LLM_NAME` to be in a format used by Ollama (like `qwen3:0.6b`, `gemma4:12b`)
     Find the names on Ollama website model's page.

2. **Download a Speech recognition Model**
   - Download a Speech recognition model from [whisper.cpp Hugging Face repository](https://huggingface.co/ggerganov/whisper.cpp/tree/main) into `models` folder
   - Example: [ggml-small.bin](https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin)
   - The quality of speech recognition improves with the model size

3. **Build the main image**
   - in the root directory run 
   - `docker build -t homie_main .`

4. **Build TTS image**
   - go to tts folder
   - `docker build -t homie_tts .`
   - downloads kokoro package with dependencies during the installation which is around 2-5GB currently

5. **Start the Stack**
   - Start the compose stack with Docker/Podman
   - docker compose up
   - to use gpu `docker compose -f compose.yml -f compose.gpu.yml up`
   This is linux specific I think. Also you need to install NVidia drivers and NVidia Container toolkit
   (I wasn't yet able to make stt container use GPU but it may work for you)

6. **Pull Initial Ollama Model**
   - After starting the stack (make sure homie_ollama has been started), run:
     ```bash
     docker exec homie_ollama ollama pull modelname
     ```
   - this will download the `modelname` into the homie_ollama container
   - `modelname` should be Ollama model name listed on a model's page on Ollama's website.
     For example `qwen3:0.6b`, `gemma4:12b`, etc.
   - Note: `qwen3:0.6b` is very small and lightweight but inference quality may be limited
   - In case of a cloud model it will just make it available without a download.
     but you would have to log into Ollama's web interface:
     ```bash
     docker exec homie_ollama ollama signin
     ```

7. Make sure all 4 services have started. Now you can use the app in the browser at **127.0.0.1:5000**

*TODO: Add `build:` sections to compose file for automated image builds*
