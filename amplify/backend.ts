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

// NOTE: deliberately NOT using backend.data.resources.tables['X'].tableName
// or .grantReadWriteData() here. bedrock-chat's Lambda lives in this exact
// same shared "function" nested stack, and AppSync's chat/translateTexts
// resolvers already require data-stack -> function-stack (to reference
// bedrock-chat's ARN). Referencing ANY data-stack table token from mcp-server
// (whether via a grant or a plain env var) adds the reverse edge and forms a
// circular dependency between the two stacks. A wildcard-suffix IAM policy
// (using only account/region pseudo-parameters, not stack tokens) grants the
// needed permissions without creating that reference. Actual table names are
// hardcoded as plain string literals (not tokens) once known post-deploy —
// see mcp-server/handler.js comments.
const mcpStack = Stack.of(mcpLambda);
mcpLambda.addToRolePolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:DeleteItem', 'dynamodb:Scan', 'dynamodb:Query'],
    resources: [
      `arn:aws:dynamodb:${mcpStack.region}:${mcpStack.account}:table/CalendarEvent-*`,
      `arn:aws:dynamodb:${mcpStack.region}:${mcpStack.account}:table/Notification-*`,
      `arn:aws:dynamodb:${mcpStack.region}:${mcpStack.account}:table/Streak-*`,
      `arn:aws:dynamodb:${mcpStack.region}:${mcpStack.account}:table/ApiToken-*`,
    ],
  })
);

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

// NOTE: deliberately not calling backend.addOutput() here — it still
// attaches the resulting CfnOutput to the data stack under the hood, which
// recreates the same circular dependency (data stack -> function stack) that
// the grants above already require in the other direction. Lambda Function
// URLs are stable once created (they don't change on redeploy unless the
// URL resource itself is replaced), so once this deploys successfully the
// URL is fetched once via the AWS CLI and hardcoded into mcp.service.ts
// instead of being wired through CDK.
void mcpFunctionUrl;
