# OneDrive PDF to Pinecone RAG Upload Blueprint

Copy-paste guide for creating a new OneDrive PDF ingestion workflow. This is a proven, battle-tested stack that monitors a OneDrive for Business folder, extracts text from PDFs, generates embeddings, and upserts them into Pinecone.

Use this as a template for each new store / folder you want to ingest.

---

## Quick Start Checklist

- [ ] Create a new GitHub repo
- [ ] Copy all files from the file structure below
- [ ] Create a Pinecone index (3072 dimensions, cosine, serverless)
- [ ] Create a Trigger.dev project and link it
- [ ] Set all environment variables (locally in `.env` and in Trigger.dev)
- [ ] Update `trigger.config.ts` with your new Trigger.dev project ID
- [ ] Update `src/trigger/ingestOneDrive.ts` with your task ID and cron schedule
- [ ] Run `npm install`, then `npx tsx src/testLocal.ts` to verify locally
- [ ] Deploy with `npx trigger deploy`
- [ ] Set up GitHub Actions for auto-deploy on push

---

## Architecture

```
OneDrive for Business
        |
        v
  Microsoft Graph API (delta queries)
        |
        v
  PDF Download (Buffer)
        |
        v
  unpdf (text extraction) -- Uint8Array required
        |
        v
  Character chunking (900 chars, 175 overlap)
        |
        v
  Gemini Embeddings (gemini-embedding-001, 3072 dims)
        |
        v
  Pinecone Upsert (batches of 100)
        |
        v
  Delta token saved as sentinel record in Pinecone
```

**Key design decisions:**
- Delta queries track changes — first run gets everything, subsequent runs get only new/modified/deleted files
- Delta token stored in Pinecone itself (no external state store needed)
- Dedup via Pinecone metadata filter (file ID + last_modified)
- Idempotent vector IDs: `{slugify(fileId)}_c{chunkIndex}` — safe to re-process

---

## Azure AD App Registration (One-Time Setup)

You only need ONE Azure AD app registration for all stores/workflows. Reuse the same credentials.

### Required API Permissions (Application type, NOT delegated)

| Permission | Type | Description |
|---|---|---|
| `Files.Read.All` | Application | Read all files in all drives |
| `User.Read.All` | Application | Resolve user email to object ID |

**After adding permissions:** Click "Grant admin consent" in the Azure portal.

### Finding Your Credentials

| Credential | Where to Find |
|---|---|
| `MS_GRAPH_TENANT_ID` | Azure AD > Overview > Tenant ID |
| `MS_GRAPH_CLIENT_ID` | App Registration > Overview > Application (client) ID |
| `MS_GRAPH_CLIENT_SECRET` | App Registration > Certificates & Secrets > **Client Secret Value** (NOT the Secret ID!) |
| `ONEDRIVE_USER_ID` | The user's **email address** (e.g. `user@company.com`) |

### Common Auth Errors

| Error | Cause | Fix |
|---|---|---|
| `AADSTS7000215 invalid_client` | Using Secret ID instead of Secret Value | Create new secret, copy the **Value** column |
| `User not found` | Missing `User.Read.All` permission | Add permission + grant admin consent |
| `Resource could not be found` | Wrong folder path or missing `Files.Read.All` | Check path, add permission + grant admin consent |

---

## Environment Variables

Create a `.env` file in the project root:

```env
# === Azure / Microsoft Graph ===
MS_GRAPH_TENANT_ID=<your-tenant-id>
MS_GRAPH_CLIENT_ID=<your-client-id>
MS_GRAPH_CLIENT_SECRET=<your-client-secret-VALUE>
ONEDRIVE_USER_ID=<user-email@company.com>

# OneDrive folder path (decoded, no leading slash)
ONEDRIVE_FOLDER_PATH=<path/to/your/folder>

# === Pinecone ===
PINECONE_API_KEY=<your-pinecone-api-key>
PINECONE_INDEX_NAME=<your-index-name>

# === Gemini (Embeddings) ===
GEMINI_API_KEY=<your-gemini-api-key>
EMBEDDING_MODEL=gemini-embedding-001
EMBEDDING_DIMENSIONS=3072

# === Chunking ===
CHUNK_SIZE=900
CHUNK_OVERLAP=175

# === Trigger.dev ===
TRIGGER_PROJECT_ID=<your-trigger-project-id>
TRIGGER_SECRET_KEY=<your-trigger-dev-secret-key>
TRIGGER_PROD_SECRET_KEY=<your-trigger-prod-secret-key>
```

### OneDrive Folder Path

If your SharePoint URL is:
```
https://company-my.sharepoint.com/my?id=%2Fpersonal%2Fuser_company_com%2FDocuments%2FDealership%20Documents%2FInvoices
```

The folder path (URL-decoded, relative to drive root) is:
```
Dealership Documents/Invoices
```

---

## Pinecone Index Setup

Create a new index for each store:

| Setting | Value |
|---|---|
| Dimensions | `3072` |
| Metric | `cosine` |
| Type | Serverless |
| Cloud | AWS |
| Region | `us-east-1` |

---

## File Structure

```
project-root/
  .env                          # Local env vars (gitignored)
  .gitignore
  package.json
  tsconfig.json
  trigger.config.ts             # CHANGE: project ID
  src/
    testLocal.ts                # Local end-to-end test script
    trigger/
      ingestOneDrive.ts         # CHANGE: task ID, cron schedule
    lib/
      types.ts                  # Shared TypeScript interfaces
      graphClient.ts            # Microsoft Graph auth + delta + download
      pdfProcessor.ts           # PDF text extraction + chunking
      embedder.ts               # Gemini embedding with rate limiting
      pineconeClient.ts         # Pinecone upsert, dedup, delete
      deltaTracker.ts           # Delta token read/write in Pinecone
      ingestCore.ts             # Main orchestration logic
  .github/
    workflows/
      deploy-trigger.yml        # Auto-deploy on push to main
```

---

## Files to Copy (with what to change)

### `.gitignore`

```
node_modules/
dist/
.env
.trigger/
```

### `package.json`

```json
{
  "name": "YOUR-PROJECT-NAME",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev:trigger": "npx trigger dev",
    "deploy:trigger": "npx trigger deploy"
  },
  "devDependencies": {
    "@trigger.dev/build": "4.4.3",
    "@trigger.dev/sdk": "4.4.3",
    "@types/node": "^22.0.0",
    "trigger.dev": "4.4.3",
    "tsx": "^4.21.0",
    "typescript": "^5.9.3"
  },
  "dependencies": {
    "@azure/identity": "^4.6.0",
    "@google/genai": "^1.0.0",
    "@microsoft/microsoft-graph-client": "^3.0.0",
    "@pinecone-database/pinecone": "^4.0.0",
    "dotenv": "^17.3.1",
    "unpdf": "^1.4.0"
  }
}
```

**IMPORTANT:** Pin Trigger.dev versions to exact (no `^`). Caret versions cause CLI/runtime mismatches.

### `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": ".",
    "declaration": true,
    "resolveJsonModule": true,
    "allowSyntheticDefaultImports": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*", "trigger.config.ts"],
  "exclude": ["node_modules", "dist"]
}
```

### `trigger.config.ts` -- CHANGE PROJECT ID

```typescript
import { defineConfig } from "@trigger.dev/sdk/v3";

export default defineConfig({
  project: "proj_XXXXXXXXXXXXXXXXXX",  // <-- YOUR Trigger.dev project ID
  runtime: "node",
  logLevel: "log",
  maxDuration: 300,
  dirs: ["src/trigger"],
});
```

**IMPORTANT:** Hardcode the project ID. `process.env.TRIGGER_PROJECT_ID` does NOT work at build time.

### `src/lib/types.ts`

```typescript
export interface DriveItemChange {
  id: string;
  name: string;
  parentPath: string;
  lastModifiedDateTime: string;
  size: number;
  deleted: boolean;
  isFile: boolean;
}

export interface DeltaResponse {
  items: DriveItemChange[];
  deltaToken: string;
}

export interface ChunkRecord {
  id: string;
  text: string;
  metadata: {
    source_file: string;
    onedrive_file_id: string;
    folder_path: string;
    chunk_index: number;
    total_chunks: number;
    last_modified: string;
  };
}

export interface EmbeddedChunk extends ChunkRecord {
  embedding: number[];
}
```

### `src/lib/graphClient.ts`

```typescript
import { ClientSecretCredential } from "@azure/identity";
import { Client } from "@microsoft/microsoft-graph-client";
import { TokenCredentialAuthenticationProvider } from "@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials/index.js";
import type { DeltaResponse, DriveItemChange } from "./types.js";

let graphClient: Client | null = null;

function getClient(): Client {
  if (graphClient) return graphClient;

  const credential = new ClientSecretCredential(
    process.env.MS_GRAPH_TENANT_ID!,
    process.env.MS_GRAPH_CLIENT_ID!,
    process.env.MS_GRAPH_CLIENT_SECRET!
  );

  const authProvider = new TokenCredentialAuthenticationProvider(credential, {
    scopes: ["https://graph.microsoft.com/.default"],
  });

  graphClient = Client.initWithMiddleware({ authProvider });
  return graphClient;
}

async function fetchWithRetry(
  requestFn: () => Promise<any>,
  maxRetries = 3
): Promise<any> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await requestFn();
    } catch (error: any) {
      const status = error?.statusCode || error?.code;

      if (status === 429) {
        const retryAfter = parseInt(error?.headers?.["retry-after"] || "10", 10);
        console.log(`Rate limited by Graph API, waiting ${retryAfter}s...`);
        await new Promise((r) => setTimeout(r, retryAfter * 1000));
        continue;
      }

      if (status === 410) {
        throw new Error("DELTA_TOKEN_EXPIRED");
      }

      if (status >= 500 && attempt < maxRetries - 1) {
        const wait = Math.pow(4, attempt) * 1000;
        console.log(`Graph API error ${status}, retrying in ${wait}ms...`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }

      throw error;
    }
  }
}

export async function getDelta(
  userId: string,
  folderPath: string,
  deltaToken: string | null
): Promise<DeltaResponse> {
  const client = getClient();
  const items: DriveItemChange[] = [];

  let url: string;
  if (deltaToken) {
    url = deltaToken;
  } else {
    console.log(`Resolving folder: /users/${userId}/drive/root:/${folderPath}`);

    try {
      const drive = await fetchWithRetry(() =>
        client.api(`/users/${userId}/drive`).get()
      );
      console.log(`Drive found: ${drive.name} (${drive.driveType})`);
    } catch (err: any) {
      console.error(`Cannot access user drive. userId=${userId}, error=${err.message}`);
      throw err;
    }

    try {
      const folder = await fetchWithRetry(() =>
        client.api(`/users/${userId}/drive/root:/${folderPath}`).get()
      );
      console.log(`Folder found: ${folder.name}, id=${folder.id}`);
      url = `/users/${userId}/drive/items/${folder.id}/delta`;
    } catch (err: any) {
      console.error(`Folder not found at path: ${folderPath}`);
      console.log("Listing drive root to help debug...");
      try {
        const root = await client.api(`/users/${userId}/drive/root/children`).get();
        const names = root.value?.map((item: any) => item.name) || [];
        console.log(`Root folder contents: ${JSON.stringify(names)}`);
      } catch { /* ignore */ }
      throw err;
    }
  }

  let nextDeltaToken = "";

  while (url) {
    const response = await fetchWithRetry(() => {
      if (url.startsWith("https://")) {
        return client.api(url).get();
      }
      return client.api(url).get();
    });

    if (response.value) {
      for (const item of response.value) {
        items.push({
          id: item.id,
          name: item.name || "",
          parentPath: item.parentReference?.path || "",
          lastModifiedDateTime: item.lastModifiedDateTime || "",
          size: item.size || 0,
          deleted: !!item.deleted,
          isFile: !!item.file,
        });
      }
    }

    if (response["@odata.nextLink"]) {
      url = response["@odata.nextLink"];
    } else if (response["@odata.deltaLink"]) {
      nextDeltaToken = response["@odata.deltaLink"];
      url = "";
    } else {
      url = "";
    }
  }

  return { items, deltaToken: nextDeltaToken };
}

export async function downloadFile(
  userId: string,
  itemId: string
): Promise<Buffer> {
  const client = getClient();

  const stream = await fetchWithRetry(() =>
    client.api(`/users/${userId}/drive/items/${itemId}/content`).getStream()
  );

  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  return Buffer.concat(chunks);
}
```

### `src/lib/pdfProcessor.ts`

```typescript
import { extractText } from "unpdf";
import type { ChunkRecord } from "./types.js";

const CHUNK_SIZE = parseInt(process.env.CHUNK_SIZE || "900", 10);
const CHUNK_OVERLAP = parseInt(process.env.CHUNK_OVERLAP || "175", 10);

function slugify(text: string): string {
  return text
    .replace(/[^a-zA-Z0-9]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .toLowerCase();
}

function chunkText(text: string, chunkSize: number, overlap: number): string[] {
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    const chunk = text.slice(start, end).trim();
    if (chunk.length > 0) {
      chunks.push(chunk);
    }
    start += chunkSize - overlap;
  }

  return chunks;
}

export async function extractAndChunk(
  pdfBuffer: Buffer,
  fileId: string,
  fileName: string,
  folderPath: string,
  lastModified: string
): Promise<ChunkRecord[]> {
  // unpdf requires Uint8Array, NOT Buffer
  const parsed = await extractText(new Uint8Array(pdfBuffer));
  // unpdf returns text as string[] (one per page) — join into a single string
  const fullText = Array.isArray(parsed.text)
    ? parsed.text.join("\n")
    : String(parsed.text || "");

  if (!fullText || fullText.trim().length === 0) {
    console.log(`Warning: No text extracted from ${fileName} — may be a scanned/image PDF`);
    return [];
  }

  const chunks = chunkText(fullText, CHUNK_SIZE, CHUNK_OVERLAP);
  const sluggedId = slugify(fileId);

  return chunks.map((text, i) => ({
    id: `${sluggedId}_c${i}`,
    text,
    metadata: {
      source_file: fileName,
      onedrive_file_id: fileId,
      folder_path: folderPath,
      chunk_index: i,
      total_chunks: chunks.length,
      last_modified: lastModified,
    },
  }));
}
```

### `src/lib/embedder.ts`

```typescript
import { GoogleGenAI } from "@google/genai";
import type { ChunkRecord, EmbeddedChunk } from "./types.js";

const BATCH_SIZE = 20;
const SLEEP_MS = 15_000; // 15s between batches — stays under free tier limits
const MAX_RETRIES = 5;

let genai: GoogleGenAI | null = null;

function getGenAI(): GoogleGenAI {
  if (!genai) {
    genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  }
  return genai;
}

async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries = MAX_RETRIES
): Promise<T> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      const isRateLimit =
        error?.status === 429 ||
        error?.message?.includes("RESOURCE_EXHAUSTED") ||
        error?.message?.includes("429");

      if (isRateLimit && attempt < maxRetries - 1) {
        const wait = Math.min(10000 * Math.pow(2, attempt), 90000);
        console.log(
          `Gemini rate limited (attempt ${attempt + 1}/${maxRetries}), waiting ${wait / 1000}s...`
        );
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }

      if (attempt < maxRetries - 1 && error?.status >= 500) {
        const wait = Math.pow(2, attempt) * 1000;
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }

      throw error;
    }
  }
  throw new Error("Max retries exceeded");
}

export async function embedChunks(
  chunks: ChunkRecord[]
): Promise<EmbeddedChunk[]> {
  const ai = getGenAI();
  const model = process.env.EMBEDDING_MODEL || "gemini-embedding-001";
  const dimensions = parseInt(process.env.EMBEDDING_DIMENSIONS || "3072", 10);
  const results: EmbeddedChunk[] = [];

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const texts = batch.map((c) => c.text);

    const response = await retryWithBackoff(async () => {
      return ai.models.embedContent({
        model,
        contents: texts,
        config: {
          taskType: "RETRIEVAL_DOCUMENT",
          outputDimensionality: dimensions,
        },
      });
    });

    if (!response.embeddings) {
      throw new Error(`No embeddings returned for batch starting at index ${i}`);
    }

    for (let j = 0; j < batch.length; j++) {
      const embedding = response.embeddings[j];
      if (!embedding?.values) {
        throw new Error(`Missing embedding for chunk ${i + j}`);
      }
      results.push({
        ...batch[j],
        embedding: embedding.values,
      });
    }

    if (i + BATCH_SIZE < chunks.length) {
      console.log(
        `Embedded ${Math.min(i + BATCH_SIZE, chunks.length)}/${chunks.length} chunks, pausing ${SLEEP_MS / 1000}s...`
      );
      await new Promise((r) => setTimeout(r, SLEEP_MS));
    }
  }

  console.log(`Embedding complete: ${results.length} chunks embedded`);
  return results;
}
```

### `src/lib/pineconeClient.ts`

```typescript
import { Pinecone, type Index } from "@pinecone-database/pinecone";
import type { EmbeddedChunk } from "./types.js";

const UPSERT_BATCH_SIZE = 100;

let pinecone: Pinecone | null = null;
const indexCache = new Map<string, Index>();

export function getPineconeIndex(indexName?: string): Index {
  const name = indexName || process.env.PINECONE_INDEX_NAME || "invoices-financials";

  if (indexCache.has(name)) return indexCache.get(name)!;

  if (!pinecone) {
    pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
  }

  const idx = pinecone.index(name);
  indexCache.set(name, idx);
  return idx;
}

// Helper: Pinecone rejects all-zero vectors
function nonZeroQueryVector(): number[] {
  const v = new Array(parseInt(process.env.EMBEDDING_DIMENSIONS || "3072", 10)).fill(0);
  v[0] = 1e-7;
  return v;
}

export async function upsertVectors(
  idx: Index,
  embedded: EmbeddedChunk[]
): Promise<void> {
  for (let i = 0; i < embedded.length; i += UPSERT_BATCH_SIZE) {
    const batch = embedded.slice(i, i + UPSERT_BATCH_SIZE);

    await idx.upsert(
      batch.map((chunk) => ({
        id: chunk.id,
        values: chunk.embedding,
        metadata: chunk.metadata,
      }))
    );

    console.log(
      `Upserted ${Math.min(i + UPSERT_BATCH_SIZE, embedded.length)}/${embedded.length} vectors`
    );
  }
}

export async function checkIfProcessed(
  idx: Index,
  fileId: string,
  lastModified: string
): Promise<boolean> {
  try {
    const results = await idx.query({
      vector: nonZeroQueryVector(),
      topK: 1,
      filter: {
        onedrive_file_id: { $eq: fileId },
        last_modified: { $eq: lastModified },
      },
      includeMetadata: true,
    });

    return (results.matches?.length || 0) > 0;
  } catch {
    return false;
  }
}

export async function deleteByFileId(
  idx: Index,
  fileId: string
): Promise<void> {
  try {
    await idx.deleteMany({
      filter: { onedrive_file_id: { $eq: fileId } },
    });
    console.log(`Deleted vectors for file ${fileId}`);
  } catch (error) {
    console.error(`Failed to delete vectors for file ${fileId}:`, error);
  }
}
```

### `src/lib/deltaTracker.ts`

```typescript
import type { Index } from "@pinecone-database/pinecone";

const SENTINEL_ID = "__delta_token__";
const EMBEDDING_DIMENSIONS = parseInt(process.env.EMBEDDING_DIMENSIONS || "3072", 10);

function sentinelVector(): number[] {
  // Pinecone rejects all-zero vectors, so use a tiny non-zero value
  const vec = new Array(EMBEDDING_DIMENSIONS).fill(0);
  vec[0] = 1e-7;
  return vec;
}

export async function readDeltaToken(index: Index): Promise<string | null> {
  try {
    const result = await index.fetch([SENTINEL_ID]);
    const record = result.records[SENTINEL_ID];
    if (record?.metadata?.delta_token) {
      return record.metadata.delta_token as string;
    }
    return null;
  } catch {
    return null;
  }
}

export async function saveDeltaToken(
  index: Index,
  token: string
): Promise<void> {
  await index.upsert([
    {
      id: SENTINEL_ID,
      values: sentinelVector(),
      metadata: {
        delta_token: token,
        updated_at: new Date().toISOString(),
        _type: "sentinel",
      },
    },
  ]);
}
```

### `src/lib/ingestCore.ts`

```typescript
import { logger } from "@trigger.dev/sdk/v3";
import { getDelta, downloadFile } from "./graphClient.js";
import { readDeltaToken, saveDeltaToken } from "./deltaTracker.js";
import { extractAndChunk } from "./pdfProcessor.js";
import { embedChunks } from "./embedder.js";
import {
  getPineconeIndex,
  upsertVectors,
  checkIfProcessed,
  deleteByFileId,
} from "./pineconeClient.js";

export interface IngestConfig {
  userId: string;
  folderPath: string;
  indexName: string;
}

export async function runIngestion(config: IngestConfig) {
  const { userId, folderPath, indexName } = config;
  const index = getPineconeIndex(indexName);

  logger.info(`[${indexName}] Reading delta token...`);
  let deltaToken = await readDeltaToken(index);
  const isFirstRun = !deltaToken;
  logger.info(
    isFirstRun
      ? `[${indexName}] First run — full scan`
      : `[${indexName}] Incremental scan with delta token`
  );

  let deltaResponse;
  try {
    deltaResponse = await getDelta(userId, folderPath, deltaToken);
  } catch (error: any) {
    if (error.message === "DELTA_TOKEN_EXPIRED") {
      logger.warn(`[${indexName}] Delta token expired (410 Gone), doing full re-scan...`);
      deltaResponse = await getDelta(userId, folderPath, null);
    } else {
      throw error;
    }
  }

  logger.info(`[${indexName}] Delta returned ${deltaResponse.items.length} items`);

  const pdfItems = deltaResponse.items.filter(
    (item) =>
      item.isFile &&
      item.name.toLowerCase().endsWith(".pdf") &&
      !item.deleted
  );

  const deletedItems = deltaResponse.items.filter(
    (item) => item.deleted && item.name.toLowerCase().endsWith(".pdf")
  );

  logger.info(
    `[${indexName}] Found ${pdfItems.length} PDF(s) to process, ${deletedItems.length} deleted`
  );

  for (const deleted of deletedItems) {
    logger.info(`[${indexName}] Removing vectors for deleted file: ${deleted.name}`);
    await deleteByFileId(index, deleted.id);
  }

  let processedCount = 0;
  let skippedCount = 0;
  let totalChunks = 0;

  for (const item of pdfItems) {
    const alreadyProcessed = await checkIfProcessed(
      index,
      item.id,
      item.lastModifiedDateTime
    );

    if (alreadyProcessed) {
      logger.info(`[${indexName}] Skipping ${item.name} — already processed`);
      skippedCount++;
      continue;
    }

    logger.info(
      `[${indexName}] Processing: ${item.name} (${(item.size / 1024).toFixed(1)} KB)`
    );

    const pdfBuffer = await downloadFile(userId, item.id);

    const chunks = await extractAndChunk(
      pdfBuffer,
      item.id,
      item.name,
      item.parentPath,
      item.lastModifiedDateTime
    );

    if (chunks.length === 0) {
      logger.warn(`[${indexName}] No text extracted from ${item.name}, skipping`);
      continue;
    }

    logger.info(`[${indexName}] Extracted ${chunks.length} chunks from ${item.name}`);

    const embedded = await embedChunks(chunks);
    await upsertVectors(index, embedded);

    processedCount++;
    totalChunks += chunks.length;
    logger.info(`[${indexName}] Completed ${item.name}: ${chunks.length} vectors upserted`);
  }

  if (deltaResponse.deltaToken) {
    await saveDeltaToken(index, deltaResponse.deltaToken);
    logger.info(`[${indexName}] Delta token saved for next run`);
  }

  const summary = {
    store: indexName,
    firstRun: isFirstRun,
    totalItemsFromDelta: deltaResponse.items.length,
    pdfsProcessed: processedCount,
    pdfsSkipped: skippedCount,
    pdfsDeleted: deletedItems.length,
    totalChunksUpserted: totalChunks,
  };

  logger.info(`[${indexName}] Ingestion complete`, summary);
  return summary;
}
```

### `src/trigger/ingestOneDrive.ts` -- CHANGE TASK ID + CRON

```typescript
import { schedules } from "@trigger.dev/sdk/v3";
import { runIngestion } from "../lib/ingestCore.js";

export const ingestScheduled = schedules.task({
  id: "ingest-YOUR-STORE-weekly",  // <-- CHANGE: unique task ID per store
  cron: "0 6 * * 1",               // <-- CHANGE: your preferred schedule
  maxDuration: 300,
  retry: {
    maxAttempts: 3,
    minTimeoutInMs: 30_000,
  },

  run: async () => {
    return runIngestion({
      userId: process.env.ONEDRIVE_USER_ID!,
      folderPath: process.env.ONEDRIVE_FOLDER_PATH!,
      indexName: process.env.PINECONE_INDEX_NAME || "your-index-name",
    });
  },
});
```

### `src/testLocal.ts`

```typescript
/**
 * Local end-to-end test — runs the full ingestion pipeline outside Trigger.dev.
 * Usage: npx tsx src/testLocal.ts
 */
import "dotenv/config";
import { getDelta, downloadFile } from "./lib/graphClient.js";
import { extractAndChunk } from "./lib/pdfProcessor.js";
import { embedChunks } from "./lib/embedder.js";
import {
  getPineconeIndex,
  upsertVectors,
  checkIfProcessed,
} from "./lib/pineconeClient.js";
import { readDeltaToken, saveDeltaToken } from "./lib/deltaTracker.js";

async function main() {
  const userId = process.env.ONEDRIVE_USER_ID!;
  const folderPath = process.env.ONEDRIVE_FOLDER_PATH!;
  const indexName = process.env.PINECONE_INDEX_NAME || "your-index-name";

  console.log("=== Local Ingestion Test ===");
  console.log(`User: ${userId}`);
  console.log(`Folder: ${folderPath}`);
  console.log(`Index: ${indexName}`);

  const index = getPineconeIndex(indexName);
  let deltaToken = await readDeltaToken(index);
  console.log(deltaToken ? "Resuming with delta token" : "First run — full scan");

  let deltaResponse;
  try {
    deltaResponse = await getDelta(userId, folderPath, deltaToken);
  } catch (error: any) {
    if (error.message === "DELTA_TOKEN_EXPIRED") {
      console.log("Delta token expired, doing full scan...");
      deltaResponse = await getDelta(userId, folderPath, null);
    } else {
      throw error;
    }
  }

  console.log(`Delta returned ${deltaResponse.items.length} items`);

  const pdfItems = deltaResponse.items.filter(
    (item) => item.isFile && item.name.toLowerCase().endsWith(".pdf") && !item.deleted
  );
  console.log(`Found ${pdfItems.length} PDF(s)`);

  if (pdfItems.length === 0) {
    console.log("No PDFs to process. Saving delta token and exiting.");
    if (deltaResponse.deltaToken) {
      await saveDeltaToken(index, deltaResponse.deltaToken);
    }
    return;
  }

  let processedCount = 0;
  let totalChunks = 0;

  for (const item of pdfItems) {
    const alreadyProcessed = await checkIfProcessed(
      index,
      item.id,
      item.lastModifiedDateTime
    );

    if (alreadyProcessed) {
      console.log(`Skipping ${item.name} — already processed`);
      continue;
    }

    console.log(`Processing: ${item.name} (${(item.size / 1024).toFixed(1)} KB)`);

    const pdfBuffer = await downloadFile(userId, item.id);
    console.log(`  Downloaded ${pdfBuffer.length} bytes`);

    const chunks = await extractAndChunk(
      pdfBuffer,
      item.id,
      item.name,
      item.parentPath,
      item.lastModifiedDateTime
    );

    if (chunks.length === 0) {
      console.log(`  No text extracted from ${item.name}, skipping`);
      continue;
    }

    console.log(`  Extracted ${chunks.length} chunks`);
    console.log(`  First chunk preview: "${chunks[0].text.substring(0, 100)}..."`);

    const embedded = await embedChunks(chunks);
    console.log(`  Embedded ${embedded.length} chunks`);

    await upsertVectors(index, embedded);
    console.log(`  Upserted ${embedded.length} vectors`);

    processedCount++;
    totalChunks += chunks.length;
  }

  if (deltaResponse.deltaToken) {
    await saveDeltaToken(index, deltaResponse.deltaToken);
    console.log("Delta token saved");
  }

  console.log("\n=== Summary ===");
  console.log(`PDFs processed: ${processedCount}`);
  console.log(`Total chunks upserted: ${totalChunks}`);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
```

### `.github/workflows/deploy-trigger.yml`

```yaml
name: Deploy to Trigger.dev

on:
  push:
    branches:
      - main

jobs:
  deploy:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "22"

      - name: Install dependencies
        run: npm ci

      - name: Deploy to Trigger.dev
        run: npx trigger deploy
        env:
          TRIGGER_SECRET_KEY: ${{ secrets.TRIGGER_PROD_SECRET_KEY }}
```

**GitHub Secret required:** Add `TRIGGER_PROD_SECRET_KEY` to your repo's Settings > Secrets.

---

## Deployment Steps (for each new store)

1. **Create GitHub repo** and push all files above
2. **Create Pinecone index** with 3072 dimensions, cosine metric, serverless
3. **Create Trigger.dev project** at cloud.trigger.dev
4. **Set environment variables** in Trigger.dev project settings (all the `.env` vars except `TRIGGER_*`)
5. **Update `trigger.config.ts`** with the new Trigger.dev project ID
6. **Update `src/trigger/ingestOneDrive.ts`** with unique task ID
7. **Run locally first:** `npm install && npx tsx src/testLocal.ts`
8. **Deploy:** `npx trigger deploy`
9. **Add GitHub secret:** `TRIGGER_PROD_SECRET_KEY`
10. **Trigger a test run** from the Trigger.dev dashboard

---

## Gotchas and Lessons Learned

| Issue | Symptom | Fix |
|---|---|---|
| **pdf-parse** | `TypeError: __require.ensure is not a function` | Use `unpdf` instead — ESM-compatible |
| **unpdf wants Uint8Array** | `Please provide binary data as Uint8Array` | Wrap: `new Uint8Array(pdfBuffer)` |
| **unpdf text is array** | `fullText.trim is not a function` | Join pages: `Array.isArray(parsed.text) ? parsed.text.join("\n") : String(parsed.text)` |
| **Pinecone zero vectors** | `Dense vectors must contain at least one non-zero value` | Use `1e-7` in first element for sentinel/query vectors |
| **Gemini model retired** | `models/gemini-embedding-exp-03-07 is not found` | Use `gemini-embedding-001` (stable, supports 3072 dims) |
| **Trigger.dev version mismatch** | CLI/runtime version conflict | Pin exact versions (no `^`) in package.json |
| **process.env in trigger.config.ts** | Project ID undefined at build time | Hardcode the project ID |
| **Azure Secret ID vs Value** | `AADSTS7000215 invalid_client` | Use the **Value** column, not the Secret ID |
| **Missing User.Read.All** | `User not found` or resource errors | Add Application permission + grant admin consent |
| **ONEDRIVE_USER_ID format** | User email works (e.g. `user@company.com`) | Use email address, Graph resolves it |
| **Folder path encoding** | `Resource could not be found` | URL-decode the SharePoint path, no leading slash |

---

## Verifying the Embedding Model

Experimental Gemini models get retired without notice. Verify your model works:

```bash
curl -s "https://generativelanguage.googleapis.com/v1beta/models?key=YOUR_KEY" | grep -i embed
```

Test embedding with your target dimensions:

```bash
curl -s "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=YOUR_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"content":{"parts":[{"text":"test"}]},"outputDimensionality":3072}'
```
