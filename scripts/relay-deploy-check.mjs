import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const requiredSecrets = ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'GEMINI_API_KEY', 'RELAY_ACCESS_TOKEN'];

export function validateDeploymentSecrets(env) {
  const missing = requiredSecrets.filter((name) => typeof env[name] !== 'string' || !env[name].trim());
  if (missing.length) {
    throw new Error(`Missing GitHub Actions repository secrets: ${missing.join(', ')}. Add them in Settings > Secrets and variables > Actions, then run this workflow again. Never paste their values into chat or source code.`);
  }
  if (!/^[a-f0-9]{32}$/i.test(env.CLOUDFLARE_ACCOUNT_ID)) {
    throw new Error('CLOUDFLARE_ACCOUNT_ID must be the 32-character account ID from your Cloudflare account, not an email address or token.');
  }
  if (!/^[\x21-\x7e]{32,256}$/.test(env.RELAY_ACCESS_TOKEN) || env.RELAY_ACCESS_TOKEN.startsWith('AIza') || env.RELAY_ACCESS_TOKEN === env.GEMINI_API_KEY) {
    throw new Error('RELAY_ACCESS_TOKEN must be a separate random password of 32–256 non-space ASCII characters, not the Gemini API key.');
  }
}

export function workerBaseUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Deployment did not report a Worker URL. Check the Cloudflare deployment step.'); }
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.workers.dev') || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Expected a clean HTTPS workers.dev URL from the deployment. Check that workers_dev is enabled in relay/wrangler.jsonc.');
  }
  return url.origin;
}

// The relay's error strings are fixed, credential-free setup hints (the same text
// the website shows after Test & connect), e.g. "Gemini model not found. ...".
// Surface one only if it still looks like such a sentence: short, plain
// punctuation, and no URLs, markup, key-like prefixes, or long opaque tokens.
export function relayErrorHint(data, accessToken) {
  const message = typeof data?.error === 'string' ? data.error.trim() : '';
  if (!message || message.length > 240) return '';
  if (!/^[A-Za-z0-9 .,;:'’()/_-]+$/.test(message) || /\S{25,}|\/\/|https?:|www\./i.test(message)) return '';
  if (/AIza/.test(message) || (accessToken && message.includes(accessToken))) return '';
  return message;
}

export async function verifyRelayConnection(url, accessToken, allowedOrigin, fetcher = fetch) {
  const base = workerBaseUrl(url);
  if (!/^[\x21-\x7e]{32,256}$/.test(accessToken ?? '')) throw new Error('RELAY_ACCESS_TOKEN is missing or invalid.');
  let origin;
  try { origin = new URL(allowedOrigin); } catch { throw new Error('ALLOWED_ORIGIN is invalid in the Worker configuration.'); }
  if (origin.protocol !== 'https:' || origin.origin !== allowedOrigin) throw new Error('ALLOWED_ORIGIN must be an HTTPS origin without a path or trailing slash.');
  let response;
  let data;
  try {
    response = await fetcher(`${base}/api/status`, {
      method: 'GET',
      headers: { Origin: allowedOrigin, Authorization: `Bearer ${accessToken}` },
      redirect: 'error',
      signal: AbortSignal.timeout(60_000),
    });
    data = await response.json();
  } catch {
    // Do not print request headers or raw network/provider error messages.
    throw new Error('Worker deployment completed, but its connection check could not finish. Check its URL and test again in the website’s API connection screen.');
  }
  if (!response.ok || data?.connected !== true || data?.provider !== 'Google Gemini' || typeof data?.model !== 'string' || !/^gemini-[a-zA-Z0-9._-]{1,100}$/.test(data.model)) {
    const hint = response.ok ? '' : relayErrorHint(data, accessToken);
    throw new Error(`Worker deployment completed, but Gemini access could not be verified (HTTP ${response.status}).${hint ? ` Relay reported: ${hint}` : ''} Check the Worker secrets, ALLOWED_ORIGIN, GEMINI_MODEL, and Google quota/billing. The website's Test & connect button can show the setup error. No text generation was attempted.`);
  }
  return { url: base, model: data.model };
}

async function main() {
  if (process.argv[2] === 'validate') {
    validateDeploymentSecrets(process.env);
    console.log('All required deployment secrets are present and pass format checks. Values were not printed.');
    return;
  }
  if (process.argv[2] !== 'verify') throw new Error('Use validate or verify.');
  const url = workerBaseUrl(process.env.RELAY_URL);
  // Publish only the non-secret URL; never put credentials in logs or artifacts.
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `## Gemini relay deployed\n\nWorker URL: **${url}**\n\nOpen the website’s **API connection** screen and enter this URL plus your separate relay access password. Do not enter the Gemini API key.\n\n`);
  const ts = await import('typescript');
  const { config, error } = ts.parseConfigFileTextToJson('relay/wrangler.jsonc', readFileSync('relay/wrangler.jsonc', 'utf8'));
  if (error) throw new Error('Cannot read relay/wrangler.jsonc.');
  let result;
  try {
    result = await verifyRelayConnection(url, process.env.RELAY_ACCESS_TOKEN, config?.vars?.ALLOWED_ORIGIN);
  } catch (error) {
    // Show the (credential-free) reason on the run page, not only in raw logs.
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      `**Connection check failed:** ${error.message}\n`);
    throw error;
  }
  console.log(`Gemini model access verified: ${result.model}. No text generation was performed.`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `Key/model access verified for **${result.model}** without generating text. Generation still depends on provider quota and billing.\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    // Every error exposed by this script is deliberately credential-free.
    console.error(error.message);
    process.exitCode = 1;
  });
}
