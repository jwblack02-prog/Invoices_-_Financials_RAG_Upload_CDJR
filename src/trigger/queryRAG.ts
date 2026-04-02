import { task, logger } from "@trigger.dev/sdk/v3";
import type { QueryRequest, QueryResponse } from "../lib/types.js";
import { embedQuery } from "../lib/embedder.js";
import { getPineconeIndex, queryVectors } from "../lib/pineconeClient.js";
import { generateAnswer } from "../lib/llm.js";

export const queryRAG = task({
  id: "query-rag",
  maxDuration: 60,
  retry: {
    maxAttempts: 2,
    minTimeoutInMs: 5_000,
  },

  run: async (payload: QueryRequest): Promise<QueryResponse> => {
    const { question } = payload;
    logger.info("Query received", { question });

    // Step 1: Embed the question
    const embedding = await embedQuery(question);
    logger.info("Question embedded", { dimensions: embedding.length });

    // Step 2: Query Pinecone for relevant chunks
    const index = getPineconeIndex();
    const matches = await queryVectors(index, embedding, 5);
    logger.info(`Found ${matches.length} matching chunks`);

    if (matches.length === 0) {
      return {
        answer: "I couldn't find any relevant documents to answer your question.",
        sources: [],
      };
    }

    // Step 3: Generate answer with LLM
    const answer = await generateAnswer(question, matches);
    logger.info("Answer generated", { answerLength: answer.length });

    return { answer, sources: matches };
  },
});
