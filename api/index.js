const { Telegraf } = require('telegraf');
const { OpenAI } = require('openai');
const axios = require('axios');
const googleTTS = require('google-tts-api');

// Configuración de clientes
const bot = new Telegraf(process.env.TELEGRAM_TOKEN);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Historial conversacional en memoria
const historialChat = {};

const SYSTEM_PROMPT = {
  role: "system",
  content: "Eres Maya, una amiga virtual cercana, empática, divertida y atenta. " +
           "Hablas en español de forma natural e informal. Usas emojis ocasionalmente. " +
           "Tus respuestas son breves y fluidas (máximo 2 a 3 frases)."
};

// Función para limitar el historial y evitar ralentizar las peticiones
function obtenerHistorialLimpio(chatId) {
  if (!historialChat[chatId]) {
    historialChat[chatId] = [SYSTEM_PROMPT];
  }
  // Mantener solo el prompt del sistema y los últimos 6 mensajes
  if (historialChat[chatId].length > 7) {
    historialChat[chatId] = [
      SYSTEM_PROMPT,
      ...historialChat[chatId].slice(-6)
    ];
  }
  return historialChat[chatId];
}

// Función para convertir texto a voz devolviendo un Buffer
async function textoAVozBuffer(texto) {
  const urls = googleTTS.getAllAudioUrls(texto, {
    lang: 'es',
    slow: false,
    host: 'https://translate.google.com',
  });
  const buffers = [];
  for (const item of urls) {
    const res = await axios({ url: item.url, method: 'GET', responseType: 'arraybuffer' });
    buffers.push(Buffer.from(res.data));
  }
  return Buffer.concat(buffers);
}

// 1. Comando /start
bot.start((ctx) => {
  const chatId = ctx.chat.id;
  historialChat[chatId] = [SYSTEM_PROMPT];
  return ctx.reply("¡Hola! 👋 Soy Maya, tu nueva amiga virtual. ¿Cómo estás hoy? ¡Cuéntame de ti!");
});

// 2. Mensajes de TEXTO
bot.on('text', async (ctx) => {
  const chatId = ctx.chat.id;
  const texto = ctx.message.text;

  const historial = obtenerHistorialLimpio(chatId);
  historial.push({ role: "user", content: texto });

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: historial,
      max_tokens: 150
    });

    const respuestaTexto = completion.choices[0].message.content;
    historial.push({ role: "assistant", content: respuestaTexto });

    await ctx.reply(respuestaTexto);
  } catch (error) {
    console.error("Error procesando texto:", error.message);
    await ctx.reply("¡Uy! Me distraje un segundo. ¿Me repites?");
  }
});

// 3. NOTAS DE VOZ
bot.on('voice', async (ctx) => {
  const chatId = ctx.chat.id;
  const historial = obtenerHistorialLimpio(chatId);

  try {
    await ctx.sendChatAction('record_voice');

    // Obtener la URL del archivo de voz desde Telegram
    const fileId = ctx.message.voice.file_id;
    const fileUrl = await ctx.telegram.getFileLink(fileId);

    // Descargar el audio en un Buffer
    const responseAudio = await axios({ url: fileUrl.href, method: 'GET', responseType: 'arraybuffer' });
    const audioBuffer = Buffer.from(responseAudio.data);

    // Transcripción con Whisper
    const file = await OpenAI.toFile(audioBuffer, 'voice.ogg', { type: 'audio/ogg' });
    const transcription = await openai.audio.transcriptions.create({
      file: file,
      model: "whisper-1",
      language: "es"
    });

    const textoUsuario = transcription.text;
    historial.push({ role: "user", content: textoUsuario });

    // Respuesta de GPT
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: historial,
      max_tokens: 120
    });

    const respuestaTexto = completion.choices[0].message.content;
    historial.push({ role: "assistant", content: respuestaTexto });

    // Conversión TTS y envío
    const mp3Buffer = await textoAVozBuffer(respuestaTexto);
    await ctx.replyWithVoice(
      { source: mp3Buffer, filename: 'respuesta.mp3' },
      { caption: `🎙️ Maya: "${respuestaTexto}"` }
    );

  } catch (err) {
    console.error("Error en nota de voz:", err.message);
    await ctx.reply("No alcancé a escucharte bien, ¿me hablas de nuevo?");
  }
});

// Handler exportado para la función Serverless de Vercel
module.exports = async (req, res) => {
  try {
    if (req.method === 'POST') {
      // 1. Responder 200 OK a Telegram de inmediato para detener reintentos
      res.status(200).send('OK');

      // 2. Procesar el evento en segundo plano sin pasarle 'res' a Telegraf
      await bot.handleUpdate(req.body);
    } else {
      res.status(200).send('Maya está activa en Vercel.');
    }
  } catch (error) {
    console.error('Error en Webhook:', error.message);
    if (!res.headersSent) {
      res.status(500).send('Error interno');
    }
  }
};
