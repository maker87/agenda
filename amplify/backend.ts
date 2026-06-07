import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';

const backend = defineBackend({
  auth,
  data,
});

// Grant the Bedrock chat Lambda permission to invoke Bedrock models
const bedrockPolicy = new PolicyStatement({
  effect: Effect.ALLOW,
  actions: ['bedrock:InvokeModel'],
  resources: ['arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-3-haiku-20240307-v1:0'],
});

backend.data.resources.cfnResources.cfnGraphqlApi;
// Find the Lambda and add permissions
const chatFunction = backend.data.resources.functions['bedrock-chat'];
chatFunction.addToRolePolicy(bedrockPolicy);
