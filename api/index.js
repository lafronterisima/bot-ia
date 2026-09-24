require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises'); // Para esperar la escritura completa del stream
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const { OpenAI } = require('openai');
const googleTTS = require('google-tts-api');

// Configuración de APIs
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const historialChat = {};
const MAX_HISTORIAL_MENSAJES = 20; // Limitar historial para proteger la memoria y el context window

const SYSTEM_PROMPT = {
    role: "system",
    content: "Eres Maya, una amiga virtual cercana, empática, divertida y atenta. " +
             "Hablas en español de forma natural e informal. Usas emojis ocasionalmente. " +
             "Tus respuestas son breves y fluidas (máximo 2 a 3 frases)."
};

// Mantenimiento de memoria del historial
function obtenerHistorial(chatId) {
    if (!historialChat[chatId]) {
        historialChat[chatId] = [SYSTEM_PROMPT];
    }
    // Mantener solo los últimos N mensajes más el SYSTEM_PROMPT
    if (historialChat[chatId].length > MAX_HISTORIAL_MENSAJES) {
        historialChat[chatId] = [
            SYSTEM_PROMPT,
            ...historialChat[chatId].slice(-MAX_HISTORIAL_MENSAJES)
        ];
    }
    return historialChat[chatId];
}

// Generar audio MP3 unificando buffers
async function textoAVoz(texto, archivoDestino) {
    const urls = googleTTS.getAllAudioUrls(texto, {
        lang: 'es',
        slow: false,
        host: 'https://translate.google.com',
    });
    
    const buffers = await Promise.all(
        urls.map(item => axios.get(item.url, { responseType: 'arraybuffer' }).then(res => res.data))
    );
    
    fs.writeFileSync(archivoDestino, Buffer.concat(buffers));
}

// 1. Comando /start
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    historialChat[chatId] = [SYSTEM_PROMPT];
    bot.sendMessage(chatId, "¡Hola! 👋 Soy Maya, tu nueva amiga virtual. ¿Cómo estás hoy? ¡Cuéntame de ti!");
});

// 2. Mensajes de Texto
bot.on('text', async (msg) => {
    if (msg.text.startsWith('/')) return;

    const chatId = msg.chat.id;
    const historial = obtenerHistorial(chatId);
    historial.push({ role: "user", content: msg.text });

    try {
        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: historial,
            max_tokens: 200
        });

        const respuestaTexto = completion.choices[0].message.content;
        historial.push({ role: "assistant", content: respuestaTexto });

        await bot.sendMessage(chatId, respuestaTexto);

    } catch (error) {
        console.error("Error al procesar texto:", error.message);
        bot.sendMessage(chatId, "¡Uy! Me distraje un segundo. ¿Me repites?");
    }
});

// 3. Notas de Voz
bot.on('voice', async (msg) => {
    const chatId = msg.chat.id;
    const historial = obtenerHistorial(chatId);

    const timeStamp = `${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const tempOgg = path.join(__dirname, `voice_${timeStamp}.ogg`);
    const tempMp3 = path.join(__dirname, `res_${timeStamp}.mp3`);

    try {
        await bot.sendChatAction(chatId, 'record_voice');

        // Descarga segura del archivo con pipeline asíncrono
        const fileUrl = await bot.getFileLink(msg.voice.file_id);
        const response = await axios({ url: fileUrl, method: 'GET', responseType: 'stream' });
        
        await pipeline(response.data, fs.createWriteStream(tempOgg));

        // Transcribir con Whisper
        const transcription = await openai.audio.transcriptions.create({
            file: fs.createReadStream(tempOgg),
            model: "whisper-1",
            language: "es"
        });

        const textoUsuario = transcription.text;
        if (!textoUsuario.trim()) {
            return bot.sendMessage(chatId, "No logré escuchar nada en la nota de voz 😅");
        }

        historial.push({ role: "user", content: textoUsuario });

        // Generar respuesta GPT
        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: historial,
            max_tokens: 150
        });

        const respuestaTexto = completion.choices[0].message.content;
        historial.push({ role: "assistant", content: respuestaTexto });

        // Sintetizar voz y responder
        await textoAVoz(respuestaTexto, tempMp3);
        await bot.sendVoice(chatId, tempMp3, { caption: `🎙️ Maya: "${respuestaTexto}"` });

    } catch (err) {
        console.error("Error procesando nota de voz:", err);
        bot.sendMessage(chatId, "No alcancé a escucharte bien, ¿me hablas de nuevo?");
    } finally {
        // Limpieza garantizada de temporales
        if (fs.existsSync(tempOgg)) fs.unlinkSync(tempOgg);
        if (fs.existsSync(tempMp3)) fs.unlinkSync(tempMp3);
    }
});

console.log("🤖 Amiga Virtual activa en Telegram...");
