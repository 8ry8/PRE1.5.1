# AI feature integration boundary

The approved AI features are represented in the local engine as deterministic, inspectable fallbacks:

- `refinePrompt` is the evidence-grounded meta-prompt synthesizer fallback.
- `inferClassFromGoal` and `buildRequestPlan` are the router and budget-policy fallback.
- `inferOutputTier` and the output-contract sections are the structured-output fallback.
- `evaluateLocally` is the regression/evaluation harness simulation.
- `stressTest` is the bounded injection and drift safety simulation.
- `diagnoseDrift` compares version branches without collecting hidden reasoning traces.

`provider.ts` is the intentionally explicit live-AI boundary. A future server relay can implement `ProviderAdapter`, validate the request against the linter, enforce tenant limits, and return provider metadata. No client-side API key should ever be added to this repository.
