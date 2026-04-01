import { ClientSecretCredential } from "@azure/identity";
import { Client } from "@microsoft/microsoft-graph-client";
import { TokenCredentialAuthenticationProvider } from "@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials/index.js";
import type { DeltaResponse, DriveItemChange } from "./types.js";

let graphClient: Client | null = null;

function getClient(): Client {
  if (graphClient) return graphClient;

  const credential = new ClientSecretCredential(
    process.env.AZURE_TENANT_ID!,
    process.env.AZURE_CLIENT_ID!,
    process.env.AZURE_CLIENT_SECRET!
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

      // 429 Too Many Requests — respect Retry-After
      if (status === 429) {
        const retryAfter = parseInt(error?.headers?.["retry-after"] || "10", 10);
        console.log(`Rate limited by Graph API, waiting ${retryAfter}s...`);
        await new Promise((r) => setTimeout(r, retryAfter * 1000));
        continue;
      }

      // 410 Gone — delta token is invalid
      if (status === 410) {
        throw new Error("DELTA_TOKEN_EXPIRED");
      }

      // Transient server errors
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

  // Build initial URL
  let url: string;
  if (deltaToken) {
    // Use the full deltaLink URL stored from last time
    url = deltaToken;
  } else {
    // First run — get all items
    url = `/users/${userId}/drive/root:/${folderPath}:/delta`;
  }

  let nextDeltaToken = "";

  // Paginate through all results
  while (url) {
    const response = await fetchWithRetry(() => {
      // If it's a full URL (deltaLink), use it directly
      if (url.startsWith("https://")) {
        return client.api(url).get();
      }
      return client.api(url).get();
    });

    // Process items in this page
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

    // Check for next page or delta link
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
