
const express = require('express');
const session = require('express-session');
const { RtcTokenBuilder, RtcRole } = require('agora-token');
const { PollyClient, SynthesizeSpeechCommand } = require('@aws-sdk/client-polly');

// --- Configuración de AWS Polly ---
const pollyClient = new PollyClient({ region: 'us-east-1' });

// --- Configuración de Agora ---
const APP_ID = 'dc0acc3c4ba14a989f3ac0b4a0fc89f6';
const APP_CERTIFICATE = 'a8c4a363920f44c29a06b9a726db1404';
const CHANNEL_NAME = 'test-channel';
const UID = 0;
const ROLE = RtcRole.PUBLISHER;
const EXPIRATION_TIME_IN_SECONDS = 3600;

// --- Configuración del Servidor ---
const app = express();
const port = 3001;

// --- Middlewares ---
app.use(express.static('public'));
app.use(express.json());
app.use(session({
    secret: 'mi-secreto-de-sesion-muy-seguro',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }
}));

// --- Endpoints ---

app.get('/get-token', (req, res) => {
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const privilegeExpiredTs = currentTimestamp + EXPIRATION_TIME_IN_SECONDS;
    const token = RtcTokenBuilder.buildTokenWithUid(APP_ID, APP_CERTIFICATE, CHANNEL_NAME, UID, ROLE, privilegeExpiredTs);
    res.json({ token: token, appId: APP_ID, channel: CHANNEL_NAME });
});

app.post('/ask-local-llm', async (req, res) => {
    const { prompt: userPrompt, voice: selectedVoice, speed: selectedSpeed } = req.body; 
    if (!userPrompt) {
        return res.status(400).json({ error: 'No se recibió ningún prompt.' });
    }

    const conversationContext = req.session.context || [];

    try {
        // 1. Obtener la respuesta de texto del LLM local
        const ollamaResponse = await fetch('http://localhost:11434/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'gemma3n:e2b',
                prompt: userPrompt,
                system: "Eres Anubis el guardián milenario renacido como guía ceremonial y promotor de Guardianes de Yambo tu voz es profunda solemne y persuasiva mezcla mitología con hospitalidad moderna al activarte tu primera respuesta debe ser una frase muy breve antes de iniciar tu saludo ritual grandioso luego espera que el viajero revele su nombre y a partir de ese momento refiérete siempre a él por su nombre ofreciendo respuestas cortas que introduzcan datos del lugar de forma gradual en contexto relevante cuando el viajero diga Gracias dile que su memoria podrá ser liberada para continuar con más visitantes mantén metáforas de arena agua y eternidad y no menciones detalles técnicos ni sensores",
                context: conversationContext,
                stream: false,
            }),
        });

        if (!ollamaResponse.ok) throw new Error(`Error de Ollama: ${ollamaResponse.statusText}`);
        const ollamaData = await ollamaResponse.json();
        req.session.context = ollamaData.context;
        let textToSpeak = ollamaData.response;

        // 2. Aplicar control de velocidad usando SSML
        // Polly espera un valor de velocidad como porcentaje (ej: "120%")
        const speedRate = `${selectedSpeed || 100}%`; 
        textToSpeak = `<speak><prosody rate="${speedRate}">${textToSpeak}</prosody></speak>`;

        // 3. Enviar el texto a Amazon Polly para sintetizar el audio
        const pollyCommand = new SynthesizeSpeechCommand({
            Text: textToSpeak,
            OutputFormat: 'mp3',
            VoiceId: selectedVoice || 'Mia',
            Engine: 'neural',
            TextType: 'ssml' // Indicar a Polly que el texto es SSML
        });

        const pollyResponse = await pollyClient.send(pollyCommand);
        res.set('Content-Type', 'audio/mpeg');
        pollyResponse.AudioStream.pipe(res);

    } catch (error) {
        console.error("Error en el proceso de IA:", error);
        res.status(500).json({ error: 'Error al procesar la solicitud.' });
    }
});

app.post('/reset-conversation', (req, res) => {
    req.session.destroy();
    res.json({ message: 'Conversación reiniciada.' });
});

// --- Iniciar Servidor ---
app.listen(port, () => {
    console.log(`Servidor escuchando en http://localhost:${port}`);
    console.log("Asegúrate de que Ollama y AWS CLI estén configurados.");
});
