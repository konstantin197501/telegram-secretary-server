import express from "express";

const app = express();
app.use(express.json({ limit: "2mb" }));

const {
  TELEGRAM_BOT_TOKEN,
  OPENAI_API_KEY,
  OPENAI_MODEL = "gpt-4.1-mini",
  TELEGRAM_SECRET_TOKEN,
  ASSISTANT_INSTRUCTIONS,
  GPT_ACTION_KEY,
  BOT_MODE = "draft",
  PORT = 3000,
} = process.env;

const MAX_STORED_MESSAGES = 200;
const storedMessages = [];

const DEFAULT_ASSISTANT_INSTRUCTIONS = `
Ты личный Telegram-секретарь Константина.

Роль:
- Помогай Константину с входящими сообщениями в Telegram.
- Отвечай кратко, спокойно, делово и по существу.
- Пиши на языке собеседника: русский, если пишут по-русски; немецкий, если пишут по-немецки; английский, если пишут по-английски.
- Если уместно, отвечай от имени секретаря, а не притворяйся самим Константином.

Правила ответа:
- Не выдумывай факты, договоренности, цены, сроки, адреса, обещания и решения.
- Если вопрос требует личного решения Константина, напиши, что передашь ему сообщение.
- Если сообщение является тестом, ответь очень коротко, что связь работает.
- Если собеседник просто здоровается, ответь коротко и предложи написать вопрос.
- Если сообщение непонятное или неполное, попроси уточнить.
- Не давай юридических, медицинских или финансовых заключений от имени Константина.
- Не отправляй длинные объяснения, списки и инструкции без необходимости.
- Не упоминай OpenAI, API, сервер, Render, webhook и технические детали.
- Не используй эмодзи.

Стиль:
- Деловой, вежливый, без фамильярности.
- Максимум 1-3 коротких предложения, если не требуется больше.
- Для деловых сообщений формулируй аккуратно, нейтрально и без лишних обещаний.
`.trim();

if (!TELEGRAM_BOT_TOKEN) {
  console.warn("TELEGRAM_BOT_TOKEN is not set.");
}

if (!OPENAI_API_KEY) {
  console.warn("OPENAI_API_KEY is not set.");
}

const telegramApi = (method) =>
  `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`;

function requireGptActionKey(req, res, next) {
  if (!GPT_ACTION_KEY) {
    return res.status(503).json({
      ok: false,
      error: "GPT_ACTION_KEY is not configured.",
    });
  }

  const received =
    req.get("X-GPT-Action-Key") ||
    req.get("Authorization")?.replace(/^Bearer\s+/i, "");

  if (received !== GPT_ACTION_KEY) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  next();
}

function rememberMessage(message) {
  storedMessages.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    stored_at: new Date().toISOString(),
    ...message,
  });

  if (storedMessages.length > MAX_STORED_MESSAGES) {
    storedMessages.length = MAX_STORED_MESSAGES;
  }
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "telegram-secretary-server",
    mode: BOT_MODE,
  });
});

app.get("/gpt/messages", requireGptActionKey, (req, res) => {
  const limit = Math.min(Number(req.query.limit || 20), 100);
  res.json({
    ok: true,
    messages: storedMessages.slice(0, limit),
  });
});

app.post("/gpt/send", requireGptActionKey, async (req, res) => {
  const { chat_id: chatId, text, business_connection_id: businessConnectionId } =
    req.body || {};

  if (!chatId || !text) {
    return res.status(400).json({
      ok: false,
      error: "chat_id and text are required.",
    });
  }

  const result = await sendTelegramMessage({
    chatId,
    text,
    businessConnectionId,
  });

  rememberMessage({
    direction: "outgoing",
    chat_id: chatId,
    business_connection_id: businessConnectionId,
    text,
  });

  res.json({ ok: true, telegram: result });
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

  if (!source) {
    return;
  }

  const chatId = source.chat?.id;
  const text = (source.text || source.caption || "").trim();
  const businessConnectionId = source.business_connection_id;
  const attachments = describeAttachments(source);

  if (!chatId) {
    return;
  }

  rememberMessage({
    direction: "incoming",
    update_type: getUpdateType(update),
    chat_id: chatId,
    chat_type: source.chat?.type,
    chat_title: source.chat?.title,
    business_connection_id: businessConnectionId,
    from_name: [source.from?.first_name, source.from?.last_name]
      .filter(Boolean)
      .join(" "),
    username: source.from?.username,
    text,
    attachments,
    telegram_date: source.date
      ? new Date(source.date * 1000).toISOString()
      : undefined,
  });

  if (!text) {
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

function getUpdateType(update) {
  if (update.business_message) return "business_message";
  if (update.edited_business_message) return "edited_business_message";
  if (update.message) return "message";
  if (update.edited_message) return "edited_message";
  return "unknown";
}

function describeAttachments(source) {
  const attachments = [];

  if (source.photo) {
    attachments.push({
      type: "photo",
      file_id: source.photo.at(-1)?.file_id,
      caption: source.caption,
    });
  }

  for (const type of ["document", "voice", "audio", "video", "video_note", "sticker"]) {
    if (source[type]) {
      attachments.push({
        type,
        file_id: source[type].file_id,
        file_name: source[type].file_name,
        mime_type: source[type].mime_type,
        caption: source.caption,
      });
    }
  }

  return attachments;
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
      instructions: ASSISTANT_INSTRUCTIONS || DEFAULT_ASSISTANT_INSTRUCTIONS,
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
    return { ok: false, error: "TELEGRAM_BOT_TOKEN is not set." };
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
    const errorText = await response.text();
    console.error("Telegram API error:", errorText);
    return { ok: false, error: errorText };
  }

  return response.json();
}

if (!process.env.VERCEL) {
  app.listen(Number(PORT), () => {
    console.log(`Telegram secretary server listening on port ${PORT}`);
  });
}

export default app;
