/**
 * Patches the live n8n workflow to fix indefinite polling on FAILED runs.
 *
 * Changes:
 *   1. "Is Completed?" node — condition now checks isCompleted === true (boolean)
 *      instead of status === "COMPLETED" (string). Exits loop on both SUCCESS and FAILED.
 *   2. New "Is Success?" node — checks isSuccess === true. Routes to Format Answer (yes)
 *      or Send Error Message (no).
 *   3. New "Send Error Message" node — Telegram message for failed runs.
 *   4. Connections updated to wire the new nodes in.
 *
 * Usage: npx tsx scripts/patchN8nWorkflow2.ts
 */
import "dotenv/config";

const N8N_BASE_URL = process.env.N8N_BASE_URL!.replace(/\/home\/workflows\/?$/, "");
const N8N_API_KEY = process.env.N8N_API_KEY!;
const WORKFLOW_ID = "4QPhR9gBAQViCQ4v";

async function main() {
  // 1. Fetch current workflow
  console.log("Fetching current workflow...");
  const getRes = await fetch(`${N8N_BASE_URL}/api/v1/workflows/${WORKFLOW_ID}`, {
    headers: { "X-N8N-API-KEY": N8N_API_KEY },
  });
  if (!getRes.ok) {
    console.error(`Failed to fetch: ${getRes.status} ${await getRes.text()}`);
    process.exit(1);
  }
  const workflow = await getRes.json();

  // 2. Patch "Is Completed?" — switch from string status check to boolean isCompleted
  const ifCompleted = workflow.nodes.find((n: any) => n.id === "if-completed");
  if (!ifCompleted) {
    console.error("Could not find 'Is Completed?' node (id: if-completed)");
    process.exit(1);
  }

  ifCompleted.parameters.conditions.conditions = [
    {
      id: "condition-completed",
      leftValue: "={{ $json.isCompleted }}",
      rightValue: true,
      operator: {
        type: "boolean",
        operation: "true",
      },
    },
  ];
  console.log("Patched: Is Completed? → checks isCompleted === true (boolean)");

  // 3. Add "Is Success?" node (positioned after "Is Completed?" YES branch)
  const isSuccessNode = {
    parameters: {
      conditions: {
        options: {
          caseSensitive: true,
          leftValue: "",
          typeValidation: "strict",
        },
        conditions: [
          {
            id: "condition-success",
            leftValue: "={{ $json.isSuccess }}",
            rightValue: true,
            operator: {
              type: "boolean",
              operation: "true",
            },
          },
        ],
        combinator: "and",
      },
    },
    id: "if-success",
    name: "Is Success?",
    type: "n8n-nodes-base.if",
    typeVersion: 2.2,
    position: [1250, -100],
  };

  // 4. Add "Send Error Message" Telegram node — copy credential from an existing Telegram node
  const existingTelegramNode = workflow.nodes.find(
    (n: any) => n.type === "n8n-nodes-base.telegram" && n.credentials?.telegramApi
  );
  const telegramCredential = existingTelegramNode?.credentials ?? {};

  const sendErrorNode = {
    parameters: {
      operation: "sendMessage",
      chatId: `={{ $('Telegram Trigger').item.json.message.chat.id }}`,
      text: "❌ Sorry, I couldn't process your question. Please try again or contact support.",
      additionalFields: {},
    },
    id: "send-error",
    name: "Send Error Message",
    type: "n8n-nodes-base.telegram",
    typeVersion: 1.2,
    position: [1500, 100],
    credentials: telegramCredential,
  };

  // Remove any existing copies of these nodes (idempotent re-run)
  workflow.nodes = workflow.nodes.filter(
    (n: any) => n.id !== "if-success" && n.id !== "send-error"
  );

  // Reposition Format Answer and Reply nodes to make room
  const formatNode = workflow.nodes.find((n: any) => n.id === "format-answer");
  if (formatNode) formatNode.position = [1500, -200];
  const replyNode = workflow.nodes.find((n: any) => n.id === "telegram-reply");
  if (replyNode) replyNode.position = [1750, -200];

  workflow.nodes.push(isSuccessNode, sendErrorNode);
  console.log("Added: Is Success? node (id: if-success)");
  console.log("Added: Send Error Message node (id: send-error)");

  // 5. Rewrite connections
  workflow.connections = {
    "Telegram Trigger": {
      main: [[{ node: "Trigger Query Task", type: "main", index: 0 }]],
    },
    "Trigger Query Task": {
      main: [[{ node: "Wait for Processing", type: "main", index: 0 }]],
    },
    "Wait for Processing": {
      main: [[{ node: "Get Run Result", type: "main", index: 0 }]],
    },
    "Get Run Result": {
      main: [[{ node: "Is Completed?", type: "main", index: 0 }]],
    },
    "Is Completed?": {
      main: [
        [{ node: "Is Success?", type: "main", index: 0 }],      // YES branch
        [{ node: "Still Processing", type: "main", index: 0 }], // NO branch
      ],
    },
    "Is Success?": {
      main: [
        [{ node: "Format Answer", type: "main", index: 0 }],     // YES branch
        [{ node: "Send Error Message", type: "main", index: 0 }], // NO branch
      ],
    },
    "Format Answer": {
      main: [[{ node: "Reply in Telegram", type: "main", index: 0 }]],
    },
    "Still Processing": {
      main: [[{ node: "Wait for Processing", type: "main", index: 0 }]],
    },
  };
  console.log("Updated: connections rewired");

  // 6. PUT the updated workflow back
  console.log("Saving workflow...");
  const putRes = await fetch(`${N8N_BASE_URL}/api/v1/workflows/${WORKFLOW_ID}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "X-N8N-API-KEY": N8N_API_KEY,
    },
    body: JSON.stringify({
      name: workflow.name,
      nodes: workflow.nodes,
      connections: workflow.connections,
      settings: { executionOrder: "v1" },
    }),
  });

  if (!putRes.ok) {
    console.error(`Failed to update: ${putRes.status} ${await putRes.text()}`);
    process.exit(1);
  }

  const result = await putRes.json();
  console.log(`\nWorkflow updated successfully!`);
  console.log(`  ID: ${result.id}`);
  console.log(`  Name: ${result.name}`);

  // 7. Verify
  const verifyIfCompleted = result.nodes.find((n: any) => n.id === "if-completed");
  const verifyIfSuccess = result.nodes.find((n: any) => n.id === "if-success");
  const verifySendError = result.nodes.find((n: any) => n.id === "send-error");
  console.log(`\nVerification:`);
  console.log(`  Is Completed? condition: ${JSON.stringify(verifyIfCompleted?.parameters?.conditions?.conditions?.[0]?.leftValue)}`);
  console.log(`  Is Success? node present: ${!!verifyIfSuccess}`);
  console.log(`  Send Error Message node present: ${!!verifySendError}`);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
