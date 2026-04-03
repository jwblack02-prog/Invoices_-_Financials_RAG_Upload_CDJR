/**
 * Cloudflare Worker — Telegram webhook receiver for CDJR RAG Bot.
 *
 * Telegram POSTs every incoming message here. The Worker:
 *   1. Parses the update and extracts chatId + question text
 *   2. Fires a Trigger.dev task (query-rag) asynchronously
 *   3. Returns 200 immediately so Telegram doesn't retry
 *
 * The query-rag task handles sending the reply back to Telegram directly.
 *
 * Secrets (set via `npx wrangler secret put <NAME>`):
 *   TRIGGER_PROD_SECRET_KEY  — Trigger.dev production secret key
 *   TELEGRAM_BOT_TOKEN       — Telegram bot token from @BotFather
 *
 * Deploy: npx wrangler deploy
 * Set webhook: curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://cdjr-telegram-webhook.<subdomain>.workers.dev/"
 */

interface Env {
  TRIGGER_PROD_SECRET_KEY: string;
  TELEGRAM_BOT_TOKEN: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("OK", { status: 200 });
    }

    let update: any;
    try {
      update = await request.json();
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

    // Fire-and-forget: trigger the Trigger.dev task
    const triggerRes = await fetch(
      "https://api.trigger.dev/api/v1/tasks/query-rag/trigger",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.TRIGGER_PROD_SECRET_KEY}`,
        },
        body: JSON.stringify({
          payload: { question, chatId },
        }),
      }
    );

    if (!triggerRes.ok) {
      // Log error but still return 200 to Telegram (avoid retries)
      console.error(
        `Trigger.dev error: ${triggerRes.status} ${await triggerRes.text()}`
      );

      // Send a user-facing error message via Telegram
      await fetch(
        `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text: "❌ Sorry, I couldn't start processing your question. Please try again.",
          }),
        }
      );
    }

    return new Response("OK", { status: 200 });
  },
};
