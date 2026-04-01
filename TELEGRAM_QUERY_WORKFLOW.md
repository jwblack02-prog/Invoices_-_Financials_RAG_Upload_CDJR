# Telegram RAG Query Bot via n8n

Build a separate project that lets users query the CDJR invoices/financials Pinecone database from Telegram using n8n as the orchestrator.

## Architecture

```
Telegram Message → n8n Webhook → Query Pinecone → Generate LLM Answer → Reply in Telegram
```

## What This Project Needs

### n8n Workflow Nodes (in order)

1. **Telegram Trigger** — listens for incoming messages from a Telegram bot
2. **Gemini Embedding Node** — embed the user's question using the same model/dimensions as the ingestion pipeline
3. **Pinecone Query Node (HTTP Request)** — query the vector database for relevant chunks
4. **LLM Node (OpenRouter or Gemini)** — generate an answer using retrieved chunks as context
5. **Telegram Reply Node** — send the answer back to the user

### Pinecone Database Details

These must match the ingestion pipeline exactly:

| Setting | Value |
|---|---|
| Index name | `invoices-financials-cdjr` |
| Dimensions | `3072` |
| Metric | `cosine` |
| Embedding model | `gemini-embedding-exp-03-07` |
| Cloud/Region | AWS / us-east-1 (serverless) |

### Environment Variables Needed

```
PINECONE_API_KEY=<same key used in ingestion project>
GEMINI_API_KEY=<same key used in ingestion project>
TELEGRAM_BOT_TOKEN=<from @BotFather on Telegram>
LLM_API_KEY=<OpenRouter or Gemini API key for answer generation>
```

## Detailed n8n Node Configuration

### Node 1: Telegram Trigger

- **Trigger on:** Message
- **Bot Token:** `{{ $env.TELEGRAM_BOT_TOKEN }}`
- Output: `{{ $json.message.text }}` (the user's question)

### Node 2: Embed the Question (HTTP Request)

Call Gemini's embedding API to convert the question into a vector.

- **Method:** POST
- **URL:** `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-exp-03-07:embedContent?key={{ $env.GEMINI_API_KEY }}`
- **Body (JSON):**
```json
{
  "content": {
    "parts": [{ "text": "{{ $json.message.text }}" }]
  },
  "taskType": "RETRIEVAL_QUERY",
  "outputDimensionality": 3072
}
```
- Output: `{{ $json.embedding.values }}` (the 3072-dim vector)

### Node 3: Query Pinecone (HTTP Request)

Search for the most relevant document chunks.

- **Method:** POST
- **URL:** `https://invoices-financials-cdjr-<PINECONE_ENV>.svc.pinecone.io/query`
  - Get the full host URL from your Pinecone dashboard > index > Connect
- **Headers:**
  - `Api-Key: {{ $env.PINECONE_API_KEY }}`
  - `Content-Type: application/json`
- **Body (JSON):**
```json
{
  "vector": {{ $json.embedding.values }},
  "topK": 5,
  "includeMetadata": true
}
```
- Output: Array of matches with `metadata.source_file`, `metadata.folder_path`, and the chunk text

### Node 4: Build Context + LLM Prompt (Code Node)

Combine the retrieved chunks into a prompt for the LLM.

```javascript
const matches = $input.first().json.matches;
const question = $('Telegram Trigger').first().json.message.text;

const context = matches
  .filter(m => m.metadata && m.metadata._type !== 'sentinel')
  .map((m, i) => `[${i + 1}] (${m.metadata.source_file}): ${m.metadata.text || 'No text available'}`)
  .join('\n\n');

const prompt = `You are a helpful assistant for Black Automotive Group's CDJR dealership. Answer questions about invoices and financial documents based on the context provided.

CONTEXT FROM DOCUMENTS:
${context}

QUESTION: ${question}

Answer based only on the provided context. If the information is not in the context, say so. Include which source file(s) the information came from.`;

return [{ json: { prompt, question } }];
```

### Node 5: Generate Answer (HTTP Request to OpenRouter or Gemini)

**Option A: OpenRouter**
- **Method:** POST
- **URL:** `https://openrouter.ai/api/v1/chat/completions`
- **Headers:**
  - `Authorization: Bearer {{ $env.LLM_API_KEY }}`
  - `Content-Type: application/json`
- **Body:**
```json
{
  "model": "google/gemini-2.0-flash-001",
  "messages": [
    { "role": "user", "content": "{{ $json.prompt }}" }
  ],
  "max_tokens": 1000
}
```

**Option B: Gemini directly**
- **Method:** POST
- **URL:** `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={{ $env.GEMINI_API_KEY }}`
- **Body:**
```json
{
  "contents": [
    { "parts": [{ "text": "{{ $json.prompt }}" }] }
  ]
}
```

### Node 6: Reply in Telegram

- **Operation:** Send Message
- **Chat ID:** `{{ $('Telegram Trigger').first().json.message.chat.id }}`
- **Text:** `{{ $json.choices[0].message.content }}` (OpenRouter) or `{{ $json.candidates[0].content.parts[0].text }}` (Gemini)

## Setup Steps

1. **Create Telegram Bot:**
   - Message @BotFather on Telegram
   - Send `/newbot`, follow prompts
   - Save the bot token

2. **Set up n8n:**
   - Create a new workflow
   - Add nodes in the order above
   - Set credentials/env vars in n8n settings

3. **Get Pinecone Host URL:**
   - Go to Pinecone dashboard > `invoices-financials-cdjr` index > Connect
   - Copy the full host URL (looks like `invoices-financials-cdjr-xxxxxxx.svc.aped-xxxx-xxx.pinecone.io`)

4. **Test:**
   - Send a message to your Telegram bot: "What invoices were submitted last month?"
   - Verify it queries Pinecone and returns a contextual answer

## Optional Enhancements

- **Chat memory:** Add a Code node that stores last N messages per chat ID (use n8n's static data or a Redis store)
- **Multi-store support:** Add a command like `/cdjr` or `/store2` to select which Pinecone index to query
- **File source links:** Include OneDrive links to source documents in the response
- **Rate limiting:** Add a Code node to throttle queries per user
