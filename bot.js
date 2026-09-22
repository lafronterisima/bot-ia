const { Telegraf } = require('telegraf');
const OpenAI = require('openai');

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Almacenamiento temporal de historial por usuario
const chatHistories = {};

const SYSTEM_PROMPT = {
  role: 'system',
  content: 'Eres Valeria, una amiga virtual empática, divertida y cercana. Hablas en español informal y natural.'
};

bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const userMessage = ctx.message.text;

  // Inicializar historial si no existe
  if (!chatHistories[userId]) {
    chatHistories[userId] = [SYSTEM_PROMPT];
  }

  // Agregar mensaje del usuario
  chatHistories[userId].push({ role: 'user', content: userMessage });

  // Mantener el historial manejable (últimos 15 mensajes)
  if (chatHistories[userId].length > 16) {
    chatHistories[userId] = [SYSTEM_PROMPT, ...chatHistories[userId].slice(-15)];
  }

  try {
    // Generar respuesta con la IA
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: chatHistories[userId],
      temperature: 0.8, // Mayor creatividad/naturalidad
    });

    const botResponse = completion.choices[0].message.content;

    // Guardar respuesta del bot en el historial
    chatHistories[userId].push({ role: 'assistant', content: botResponse });

    // Responder en Telegram
    await ctx.reply(botResponse);
  } catch (error) {
    console.error('Error al generar respuesta:', error);
    await ctx.reply('Uy, me distraje un segundo... ¿me repites?');
  }
});

bot.launch();