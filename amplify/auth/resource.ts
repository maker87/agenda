import { defineAuth } from '@aws-amplify/backend';

/**
 * Define and configure your auth resource
 * @see https://docs.amplify.aws/gen2/build-a-backend/auth
 */
export const auth = defineAuth({
  loginWith: {
    email: {
      verificationEmailStyle: 'CODE',
      verificationEmailSubject: 'Agenda - Your verification code',
      verificationEmailBody: (createCode) =>
        `Your Agenda verification code is: ${createCode()}. Enter this code to verify your email.`,
    },
  },
  userAttributes: {
    email: {
      required: true,
      mutable: true,
    },
  },
});
