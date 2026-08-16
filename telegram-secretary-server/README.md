# Telegram Secretary Server

Минимальный сервер для бота `@KonstantinSecretaryNewBot`.

Он принимает сообщения Telegram через `/webhook`, отправляет текст в OpenAI API и возвращает ответ в Telegram. По умолчанию бот работает в режиме черновика (`BOT_MODE=draft`), чтобы сначала не отправлять автоматические ответы без контроля.

## Переменные окружения

В Render/Railway/Vercel задайте:

```text
TELEGRAM_BOT_TOKEN=новый токен из BotFather
OPENAI_API_KEY=ваш OpenAI API key
OPENAI_MODEL=gpt-4.1-mini
BOT_MODE=draft
TELEGRAM_SECRET_TOKEN=любая длинная случайная строка
PORT=3000
```

После того как старый Telegram token был показан в чате, его нужно заменить:

```text
@BotFather -> /mybots -> Konstantin Secretary -> API Token -> Revoke
```

## Локальный запуск

```bash
npm install
cp .env.example .env
npm start
```

Для локальной проверки нужен публичный HTTPS-туннель, например ngrok или Cloudflare Tunnel. Для постоянной работы проще использовать Render или Railway.

## Render

1. Создайте новый Web Service.
2. Подключите этот проект.
3. Build command:

```bash
npm install
```

4. Start command:

```bash
npm start
```

5. Добавьте переменные окружения из раздела выше.
6. После деплоя откройте:

```text
https://ВАШ-СЕРВЕР.onrender.com/health
```

Должно вернуть JSON с `"ok": true`.

## Подключение webhook

После деплоя выполните в браузере:

```text
https://api.telegram.org/botНОВЫЙ_TELEGRAM_TOKEN/setWebhook?url=https://ВАШ-СЕРВЕР.onrender.com/webhook&secret_token=ВАШ_TELEGRAM_SECRET_TOKEN&allowed_updates=["message","edited_message","business_message","edited_business_message","deleted_business_messages","business_connection"]
```

Потом проверьте:

```text
https://api.telegram.org/botНОВЫЙ_TELEGRAM_TOKEN/getWebhookInfo
```

Нормально, если `url` заполнен адресом `/webhook`, а `pending_update_count` равен `0` или небольшому числу.

## Режимы работы

```text
BOT_MODE=draft
```

Бот отвечает черновиком: безопасный режим для начала.

```text
BOT_MODE=auto
```

Бот отвечает сразу. Включайте только после тестов на выбранных чатах.
