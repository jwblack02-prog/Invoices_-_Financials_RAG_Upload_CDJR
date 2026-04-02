# CDJR Invoice Query Bot — Telegram via n8n + Trigger.dev

Query the CDJR invoices/financials Pinecone database from Telegram.

## Architecture

```
[Telegram Bot] → [n8n: "CDJR Invoice Query Bot"]
                      ↓
               [HTTP POST to Trigger.dev API]
               (trigger "query-rag" task)
                      ↓
            [Trigger.dev runs query-rag task]
              1. Embed question (Gemini gemini-embedding-001, RETRIEVAL_QUERY, 3072 dims)
              2. Query Pinecone (top 5 chunks, filter out sentinel)
              3. Generate answer (Gemini 2.5 Flash)
              4. Return { answer, sources }
                      ↓
               [n8n polls for result]
                      ↓
            [Telegram Reply with answer + source files]
```

## Components

| Component | Where | Purpose |
|---|---|---|
| Telegram Bot | Telegram (@BotFather) | User interface |
| n8n Workflow | `https://ai.blackbuick.org` | Telegram glue — trigger, wait, reply |
| Trigger.dev Task | Same project as ingestion | Query logic — embed, search, LLM |
| Pinecone | `invoices-financials-cdjr` | Vector database with CDJR invoice chunks |
| Gemini | Google AI | Embeddings + answer generation |

## n8n Workflow: "CDJR Invoice Query Bot"

**Workflow ID:** `4QPhR9gBAQViCQ4v`
**URL:** `https://ai.blackbuick.org/workflow/4QPhR9gBAQViCQ4v`

### Nodes

1. **Telegram Trigger** — listens for messages to the bot
2. **Trigger Query Task** — HTTP POST to `https://api.trigger.dev/api/v1/tasks/query-rag/trigger` with `{ "payload": { "question": "..." } }`
3. **Wait for Processing** — 3 second delay
4. **Get Run Result** — HTTP GET to `https://api.trigger.dev/api/v1/runs/{runId}`
5. **Is Completed?** — checks if `status === "COMPLETED"`
   - Yes → Format Answer → Reply in Telegram
   - No → Send "still processing" → loop back to Wait
6. **Format Answer** — extracts answer + source file names from output
7. **Reply in Telegram** — sends the answer back to the user

### Setup Steps

1. Open the workflow at the URL above
2. Click the **Telegram Trigger** node → add your Telegram bot credential (bot token from @BotFather)
3. Click the **Reply in Telegram** and **Still Processing** nodes → select the same Telegram credential
4. **Activate** the workflow (toggle in top right)
5. Send a message to your bot: "What invoices were submitted in March?"

## Trigger.dev Task: `query-rag`

Lives in the same repo and project as the ingestion task.

**Files:**
- `src/trigger/queryRAG.ts` — task definition
- `src/lib/embedder.ts` — `embedQuery()` function (RETRIEVAL_QUERY task type)
- `src/lib/pineconeClient.ts` — `queryVectors()` function
- `src/lib/llm.ts` — `generateAnswer()` using Gemini 2.5 Flash

**Trigger.dev project:** `proj_rlpljlgshcxxubhjfmss`
**Task ID:** `query-rag`
**Auth:** Bearer token using `TRIGGER_PROD_SECRET_KEY`

### API Endpoints

**Trigger a query:**
```
POST https://api.trigger.dev/api/v1/tasks/query-rag/trigger
Authorization: Bearer <TRIGGER_PROD_SECRET_KEY>
Content-Type: application/json

{
  "payload": {
    "question": "What invoices were submitted in March?"
  }
}
```

**Check result:**
```
GET https://api.trigger.dev/api/v1/runs/<run_id>
Authorization: Bearer <TRIGGER_PROD_SECRET_KEY>
```

Response when complete:
```json
{
  "status": "COMPLETED",
  "output": {
    "answer": "The following invoices were submitted in March: ...",
    "sources": [
      { "id": "...", "score": 0.70, "text": "...", "metadata": { "source_file": "cdjr0316.pdf", ... } }
    ]
  }
}
```

## Pinecone Database Details

Must match the ingestion pipeline:

| Setting | Value |
|---|---|
| Index name | `invoices-financials-cdjr` |
| Dimensions | `3072` |
| Metric | `cosine` |
| Embedding model | `gemini-embedding-001` |
| Query task type | `RETRIEVAL_QUERY` |
| Ingestion task type | `RETRIEVAL_DOCUMENT` |

## Environment Variables (Trigger.dev)

These are already set from the ingestion pipeline — no new env vars needed:
```
PINECONE_API_KEY
PINECONE_INDEX_NAME=invoices-financials-cdjr
GEMINI_API_KEY
EMBEDDING_MODEL=gemini-embedding-001
EMBEDDING_DIMENSIONS=3072
```

## Testing Locally

```bash
npx tsx src/testQuery.ts "What invoices were submitted in March?"
```

## Troubleshooting

| Issue | Cause | Fix |
|---|---|---|
| Bot not responding | Workflow not activated in n8n | Toggle active in n8n workflow editor |
| "Still processing" loops forever | Task failing in Trigger.dev | Check Trigger.dev dashboard for errors |
| Empty/wrong answers | Wrong embedding model or task type | Must use `gemini-embedding-001` with `RETRIEVAL_QUERY` |
| `models/xxx is not found` | Gemini model retired | Check available models, update `llm.ts` |
| No text in results | Missing text in Pinecone metadata | Re-run `npx tsx src/reindex.ts` then `npx tsx src/testLocal.ts` |
| Sentinel in results | Missing filter | `queryVectors()` filters `_type !== "sentinel"` |

## Multi-Store Support

To add a second store's query bot:
1. Create a new Telegram bot via @BotFather
2. Duplicate the n8n workflow
3. The query-rag task already reads from `PINECONE_INDEX_NAME` — for multi-store, add a second task with a different index name, or accept a `store` parameter in the payload
