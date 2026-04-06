import { task, logger } from "@trigger.dev/sdk/v3";
import type { QueryMatch, QueryRequest, QueryResponse } from "../lib/types.js";
import { embedQuery } from "../lib/embedder.js";
import { getSupabaseClient, queryVectors } from "../lib/supabaseClient.js";
import { generateAnswer } from "../lib/llm.js";

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

  let text = answer;
  const sourceFiles = [
    ...new Set(
      sources.map((s) => s.metadata?.source_file).filter(Boolean)
    ),
  ];
  if (sourceFiles.length > 0) {
    text += "\n\n📄 Sources: " + sourceFiles.join(", ");
  }

  const res = await fetch(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    }
  );

  if (!res.ok) {
    logger.error("Failed to send Telegram reply", {
      status: res.status,
      body: await res.text(),
    });
  } else {
    logger.info("Telegram reply sent", { chatId });
  }
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

    // Step 1: Embed the question
    const embedding = await embedQuery(question);
    logger.info("Question embedded", { dimensions: embedding.length });

    // Step 2: Query Supabase for relevant chunks
    const client = getSupabaseClient();
    const matches = await queryVectors(client, embedding, 5);
    logger.info(`Found ${matches.length} matching chunks`);

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
  },
});
