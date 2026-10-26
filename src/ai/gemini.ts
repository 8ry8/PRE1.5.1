import type { ProviderAdapter, ProviderRequest, ProviderResponse } from './provider';

export interface RelayConnectionStatus {
  provider: string;
  model: string;
  connected: true;
}

export function normalizeRelayUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error('Enter your deployed Worker URL, such as https://pre-gemini-relay.your-account.workers.dev.');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Use the HTTPS Worker base URL only, without credentials, a path, query parameters, or a fragment.');
  }
  if (url.hostname === 'generativelanguage.googleapis.com') {
    throw new Error('Enter your private relay URL, not the Google API URL. The Gemini API key belongs on the Worker.');
  }
  return url.origin;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validString(value: unknown, max: number): value is string {
  return typeof value === 'string' && !!value.trim() && value.length <= max;
}

function optionalCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/** The relay password lives in this instance only. Never serialize the adapter. */
export class GeminiRelay implements ProviderAdapter {
  readonly name = 'Google Gemini via private relay';
  readonly url: string;
  readonly #accessToken: string;
  readonly #fetcher: typeof fetch;

  constructor(url: string, accessToken: string, fetcher: typeof fetch = fetch) {
    this.url = normalizeRelayUrl(url);
    const token = accessToken.trim();
    if (token.startsWith('AIza')) {
      throw new Error('That looks like a Google API key. Put it in the Worker secret GEMINI_API_KEY, not in this site. Enter your separate relay access password here.');
    }
    if (!/^[\x21-\x7e]{32,256}$/.test(token)) {
      throw new Error('Enter the separate RELAY_ACCESS_TOKEN password: 32–256 non-space ASCII characters. Do not enter your Gemini API key.');
    }
    this.#accessToken = token;
    this.#fetcher = fetcher.bind(globalThis);
  }

  private async request(path: string, body?: ProviderRequest): Promise<unknown> {
    const controller = new AbortController();
    // Longer than the relay's own 180s server budget (PROVIDER_TIMEOUT_MS in
    // relay/worker.mjs) so the client always outlives the Worker and can show
    // the relay's real message instead of a bare abort. The margin also covers
    // the relay's bounded transient retries and its single automatic fallback
    // attempt, all of which share that same 180s budget. The browser itself
    // still never retries: only the relay can, because only the relay knows
    // whether an upstream call was already made.
    const timer = setTimeout(() => controller.abort(), 210_000);
    try {
      let response: Response;
      try {
        response = await this.#fetcher(`${this.url}${path}`, {
          method: body ? 'POST' : 'GET',
          headers: {
            Authorization: `Bearer ${this.#accessToken}`,
            ...(body ? { 'Content-Type': 'application/json' } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
          credentials: 'omit',
          cache: 'no-store',
          redirect: 'error',
          referrerPolicy: 'no-referrer',
          signal: controller.signal,
        });
      } catch {
        if (controller.signal.aborted) throw new Error('The relay timed out. A request may still be billed; no automatic retry was made.');
        throw new Error('Could not reach the relay. Check its HTTPS URL, your network, and that ALLOWED_ORIGIN matches this website origin.');
      }
      let data: unknown;
      try {
        data = await response.json();
      } catch {
        if (controller.signal.aborted) throw new Error('The relay timed out. A request may still be billed; no automatic retry was made.');
        throw new Error('The address did not return relay JSON. Check the Worker URL and deployment.');
      }
      if (!response.ok) {
        const message = record(data) && validString(data.error, 500)
          ? data.error.replaceAll(this.#accessToken, '[redacted]')
          : `Relay request failed (${response.status}). Check the Worker settings and access password.`;
        throw new Error(message);
      }
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  async testConnection(): Promise<RelayConnectionStatus> {
    const result = await this.request('/api/status');
    if (!record(result) || result.connected !== true || result.provider !== 'Google Gemini' || !validString(result.model, 128)) {
      throw new Error('Unexpected connection response. Make sure this is the PRE Gemini relay.');
    }
    return { provider: result.provider, model: result.model, connected: true };
  }

  async refine(request: ProviderRequest): Promise<ProviderResponse> {
    if (!request.prompt.trim() || request.prompt.length > 40_000) {
      throw new Error('Gemini refinement requires a non-empty draft of at most 40,000 characters, including attached text. Reduce the draft or attachments.');
    }
    const result = await this.request('/api/refine', request);
    if (!record(result) || !validString(result.text, 96_000) || result.provider !== 'Google Gemini' || !validString(result.model, 128)) {
      throw new Error('The relay returned an invalid refinement. No new variant was saved.');
    }
    return {
      text: result.text,
      provider: result.provider,
      model: result.model,
      inputTokens: optionalCount(result.inputTokens),
      outputTokens: optionalCount(result.outputTokens),
      requestId: validString(result.requestId, 128) ? result.requestId : undefined,
    };
  }
}
