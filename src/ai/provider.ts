import type { ModelClass, OutputTier, PromptVariant } from '../domain';

/**
 * Security boundary for live AI features.
 *
 * The browser, Android app, and Apple app must depend on an authenticated
 * server relay rather than embedding provider credentials. The deterministic
 * local engine remains the fallback when no adapter is configured.
 */
export interface ProviderRequest {
  prompt: string;
  modelClass: ModelClass;
  outputTier: OutputTier;
  targetModel: string;
  citations: string[];
  projectVariantId?: string;
}

export interface ProviderResponse {
  text: string;
  provider: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  requestId?: string;
}

export interface ProviderAdapter {
  readonly name: string;
  refine(request: ProviderRequest): Promise<ProviderResponse>;
  evaluate?(variant: PromptVariant): Promise<unknown>;
}

export class ProviderNotConfiguredError extends Error {
  constructor() {
    super('No server-side provider adapter is configured. Use the deterministic local engine or configure a reviewed relay.');
    this.name = 'ProviderNotConfiguredError';
  }
}

/**
 * Explicitly failing adapter: it prevents a UI from silently claiming that an
 * AI feature ran when the product has not been connected to a provider.
 */
export const unconfiguredProvider: ProviderAdapter = {
  name: 'unconfigured',
  async refine(): Promise<ProviderResponse> {
    throw new ProviderNotConfiguredError();
  },
};
