# Telegram Query Bot

See `ONEDRIVE_RAG_BLUEPRINT.md` for full architecture and setup.

## Flow

```
Telegram message → Supabase Edge Function → Trigger.dev "query-rag" task → Telegram reply
```

The Edge Function fires the task asynchronously and returns 200 immediately.  
The task embeds the question, searches Supabase, generates an answer with Gemini, and replies directly to Telegram.

## Trigger.dev Task

**ID:** `query-rag`  
**File:** `src/trigger/queryRAG.ts`  
**Payload:** `{ question: string, chatId: string }`

## Edge Function

**URL:** `https://jrlfjefxxazdymwrcxmb.supabase.co/functions/v1/telegram-webhook`  
**File:** `supabase/functions/telegram-webhook/index.ts`  
**Secrets needed:** `TRIGGER_PROD_SECRET_KEY`, `TELEGRAM_BOT_TOKEN`

## Verify Webhook

```bash
curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"
# url should be the Edge Function URL above
```
