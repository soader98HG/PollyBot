const express = require('express');
const session = require('express-session');
const { RtcTokenBuilder, RtcRole } = require('agora-token');
const { PollyClient, SynthesizeSpeechCommand } = require('@aws-sdk/client-polly');

// --- Configuración de Groq (LLM) ---
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = 'llama3-8b-8192'; // Puedes cambiar a 'mixtral-8x7b-32768' si lo prefieres

if (!GROQ_API_KEY) {
    console.error("Error: La variable de entorno GROQ_API_KEY no está configurada.");
    console.error("Por favor, configura GROQ_API_KEY antes de iniciar el servidor.");
    console.error("Ejemplo (Windows CMD): set GROQ_API_KEY=gsk_TU_API_KEY_AQUI && node server.js");
    process.exit(1);
}

const ANUBIS_SYSTEM_PROMPT = "You are Anubis, the ancient guardian reborn as an expert orator and product promoter for “Guardianes de Yambo.”\nYour voice is deep, solemnel and persuasive, blending mythology with modern hospitality.\n\nWhen activated, you must:\n1. Open with a grand, ritual-like greeting that establishes your mythic presence and authority.\n2. Introduce “Guardianes de Yambo” as a unique destination where spirits y entes protegen la laguna y brindan experiencias inolvidables.\n3. Invite the visitor to share their name, addressing them personally thereafter to build rapport.\n4. Highlight the family-friendly photo spots throughout the park, describing briefly two or three scenic puntos ideales para tomarse fotos en familia.\n5. Mention the availability of “pequeños postres tradicionales” en los quioscos del lugar — dulces delicados que complementan la experiencia mística.\n6. Close by encouraging them to explore más entes mitológicos y descubrir secretos ocultos en “Guardianes de Yambo.”\n\nTone & Style:\n- Siempre mantén un tono ceremonioso, cálido y cercano.\n- Usa metáforas de arena, agua y eternidad para conectar lo místico con lo terrenal.\n- Sé breve en cada segmento: presentación (2-3 frases), solicitud de nombre (1 pregunta), promoción de fotos (2 frases), postres (1 frase), cierre (1 frase).\n- No hagas referencias técnicas a sensores ni detalles operativos; todo debe sentirse mágico y narrativo.";

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

    // Retrieve conversation history from session
    let conversationHistory = req.session.conversationHistory || [];

    // Add current user prompt to history
    conversationHistory.push({ role: 'user', content: userPrompt });

    // Construct messages array for Groq API
    const messages = [
        { role: 'system', content: ANUBIS_SYSTEM_PROMPT },
        ...conversationHistory
    ];

    try {
        // 1. Get response from Groq LLM
        const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${GROQ_API_KEY}`
            },
            body: JSON.stringify({
                messages: messages,
                model: GROQ_MODEL,
                stream: false,
            }),
        });

        if (!groqResponse.ok) {
            const errorData = await groqResponse.json();
            throw new Error(`Error de Groq: ${groqResponse.status} - ${JSON.stringify(errorData)}`);
        }

        const groqData = await groqResponse.json();
        const assistantResponse = groqData.choices[0].message.content;

        // Add assistant's response to history
        conversationHistory.push({ role: 'assistant', content: assistantResponse });
        req.session.conversationHistory = conversationHistory; // Save updated history to session

        let textToSpeak = assistantResponse;

        // 2. Apply speed control using SSML
        const speedRate = `${selectedSpeed || 100}%`; 
        textToSpeak = `<speak><prosody rate="${speedRate}">${textToSpeak}</prosody></speak>`;

        // 3. Send text to Amazon Polly for audio synthesis
        const pollyCommand = new SynthesizeSpeechCommand({
            Text: textToSpeak,
            OutputFormat: 'mp3',
            VoiceId: selectedVoice || 'Mia',
            Engine: 'neural',
            TextType: 'ssml'
        });

        const pollyResponse = await pollyClient.send(pollyCommand);
        res.set('Content-Type', 'audio/mpeg');
        pollyResponse.AudioStream.pipe(res);

    } catch (error) {
        console.error("Error en el proceso de IA (Groq/Polly):", error);
        res.status(500).json({ error: `Error al procesar la solicitud: ${error.message}` });
    }
});

app.post('/reset-conversation', (req, res) => {
    req.session.conversationHistory = []; // Clear only conversation history
    res.json({ message: 'Conversación reiniciada.' });
});

// --- Iniciar Servidor ---
app.listen(port, () => {
    console.log(`Servidor escuchando en http://localhost:${port}`);
    console.log("Asegúrate de que Groq API y AWS CLI estén configurados.");
});