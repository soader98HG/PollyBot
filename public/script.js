const dialog = document.getElementById('dialog');
const statusDiv = document.getElementById('status');
const micStatusDiv = document.getElementById('mic-status');
const toggleAmbientSoundBtn = document.getElementById('toggleAmbientSoundBtn');
const voiceSelect = document.getElementById('voice-select');
const reconnectBtn = document.getElementById('reconnect-btn');

// --- Valores preestablecidos ---
let selectedVoice = 'Lucia'; // Default voice
const DEFAULT_SPEED = 80;

// --- Lógica de la Aplicación ---
let isIaSpeaking = false;
let isProcessing = false;
let recognitionActive = false;

// --- Gestión de Voces ---
async function playGoodbyeAndReload() {
    try {
        const response = await fetch(`/api/goodbye-speech?voice=${selectedVoice}`);
        if (!response.ok) {
            throw new Error('Failed to fetch goodbye speech');
        }
        const audioBlob = await response.blob();
        const audioUrl = URL.createObjectURL(audioBlob);
        const audio = new Audio(audioUrl);
        audio.onended = () => location.reload();
        safePlay(audio);
    } catch (error) {
        console.error('Error playing goodbye speech:', error);
        location.reload(); // Reload even if there is an error
    }
}

async function populateVoices() {
    try {
        const response = await fetch('/api/voices');
        const voices = await response.json();
        voiceSelect.innerHTML = '';
        voices.forEach(voice => {
            const option = document.createElement('option');
            option.value = voice.Id;
            option.textContent = `${voice.Name} (${voice.LanguageName})`;
            voiceSelect.appendChild(option);
        });
        voiceSelect.value = selectedVoice;
    } catch (error) {
        console.error('Error al obtener las voces:', error);
    }
}

voiceSelect.addEventListener('change', () => {
    selectedVoice = voiceSelect.value;
});

reconnectBtn.addEventListener('click', () => {
    location.reload();
});


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
    if (!recognitionActive && !isIaSpeaking && !isProcessing) {
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

function speak(audioBlob, textToDisplay) {
    if (!suspenseSound.paused) suspenseSound.pause();
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

    const handleSpeechEnd = () => {
        isIaSpeaking = false;
        if (!isAmbientSoundMuted) ambientSound.volume = AMBIENT_VOLUME_NORMAL;
        startRecognition();
        URL.revokeObjectURL(audioUrl);
    };

    audio.onended = handleSpeechEnd;
    audio.onerror = (e) => {
        console.error('Error al reproducir el audio.', e);
        handleSpeechEnd();
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
    if (!isIaSpeaking && !isProcessing) startRecognition(); 
};
recognition.onerror = (event) => {
    if (event.error !== 'no-speech' && event.error !== 'aborted') {
        console.error('Error de reconocimiento de voz.', event.error);
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
            addMessage("DE NADA", 'ia');
            await playGoodbyeAndReload();
        } else {

        const response = await fetch('/ask-local-llm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                prompt, 
                voice: selectedVoice, 
                speed: DEFAULT_SPEED
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Error del servidor: ${errorText}`);
        }

        const audioBlob = await response.blob();
        speak(audioBlob, "[Respuesta de audio]");
        }

    } catch (error) {
        console.error('No se pudo procesar la solicitud.', error);
        addMessage("Lo siento, no pude proceser tu solicitud.", 'ia');
    } finally {
        isProcessing = false;
        if (!isAmbientSoundMuted) {
            ambientSound.volume = AMBIENT_VOLUME_NORMAL;
            safePlay(ambientSound);
        }
        suspenseSound.pause();
        suspenseSound.currentTime = 0;
    }
}


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

// Iniciar la aplicación
addMessage('Habla ahora.', 'ia');
startRecognition();
if (!isAmbientSoundMuted && ambientSound.paused) safePlay(ambientSound);
populateVoices();
