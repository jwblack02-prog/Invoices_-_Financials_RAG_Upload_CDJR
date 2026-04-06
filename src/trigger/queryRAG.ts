import { task, logger } from "@trigger.dev/sdk/v3";
import type { QueryMatch, QueryRequest, QueryResponse } from "../lib/types.js";
import { embedQuery } from "../lib/embedder.js";
import { getSupabaseClient, queryVectors } from "../lib/supabaseClient.js";
import { generateAnswer } from "../lib/llm.js";

async function sendTelegramMessage(
  token: string,
  chatId: string,
  text: string,
  parseMode?: string
): Promise<void> {
  const body: Record<string, string> = { chat_id: chatId, text };
  if (parseMode) body.parse_mode = parseMode;

  const res = await fetch(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    logger.error("Failed to send Telegram message", {
      status: res.status,
      body: await res.text(),
    });
  }
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function sendTelegramReply(
  chatId: string,
  answer: string,
  sources: QueryMatch[]
): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    logger.warn("TELEGRAM_BOT_TOKEN not set — skipping Telegram reply");
    return;
  }

  // Use HTML parse mode — far more lenient than Markdown (only &, <, > need escaping)
  let text = escapeHtml(answer);

  // Build source list with OneDrive links when available
  const seen = new Set<string>();
  const sourceLines: string[] = [];
  for (const s of sources) {
    const file = s.metadata?.source_file;
    if (!file || seen.has(file)) continue;
    seen.add(file);
    const url = s.metadata?.web_url;
    if (url) {
      sourceLines.push(`• <a href="${url}">${escapeHtml(file)}</a>`);
    } else {
      sourceLines.push(`• ${escapeHtml(file)}`);
    }
  }

  if (sourceLines.length > 0) {
    text += "\n\n📄 <b>Sources:</b>\n" + sourceLines.join("\n");
  }

  await sendTelegramMessage(token, chatId, text, "HTML");
}

export const queryRAG = task({
  id: "query-rag",
  maxDuration: 60,
  retry: {
    maxAttempts: 2,
    minTimeoutInMs: 5_000,
  },

  run: async (payload: QueryRequest): Promise<QueryResponse> => {
    const { question, chatId } = payload;
    logger.info("Query received", { question, chatId });

    // Start "still thinking" interval — fires every 30s while processing
    let thinkingInterval: ReturnType<typeof setInterval> | undefined;
    if (chatId) {
      const token = process.env.TELEGRAM_BOT_TOKEN;
      if (token) {
        thinkingInterval = setInterval(() => {
          sendTelegramMessage(
            token,
            chatId,
            "⏳ Still working on an answer, be with you shortly…"
          ).catch(() => {}); // fire-and-forget
        }, 30_000);
      }
    }

    try {
      // Step 1: Embed the question
      const embedding = await embedQuery(question);
      logger.info("Question embedded", { dimensions: embedding.length });

      // Step 2: Query Supabase for relevant chunks
      const client = getSupabaseClient();
      const allMatches = await queryVectors(client, embedding, 30);
      const matches = allMatches.filter((m) => m.score >= 0.35);
      logger.info(`Found ${matches.length} matching chunks (of ${allMatches.length} retrieved)`);
      if (matches.length > 0) {
        logger.info(`Match scores: ${matches.map(m => m.score.toFixed(3)).join(', ')}`);
      }

      if (matches.length === 0) {
        const answer = "I couldn't find any relevant documents to answer your question.";
        if (chatId) await sendTelegramReply(chatId, answer, []);
        return { answer, sources: [] };
      }

      // Step 3: Generate answer with LLM
      const answer = await generateAnswer(question, matches);
      logger.info("Answer generated", { answerLength: answer.length });

      if (chatId) await sendTelegramReply(chatId, answer, matches);

      return { answer, sources: matches };
    } finally {
      if (thinkingInterval) clearInterval(thinkingInterval);
    }
  },
});
