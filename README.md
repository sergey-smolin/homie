# Local first Voice Chat Assistant

Includes fully local setup for three parts of a voice enabled AI assistant:
a speach recognition model, an LLM, and a text-to-speech model. The development and testing
was done on Linux. Uses Docker/Podman Compose. Any docker command in this readme can be substituted for podman

It combines:
- **Whisper.cpp** for high-quality speech-to-text transcription (depends on the model)
- **Ollama** for local LLM inference (Since regular ollama supports cloud models too this can theoretically be enabled for the dockder image too)
- **Kokoro** for natural text-to-speech synthesis
- **The main script** for managing the whole process

All components run locally with no external API dependencies, ensuring privacy and offline capability.

## Setup Instructions

1. **Configure Environment**
   - Rename `.env.example` to `.env`
   - Specify `PROJECT_PATH` in the `.env` file so that bind mounts are resolved properly
   - Specify the speech recognition file name in `STT_MODEL` variable `.env` file

2. **Download a Speech recognition Model**
   - Download a Speech recognition model from [whisper.cpp Hugging Face repository](https://huggingface.co/ggerganov/whisper.cpp/tree/main) into `models` folder
   - Example: [ggml-small.bin](https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin)
   - The quality of speech recognition improves with the model size

3. **Build the main image**
   - in the root directory run 
   - docker build -t homie_main .

4. **Build TTS image**
   - go to tts folder
   - docker build -t homie_tts .
   - downloads kokoro package with dependencies during the installation which is around 2-5GB currently

5. **Add docker network**
   - docker network create homie_net

6. **Start the Stack**
   - Start the compose stack with Docker/Podman

7. **Pull Initial Ollama Model**
   - After starting the stack (make sure homie_ollama has been started), run:
     ```bash
     docker exec homie_ollama ollama pull qwen3:0.6b
     ```
   - this will download the qwen3:0.6b
   - currently only works with qwen3:0.6b. TODO: add any model.
   - Note: `qwen3:0.6b` is very small and lightweight but inference quality may be limited
   - you can download additional models with this command. In case of a cloud model it will just make it available without a download.
       but you would have to log into ollama web interface when prompted

8. Make sure all 4 services have started. Now you can use the app.

*TODO: Add `build:` sections to compose file for automated builds*
