import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { mcpServerFunction } from './functions/mcp-server/resource';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Stack } from 'aws-cdk-lib';
import { Function as LambdaFunction, FunctionUrlAuthType, HttpMethod } from 'aws-cdk-lib/aws-lambda';

const backend = defineBackend({
  auth,
  data,
  mcpServerFunction,
});

// ── MCP server: exposes calendar events/reminders/streaks as tools for
// external MCP clients (Claude Desktop, etc.), authenticated via a personal
// access token (ApiToken model) rather than full OAuth — the token is
// generated from the app's Settings UI and checked inside the handler.
// resources.lambda is typed as the IFunction interface, which doesn't expose
// addEnvironment() (only the concrete Function class does) — cast since
// defineFunction() always creates a real, owned Function under the hood.
const mcpLambda = backend.mcpServerFunction.resources.lambda as LambdaFunction;

const mcpFunctionUrl = mcpLambda.addFunctionUrl({
  authType: FunctionUrlAuthType.NONE, // auth is handled inside the handler via bearer token
  cors: {
    allowedOrigins: ['*'],
    allowedMethods: [HttpMethod.POST],
    allowedHeaders: ['*'],
  },
});

mcpLambda.addEnvironment('CALENDAR_EVENT_TABLE', backend.data.resources.tables['CalendarEvent'].tableName);
mcpLambda.addEnvironment('NOTIFICATION_TABLE', backend.data.resources.tables['Notification'].tableName);
mcpLambda.addEnvironment('STREAK_TABLE', backend.data.resources.tables['Streak'].tableName);
mcpLambda.addEnvironment('API_TOKEN_TABLE', backend.data.resources.tables['ApiToken'].tableName);

backend.data.resources.tables['CalendarEvent'].grantReadWriteData(mcpLambda);
backend.data.resources.tables['Notification'].grantReadWriteData(mcpLambda);
backend.data.resources.tables['Streak'].grantReadWriteData(mcpLambda);
backend.data.resources.tables['ApiToken'].grantReadData(mcpLambda);

// Find the bedrock-chat Lambda in the CDK construct tree and grant Bedrock permissions.
// (Deliberately NOT adding an environment variable here referencing anything
// from the mcp-server stack — bedrock-chat's Lambda lives inside the data
// stack, and mcp-server's grants above already make the function stack
// depend on the data stack, so a reverse reference here would create a
// circular dependency between the two nested stacks.)
const dataStack = Stack.of(backend.data);
const allConstructs = dataStack.node.findAll();
for (const construct of allConstructs) {
  if (construct instanceof LambdaFunction && construct.node.id.includes('bedrock-chat')) {
    construct.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['bedrock:InvokeModel'],
        resources: [
          'arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-sonnet-4-5-20250929-v1:0',
          'arn:aws:bedrock:us-east-1:*:inference-profile/us.anthropic.claude-sonnet-4-5-20250929-v1:0',
        ],
      })
    );
  }
}

// Publish the mcp-server Function URL (only known after synth) into
// amplify_outputs.json's `custom` section, so the frontend can read it
// without any cross-stack Lambda reference.
backend.addOutput({
  custom: {
    mcpEndpointUrl: mcpFunctionUrl.url,
  },
});
