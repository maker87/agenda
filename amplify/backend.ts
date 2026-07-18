import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { mcpServerFunction } from './functions/mcp-server/resource';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Stack } from 'aws-cdk-lib';
import { Function as LambdaFunction } from 'aws-cdk-lib/aws-lambda';
import { HttpApi, CorsHttpMethod, HttpMethod as ApiHttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';

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

// Using API Gateway (HTTP API) rather than a Lambda Function URL — this AWS
// account rejects anonymous Function URL invocations with a 403
// AccessDeniedException at the platform edge (before the request ever
// reaches the Lambda), despite AuthType.NONE and the resource policy being
// configured correctly. API Gateway isn't subject to that same restriction.
const mcpStack = Stack.of(mcpLambda);
const mcpHttpApi = new HttpApi(mcpStack, 'McpHttpApi', {
  apiName: 'agenda-mcp-server',
  corsPreflight: {
    allowOrigins: ['*'],
    allowMethods: [CorsHttpMethod.POST],
    allowHeaders: ['*'],
  },
});
mcpHttpApi.addRoutes({
  path: '/',
  methods: [ApiHttpMethod.POST],
  integration: new HttpLambdaIntegration('McpIntegration', mcpLambda),
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

// Table names are plain string literals (not backend.data tokens) for the
// same reason as the policy above — confirmed once via
// `aws dynamodb list-tables` after the first successful mcp-server deploy.
// App id d2v5f8amhdhhjl -> AppSync API id mvjyhqvbi5hajc6rcdnhqwva24.
mcpLambda.addEnvironment('CALENDAR_EVENT_TABLE', 'CalendarEvent-mvjyhqvbi5hajc6rcdnhqwva24-NONE');
mcpLambda.addEnvironment('NOTIFICATION_TABLE', 'Notification-mvjyhqvbi5hajc6rcdnhqwva24-NONE');
mcpLambda.addEnvironment('STREAK_TABLE', 'Streak-mvjyhqvbi5hajc6rcdnhqwva24-NONE');
mcpLambda.addEnvironment('API_TOKEN_TABLE', 'ApiToken-mvjyhqvbi5hajc6rcdnhqwva24-NONE');

// Find the bedrock-chat Lambda in the CDK construct tree and grant Bedrock permissions.
// (Deliberately NOT adding an environment variable here referencing anything
// from the mcp-server stack — bedrock-chat's Lambda lives inside the data
// stack, and mcp-server's grants above already make the function stack
// depend on the data stack, so a reverse reference here would create a
// circular dependency between the two nested stacks.)
//
// TEMPORARY: resources target Nova Lite, matching the temporary MODEL_ID
// revert in bedrock-chat/handler.js (this account hasn't completed Bedrock's
// Anthropic use-case-details form yet). Restore the claude-sonnet-4-5
// foundation-model/inference-profile ARNs here when switching back.
const dataStack = Stack.of(backend.data);
const allConstructs = dataStack.node.findAll();
for (const construct of allConstructs) {
  if (construct instanceof LambdaFunction && construct.node.id.includes('bedrock-chat')) {
    construct.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['bedrock:InvokeModel'],
        resources: [
          'arn:aws:bedrock:us-east-1::foundation-model/us.amazon.nova-lite-v1:0',
          'arn:aws:bedrock:us-east-1:*:inference-profile/us.amazon.nova-lite-v1:0',
        ],
      })
    );
  }
}

// NOTE: deliberately not calling backend.addOutput() here — it still
// attaches the resulting CfnOutput to the data stack under the hood, which
// recreates the same circular dependency the grants above already require in
// the other direction. The API's invoke URL is hardcoded in mcp.service.ts
// instead (fetched once via `aws apigatewayv2 get-apis` after deploy).
void mcpHttpApi;
