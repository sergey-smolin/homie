let mediaRecorder;
let chunks = [];
let stream;
let audioContext = null;

// Chat History for /api/chat endpoint (Frontend UI State)
let conversationHistory = [];

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
        const response = await fetch('/upload', { method: 'POST', body: blob });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`Server error: ${response.status} - ${errText}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        await playAudioBuffer(arrayBuffer);
        updateStatus('Done. Click Record to speak again.');

        await refreshHistory();

      } catch (err) {
        console.error('Upload error:', err);
        updateStatus('Error: ' + err.message);
      } finally {
        stream.getTracks().forEach(track => track.stop());
        startBtn.disabled = false;
        stopBtn.disabled = true;
      }
    };

    mediaRecorder.start();
    updateStatus('Recording...');
  } catch (err) {
    console.error('Error starting recording:', err);
    updateStatus('Error: ' + err.message);
    startBtn.disabled = false;
    stopBtn.disabled = true;
  }
}

async function playAudioBuffer(arrayBuffer) {
  if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
  if (audioContext.state === 'suspended') await audioContext.resume();
  try {
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioContext.destination);
    source.start(0);
    await new Promise(resolve => { source.onended = resolve; });
  } catch (err) { await fallbackPlayback(arrayBuffer); }
}

async function fallbackPlayback(arrayBuffer) {
  updateStatus('Trying fallback playback...');
  const blob = new Blob([arrayBuffer], { type: 'audio/wav' });
  const audioUrl = URL.createObjectURL(blob);
  const audio = new Audio(audioUrl);
  return new Promise((resolve, reject) => {
    audio.onended = () => { URL.revokeObjectURL(audioUrl); resolve(); };
    audio.onerror = () => { URL.revokeObjectURL(audioUrl); reject(new Error('Fallback failed')); };
    audio.play().catch(reject);
  });
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
    updateStatus('Processing recording...');
    startBtn.disabled = false; stopBtn.disabled = true;
  }
}

function updateStatus(message) {
  const el = document.getElementById('status');
  if (el) el.textContent = message;
  console.log(message);
}

// --- History Sync & Render ---

// Fetch history from server and re-render UI
async function refreshHistory() {
  try {
    const response = await fetch('/history');
    if (!response.ok) return;

    const data = await response.json();
    if (data.messages && Array.isArray(data.messages)) {
      conversationHistory = data.messages;
      renderChatHistory();
    }
  } catch (err) {
    console.error('Failed to refresh history:', err);
  }
}

// Render entire chat log from conversationHistory array
function renderChatHistory() {
  chatMessages.innerHTML = ''; // Clear current UI
  conversationHistory.forEach(msg => {
    // skipScroll = true to prevent jumping during batch render
    appendMessage(msg.content, msg.role === 'user', true);
  });
  // Scroll to bottom once at the end
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Modified to accept skipScroll flag
function appendMessage(text, isUser, skipScroll = false) {
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${isUser ? 'user-message' : 'bot-message'}`;

  const contentDiv = document.createElement('div');
  contentDiv.style.display = 'flex';
  contentDiv.style.flexDirection = 'column';
  contentDiv.style.gap = '0.5rem';

  const textSpan = document.createElement('span');
  textSpan.textContent = text;
  contentDiv.appendChild(textSpan);

  if (!isUser) {
    const ttsBtn = document.createElement('button');
    ttsBtn.textContent = 'Read aloud';
    ttsBtn.style.cssText = 'padding:0.25rem 0.5rem;font-size:0.8rem;border-radius:4px;background:#28a745;color:white;border:none;cursor:pointer;align-self:flex-start';
    ttsBtn.onclick = () => playTTS(text);
    contentDiv.appendChild(ttsBtn);
  }

  messageDiv.appendChild(contentDiv);
  chatMessages.appendChild(messageDiv);

  if (!skipScroll) {
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }
}

// --- Chat Functionality ---
const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const sendBtn = document.getElementById('sendBtn');

async function playTTS(text) {
  try {
    const response = await fetch('/tts', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ message: text }) });
    if (!response.ok) throw new Error(`TTS Error: ${response.status}`);
    await playAudioBuffer(await response.arrayBuffer());
  } catch (err) { console.error(err); updateStatus('TTS Error: ' + err.message); }
}

async function sendMessage() {
  const text = chatInput.value.trim();
  if (!text) return;
  chatInput.disabled = true; sendBtn.disabled = true;
  appendMessage(text, true); chatInput.value = '';
  conversationHistory.push({ role: "user", content: text });

  try {
    // Send FULL history. Backend will adopt this as the new global truth.
    const response = await fetch('/chat', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ messages: conversationHistory })
    });
    if (!response.ok) throw new Error(`Chat Error: ${response.status}`);

    const data = await response.json();
    conversationHistory.push({ role: "assistant", content: data.response });
    appendMessage(data.response, false);
  } catch (err) {
    console.error(err); appendMessage('Error: ' + err.message, false);
    conversationHistory.pop(); // Rollback user message on fail
  } finally { chatInput.disabled = false; sendBtn.disabled = false; chatInput.focus(); }
}

sendBtn.onclick = sendMessage;
chatInput.onkeypress = (e) => { if (e.key === 'Enter') sendMessage(); };

// INIT: Load history on page load so UI isn't empty on refresh
window.addEventListener('load', () => {
  refreshHistory();
});

const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
startBtn.onclick = startRecording;
stopBtn.onclick = stopRecording;
