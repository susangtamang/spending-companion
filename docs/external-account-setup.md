# External development accounts

Clerk and Plaid are not required for unit tests or the local sample-data demo. They are required for the live sign-in and Plaid Sandbox exit gates. Do not commit or share passwords, secret keys, Plaid tokens, or the local encryption key.

## Clerk development instance

1. Create a Clerk account and a development application using the [official Clerk setup guide](https://clerk.com/docs/getting-started/quickstart/setup-clerk).
2. Enable email-address sign-in and email verification codes for the development instance.
3. Enable Clerk's Native API for the Expo app as described in the [official Expo quickstart](https://clerk.com/docs/expo/getting-started/quickstart).
4. Copy the development publishable key into `apps/mobile/.env` as `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`.
5. Put the backend secret key, issuer, and any audience/authorized-party restrictions only in the root `.env` using `.env.example` as the template.

## Plaid Sandbox

1. Create a Plaid developer account and obtain the Sandbox `client_id` and Sandbox secret from the Dashboard. Plaid documents these in its [Quickstart](https://plaid.com/docs/quickstart/) and [Sandbox overview](https://plaid.com/docs/sandbox/).
2. Put `PLAID_CLIENT_ID` and `PLAID_SECRET` only in the root `.env`; never add them to `apps/mobile/.env`.
3. Generate a local 32-byte AES key and store its base64 form as `PLAID_TOKEN_ENCRYPTION_KEY`. This key is local-development-only; production deliberately refuses it and requires a cloud KMS adapter.
4. Expose the API through a reachable HTTPS URL for webhook testing and set `PLAID_WEBHOOK_URL` to that URL plus `/v1/webhooks/plaid`.
5. Use Plaid's documented Sandbox test users or Sandbox Studio; never use real bank credentials in Sandbox.

## Mobile development build

Plaid Link contains native code and does not run in Expo Go. After both accounts are configured, create a custom Expo development build and set `EXPO_PUBLIC_API_URL` to an API address reachable by the phone. `localhost` on the phone is the phone itself.

## Readiness check

- The root `.env` contains backend-only Clerk and Plaid values.
- `apps/mobile/.env` contains only the Clerk publishable key and reachable API URL.
- `npm run check`, `npm test`, and `npm run build` pass.
- The API health endpoint works from the phone's network.
- The custom development build signs in before Plaid Link is tested.
