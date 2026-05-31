import { defineAuth } from '@aws-amplify/backend';

/**
 * Define and configure your auth resource
 * Email verification enabled — Cognito sends a 6-digit code on sign-up.
 * @see https://docs.amplify.aws/gen2/build-a-backend/auth
 */
export const auth = defineAuth({
  loginWith: {
    email: true,
  },
});
