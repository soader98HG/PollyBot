const connectBtn = document.getElementById('connectBtn');
const dialog = document.getElementById('dialog');
const statusDiv = document.getElementById('status');
const micStatusDiv = document.getElementById('mic-status');
const toggleAmbientSoundBtn = document.getElementById('toggleAmbientSoundBtn');

// --- Valores preestablecidos ---
const DEFAULT_VOICE = 'Sergio';
const DEFAULT_SPEED = 80;

// --- Lógica de la Aplicación ---
let agoraClient = null;
let localAudioTrack = null;
let isConnected = false;
let isIaSpeaking = false;
let isProcessing = false;
let recognitionActive = false;

// --- Función segura para reproducir audio ---
async function safePlay(audioElement) {
    try {
        await audioElement.play();
    } catch (error) {
        if (error.name !== 'AbortError') {
            console.error('Error al reproducir audio:', error);
        }
    }
}

const suspenseSound = new Audio('/uhm.mp3');
suspenseSound.volume = 0.5;
suspenseSound.loop = true;

const ambientSound = new Audio('/ambient_loop.mp3');
ambientSound.loop = true;
const AMBIENT_VOLUME_NORMAL = 0.2;
const AMBIENT_VOLUME_LOW = 0.05;
ambientSound.volume = AMBIENT_VOLUME_NORMAL;
let isAmbientSoundMuted = false;

const recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
recognition.lang = 'es-ES';
recognition.interimResults = false;

// --- Funciones de Control del Micrófono ---
function startRecognition() {
    if (isConnected && !recognitionActive && !isIaSpeaking && !isProcessing) {
        try {
            recognition.start();
        } catch (e) { /* Ignorar error si ya está iniciado */ }
    }
}

function stopRecognition() {
    if (recognitionActive) {
        recognition.stop();
    }
}

// --- Funciones de la Interfaz ---
function updateStatus(text) { statusDiv.textContent = text; }
function updateMicStatus(status) { micStatusDiv.textContent = `Micrófono: ${status}`; }
function addMessage(text, sender) {
    const p = document.createElement('p');
    p.textContent = text;
    p.className = sender === 'user' ? 'user-message' : 'ia-message';
    dialog.appendChild(p);
    dialog.scrollTop = dialog.scrollHeight;
}

function fadeOut(audioElement, duration, callback) {
    // ... (sin cambios)
}

function speak(audioBlob, textToDisplay) {
    if (!suspenseSound.paused) fadeOut(suspenseSound, 3000);
    if (!isAmbientSoundMuted) {
        safePlay(ambientSound);
        ambientSound.volume = AMBIENT_VOLUME_LOW;
    }

    isIaSpeaking = true;
    isProcessing = false;
    stopRecognition();
    updateStatus("Hablando...");

    const audioUrl = URL.createObjectURL(audioBlob);
    const audio = new Audio(audioUrl);

    audio.onended = () => {
        isIaSpeaking = false;
        if (!isAmbientSoundMuted) ambientSound.volume = AMBIENT_VOLUME_NORMAL;
        startRecognition();
        URL.revokeObjectURL(audioUrl);
    };
    audio.onerror = (e) => {
        console.error("Error al reproducir el audio:", e);
        isIaSpeaking = false;
        if (!isAmbientSoundMuted) ambientSound.volume = AMBIENT_VOLUME_NORMAL;
        updateStatus("Error de audio");
        startRecognition();
    };

    safePlay(audio);
    addMessage(textToDisplay, 'ia');
}

// --- Eventos de Reconocimiento de Voz ---
recognition.onstart = () => { 
    recognitionActive = true; 
    updateMicStatus("Escuchando"); 
};
recognition.onend = () => { 
    recognitionActive = false; 
    if (isConnected && !isIaSpeaking && !isProcessing) startRecognition(); 
};
recognition.onerror = (event) => {
    if (event.error !== 'no-speech' && event.error !== 'aborted') {
        console.error("Error de reconocimiento:", event.error);
        updateStatus("Error de reconocimiento");
    }
    recognitionActive = false;
};
recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript.trim().toLowerCase();
    addMessage(transcript, 'user');
    updateStatus("Pensando...");
    
    stopRecognition();
    isProcessing = true;

    if (!isAmbientSoundMuted) ambientSound.pause();
    suspenseSound.currentTime = 0;
    suspenseSound.volume = 0.5;
    safePlay(suspenseSound);

    handleCommand(transcript);
};

// --- Lógica de Comandos y Conexión ---
async function handleCommand(prompt) {
    try {
        const resetPhrases = ['adios', 'gracias', 'hasta luego', 'terminar', 'reiniciar', 'olvida todo'];
        if (resetPhrases.some(phrase => prompt.includes(phrase))) {
            await fetch('/reset-conversation', { method: 'POST' });
            addMessage("Entendido. Mi memoria se ha purificado.", 'ia');
            return;
        }

        const response = await fetch('/ask-local-llm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt, voice: DEFAULT_VOICE, speed: DEFAULT_SPEED }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Error del servidor: ${errorText}`);
        }

        const audioBlob = await response.blob();
        speak(audioBlob, "[Respuesta de audio]");

    } catch (error) {
        console.error("Error en handleCommand:", error);
        addMessage("Lo siento, no pude procesar tu solicitud.", 'ia');
    } finally {
        isProcessing = false;
        if (!isAmbientSoundMuted) {
            ambientSound.volume = AMBIENT_VOLUME_NORMAL;
            safePlay(ambientSound);
        }
        suspenseSound.pause();
        suspenseSound.currentTime = 0;
        startRecognition();
    }
}

async function connectToAgora() {
    if (isConnected) return;
    try {
        updateStatus("Conectando...");
        const response = await fetch('/get-token');
        const { token, appId, channel } = await response.json();

        agoraClient = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
        await agoraClient.join(appId, channel, token, null);

        localAudioTrack = await AgoraRTC.createMicrophoneAudioTrack();
        await agoraClient.publish([localAudioTrack]);

        agoraClient.on('user-published', (user, mediaType) => {
            if (mediaType === 'audio') user.audioTrack.play();
        });

        isConnected = true;
        connectBtn.textContent = 'Desconectar';
        addMessage('Conectado. Habla ahora.', 'ia');
        startRecognition();

        if (!isAmbientSoundMuted && ambientSound.paused) safePlay(ambientSound);

    } catch (error) {
        console.error('Error al conectar con Agora:', error);
        addMessage('Error al conectar. Revisa la consola.', 'ia');
        updateStatus("Error de conexión");
    }
}

async function disconnectFromAgora() {
    if (!isConnected) return;

    stopRecognition();
    if (localAudioTrack) {
        localAudioTrack.stop();
        localAudioTrack.close();
    }
    if (agoraClient) await agoraClient.leave();

    isConnected = false;
    isIaSpeaking = false;
    isProcessing = false;
    connectBtn.textContent = 'Conectar';
    updateStatus("Desconectado");
    addMessage('Desconectado.', 'ia');
    ambientSound.pause();
    suspenseSound.pause();
}

connectBtn.onclick = () => {
    if (isConnected) disconnectFromAgora();
    else connectToAgora();
};

toggleAmbientSoundBtn.addEventListener('click', () => {
    isAmbientSoundMuted = !isAmbientSoundMuted;
    if (isAmbientSoundMuted) {
        ambientSound.pause();
        toggleAmbientSoundBtn.textContent = 'Activar Ambiente';
    } else {
        safePlay(ambientSound);
        toggleAmbientSoundBtn.textContent = 'Silenciar Ambiente';
    }
});