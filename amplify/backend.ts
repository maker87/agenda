import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Stack } from 'aws-cdk-lib';
import { Function as LambdaFunction } from 'aws-cdk-lib/aws-lambda';

const backend = defineBackend({
  auth,
  data,
});

// Find the bedrock-chat Lambda in the CDK construct tree and grant Bedrock permissions
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
