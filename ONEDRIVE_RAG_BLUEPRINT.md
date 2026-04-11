# CDJR Invoice RAG Agent

Monitors a OneDrive folder, extracts text from PDFs (OCR fallback), embeds chunks, stores vectors in Supabase. A Telegram bot answers questions against that data.

## Architecture

```
OneDrive (delta sync) -> PDF -> unpdf / Mistral OCR fallback
  -> chunk (900 chars, 175 overlap)
  -> Gemini embeddings (gemini-embedding-001, 3072 dims)
  -> Supabase pgvector (document_chunks)

Telegram -> Supabase Edge Function -> Trigger.dev "query-rag"
  -> embed question -> vector + FTS hybrid search -> Gemini answer -> Telegram reply
```

## Trigger.dev Tasks

| Task | Schedule | File |
|---|---|---|
| `ingest-one-drive` | Every 15 min (cron) | `src/trigger/ingestOneDrive.ts` |
| `query-rag` | On demand (Telegram webhook) | `src/trigger/queryRAG.ts` |

Project: `proj_rlpljlgshcxxubhjfmss`. Auto-deploys on push to `main` via `.github/workflows/deploy-trigger.yml`.

## Supabase

**Tables:** `document_chunks` (vectors + metadata + FTS), `delta_state` (OneDrive delta token)
**RPC functions:** `match_documents` (cosine similarity), `search_documents_fts` (keyword search, OR-logic)
**Note:** pgvector HNSW index max is 2000 dims; we use 3072, so no HNSW -- sequential scan is fine at invoice scale.

## Environment Variables

**`.env` + Trigger.dev dashboard:** `MS_GRAPH_TENANT_ID`, `MS_GRAPH_CLIENT_ID`, `MS_GRAPH_CLIENT_SECRET` (Value, not ID), `ONEDRIVE_USER_ID`, `ONEDRIVE_FOLDER_PATH`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, `MISTRAL_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TRIGGER_PROJECT_ID`, `TRIGGER_SECRET_KEY`, `TRIGGER_PROD_SECRET_KEY`

**Edge Function secrets** (Supabase dashboard): `TRIGGER_PROD_SECRET_KEY`, `TELEGRAM_BOT_TOKEN`

**GitHub Actions secret:** `TRIGGER_PROD_SECRET_KEY`

## Azure AD App (one-time, shared across stores)

Application permissions: `Files.Read.All`, `User.Read.All` -- click **Grant admin consent** after adding.

## Key Commands

```bash
npx tsx src/testLocal.ts                  # full local ingestion test
npx tsx src/testQuery.ts "your question"  # local query test
npx tsx src/reindex.ts                    # wipe and re-ingest from scratch
npx trigger deploy                        # deploy tasks to Trigger.dev prod
```

## Adding a Second Store

1. Clone repo, update `ONEDRIVE_FOLDER_PATH` in `.env`
2. New Supabase project (or add `store_name` column to share one)
3. New Telegram bot via @BotFather
4. New/updated Edge Function to route by bot token

## Troubleshooting

| Symptom | Fix |
|---|---|
| Bot not responding | Check webhook: `curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"` |
| No Trigger.dev executions | Re-run `setWebhook`, verify Edge Function secrets |
| Empty answers | No vectors -- run `npx tsx src/testLocal.ts` |
| Graph API auth error | Recreate secret, copy the **Value** column (not ID) |
| Scanned PDF has no text | Mistral OCR fires automatically as fallback |
| Stale delta token | Run `npx tsx src/reindex.ts` to reset |
