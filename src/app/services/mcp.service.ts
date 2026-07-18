import { Injectable } from '@angular/core';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../../amplify/data/resource';

let _client: ReturnType<typeof generateClient<Schema>> | null = null;
function getClient() {
  if (!_client) _client = generateClient<Schema>();
  return _client;
}

// Lambda Function URLs are stable once created — they don't change on
// redeploy unless the URL resource itself is replaced. Wiring this through
// CDK (env var or backend.addOutput) created a circular dependency between
// the data stack and the mcp-server function stack, so instead it's fetched
// once via the AWS CLI after deploy and hardcoded here.
const MCP_ENDPOINT_URL = 'https://j2lntgdub2awy5vqk3ttcaia2m0xvems.lambda-url.us-east-1.on.aws/';

/**
 * Manages the personal access token external MCP clients (Claude Desktop,
 * etc.) use to authenticate against the mcp-server Lambda's Function URL.
 */
@Injectable({ providedIn: 'root' })
export class McpService {

  async getEndpointUrl(): Promise<string> {
    return MCP_ENDPOINT_URL;
  }

  /** Returns the current active token for this account, if one has been generated. */
  async getToken(): Promise<string | null> {
    try {
      const { data, errors } = await getClient().models.ApiToken.list();
      if (errors?.length) throw new Error(errors[0].message);
      return data?.[0]?.token ?? null;
    } catch (err) {
      console.warn('[McpService] getToken failed:', err);
      return null;
    }
  }

  /** Generates a new token, replacing any existing one for this account (only one active token at a time). */
  async regenerateToken(ownerEmail: string): Promise<string> {
    const { data: existing } = await getClient().models.ApiToken.list();
    for (const t of existing ?? []) {
      await getClient().models.ApiToken.delete({ id: t.id });
    }
    const token = this.generateSecret();
    const { data, errors } = await getClient().models.ApiToken.create({
      ownerEmail,
      token,
      createdAt: new Date().toISOString(),
    });
    if (errors?.length) throw new Error(errors[0].message);
    return data!.token;
  }

  private generateSecret(): string {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  }
}
