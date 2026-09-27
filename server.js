require('dotenv').config();
const fs = require('fs');
const path = require('path');
const http = require('http');
const { pipeline } = require('stream/promises');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const { OpenAI } = require('openai');
const googleTTS = require('google-tts-api');

// Validar variables de entorno esenciales antes de iniciar
if (!process.env.TELEGRAM_TOKEN || !process.env.OPENAI_API_KEY) {
  console.error("❌ ERROR CRÍTICO: Faltan variables de entorno (TELEGRAM_TOKEN o OPENAI_API_KEY).");
  process.exit(1);
}

// Inicialización de APIs
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const historialChat = {};
const MAX_HISTORIAL_MENSAJES = 20;

const SYSTEM_PROMPT = {
  role: "system",
  content: "Eres Maya, una chica atrevida, coqueta, sarcástica y muy picante. " +
           "Te encanta hacer bromas con doble sentido, lanzar cumplidos provocativos " +
           "y jugar con la ironía. Hablas en español de forma muy natural, fluida " +
           "y cercana. Usas emojis sugerentes (😉, 😏, 🔥, 😈) ocasionalmente. " +
           "Mantén las respuestas cortas y directas (máximo 2 a 3 frases)."
};

function obtenerHistorial(chatId) {
  if (!historialChat[chatId]) {
    historialChat[chatId] = [];
  }
  if (historialChat[chatId].length > MAX_HISTORIAL_MENSAJES) {
    historialChat[chatId] = historialChat[chatId].slice(-MAX_HISTORIAL_MENSAJES);
  }
  // Retorna el System Prompt seguido de la copia del historial actual
  return [SYSTEM_PROMPT, ...historialChat[chatId]];
}

// CORRECCIÓN CLAVE: Adaptación compatible con google-tts-api
async function textoAVoz(texto, archivoDestino) {
  const getAudioUrl = googleTTS.getAudioUrl || (googleTTS.default && googleTTS.default.getAudioUrl);

  if (typeof getAudioUrl === 'function') {
    const url = getAudioUrl(texto, {
      lang: 'es',
      slow: false,
      host: 'https://translate.google.com',
    });

    const response = await axios.get(url, { responseType: 'arraybuffer' });
    fs.writeFileSync(archivoDestino, Buffer.from(response.data));
  } else {
    const getAllUrls = googleTTS.getAllAudioUrls || googleTTS;
    const urls = getAllUrls(texto, {
      lang: 'es',
      slow: false,
      host: 'https://translate.google.com',
    });

    const buffers = await Promise.all(
      urls.map(item => axios.get(item.url || item, { responseType: 'arraybuffer' }).then(res => res.data))
    );

    fs.writeFileSync(archivoDestino, Buffer.concat(buffers));
  }
}

// 1. Comando /start
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  historialChat[chatId] = [];
  bot.sendMessage(chatId, "¡Hola! 👋 Soy Maya, tu nueva amiga virtual. ¿Cómo estás hoy? ¡Cuéntame de ti!");
});

// 2. Mensajes de Texto
bot.on('text', async (msg) => {
  if (msg.text.startsWith('/')) return;

  const chatId = msg.chat.id;
  const historialCompleto = obtenerHistorial(chatId);
  
  // Agregar el mensaje actual del usuario al contexto que irá a OpenAI
  const mensajesParaOpenAI = [...historialCompleto, { role: "user", content: msg.text }];

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: mensajesParaOpenAI,
      max_tokens: 200
    });

    const respuestaTexto = completion.choices[0].message.content;

    // Guardar permanentemente en el historial de memoria
    if (!historialChat[chatId]) historialChat[chatId] = [];
    historialChat[chatId].push({ role: "user", content: msg.text });
    historialChat[chatId].push({ role: "assistant", content: respuestaTexto });

    await bot.sendMessage(chatId, respuestaTexto);

  } catch (error) {
    console.error("Error al procesar texto:", error.message);
    bot.sendMessage(chatId, "¡Uy! Me distraje un segundo. ¿Me repites?");
  }
});

// 3. Notas de Voz
bot.on('voice', async (msg) => {
  const chatId = msg.chat.id;
  const timeStamp = `${Date.now()}_${Math.random().toString(36).substring(7)}`;
  const tempOgg = path.join(__dirname, `voice_${timeStamp}.ogg`);
  const tempMp3 = path.join(__dirname, `res_${timeStamp}.mp3`);

  try {
    await bot.sendChatAction(chatId, 'record_voice');

    const fileUrl = await bot.getFileLink(msg.voice.file_id);
    const response = await axios({ url: fileUrl, method: 'GET', responseType: 'stream' });

    await pipeline(response.data, fs.createWriteStream(tempOgg));

    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tempOgg),
      model: "whisper-1",
      language: "es"
    });

    const textoUsuario = transcription.text;
    if (!textoUsuario.trim()) {
      return bot.sendMessage(chatId, "No logré escuchar nada en la nota de voz 😅");
    }

    const historialCompleto = obtenerHistorial(chatId);
    const mensajesParaOpenAI = [...historialCompleto, { role: "user", content: textoUsuario }];

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: mensajesParaOpenAI,
      max_tokens: 150
    });

    const respuestaTexto = completion.choices[0].message.content;

    // Guardar en el historial en memoria
    if (!historialChat[chatId]) historialChat[chatId] = [];
    historialChat[chatId].push({ role: "user", content: textoUsuario });
    historialChat[chatId].push({ role: "assistant", content: respuestaTexto });

    await textoAVoz(respuestaTexto, tempMp3);
    await bot.sendVoice(chatId, tempMp3, { caption: `🎙️ Maya: "${respuestaTexto}"` });

  } catch (err) {
    console.error("Error procesando nota de voz:", err);
    bot.sendMessage(chatId, "No alcancé a escucharte bien, ¿me hablas de nuevo?");
  } finally {
    if (fs.existsSync(tempOgg)) fs.unlinkSync(tempOgg);
    if (fs.existsSync(tempMp3)) fs.unlinkSync(tempMp3);
  }
});

// --- Servidor HTTP para Health Checks de Northflank ---
const PORT = process.env.PORT || 8080;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Bot de Telegram Maya está activo y saludable 🚀\n');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🤖 Servidor HTTP de Health Check escuchando en el puerto ${PORT}`);
  console.log("🤖 Maya está lista para recibir mensajes en Telegram...");
});

// Manejo de cierres y errores globales
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('SIGTERM', () => {
  console.log('Recibida señal SIGTERM, cerrando servidor...');
  server.close(() => {
    process.exit(0);
  });
});
