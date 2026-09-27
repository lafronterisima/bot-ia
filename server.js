require('dotenv').config();
const fs = require('fs');
const path = require('path');
const http = require('http');
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

// FUNCIÓN textoAVoz CON INDICACIONES INTEGRADAS
async function textoAVoz(texto, archivoDestino) {
  // 1. Limpieza y validación del texto recibido
  const textoLimpio = String(texto || '').trim();
  if (!textoLimpio) throw new Error("El texto introducido para TTS está vacío.");

  // 2. Obtención segura de las URLs divididas
  const urls = googleTTS.getAllAudioUrls(textoLimpio, {
    lang: 'es',
    slow: false,
    host: 'https://translate.google.com',
    timeout: 10000,
  });

  if (!Array.isArray(urls) || urls.length === 0) {
    throw new Error("No se pudieron generar los fragmentos de audio con google-tts-api.");
  }

  // 3. Descarga de los buffers en paralelo
  const buffers = await Promise.all(
    urls.map(async (item) => {
      const targetUrl = typeof item === 'string' ? item : item.url;
      const res = await axios.get(targetUrl, { responseType: 'arraybuffer' });
      return res.data;
    })
  );

  // 4. Escritura en disco
  fs.writeFileSync(archivoDestino, Buffer.concat(buffers));
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

    // 1. Descargar audio de Telegram asegurando que se complete la escritura
    const fileUrl = await bot.getFileLink(msg.voice.file_id);
    const response = await axios({ url: fileUrl, method: 'GET', responseType: 'stream' });

    const writer = fs.createWriteStream(tempOgg);
    response.data.pipe(writer);

    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });

    // 2. Transcribir audio con OpenAI Whisper
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tempOgg),
      model: "whisper-1",
      language: "es"
    });

    const textoUsuario = transcription.text;
    if (!textoUsuario || !textoUsuario.trim()) {
      return bot.sendMessage(chatId, "No logré escuchar nada en la nota de voz 😅");
    }

    // 3. Generar respuesta de texto con ChatGPT
    const historialCompleto = obtenerHistorial(chatId);
    const mensajesParaOpenAI = [...historialCompleto, { role: "user", content: textoUsuario }];

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: mensajesParaOpenAI,
      max_tokens: 150
    });

    const respuestaTexto = completion.choices[0].message.content;

    // Guardar conversación en el historial
    if (!historialChat[chatId]) historialChat[chatId] = [];
    historialChat[chatId].push({ role: "user", content: textoUsuario });
    historialChat[chatId].push({ role: "assistant", content: respuestaTexto });

    // 4. Convertir texto a voz y enviar por Telegram
    await textoAVoz(respuestaTexto, tempMp3);
    await bot.sendVoice(chatId, tempMp3, { caption: `🎙️ Maya: "${respuestaTexto}"` });

  } catch (err) {
    console.error("❌ Error procesando nota de voz:", err.message || err);
    if (err.response) {
      console.error("Detalles de la respuesta de error:", err.response.data);
    }
    bot.sendMessage(chatId, "No alcancé a escucharte bien, ¿me hablas de nuevo?");
  } finally {
    // Limpieza segura de archivos temporales
    try {
      if (fs.existsSync(tempOgg)) fs.unlinkSync(tempOgg);
      if (fs.existsSync(tempMp3)) fs.unlinkSync(tempMp3);
    } catch (cleanupError) {
      console.error("Error al eliminar archivos temporales:", cleanupError.message);
    }
  }
});

// --- Servidor HTTP para Health Checks de Northflank / Heroku / Render ---
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
