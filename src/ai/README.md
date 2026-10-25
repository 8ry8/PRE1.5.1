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
- `GEMINI_API_KEY` and `RELAY_ACCESS_TOKEN` are Worker secrets. Origin checks, authentication, required rate limiting, fixed upstream/model selection, bounded payloads, output caps, the thinking level, and timeouts all run server-side. The client cannot raise any of them.
- Connection testing performs a model lookup, not generation. Refinement requires explicit consent to send the local draft (including extracted context) to the Worker and Google.
- Refinement never falls back to the local engine, and never retries the same model. It does make **at most one** automatic attempt against `GEMINI_FALLBACK_MODEL`, and only when the primary failed on the provider side (unavailable, rejected, or unreadable) — never for a quota `429`, safety block, incomplete generation, or timeout, and never once the shared 180-second server budget is spent. The fallback consumes a second unit of the account rate limit, and the response reports the model that actually answered, so a variant is never mislabeled. `/api/status` deliberately does not fall back: it must keep reporting whether the configured primary model is reachable.
- The browser waits 210 seconds, longer than the relay's 180-second budget, so a failure surfaces the relay's own credential-free message instead of a bare client-side abort.
- The actual provider/model and optional usage counts are saved in the variant's optional `generation` metadata. Old variants without it remain local variants. No connection credentials belong in the portable project schema.
- Local draft citations remain visible, but the AI rewrite is an **unattributed change** with a review warning. Local regression checks do not validate that rewrite. Evaluation and real tools are not implemented by this adapter.
- This is a personal-use, single-owner relay, not tenant authentication. A public service needs account-level authorization, quotas, abuse protection, and privacy review.

The unconfigured adapter is retained for other clients/providers. No client-side provider API key should ever be added to this repository.
