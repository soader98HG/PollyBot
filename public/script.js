const connectBtn = document.getElementById('connectBtn');
const dialog = document.getElementById('dialog');
const statusDiv = document.getElementById('status');
const micStatusDiv = document.getElementById('mic-status');
const toggleAmbientSoundBtn = document.getElementById('toggleAmbientSoundBtn');

// --- Valores preestablecidos ---
const DEFAULT_VOICE = 'Sergio'; // Voz de Sergio por defecto
const DEFAULT_SPEED = 80;     // Velocidad al 80% por defecto

// --- Lógica de la Aplicación ---
let agoraClient = null;
let localAudioTrack = null;
let isConnected = false;
let isIaSpeaking = false;
let isProcessing = false; // Nuevo flag para indicar que la IA está pensando/procesando

const suspenseSound = new Audio('/uhm.mp3'); // Sonido de suspenso
suspenseSound.volume = 0.5; 
suspenseSound.loop = true; 

const ambientSound = new Audio('/ambient_loop.mp3');
ambientSound.loop = true;
const AMBIENT_VOLUME_NORMAL = 0.2; // Volumen normal del ambiente
const AMBIENT_VOLUME_LOW = 0.05;   // Volumen bajo cuando la IA habla
ambientSound.volume = AMBIENT_VOLUME_NORMAL;
let isAmbientSoundMuted = false;

const recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
recognition.lang = 'es-ES';
recognition.interimResults = false;

const synth = window.speechSynthesis;

function updateStatus(text) {
    statusDiv.textContent = text;
}

function updateMicStatus(status) {
    micStatusDiv.textContent = `Micrófono: ${status}`;
}

function addMessage(text, sender) {
    const p = document.createElement('p');
    p.textContent = text;
    p.className = sender === 'user' ? 'user-message' : 'ia-message';
    dialog.appendChild(p);
    dialog.scrollTop = dialog.scrollHeight;
}

// Función para atenuar el volumen de un audio
function fadeOut(audioElement, duration, callback) {
    const startVolume = audioElement.volume;
    const steps = 50; // Número de pasos para la atenuación
    const stepTime = duration / steps;
    let currentStep = 0;

    function fade() {
        currentStep++;
        const newVolume = startVolume * (1 - (currentStep / steps));
        if (newVolume <= 0.01) { // Asegurarse de que llegue a cero
            audioElement.volume = 0;
            audioElement.pause();
            audioElement.currentTime = 0;
            if (callback) callback();
            return;
        }
        audioElement.volume = newVolume;
        if (currentStep < steps) {
            setTimeout(fade, stepTime);
        } else {
            audioElement.volume = 0;
            audioElement.pause();
            audioElement.currentTime = 0;
            if (callback) callback();
        }
    }
    fade();
}

function speak(audioBlob, textToDisplay) {
    // Iniciar atenuación del sonido de suspenso
    if (!suspenseSound.paused) {
        fadeOut(suspenseSound, 3000); // Atenuar en 3 segundos
    }

    // Reanudar sonido de ambiente y bajar su volumen
    if (!isAmbientSoundMuted) {
        ambientSound.play(); // Asegurarse de que esté reproduciéndose
        ambientSound.volume = AMBIENT_VOLUME_LOW; 
    }

    isIaSpeaking = true;
    isProcessing = false; 
    recognition.stop(); 
    updateStatus("Hablando...");
    updateMicStatus("Inactivo");

    const audioUrl = URL.createObjectURL(audioBlob);
    const audio = new Audio(audioUrl);

    audio.onended = () => {
        isIaSpeaking = false;
        if (!isAmbientSoundMuted) {
            ambientSound.volume = AMBIENT_VOLUME_NORMAL; // Restaurar volumen del ambiente
        }
        if (isConnected) {
            updateStatus("Escuchando...");
            recognition.start(); 
            updateMicStatus("Escuchando");
        } else {
            updateStatus("Desconectado");
            updateMicStatus("Inactivo");
        }
        URL.revokeObjectURL(audioUrl);
    };

    audio.onerror = (e) => {
        console.error("Error al reproducir el audio:", e);
        isIaSpeaking = false;
        if (!isAmbientSoundMuted) {
            ambientSound.volume = AMBIENT_VOLUME_NORMAL; // Restaurar volumen del ambiente
        }
        updateStatus("Error de audio");
        if (isConnected) {
            updateStatus("Escuchando...");
            recognition.start();
            updateMicStatus("Escuchando");
        }
    };

    audio.play();
    addMessage(textToDisplay, 'ia');
}

recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript.trim().toLowerCase();
    addMessage(transcript, 'user');
    updateStatus("Pensando...");
    
    // Detener el reconocimiento inmediatamente después de obtener el resultado
    recognition.stop(); 
    updateMicStatus("Inactivo");
    isProcessing = true; 

    // Pausar el sonido de ambiente
    if (!isAmbientSoundMuted) {
        ambientSound.pause();
    }
    
    // Reiniciar el audio al principio y asegurar su volumen antes de reproducir
    suspenseSound.currentTime = 0; 
    suspenseSound.volume = 0.5; 
    suspenseSound.play();

    handleCommand(transcript);
};

recognition.onerror = (event) => {
    if (event.error !== 'no-speech') {
        console.error("Error de reconocimiento:", event.error);
        updateStatus("Error de reconocimiento");
    }
    // Si hay un error, y no estamos procesando o hablando, intentar reanudar
    if (isConnected && !isProcessing && !isIaSpeaking) {
        updateStatus("Escuchando...");
        recognition.start();
        updateMicStatus("Escuchando");
    }
};

async function handleCommand(prompt) {
    // --- Lógica de reinicio de memoria por frases clave ---
    const resetPhrases = ['adios', 'gracias', 'hasta luego', 'terminar', 'reiniciar', 'olvida todo'];
    const shouldReset = resetPhrases.some(phrase => prompt.includes(phrase));

    if (shouldReset) {
        try {
            await fetch('/reset-conversation', { method: 'POST' });
            addMessage("Entendido. Mi memoria se ha purificado. Vuelve cuando el destino te llame de nuevo.", 'ia');
        } catch (error) {
            console.error("Error al reiniciar la conversación:", error);
        }
        // Después de un comando de control, la IA no hablará, así que reanudamos el reconocimiento
        isProcessing = false;
        if (!isAmbientSoundMuted) {
            ambientSound.volume = AMBIENT_VOLUME_NORMAL; // Restaurar volumen del ambiente
            ambientSound.play(); // Asegurarse de que esté reproduciéndose
        }

        // Asegurarse de que el sonido de suspenso esté detenido
        suspenseSound.pause();
        suspenseSound.currentTime = 0;

        if (isConnected) {
            updateStatus("Escuchando...");
            recognition.start();
            updateMicStatus("Escuchando");
        }
        return;
    }

    try {
        const selectedVoice = DEFAULT_VOICE; 
        const selectedSpeed = DEFAULT_SPEED; 

        const response = await fetch('/ask-local-llm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                prompt: prompt,
                voice: selectedVoice,
                speed: selectedSpeed
            }),
        });

        if (!response.ok) {
            // Mejorar el manejo de errores del servidor
            const errorText = await response.text();
            console.error("Error del servidor:", errorText);
            addMessage(`Error del servidor: ${errorText.substring(0, 100)}...`, 'ia');
            throw new Error(`Server error: ${response.status}`);
        }

        const audioBlob = await response.blob();
        speak(audioBlob, "[Respuesta de audio]");

    } catch (error) {
        console.error("Error al llamar al LLM o TTS:", error);
        addMessage("Lo siento, no pude procesar tu solicitud. Revisa la consola para más detalles.", 'ia');
        isProcessing = false;
        if (!isAmbientSoundMuted) {
            ambientSound.volume = AMBIENT_VOLUME_NORMAL; // Restaurar volumen del ambiente
            ambientSound.play(); // Asegurarse de que esté reproduciéndose
        }

        // Asegurarse de que el sonido de suspenso esté detenido
        suspenseSound.pause();
        suspenseSound.currentTime = 0;

        if (isConnected) {
            updateStatus("Escuchando...");
            recognition.start();
            updateMicStatus("Escuchando");
        }
    }
}

// ... (El resto del código de conexión de Agora no cambia) ...

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

        agoraClient.on('user-published', async (user, mediaType) => {
            await agoraClient.subscribe(user, mediaType);
            if (mediaType === 'audio') {
                user.audioTrack.play();
            }
        });

        isConnected = true;
        connectBtn.textContent = 'Desconectar';
        updateStatus("Escuchando...");
        updateMicStatus("Escuchando");
        addMessage('Saludo a tu espíritu, viajero. Has cruzado el umbral hacia lo eterno...', 'ia');
        recognition.start();
        // Iniciar sonido de ambiente solo si no está ya reproduciéndose
        if (!isAmbientSoundMuted && ambientSound.paused) {
            ambientSound.play(); 
        }

    } catch (error) {
        console.error('Error al conectar con Agora:', error);
        addMessage('Error al conectar. Revisa la consola.', 'ia');
        updateStatus("Error de conexión");
        updateMicStatus("Inactivo");
    }
}

async function disconnectFromAgora() {
    if (!isConnected) return;

    recognition.stop();
    updateMicStatus("Inactivo");
    if (localAudioTrack) {
        localAudioTrack.stop();
        localAudioTrack.close();
    }
    if (agoraClient) {
        await agoraClient.leave();
    }

    isConnected = false;
    isIaSpeaking = false;
    isProcessing = false; 
    connectBtn.textContent = 'Conectar';
    updateStatus("Desconectado");
    addMessage('Desconectado.', 'ia');
    ambientSound.pause(); // Pausar sonido de ambiente al desconectar
    ambientSound.currentTime = 0; // Reiniciar
    suspenseSound.pause(); // Pausar sonido de suspenso al desconectar
    suspenseSound.currentTime = 0; // Reiniciar
}

connectBtn.onclick = () => {
    if (isConnected) {
        disconnectFromAgora();
    } else {
        connectToAgora();
    }
};

recognition.onend = () => {
    if (isConnected && !isProcessing && !isIaSpeaking) {
        try {
            recognition.start();
            updateMicStatus("Escuchando");
        } catch(e) {
            // Ignorar error
        }
    }
};

document.addEventListener('DOMContentLoaded', () => {
    connectToAgora();
});

toggleAmbientSoundBtn.addEventListener('click', () => {
    isAmbientSoundMuted = !isAmbientSoundMuted;
    if (isAmbientSoundMuted) {
        ambientSound.pause();
        toggleAmbientSoundBtn.textContent = 'Activar Ambiente';
    } else {
        ambientSound.play();
        toggleAmbientSoundBtn.textContent = 'Silenciar Ambiente';
    }
});