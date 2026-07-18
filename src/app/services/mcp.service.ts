import { Injectable } from '@angular/core';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../../amplify/data/resource';

let _client: ReturnType<typeof generateClient<Schema>> | null = null;
function getClient() {
  if (!_client) _client = generateClient<Schema>();
  return _client;
}

/**
 * Manages the personal access token external MCP clients (Claude Desktop,
 * etc.) use to authenticate against the mcp-server Lambda's Function URL,
 * and looks up that URL (which only exists after CDK synth, so it's
 * surfaced via a query rather than baked into amplify_outputs.json).
 */
@Injectable({ providedIn: 'root' })
export class McpService {

  async getEndpointUrl(): Promise<string> {
    try {
      const { data, errors } = await getClient().queries.getMcpEndpoint();
      if (errors?.length) throw new Error(errors[0].message);
      return data ?? '';
    } catch (err) {
      console.warn('[McpService] getEndpointUrl failed:', err);
      return '';
    }
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
