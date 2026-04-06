/**
 * Supabase Edge Function — Telegram webhook receiver for CDJR RAG Bot.
 *
 * Telegram POSTs every incoming message here. This function:
 *   1. Parses the update and extracts chatId + question text
 *   2. Fires a Trigger.dev task (query-rag) asynchronously
 *   3. Returns 200 immediately so Telegram doesn't retry
 *
 * The query-rag task handles sending the reply back to Telegram directly.
 *
 * Secrets (set via Supabase dashboard or `supabase secrets set`):
 *   TRIGGER_PROD_SECRET_KEY  — Trigger.dev production secret key
 *   TELEGRAM_BOT_TOKEN       — Telegram bot token from @BotFather
 *
 * Deploy: supabase functions deploy telegram-webhook
 * Set webhook: curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<project-ref>.supabase.co/functions/v1/telegram-webhook"
 */

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("OK", { status: 200 });
  }

  let update: any;
  try {
    update = await req.json();
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  // Only handle regular text messages
  const message = update?.message;
  if (!message?.text || !message?.chat?.id) {
    return new Response("OK", { status: 200 });
  }

  const chatId = String(message.chat.id);
  const question = message.text.trim();

  const triggerSecretKey = Deno.env.get("TRIGGER_PROD_SECRET_KEY")!;
  const telegramBotToken = Deno.env.get("TELEGRAM_BOT_TOKEN")!;

  const triggerRes = await fetch(
    "https://api.trigger.dev/api/v1/tasks/query-rag/trigger",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${triggerSecretKey}`,
      },
      body: JSON.stringify({ payload: { question, chatId } }),
    }
  );

  if (!triggerRes.ok) {
    console.error(`Trigger.dev error: ${triggerRes.status} ${await triggerRes.text()}`);
    // Send user-facing error and still return 200 to avoid Telegram retries
    await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: "❌ Sorry, I couldn't start processing your question. Please try again.",
      }),
    });
  }

  return new Response("OK", { status: 200 });
});
