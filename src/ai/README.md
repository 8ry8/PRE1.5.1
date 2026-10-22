# AI feature integration boundary

The approved AI features are represented in the local engine as deterministic, inspectable fallbacks:

- `refinePrompt` is the evidence-grounded meta-prompt synthesizer fallback.
- `inferClassFromGoal` and `buildRequestPlan` are the router and budget-policy fallback.
- `inferOutputTier` and the output-contract sections are the structured-output fallback.
- `evaluateLocally` is the regression/evaluation harness simulation.
- `stressTest` is the bounded injection and drift safety simulation.
- `diagnoseDrift` compares version branches without collecting hidden reasoning traces.

`provider.ts` is the explicit live-AI boundary. `gemini.ts` implements `ProviderAdapter` through the private Worker in `relay/worker.mjs`. See [Gemini setup](../../docs/gemini-setup.md).

- The API connection screen accepts an HTTPS relay URL and a **separate relay password**, never a provider key. Only the URL is persisted. The password stays in the adapter instance until disconnect/reload.
- `GEMINI_API_KEY` and `RELAY_ACCESS_TOKEN` are Worker secrets. Origin checks, authentication, required rate limiting, fixed upstream/model selection, bounded payloads, output caps, and timeouts run server-side.
- Connection testing performs a model lookup, not generation. Refinement requires explicit consent to send the local draft (including extracted context) to the Worker and Google. It never retries or silently falls back on failure.
- The actual provider/model and optional usage counts are saved in the variant's optional `generation` metadata. Old variants without it remain local variants. No connection credentials belong in the portable project schema.
- Local draft citations remain visible, but the AI rewrite is an **unattributed change** with a review warning. Local regression checks do not validate that rewrite. Evaluation and real tools are not implemented by this adapter.
- This is a personal-use, single-owner relay, not tenant authentication. A public service needs account-level authorization, quotas, abuse protection, and privacy review.

The unconfigured adapter is retained for other clients/providers. No client-side provider API key should ever be added to this repository.
