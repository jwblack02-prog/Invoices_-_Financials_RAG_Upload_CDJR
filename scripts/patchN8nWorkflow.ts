/**
 * Patches the live n8n workflow to fix the Trigger.dev run polling endpoint.
 * Changes /api/v1/runs/ → /api/v3/runs/ in the "Get Run Result" node.
 * Usage: npx tsx scripts/patchN8nWorkflow.ts
 */
import "dotenv/config";

const N8N_BASE_URL = process.env.N8N_BASE_URL!.replace(/\/home\/workflows\/?$/, "");
const N8N_API_KEY = process.env.N8N_API_KEY!;
const WORKFLOW_ID = "4QPhR9gBAQViCQ4v";

async function main() {
  // 1. Get current workflow
  console.log("Fetching current workflow...");
  const getRes = await fetch(`${N8N_BASE_URL}/api/v1/workflows/${WORKFLOW_ID}`, {
    headers: { "X-N8N-API-KEY": N8N_API_KEY },
  });
  if (!getRes.ok) {
    console.error(`Failed to fetch: ${getRes.status} ${await getRes.text()}`);
    process.exit(1);
  }
  const workflow = await getRes.json();

  // 2. Find and fix the "Get Run Result" node
  const node = workflow.nodes.find((n: any) => n.id === "check-result");
  if (!node) {
    console.error("Could not find 'Get Run Result' node (id: check-result)");
    process.exit(1);
  }

  const oldUrl = node.parameters.url;
  const newUrl = oldUrl.replace("/api/v1/runs/", "/api/v3/runs/");

  if (oldUrl === newUrl) {
    console.log("URL already uses /api/v3/runs/ — no change needed.");
    return;
  }

  console.log(`Old URL: ${oldUrl}`);
  console.log(`New URL: ${newUrl}`);
  node.parameters.url = newUrl;

  // 3. PUT the updated workflow back
  console.log("Updating workflow...");
  const putRes = await fetch(`${N8N_BASE_URL}/api/v1/workflows/${WORKFLOW_ID}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "X-N8N-API-KEY": N8N_API_KEY,
    },
    body: JSON.stringify({ name: workflow.name, nodes: workflow.nodes, connections: workflow.connections, settings: { executionOrder: "v1" } }),
  });

  if (!putRes.ok) {
    console.error(`Failed to update: ${putRes.status} ${await putRes.text()}`);
    process.exit(1);
  }

  const result = await putRes.json();
  console.log(`Workflow updated successfully!`);
  console.log(`  ID: ${result.id}`);
  console.log(`  Name: ${result.name}`);

  // 4. Verify
  const verifyNode = result.nodes.find((n: any) => n.id === "check-result");
  console.log(`  Verified URL: ${verifyNode?.parameters?.url}`);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
