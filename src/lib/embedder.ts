import { GoogleGenAI } from "@google/genai";
import type { ChunkRecord, EmbeddedChunk } from "./types.js";

const BATCH_SIZE = 20;
const SLEEP_MS = 15_000; // 15s between batches — stays under 100 items/min free tier
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

export async function embedQuery(question: string): Promise<number[]> {
  const ai = getGenAI();
  const model = process.env.EMBEDDING_MODEL || "gemini-embedding-exp-03-07";
  const dimensions = parseInt(process.env.EMBEDDING_DIMENSIONS || "3072", 10);

  const response = await retryWithBackoff(async () => {
    return ai.models.embedContent({
      model,
      contents: [question],
      config: {
        taskType: "RETRIEVAL_QUERY",
        outputDimensionality: dimensions,
      },
    });
  });

  if (!response.embeddings?.[0]?.values) {
    throw new Error("Failed to embed question");
  }

  return response.embeddings[0].values;
}

export async function embedChunks(
  chunks: ChunkRecord[]
): Promise<EmbeddedChunk[]> {
  const ai = getGenAI();
  const model = process.env.EMBEDDING_MODEL || "gemini-embedding-exp-03-07";
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

    // Rate limit pause — skip after last batch
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
