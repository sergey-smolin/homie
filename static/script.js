let mediaRecorder;
let chunks = [];
let stream;
let audioContext = null;

async function startRecording() {
  startBtn.disabled = true;
  stopBtn.disabled = false;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream);
    chunks = [];

    mediaRecorder.ondataavailable = e => chunks.push(e.data);
    mediaRecorder.onstop = async () => {
      const blob = new Blob(chunks, { type: 'audio/webm' });
      try {
        const response = await fetch('/upload', {
          method: 'POST',
          body: blob
        });
        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`Server error: ${response.status} - ${errText}`);
        }

        // Get audio as ArrayBuffer for Web Audio API
        const arrayBuffer = await response.arrayBuffer();
        await playAudioBuffer(arrayBuffer);
        updateStatus('Done. Click Record to speak again.');

      } catch (err) {
        console.error('Upload error:', err);
        updateStatus('Error: ' + err.message);
      } finally {
        // Stop all tracks to release microphone
        stream.getTracks().forEach(track => track.stop());
        startBtn.disabled = false;
        stopBtn.disabled = true;
      }
    };

    mediaRecorder.start();
    updateStatus('Recording...');
    console.log('Recording started');
  } catch (err) {
    console.error('Error starting recording:', err);
    updateStatus('Error: ' + err.message);
    startBtn.disabled = false;
    stopBtn.disabled = true;
  }
}

async function playAudioBuffer(arrayBuffer) {
  // Initialize AudioContext on first user interaction (required by browsers)
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }

  // Resume context if suspended (browser autoplay policy)
  if (audioContext.state === 'suspended') {
    await audioContext.resume();
  }

  try {
    // Decode the audio data (handles WAV, MP3, etc.)
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    // Create source and play
    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioContext.destination);
    source.start(0);

    // Wait for playback to finish
    await new Promise(resolve => {
      source.onended = resolve;
    });
  } catch (err) {
    console.error('Audio playback error:', err);
    // Fallback to HTMLAudioElement if Web Audio fails
    await fallbackPlayback(arrayBuffer);
  }
}

async function fallbackPlayback(arrayBuffer) {
  updateStatus('Trying fallback playback...');
  const blob = new Blob([arrayBuffer], { type: 'audio/wav' });
  const audioUrl = URL.createObjectURL(blob);
  const audio = new Audio(audioUrl);

  return new Promise((resolve, reject) => {
    audio.onended = () => {
      URL.revokeObjectURL(audioUrl);
      resolve();
    };
    audio.onerror = (e) => {
      URL.revokeObjectURL(audioUrl);
      reject(new Error('Fallback playback failed'));
    };
    audio.play().catch(reject);
  });
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
    updateStatus('Processing recording...');
    startBtn.disabled = false;
    stopBtn.disabled = true;
  }
}

function updateStatus(message) {
  const statusEl = document.getElementById('status');
  if (statusEl) {
    statusEl.textContent = message;
  }
  console.log(message);
}

// Chat functionality
const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const sendBtn = document.getElementById('sendBtn');

function appendMessage(text, isUser) {
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${isUser ? 'user-message' : 'bot-message'}`;
  
  // Create a container for the message text and the TTS button (if bot message)
  const contentDiv = document.createElement('div');
  contentDiv.style.display = 'flex';
  contentDiv.style.alignItems = 'center';
  contentDiv.style.gap = '0.5rem';
  
  const textSpan = document.createElement('span');
  textSpan.textContent = text;
  contentDiv.appendChild(textSpan);
  
  if (!isUser) {
    const ttsBtn = document.createElement('button');
    ttsBtn.textContent = 'Play TTS';
    ttsBtn.style.padding = '0.25rem 0.5rem';
    ttsBtn.style.fontSize = '0.8rem';
    ttsBtn.style.borderRadius = '4px';
    ttsBtn.style.backgroundColor = '#28a745';
    ttsBtn.style.color = 'white';
    ttsBtn.style.border = 'none';
    ttsBtn.style.cursor = 'pointer';
    ttsBtn.addEventListener('click', () => playTTS(text));
    contentDiv.appendChild(ttsBtn);
  }
  
  messageDiv.appendChild(contentDiv);
  chatMessages.appendChild(messageDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

async function playTTS(text) {
  try {
    const response = await fetch('/tts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ message: text })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Server error: ${response.status} - ${errText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    await playAudioBuffer(arrayBuffer);
  } catch (err) {
    console.error('TTS error:', err);
    updateStatus('TTS Error: ' + err.message);
  }
}

async function sendMessage() {
  const text = chatInput.value.trim();
  if (!text) return;

  // Disable input and button while sending
  chatInput.disabled = true;
  sendBtn.disabled = true;

  // Show user message immediately
  appendMessage(text, true);
  chatInput.value = '';

  try {
    const response = await fetch('/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ message: text })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Server error: ${response.status} - ${errText}`);
    }

    const data = await response.json();
    appendMessage(data.response, false);
  } catch (err) {
    console.error('Chat error:', err);
    appendMessage('Error: ' + err.message, false);
  } finally {
    chatInput.disabled = false;
    sendBtn.disabled = false;
    chatInput.focus();
  }
}

sendBtn.addEventListener('click', sendMessage);
chatInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    sendMessage();
  }
});

const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');

startBtn.addEventListener('click', startRecording)
stopBtn.addEventListener('click', stopRecording)
