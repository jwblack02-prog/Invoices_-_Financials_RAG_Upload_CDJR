import { task, logger } from "@trigger.dev/sdk/v3";
import type { QueryMatch, QueryRequest, QueryResponse } from "../lib/types.js";
import { embedQuery } from "../lib/embedder.js";
import { getSupabaseClient, queryVectors, searchByText } from "../lib/supabaseClient.js";
import { generateAnswer } from "../lib/llm.js";
import { extractSignificantKeywords, filterAndRankChunks } from "../lib/queryFilter.js";

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
    text += "\n\n———————————\n📄 <b>Sources:</b>\n" + sourceLines.join("\n");
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

      // Step 2: Vector similarity search
      const client = getSupabaseClient();
      const allMatches = await queryVectors(client, embedding, 50);
      const vectorMatches = allMatches.filter((m) => m.score >= 0.20);
      logger.info(`Vector matches: ${vectorMatches.length} (of ${allMatches.length} retrieved)`);

      // Step 3: FTS keyword search — use entity keywords only (not full question)
      // to avoid noise from common words like "spent", "2025" drowning out vendor matches
      const entityKeywords = extractSignificantKeywords(question);
      const ftsQuery = entityKeywords.length > 0 ? entityKeywords.join(" ") : question;
      logger.info(`FTS query terms: ${ftsQuery}`);
      const ftsMatches = await searchByText(client, ftsQuery, 30);
      logger.info(`FTS matches: ${ftsMatches.length}`);

      // Merge: vector results take precedence; FTS fills gaps
      const seen = new Set<string>(vectorMatches.map((m) => m.id));
      const matches = [...vectorMatches];
      for (const m of ftsMatches) {
        if (!seen.has(m.id)) {
          matches.push(m);
          seen.add(m.id);
        }
      }
      logger.info(`Combined matches: ${matches.length}`);

      if (matches.length === 0) {
        const answer = "I couldn't find any relevant documents to answer your question.";
        if (chatId) await sendTelegramReply(chatId, answer, []);
        return { answer, sources: [] };
      }

      // Step 4: Post-retrieval relevance filter
      const keywords = extractSignificantKeywords(question);
      logger.info(`Filter keywords: ${keywords.join(", ")}`);
      const filtered = filterAndRankChunks(matches, question, 30);
      logger.info(`After filter: ${filtered.length} of ${matches.length} chunks retained`);
      const sourceFiles = [...new Set(filtered.map(m => m.metadata?.source_file))];
      logger.info(`Source files in context: ${sourceFiles.join(", ")}`);

      // Step 5: Generate answer with LLM
      const answer = await generateAnswer(question, filtered);
      logger.info("Answer generated", { answerLength: answer.length });

      if (chatId) await sendTelegramReply(chatId, answer, filtered);

      return { answer, sources: filtered };
    } finally {
      if (thinkingInterval) clearInterval(thinkingInterval);
    }
  },
});
