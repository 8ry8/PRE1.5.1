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

Open [Actions → Deploy private Gemini relay](https://github.com/8ry8/PRE1.5.1/actions/workflows/gemini-relay.yml), choose **Run workflow**, select **main**, and run it. Alternatively, tell the coding agent that you have saved the secrets (do not send their values) so it can start the workflow and inspect its result.

A coding agent or other GitHub integration may be refused **Run workflow** with `HTTP 403: Resource not accessible by integration`, because that API requires the **Actions: write** permission. It can start the same deployment with a `deploy-gemini-relay` repository dispatch event instead, which requires only **Contents: write**. Reconnecting the integration does not add a permission it never requests.

```bash
gh api repos/8ry8/PRE1.5.1/dispatches -f event_type=deploy-gemini-relay
```

- The workflow runs only on `main`, and only when explicitly started by **Run workflow** or that one dispatch event type. It never runs on pull requests, pushes, or website builds. A dispatch event always deploys the latest commit on `main`, and the workflow ignores any data sent with it.
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
| `GEMINI_FALLBACK_MODEL` | The default is `gemini-3.5-flash-lite`. A second model the relay falls back to automatically when the primary keeps failing on the provider side. It is **not** used for a quota/rate-limit `429`, a safety block, an incomplete generation, or a timeout, so a fallback never repeats a charge for the same blocked content or burns quota that is already exhausted. Every attempt shares one 180-second server budget, so retries and fallback cannot multiply the wait. The variant records the model that actually answered. Delete this line (or set it to `""`) for single-model behavior with no fallback. Both models accept the relay's fixed `low` thinking level; Flash-Lite's own default is the lighter `minimal`. |
| `GEMINI_LIMITER` | A required native rate-limit binding, created by the checked-in configuration: 10 requests per 60 seconds per key/location. One refinement consumes one unit; switching to the fallback model consumes a second. Automatic retries of a failed call are not charged, because Google does not bill them and a short outage must not lock you out of your own relay. |

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
- Does not silently fall back to local output after an AI failure. The previous variant stays visible.
- Retries a **transient** provider failure automatically, so a momentary Google `5xx`/overloaded answer or a dropped connection does not become a failed edit: up to three attempts on the primary model (short waits of 0.4s and 1.2s), then the same bounded attempts on `GEMINI_FALLBACK_MODEL`. It never retries a quota `429`, a rejected key/request, a missing model, a redirect, a safety block, an incomplete generation, an oversized reply, or a timeout, and every attempt shares one 180-second budget. The saved variant always names the model that actually answered, and a failed attempt never overwrites your previous output.
- Never retries in the browser. Only the relay can retry, because only the relay knows whether an upstream call was already made; the page reports the relay's credential-free message.

## Limits and troubleshooting

- **No API connection menu on the public site:** the frontend changes have not been published yet. Review/merge the branch and let the existing Pages workflow deploy it.
- **Could not reach the relay:** verify HTTPS, the base URL, deployment, and exact `ALLOWED_ORIGIN`. CORS errors are usually an origin mismatch. CORS is not authentication; the password is still mandatory.
- **Access password incorrect:** use the secret `RELAY_ACCESS_TOKEN`, not the Gemini API key. Re-enter it after a page reload. Rotating it invalidates old connections on their next request. If you have lost track of which value is where — or you changed a secret without redeploying — follow **Clean-slate credential reset** below.
- **Relay setup incomplete:** check both secrets, the origin/model variables, and the `GEMINI_LIMITER` binding. The relay fails closed if any required setting is absent or the two secrets are the same.
- **Gemini rejected the request / model not found:** check key validity, API restrictions, available models, and billing in Google AI Studio. Update `GEMINI_MODEL` if the configured model is unavailable to your key or retired (for example, new keys cannot use `gemini-2.5-flash`).
- **Quota / rate limit:** wait, then check Google quota/billing. Do not repeatedly press Refine. Cloudflare's limiter is location-scoped and approximate, not a global monthly budget.
- **Input too large:** the draft is limited to 40,000 characters and the JSON body to 128 KiB. Reduce attachments. The server caps output at 8,192 tokens and caps reasoning effort at the `low` thinking level; it allows at most 180 seconds in total across retries, the primary, and any fallback attempt, while the browser waits at most 210 seconds for the relay. The browser limit is deliberately the longer one so you see the relay's own explanation rather than a bare timeout.
- **Gemini is unavailable (upstream HTTP 5xx):** the relay already retried the same model (`0.4s`, then `1.2s`), then tried `GEMINI_FALLBACK_MODEL` the same way. Seeing this message therefore means Google refused every attempt. Wait a minute and press Refine again; if it persists, check [Google's status page](https://status.cloud.google.com/), confirm the model is still available to your key, and update `GEMINI_MODEL` if it was retired. The number in the message is Google's (or the edge's) HTTP status, which is what makes this diagnosable; no request, prompt, or credential detail is included.
- **Gemini timed out:** both configured models are thinking models, so a large draft near the output cap can be slow. Reduce the draft or attachments. The 180-second budget is shared, so a slow primary leaves fewer retries and less fallback time; a timeout is never retried. A timed-out request may still be billed.
- **Safety block, empty or truncated result:** no new variant is saved, and no fallback model is tried. Review/reduce the input. A timed-out or rejected response can still consume provider quota.

This is a private personal-use connection, **not** production multi-tenant authentication. Do not distribute the password to website visitors or remove the guard for public use. A public service needs accounts, per-user authorization and quotas, abuse controls, and a reviewed privacy policy.

## Clean-slate credential reset (key + password)

Use this when you have lost track of which value went where. It replaces **both** credentials and finishes with an objective pass/fail test, so you never have to guess which one is wrong.

Two credentials are in play, and swapping them is the usual cause of every connection failure:

| Credential | Made by | Lives in | Typed into the site |
| --- | --- | --- | --- |
| `GEMINI_API_KEY` | Google AI Studio | Worker secret only | **Never** |
| `RELAY_ACCESS_TOKEN` | You, with any password manager | Worker secret **and** your password manager | The **Relay access password** box |

The site never asks for the Google key. If a value starting with `AIza` lands in a website field, the wrong value was pasted.

### 1. Decide which route owns your secrets — and use only that one

- **Route A (GitHub Actions).** If you have ever run **Deploy private Gemini relay**, GitHub is the source of truth. Every run pushes the GitHub values into the Worker, so **any change you make in the Cloudflare dashboard is silently overwritten** by the next run. This is the most common way to "fix" a secret and see nothing change.
- **Route B (your computer).** If you deployed with `npm run relay:deploy`, Cloudflare is the source of truth and the GitHub secrets are irrelevant.

**Pick one route and stop touching the other.** If you are unsure which you used, use Route A: it is self-verifying (step 4).

### 2. Make a new key in Google AI Studio

1. Open [aistudio.google.com/apikey](https://aistudio.google.com/apikey) and **Create API key** in a project where the **Generative Language API** is enabled.
2. Leave the key **unrestricted by HTTP referrer** — these calls come from your Worker, not from a browser.
3. Confirm the project has quota/billing enabled.
4. Copy the key once. It goes into a secret in step 3 — **never** into the website, a file, a chat message, or this repository.
5. After the new key works (step 4/5), delete the old key in AI Studio.

Keep `GEMINI_MODEL` at its default `gemini-3.8-flash` for a new key. Newly created keys cannot use `gemini-2.5-*` models, which produce **Gemini model not found**.

### 3. Make a new relay password

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

That yields 64 hex characters and satisfies every rule the relay enforces: 32–256 characters, printable ASCII, no spaces, not starting with `AIza`, and not equal to `GEMINI_API_KEY`. Save it in your password manager as the relay password.

### 4. Write both values into GitHub secrets (Route A)

In **Settings → Secrets and variables → Actions → New repository secret**, set or overwrite:

| Secret name | Value |
| --- | --- |
| `GEMINI_API_KEY` | The new key from step 2. |
| `RELAY_ACCESS_TOKEN` | The new password from step 3. |

GitHub never shows a secret's value again; overwriting with a new value is the normal way to rotate one. Leave `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` untouched.

**Do not** paste these into `relay/wrangler.jsonc`, a `VITE_` variable, workflow inputs, an issue, or a chat message.

### 5. Rerun the deployment — this is the test

**Actions → Deploy private Gemini relay → Run workflow → branch `main`**, or from a terminal:

```bash
gh api repos/8ry8/PRE1.5.1/dispatches -f event_type=deploy-gemini-relay
```

The workflow validates both secrets, deploys them to the Worker, then calls `/api/status` **with the new password** and checks the model with Google. That last step is a real end-to-end test of both credentials:

- **Green run** → the password on the Worker, the Google key, the model, and `ALLOWED_ORIGIN` are all correct. The run summary also prints your **Worker URL**.
- **Red run** → the log names what is wrong (for example *Gemini model not found* or *Gemini rejected the request*) and never prints any secret value.

If you change a secret and **do not** rerun this workflow, the Worker keeps the old value and the site will keep rejecting your new password.

### 6. Connect from the published Pages site

1. Open the **published** site, `https://8ry8.github.io/PRE1.5.1/`. An Arena/branch preview is a different origin and is refused with **This website origin is not allowed.**
2. Open **API connection** and enter the Worker **base URL** from the run summary — no `/api/status` path.
3. Paste the **relay password** from step 3 — not the Gemini key.
4. Click **Test & connect**. It does a model lookup, not a generation, so it costs no output quota.

The password is held in page memory only: re-enter it after any reload, and use **Disconnect** to clear it.

### 7. Read the exact message if it still fails

| Message | Meaning | What to do |
| --- | --- | --- |
| "That looks like a Google API key…" | The Gemini key was pasted into the site's password box. | Paste `RELAY_ACCESS_TOKEN` instead. |
| "Enter the separate RELAY_ACCESS_TOKEN password…" | Password is under 32 characters, contains a space, or has non-ASCII characters. | Regenerate with step 3. |
| "Access password is incorrect." (401) | The Worker is healthy; the value you typed is not the one now deployed. | Re-copy from your password manager. If you rotated the GitHub secret, rerun the workflow first — the Worker still holds the old one until you do. |
| "Relay setup is incomplete." (503) | A secret is missing or malformed, or the two secrets are equal. | Rerun the workflow; its first step names any invalid secret. |
| "This website origin is not allowed." (403) | You are not on `https://8ry8.github.io`. | Use the published Pages site, not a preview. |
| "Relay rate limit reached." (429) | More than 10 requests/minute. | Wait 60 seconds. Do not press Refine repeatedly. |
| "Gemini rejected the request (upstream HTTP 400/401/403)." | Google refused the key: invalid, restricted, wrong project, or billing off. | New key (step 2); check API restrictions and billing. |
| "Gemini model not found (upstream HTTP 404)." | That model is not available to your key. | Keep `gemini-3.8-flash`; new keys cannot use `gemini-2.5-*`. |
| "Gemini quota or rate limit reached (upstream HTTP 429)." | Out of Google quota. | Wait, then check quota/billing. Do not retry repeatedly. |
| "Gemini is unavailable (upstream HTTP 5xx). The relay tried N times…" | Google had a transient outage; **your password and key are fine.** | Wait a minute and press Refine again; if it persists, check [status.cloud.google.com](https://status.cloud.google.com/). |
| "Could not reach the relay." | Wrong URL or the Worker is not deployed. | Copy the base URL from the run summary. |
| "The relay timed out." | Draft too large for the shared 180-second budget. | Reduce the draft/attachments. A timed-out request can still be billed. |

Verify from a terminal at any time without opening the site (one model lookup, no generation):

```bash
curl -s -w '\nHTTP %{http_code}\n' \
  -H "Origin: https://8ry8.github.io" \
  -H "Authorization: Bearer YOUR_RELAY_PASSWORD" \
  https://pre-gemini-relay.YOUR-SUBDOMAIN.workers.dev/api/status
```

`200` with `{"provider":"Google Gemini","model":"gemini-3.8-flash","connected":true}` means both credentials are good. `401` is a password mismatch, `503` a missing or malformed secret, `403` a wrong `Origin` header. Do not pipe a secret with `echo`, which appends a newline that becomes part of the value; use the GitHub form or the interactive `npm run relay:secret -- RELAY_ACCESS_TOKEN` prompt.

## Developer checks (no real key or paid call required)

```bash
npm test
npm run build
npm run relay:check
```

Tests mock Google responses and verify the relay's authentication, CORS, limits, response handling, and the browser connection flow. A dry run validates/bundles the Worker but does not deploy it or contact Gemini.
