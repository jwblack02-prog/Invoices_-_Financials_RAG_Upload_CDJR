/**
 * Creates the CDJR RAG Query Bot workflow in n8n via REST API.
 * Usage: npx tsx scripts/createN8nWorkflow.ts
 */
import "dotenv/config";

const N8N_BASE_URL = process.env.N8N_BASE_URL!.replace(/\/home\/workflows\/?$/, "");
const N8N_API_KEY = process.env.N8N_API_KEY!;
const TRIGGER_SECRET_KEY = process.env.TRIGGER_PROD_SECRET_KEY!;

const workflow = {
  name: "CDJR Invoice Query Bot",
  nodes: [
    {
      parameters: {
        updates: ["message"],
      },
      id: "telegram-trigger",
      name: "Telegram Trigger",
      type: "n8n-nodes-base.telegramTrigger",
      typeVersion: 1.1,
      position: [0, 0],
      webhookId: "cdjr-query-bot",
    },
    {
      parameters: {
        method: "POST",
        url: "https://api.trigger.dev/api/v1/tasks/query-rag/trigger",
        authentication: "genericCredentialType",
        genericAuthType: "httpHeaderAuth",
        sendHeaders: true,
        headerParameters: {
          parameters: [
            {
              name: "Authorization",
              value: `Bearer ${TRIGGER_SECRET_KEY}`,
            },
          ],
        },
        sendBody: true,
        specifyBody: "json",
        jsonBody: `={
  "payload": {
    "question": "{{ $json.message.text }}"
  }
}`,
        options: {
          timeout: 30000,
        },
      },
      id: "trigger-task",
      name: "Trigger Query Task",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.2,
      position: [250, 0],
    },
    {
      parameters: {
        amount: 3,
        unit: "seconds",
      },
      id: "wait-node",
      name: "Wait for Processing",
      type: "n8n-nodes-base.wait",
      typeVersion: 1.1,
      position: [500, 0],
    },
    {
      parameters: {
        method: "GET",
        url: `=https://api.trigger.dev/api/v1/runs/{{ $('Trigger Query Task').item.json.id }}`,
        authentication: "genericCredentialType",
        genericAuthType: "httpHeaderAuth",
        sendHeaders: true,
        headerParameters: {
          parameters: [
            {
              name: "Authorization",
              value: `Bearer ${TRIGGER_SECRET_KEY}`,
            },
          ],
        },
        options: {
          timeout: 30000,
        },
      },
      id: "check-result",
      name: "Get Run Result",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.2,
      position: [750, 0],
    },
    {
      parameters: {
        conditions: {
          options: {
            caseSensitive: true,
            leftValue: "",
            typeValidation: "strict",
          },
          conditions: [
            {
              id: "condition-completed",
              leftValue: "={{ $json.status }}",
              rightValue: "COMPLETED",
              operator: {
                type: "string",
                operation: "equals",
              },
            },
          ],
          combinator: "and",
        },
      },
      id: "if-completed",
      name: "Is Completed?",
      type: "n8n-nodes-base.if",
      typeVersion: 2.2,
      position: [1000, 0],
    },
    {
      parameters: {
        jsCode: `// Extract the answer from the Trigger.dev run output
const output = $('Get Run Result').item.json.output;
const question = $('Telegram Trigger').item.json.message.text;
const chatId = $('Telegram Trigger').item.json.message.chat.id;

let answer = "Sorry, I couldn't process your question.";

if (output && output.answer) {
  answer = output.answer;

  // Add source files if available
  if (output.sources && output.sources.length > 0) {
    const sourceFiles = [...new Set(output.sources.map(s => s.metadata?.source_file).filter(Boolean))];
    if (sourceFiles.length > 0) {
      answer += "\\n\\n📄 Sources: " + sourceFiles.join(", ");
    }
  }
}

return [{ json: { chatId, answer } }];`,
      },
      id: "format-answer",
      name: "Format Answer",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [1250, -100],
    },
    {
      parameters: {
        operation: "sendMessage",
        chatId: "={{ $json.chatId }}",
        text: "={{ $json.answer }}",
        additionalFields: {},
      },
      id: "telegram-reply",
      name: "Reply in Telegram",
      type: "n8n-nodes-base.telegram",
      typeVersion: 1.2,
      position: [1500, -100],
    },
    {
      parameters: {
        operation: "sendMessage",
        chatId: `={{ $('Telegram Trigger').item.json.message.chat.id }}`,
        text: "⏳ Still processing your question, please wait...",
        additionalFields: {},
      },
      id: "telegram-waiting",
      name: "Still Processing",
      type: "n8n-nodes-base.telegram",
      typeVersion: 1.2,
      position: [1250, 100],
    },
  ],
  connections: {
    "Telegram Trigger": {
      main: [
        [{ node: "Trigger Query Task", type: "main", index: 0 }],
      ],
    },
    "Trigger Query Task": {
      main: [
        [{ node: "Wait for Processing", type: "main", index: 0 }],
      ],
    },
    "Wait for Processing": {
      main: [
        [{ node: "Get Run Result", type: "main", index: 0 }],
      ],
    },
    "Get Run Result": {
      main: [
        [{ node: "Is Completed?", type: "main", index: 0 }],
      ],
    },
    "Is Completed?": {
      main: [
        [{ node: "Format Answer", type: "main", index: 0 }],
        [{ node: "Still Processing", type: "main", index: 0 }],
      ],
    },
    "Format Answer": {
      main: [
        [{ node: "Reply in Telegram", type: "main", index: 0 }],
      ],
    },
    "Still Processing": {
      main: [
        [{ node: "Wait for Processing", type: "main", index: 0 }],
      ],
    },
  },
  settings: {
    executionOrder: "v1",
  },
};

async function main() {
  console.log(`Creating workflow in n8n at ${N8N_BASE_URL}...`);

  const response = await fetch(`${N8N_BASE_URL}/api/v1/workflows`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-N8N-API-KEY": N8N_API_KEY,
    },
    body: JSON.stringify(workflow),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error(`Failed to create workflow: ${response.status} ${error}`);
    process.exit(1);
  }

  const result = await response.json();
  console.log(`Workflow created successfully!`);
  console.log(`  ID: ${result.id}`);
  console.log(`  Name: ${result.name}`);
  console.log(`  URL: ${N8N_BASE_URL}/workflow/${result.id}`);
  console.log(`\nNext steps:`);
  console.log(`  1. Open the workflow in n8n`);
  console.log(`  2. Configure the Telegram credential (bot token from @BotFather)`);
  console.log(`  3. Activate the workflow`);
  console.log(`  4. Send a message to your Telegram bot to test`);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
