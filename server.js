

require('dotenv').config(); // Cargar variables de entorno desde .env

const fs = require('fs');
const express = require('express');
const session = require('express-session');
const { PollyClient, SynthesizeSpeechCommand, DescribeVoicesCommand } = require('@aws-sdk/client-polly');

// --- Configuración de Groq (LLM) ---
const GROQ_API_KEY = process.env.GROQ_API_KEY; // Leer desde .env
const GROQ_MODEL = 'llama-3.1-8b-instant'; // Puedes cambiar a 'mixtral-8x7b-32768' si lo prefieres

const ANUBIS_SYSTEM_PROMPT = fs.readFileSync('system_prompt.txt', 'utf-8');

// --- Configuración de AWS Polly ---
const pollyClient = new PollyClient({ region: 'us-east-1' });



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

app.get('/api/goodbye-speech', async (req, res) => {
    const { voice } = req.query;
    try {
        const pollyCommand = new SynthesizeSpeechCommand({
            Text: 'DE NADA',
            OutputFormat: 'mp3',
            VoiceId: voice || 'Lucia',
            Engine: 'neural',
        });

        const pollyResponse = await pollyClient.send(pollyCommand);
        res.set('Content-Type', 'audio/mpeg');
        pollyResponse.AudioStream.pipe(res);
    } catch (error) {
        console.error("Error al sintetizar el discurso de despedida:", error);
        res.status(500).json({ error: `Error al sintetizar el discurso de despedida: ${error.message}` });
    }
});


// --- Endpoint para obtener las voces ---
app.get('/api/voices', async (req, res) => {
    try {
        const command = new DescribeVoicesCommand({});
        const response = await pollyClient.send(command);
        const spanishVoices = response.Voices.filter(voice => voice.LanguageCode.startsWith('es'));
        res.json(spanishVoices);
    } catch (error) {
        console.error('Error al obtener las voces de Polly:', error);
        res.status(500).json({ error: 'Error al obtener las voces.' });
    }
});

// --- Iniciar Servidor ---

app.listen(port, () => {
    console.log(`Servidor escuchando en http://localhost:${port}`);
    console.log("Asegúrate de que Groq API (via .env) y AWS CLI estén configurados.");
});
