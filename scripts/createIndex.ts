import { Pinecone } from "@pinecone-database/pinecone";
import "dotenv/config";

const INDEX_NAME = process.env.PINECONE_INDEX_NAME || "invoices-financials";
const DIMENSIONS = parseInt(process.env.EMBEDDING_DIMENSIONS || "3072", 10);

async function createIndex() {
  const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });

  const existingIndexes = await pinecone.listIndexes();
  const exists = existingIndexes.indexes?.some((idx) => idx.name === INDEX_NAME);

  if (exists) {
    console.log(`Index "${INDEX_NAME}" already exists.`);
    const stats = await pinecone.index(INDEX_NAME).describeIndexStats();
    console.log("Stats:", JSON.stringify(stats, null, 2));
    return;
  }

  console.log(`Creating index "${INDEX_NAME}" with ${DIMENSIONS} dimensions...`);

  await pinecone.createIndex({
    name: INDEX_NAME,
    dimension: DIMENSIONS,
    metric: "cosine",
    spec: {
      serverless: {
        cloud: "aws",
        region: "us-east-1",
      },
    },
  });

  console.log(`Index "${INDEX_NAME}" created successfully!`);
}

createIndex().catch(console.error);
