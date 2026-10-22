# Connect Gemini to the GitHub Pages site

The **Gemini API key goes in a Cloudflare Worker secret named `GEMINI_API_KEY`**. It does **not** go in GitHub Pages, the site's connection form, a `VITE_` variable, source code, or chat.

GitHub Pages can serve the frontend but cannot run a private backend. This repository includes an optional, **single-owner** Worker relay. Local refinement continues to work without it. You need a Cloudflare account to deploy the relay and a Gemini API key with access to a text-generation model. Review Google's terms, data handling, quota, and billing before sending sensitive documents.

```text
GitHub Pages browser → your authenticated Cloudflare Worker → Gemini API
                         GEMINI_API_KEY stays here
```

## Option A: Deploy through GitHub — no terminal or download needed

The **Deploy private Gemini relay** GitHub Actions workflow handles dependency installation, tests, Worker deployment, secret configuration, and a key/model access check. It never builds the frontend with provider credentials and never generates text during deployment verification.

### One-time private authorization (only the account owner can do this)

1. Sign in to your **Cloudflare account**. Copy its **Account ID** from the account dashboard.
2. In **My Profile → API Tokens → Create Token**, create a token for deploying Workers. For a custom token, grant **Account → Workers Scripts → Edit** and **Account → Account Settings → Read**, scoped to the specific account where this relay will run. The **Edit Cloudflare Workers** template is another starting point; restrict its scope to your account. Use an API token, **not** your Global API Key. A `workers.dev` deployment does not require changing your DNS.
3. Open [this repository’s GitHub Actions secrets page](https://github.com/8ry8/PRE1.5.1/settings/secrets/actions). Click **New repository secret** for each of these four entries:

   | Secret name | Private value |
   | --- | --- |
   | `CLOUDFLARE_API_TOKEN` | The Cloudflare deployment API token from step 2. |
   | `CLOUDFLARE_ACCOUNT_ID` | Your 32-character Cloudflare Account ID. |
   | `GEMINI_API_KEY` | Your existing Gemini API key. |
   | `RELAY_ACCESS_TOKEN` | A different random password of 32–256 non-space ASCII characters, generated and saved in your password manager. Never reuse the Gemini key. |

   Enter the values **only in GitHub’s private secret form**, not in chat, issues, pull requests, files, workflow inputs, or frontend build variables. These repository secrets are used by the dedicated relay deployment job; the Pages build does not reference them. Anyone with the relay password can consume your Google quota, so keep it private too.

### Run the automated deployment

Open [Actions → Deploy private Gemini relay](https://github.com/8ry8/PRE1.5.1/actions/workflows/gemini-relay.yml), choose **Run workflow**, select **main**, and run it. Alternatively, tell the coding agent that you have saved the secrets (do not send their values) so it can try to start the workflow and inspect its result.

- The workflow runs only on `main`, by explicit dispatch—not on pull requests or every website build.
- Missing or invalid setup values stop deployment with the **names** to fix, never their values.
- The official, pinned Cloudflare action uploads `GEMINI_API_KEY` and `RELAY_ACCESS_TOKEN` as Worker secrets and deploys the checked-in rate-limit configuration. No manual secret copying in Cloudflare is needed for this route.
- The final step reports your **Worker URL** in the run summary and checks `/api/status` with the relay password. This verifies model access, not generation quota or billing. If the check fails, the run summary and log include the relay's own setup message (for example **Gemini model not found** or **Gemini rejected the request**), never secret values.
- If your Cloudflare account first needs a `workers.dev` subdomain, complete that setup in **Workers & Pages** and rerun the workflow. If the example model is unavailable, update `GEMINI_MODEL` in `relay/wrangler.jsonc` and rerun after that change is on `main`.
- If deployment succeeds but the Gemini check fails, the Worker still exists. Use the URL in the summary and **Test & connect** to diagnose the key/model configuration. Do not assume live AI is ready until that check succeeds.

Then skip to **4. Connect from the site** below. After changing a GitHub secret, rerun this workflow to update the Worker. Do not mix dashboard-only secret changes with stale GitHub secrets: the next automated deployment replaces the Worker values with the GitHub values.

## Option B: Deploy from your computer

### 1. Deploy the relay once

On your own computer, open a terminal in this repository. Use Node.js 22 or newer for the Worker tooling.

```bash
npm install
npx wrangler login
npm run relay:deploy
```

Wrangler opens a browser to sign in to your Cloudflare account. The configuration in `relay/wrangler.jsonc` deploys `relay/worker.mjs` as `pre-gemini-relay`, including the required rate-limit binding. Keep the HTTPS `workers.dev` URL printed by the deployment. Opening that URL directly is not a connection test: only the authenticated `/api/status` and `/api/refine` endpoints exist.

**The first deployment intentionally refuses AI requests until the secrets are configured.** Do not remove authentication or the limiter to get around a setup error. You do not need to move the frontend away from GitHub Pages.

## 2. This is where you paste your API key

In the Cloudflare dashboard:

1. Open **Workers & Pages → pre-gemini-relay → Settings → Variables and Secrets**.
2. Add a **Secret** named **`GEMINI_API_KEY`**.
3. Paste your Gemini API key as its value and save/apply the change.
4. Add another **Secret**, **`RELAY_ACCESS_TOKEN`**, using a **different random password of 32–256 non-space ASCII characters**. Never reuse the Gemini key. Save this password in your password manager; you will enter it in the site.

For example, generate a strong relay password locally with:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

You can set the two secrets through interactive CLI prompts instead of the dashboard:

```bash
npm run relay:secret -- GEMINI_API_KEY
npm run relay:secret -- RELAY_ACCESS_TOKEN
```

These commands ask for secret values privately. Do not put their values into shell command arguments, committed configuration, frontend build variables, or the browser URL. Anyone who knows the relay password can use your Gemini quota through this relay, so keep it private too. If a credential leaks, rotate it immediately.

## 3. Confirm the non-secret settings

`relay/wrangler.jsonc` includes these ordinary Worker variables:

| Setting | Value / meaning |
| --- | --- |
| `ALLOWED_ORIGIN` | `https://8ry8.github.io` for this repository's Pages site. No trailing slash and no `/PRE1.5.1/` path. If using a custom domain, set its exact HTTPS origin instead. |
| `GEMINI_MODEL` | The default is `gemini-3.8-flash`, a stable model Google offers to new API keys (as of October 2026). Google now limits `gemini-2.5-*` models to projects that used them before, so a newly created key gets **Gemini model not found** for them. Set this to a current `generateContent` model available to **your** key; availability can change. Do not use the workbench's `standard-fast`, `reasoning-balanced`, or `agentic-sandbox` profile labels here. |
| `GEMINI_LIMITER` | A required native rate-limit binding, created by the checked-in configuration: 10 requests per 60 seconds per key/location. |

If changing the origin/model, edit `relay/wrangler.jsonc` and run `npm run relay:deploy` again. This keeps later deployments consistent with your settings; secrets remain separate. A preview uses a different origin from GitHub Pages—use the published Pages site, or deliberately change `ALLOWED_ORIGIN` to the preview's exact origin for testing.

For a server-side Gemini key, enable/restrict the appropriate Generative Language API in your Google project. Browser HTTP-referrer restrictions are not appropriate for requests from this Worker. Configure Google-side quotas/billing controls; the relay's rate limit is **not** a guaranteed global spending cap.

## 4. Connect from the site

Once the updated frontend is published to GitHub Pages:

1. Open **API connection** in the sidebar (or **Set up Gemini** on the Workbench).
2. Enter your deployed **Worker URL**, for example `https://pre-gemini-relay.your-account.workers.dev`. Use the base URL, without `/api/status` or `/api/refine`.
3. Enter your **relay access password** (`RELAY_ACCESS_TOKEN`), **not** your Gemini API key.
4. Click **Test & connect**. This authenticates with the relay and checks the key/model with Google's model lookup endpoint; it does not generate a prompt. It does not guarantee later generation quota or billing access.
5. Return to **Workbench** and enter your goal or draft. Select the checkbox approving transmission of the draft and extracted attachment text, then click **Refine with Gemini**.

The website remembers only the Worker URL. The access password is kept in page memory only: re-enter it after a reload, or choose **Disconnect** to clear it. No provider API key is requested, stored, or exported by the frontend. Local refinement never sends a request to the relay or Google.

**Connecting does not deploy the frontend.** This repository's Pages workflow publishes when changes reach `main`. Branch changes and Arena previews do not automatically change the public site.

## What live mode does—and does not do

- Builds a source-cited local draft, then asks Gemini to improve the prompt. It does **not** execute the user's task, invoke tools, or run an agent.
- Sends the local draft, including ready/extracted attachment text, and policy labels to your Worker and Google only after explicit approval. Original binary attachments are not uploaded.
- Saves the returned prompt with actual provider/model metadata and optional usage counts. Target prompt profiles remain separate from the Gemini model doing the rewrite.
- Records the AI rewrite as an **unattributed change requiring review**. Inherited citations describe the local draft; they are not proof that Gemini followed or verified every rule.
- Keeps evaluations, stress tests, and drift checks local simulations. Connecting Gemini does not enable a live LLM judge or live tools. Android/Apple drafts remain local-only.
- Does not silently fall back to local output after an AI failure. The previous variant stays visible. No automatic retry is made, to avoid duplicate charges.

## Limits and troubleshooting

- **No API connection menu on the public site:** the frontend changes have not been published yet. Review/merge the branch and let the existing Pages workflow deploy it.
- **Could not reach the relay:** verify HTTPS, the base URL, deployment, and exact `ALLOWED_ORIGIN`. CORS errors are usually an origin mismatch. CORS is not authentication; the password is still mandatory.
- **Access password incorrect:** use the secret `RELAY_ACCESS_TOKEN`, not the Gemini API key. Re-enter it after a page reload. Rotating it invalidates old connections on their next request.
- **Relay setup incomplete:** check both secrets, the origin/model variables, and the `GEMINI_LIMITER` binding. The relay fails closed if any required setting is absent or the two secrets are the same.
- **Gemini rejected the request / model not found:** check key validity, API restrictions, available models, and billing in Google AI Studio. Update `GEMINI_MODEL` if the configured model is unavailable to your key or retired (for example, new keys cannot use `gemini-2.5-flash`).
- **Quota / rate limit:** wait, then check Google quota/billing. Do not repeatedly press Refine. Cloudflare's limiter is location-scoped and approximate, not a global monthly budget.
- **Input too large:** the draft is limited to 40,000 characters and the JSON body to 128 KiB. Reduce attachments. The server caps output at 8,192 tokens and waits at most 45 seconds for Gemini; the browser waits at most 60 seconds for the relay.
- **Safety block, empty or truncated result:** no new variant is saved. Review/reduce the input. A timed-out or rejected response can still consume provider quota; the app never retries automatically.

This is a private personal-use connection, **not** production multi-tenant authentication. Do not distribute the password to website visitors or remove the guard for public use. A public service needs accounts, per-user authorization and quotas, abuse controls, and a reviewed privacy policy.

## Developer checks (no real key or paid call required)

```bash
npm test
npm run build
npm run relay:check
```

Tests mock Google responses and verify the relay's authentication, CORS, limits, response handling, and the browser connection flow. A dry run validates/bundles the Worker but does not deploy it or contact Gemini.
