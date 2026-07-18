import { defineFunction } from '@aws-amplify/backend';

export const mcpServerFunction = defineFunction({
  name: 'mcp-server',
  entry: './handler.js',
  timeoutSeconds: 30,
  memoryMB: 256,
});
