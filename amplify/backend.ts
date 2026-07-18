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
const mcpLambda = backend.mcpServerFunction.resources.lambda;

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

// Find the bedrock-chat Lambda in the CDK construct tree, grant Bedrock
// permissions, and hand it the mcp-server Function URL (only known after
// synth) so getMcpEndpoint can return it to the frontend.
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
    construct.addEnvironment('MCP_ENDPOINT_URL', mcpFunctionUrl.url);
  }
}
