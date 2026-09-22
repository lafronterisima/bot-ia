import { Telegraf } from 'telegraf';
import OpenAI from 'openai';

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Handler para Vercel Serverless
export default async function handler(req, res) {
  // 1. Responder INMEDIATAMENTE a Telegram para evitar el reintento
  if (req.method === 'POST') {
    res.status(200).json({ status: 'ok' });

    try {
      const update = req.body;
      if (!update || !update.message || !update.message.text) return;

      const chatId = update.message.chat.id;
      const userText = update.message.text;

      // 2. Llamada a la IA con timeout interno para asegurar que responda rápido
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini', // Usa modelos rápidos como gpt-4o-mini o llama-3.3-70b
        messages: [
          { role: 'system', content: 'Eres Maya, una amiga virtual empática y relajada.' },
          { role: 'user', content: userText }
        ],
        max_tokens: 150 // Respuestas cortas para garantizar velocidad
      });

      const reply = completion.choices[0]?.message?.content || "¡Ups! Me quedé pensando...";

      // 3. Enviar mensaje por la API de Telegram directamente
      await bot.telegram.sendMessage(chatId, reply);

    } catch (error) {
      console.error("Error en Serverless:", error);
      // No reasignes el status aquí porque res ya fue enviado arriba
    }
  } else {
    res.status(200).send('Bot activo');
  }
}
