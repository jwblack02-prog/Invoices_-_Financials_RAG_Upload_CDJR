# CDJR Invoice RAG Agent

Monitors a OneDrive for Business folder, extracts text from PDFs (with OCR fallback), embeds them, and stores vectors in Supabase. A Telegram bot answers questions against that data.

---

## Architecture

```
OneDrive (delta sync) → PDF download → unpdf / Mistral OCR fallback
  → chunk (900 chars, 175 overlap)
  → Gemini embeddings (gemini-embedding-001, 3072 dims)
  → Supabase pgvector (document_chunks table)

Telegram message → Supabase Edge Function (webhook)
  → fires Trigger.dev task "query-rag"
  → embed question → Supabase similarity search → Gemini answer
  → Telegram reply
```

**Delta token** is stored in `delta_state` table (SQL, not a vector hack).  
**Dedup** via `onedrive_file_id + last_modified` check before re-embedding.

---

## Trigger.dev Tasks

| Task | Schedule | File |
|---|---|---|
| `ingest-one-drive` | Every 15 min (cron) | `src/trigger/ingestOneDrive.ts` |
| `query-rag` | On demand (webhook) | `src/trigger/queryRAG.ts` |

Both live in the same Trigger.dev project: `proj_rlpljlgshcxxubhjfmss`

---

## Environment Variables

### `.env` (local) + Trigger.dev prod dashboard

```env
# Azure / Microsoft Graph
MS_GRAPH_TENANT_ID=
MS_GRAPH_CLIENT_ID=
MS_GRAPH_CLIENT_SECRET=       # Secret VALUE, not the ID
ONEDRIVE_USER_ID=             # user@company.com
ONEDRIVE_FOLDER_PATH=         # e.g. Dealership Documents/Invoices and Financials/Lisa - Invoice Submissions CDJR

# Supabase
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

# Gemini
GEMINI_API_KEY=
EMBEDDING_MODEL=gemini-embedding-001
EMBEDDING_DIMENSIONS=3072

# Mistral (OCR fallback for scanned PDFs)
MISTRAL_API_KEY=

# Chunking
CHUNK_SIZE=900
CHUNK_OVERLAP=175

# Telegram
TELEGRAM_BOT_TOKEN=

# Trigger.dev
TRIGGER_PROJECT_ID=
TRIGGER_SECRET_KEY=           # dev key
TRIGGER_PROD_SECRET_KEY=      # prod key — also set in GitHub Actions secret
```

**Trigger.dev prod dashboard** must have: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, `MISTRAL_API_KEY`, `TELEGRAM_BOT_TOKEN`, `MS_GRAPH_*`, `ONEDRIVE_*`, `EMBEDDING_*`, `CHUNK_*`

---

## Supabase Schema

Run once via `npx supabase db query --linked -f supabase/migrations/001_initial.sql`

Tables: `document_chunks` (vectors + metadata), `delta_state` (delta token)  
RPC: `match_documents(query_embedding, match_count)` — cosine similarity search

> pgvector HNSW index max is 2000 dims. We use 3072, so no HNSW index — sequential scan is fine at invoice scale.

---

## Telegram Webhook

Edge Function deployed on Supabase:
```
https://jrlfjefxxazdymwrcxmb.supabase.co/functions/v1/telegram-webhook
```

Webhook is set via:
```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=<EDGE_FUNCTION_URL>"
```

Edge Function secrets (set via Supabase dashboard or `npx supabase secrets set`):
- `TRIGGER_PROD_SECRET_KEY`
- `TELEGRAM_BOT_TOKEN`

---

## Azure AD App (One-Time, Shared Across Stores)

**Required permissions** (Application type, not Delegated):
- `Files.Read.All`
- `User.Read.All`

After adding: click **Grant admin consent**.

---

## Key Commands

```bash
# Verify Supabase tables + row counts
npx tsx scripts/createSupabaseTables.ts

# Full local ingestion test
npx tsx src/testLocal.ts

# Local query test
npx tsx src/testQuery.ts "What invoices were submitted in March?"

# Wipe and re-ingest from scratch
npx tsx src/reindex.ts && npx tsx src/testLocal.ts

# Deploy tasks to Trigger.dev prod
npx trigger deploy
```

Auto-deploy on push to `main` via `.github/workflows/deploy-trigger.yml`  
(requires `TRIGGER_PROD_SECRET_KEY` set in GitHub repo → Settings → Secrets → Actions)

---

## Adding a Second Store (Buick)

1. Clone this repo into a new repo
2. Update `.env`: new `ONEDRIVE_FOLDER_PATH`, same Azure creds
3. Create a new Supabase project (or add `store_name` column to share one)
4. Create a new Telegram bot via @BotFather
5. Deploy a new Supabase Edge Function or update the existing one to route by bot token
6. Update `ingestOneDrive.ts` task ID and `storeName`

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Telegram bot not responding | Webhook not set or wrong token | Run `getWebhookInfo` — URL should be the Edge Function |
| No executions in Trigger.dev | Webhook URL empty or Edge Function secret wrong | Re-run `setWebhook`, check Edge Function secrets |
| Empty answers | No vectors in Supabase | Run `npx tsx src/testLocal.ts` |
| Auth error on Graph API | Wrong secret (using ID not Value) | Create new secret, copy the **Value** column |
| PDF has no text | Scanned PDF, `unpdf` got nothing | Mistral OCR auto-fires as fallback |
| Wrong delta token state | Stale `delta_state` row | Run `npx tsx src/reindex.ts` to reset |
