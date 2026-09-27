import { defineFunction } from '@aws-amplify/backend';

// Serves the `chat` and `translateTexts` queries (amplify/data/resource.ts).
// Registered in defineBackend too, so backend.ts can grant it Bedrock access
// by name rather than searching the construct tree for it.
export const bedrockChatFunction = defineFunction({
  name: 'bedrock-chat',
  entry: './handler.js',
  timeoutSeconds: 30,
  memoryMB: 256,
});
