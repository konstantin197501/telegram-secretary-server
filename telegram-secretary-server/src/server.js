import express from "express";

const app = express();
app.use(express.json({ limit: "2mb" }));

const {
  TELEGRAM_BOT_TOKEN,
  OPENAI_API_KEY,
  OPENAI_MODEL = "gpt-4.1-mini",
  TELEGRAM_SECRET_TOKEN,
  BOT_MODE = "draft",
  PORT = 3000,
} = process.env;

if (!TELEGRAM_BOT_TOKEN) {
  console.warn("TELEGRAM_BOT_TOKEN is not set.");
}

if (!OPENAI_API_KEY) {
  console.warn("OPENAI_API_KEY is not set.");
}

const telegramApi = (method) =>
  `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`;

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "telegram-secretary-server",
    mode: BOT_MODE,
  });
});

app.post("/webhook", async (req, res) => {
  try {
    if (TELEGRAM_SECRET_TOKEN) {
      const received = req.get("X-Telegram-Bot-Api-Secret-Token");
      if (received !== TELEGRAM_SECRET_TOKEN) {
        return res.status(401).json({ ok: false, error: "Invalid secret token" });
      }
    }

    res.status(200).json({ ok: true });
    await handleTelegramUpdate(req.body);
  } catch (error) {
    console.error("Webhook error:", error);
  }
});

async function handleTelegramUpdate(update) {
  const source =
    update.business_message ||
    update.edited_business_message ||
    update.message ||
    update.edited_message;

  if (!source || !source.text) {
    return;
  }

  const chatId = source.chat?.id;
  const text = source.text.trim();
  const businessConnectionId = source.business_connection_id;

  if (!chatId || !text) {
    return;
  }

  const reply = await buildAssistantReply({
    text,
    fromName: [source.from?.first_name, source.from?.last_name]
      .filter(Boolean)
      .join(" "),
  });

  const finalText =
    BOT_MODE === "auto"
      ? reply
      : `Черновик ответа:\n\n${reply}\n\nЧтобы включить автоответы, поставьте BOT_MODE=auto.`;

  await sendTelegramMessage({
    chatId,
    text: finalText,
    businessConnectionId,
  });
}

async function buildAssistantReply({ text, fromName }) {
  if (!OPENAI_API_KEY) {
    return "Сервер бота работает, но OPENAI_API_KEY пока не настроен.";
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      instructions:
        "Ты личный деловой Telegram-секретарь Константина. Пиши кратко, вежливо, по-русски, если собеседник пишет по-русски. Не обещай фактов, которых не знаешь. Если нужен ответ от владельца, предложи аккуратный черновик.",
      input: [
        {
          role: "user",
          content: `Сообщение в Telegram${fromName ? ` от ${fromName}` : ""}:\n${text}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("OpenAI API error:", errorText);
    return "Сервер получил сообщение, но OpenAI API вернул ошибку. Проверьте OPENAI_API_KEY, баланс и модель.";
  }

  const data = await response.json();
  return (
    data.output_text ||
    data.output
      ?.flatMap((item) => item.content || [])
      ?.map((content) => content.text)
      ?.filter(Boolean)
      ?.join("\n") ||
    "Не получилось сформировать ответ."
  );
}

async function sendTelegramMessage({ chatId, text, businessConnectionId }) {
  if (!TELEGRAM_BOT_TOKEN) {
    console.error("Cannot send Telegram message: TELEGRAM_BOT_TOKEN is not set.");
    return;
  }

  const payload = {
    chat_id: chatId,
    text,
  };

  if (businessConnectionId) {
    payload.business_connection_id = businessConnectionId;
  }

  const response = await fetch(telegramApi("sendMessage"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    console.error("Telegram API error:", await response.text());
  }
}

if (!process.env.VERCEL) {
  app.listen(Number(PORT), () => {
    console.log(`Telegram secretary server listening on port ${PORT}`);
  });
}

export default app;
