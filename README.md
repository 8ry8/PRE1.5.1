# Prompt Refining Engine v1.5.1

Prompt Refining Engine is a source-cited prompt engineering workbench. This repository now contains a working local-first Single Page Application, a Kotlin/Jetpack Compose Android client draft, and a SwiftUI Apple client draft for iOS/macOS. All three clients share the same project concepts: behavioral classes, output tiers, source citations, change records, diagnostics, regression fixtures, and versioned prompt variants.

> **Have a Gemini API key?** Open **API connection** in the web app. The key goes in the **`GEMINI_API_KEY` secret on your Cloudflare Worker**, not in GitHub Pages or the browser. Follow the [step-by-step Gemini setup guide](docs/gemini-setup.md). Local mode needs no key; the optional relay enables prompt refinement only. Android and Apple drafts remain local-only.

## What is implemented

- **Optional Gemini refinement:** Connect a private, password-protected Cloudflare Worker from the new API connection screen. The provider key stays server-side; the browser keeps only a separate relay password in memory. Explicit consent is required before sending a draft/attachment text. The relay fixes the model, output cap, thinking level, and time budget server-side, and can make one bounded fallback attempt to a second model if the primary fails on the provider side. AI rewrites are labeled for human review, not presented as independently source-verified.
- **Workbench:** Enter a raw goal, select Standard, Reasoning, or Agentic behavior, attach PDF, Word, CSV, JSON, Markdown, or text locally, and create a refined prompt. Text-layer PDFs and DOCX paragraphs are extracted locally; scanned PDFs are rejected.
- **Source-cited visual review:** Every local transformation receives a stable rule ID, an explanation, and a source locator from `shared/framework-rules.json`.
- **Pre-flight linter:** Shows context estimates, output reserves, illustrative cost, JSON-tier warnings, and Agentic safety boundaries.
- **Local-first version history:** The SPA uses IndexedDB with a localStorage fallback; Android uses SharedPreferences; Apple uses UserDefaults. All are shaped around `shared/prompt-project.schema.json`.
- **Regression evaluator:** Runs five deterministic fixtures derived from the supplied source compilation. This is a local rule-coverage simulation, not an LLM judge.
- **Agentic safety checks:** The SPA includes bounded prompt-injection, runaway-loop, and final-constraint checks without executing real tools.
- **Evidence library:** Displays the source records and framework rules used by the local engine.
- **Typed handoff exports:** The SPA can export JSON, Python, TypeScript, Go, Java, and cURL templates. Generated code leaves provider credentials as placeholders.

## Repository map

```text
.
├── index.html                         # Vite entry point for the SPA
├── src/                               # TypeScript SPA and local deterministic engine
│   ├── main.ts                        # Accessible multi-view UI and event wiring
│   ├── engine.ts                      # Refinement, linting, evaluation, stress checks
│   ├── domain.ts                      # Cross-platform TypeScript contract
│   ├── store.ts                       # IndexedDB/localStorage persistence
│   ├── ai/                            # Provider contract and Gemini relay client
│   ├── exporters.ts                   # Safe provider-neutral handoff templates
│   └── styles.css                     # Responsive visual system
├── shared/
│   ├── framework-rules.json           # Source records and stable rule IDs
│   ├── test-cases.json                # Five regression fixtures
│   └── prompt-project.schema.json     # Portable project schema
├── android/                           # Kotlin + Jetpack Compose client draft
├── apple/                             # SwiftUI iOS/macOS client draft
├── relay/                             # Private Gemini Cloudflare Worker + deployment config
├── docs/                              # Gemini setup guide and strategic approval memo
└── tests/                             # Node contract tests
```

## Run the SPA locally

Use Node.js 22 or newer (also required by the optional Worker tooling).

```bash
npm install
npm test
npm run dev
```

Open the URL printed by Vite. The dev server binds to `0.0.0.0` so a hosted preview can load it. To create a production bundle:

```bash
npm run build
npm run preview
```

The build runs TypeScript checking first. `dist/` is generated output and is ignored by Git.

## Deploy to GitHub Pages

GitHub Pages must serve Vite's compiled output; it cannot run the TypeScript entry point directly. The workflow in `.github/workflows/pages.yml` installs dependencies, runs the contract tests, builds `dist/`, and deploys that artifact when `main` is updated. On pull requests it runs the same checks without deploying. The workflow reads the Pages base path so project-site assets resolve correctly under `/PRE1.5.1/` while local development continues to use `/`.

For the first deployment, open **Settings → Pages** and set **Build and deployment → Source** to **GitHub Actions**. Do not publish the repository root as a legacy Pages site: the root `index.html` is a Vite development entry point and references TypeScript source that GitHub Pages does not compile. While the source is a branch ("legacy"), GitHub's branch publisher serves that raw root and races the workflow's own deployment, so the live site is an empty `#app` on a default white background — a blank white screen. The workflow now attempts to switch the source to GitHub Actions itself and warns in the run log if the token is refused, but the Settings change above is the guaranteed one-time fix. If the bundle itself ever fails to load, the page now shows a dark "did not load" explanation (served from inline boot markup in `index.html`) instead of a blank page. Production builds also default to relative asset paths, so `dist/` works under the `/PRE1.5.1/` project subpath even without the workflow's base-path variable.

## Connect Gemini from GitHub Pages

GitHub Pages is static hosting and cannot keep an API key private. The optional Worker relay provides the server-side boundary while the frontend stays on Pages. For a no-terminal setup, add the four private repository secrets listed in the guide and run **Actions → Deploy private Gemini relay** on `main`. Integrations without the Actions: write permission can start the same run with a `deploy-gemini-relay` repository dispatch event instead. That workflow deploys the Worker, installs its secrets, and verifies Gemini model access without generating text. Alternatively, deploy locally with `npm run relay:deploy` and configure the Worker secrets yourself. Enter only the Worker URL and relay password in **API connection**. See [the setup guide](docs/gemini-setup.md) for the complete one-time steps, origin/model settings, billing limits, and troubleshooting. Never add a provider key to a `VITE_` variable or build artifact.

This is a single-owner connection, not a public multi-tenant service. Only prompt rewriting is live; evaluation and tools remain local simulations.

## Run the Android client

Install Android Studio Ladybug or newer with Android SDK 35, then open the `android/` folder. Gradle will download the Android and Compose dependencies; choose an emulator and press **Run**. See `android/README.md` for the production boundary and beginner steps.

## Run the Apple client

Install Xcode 15.4 or newer on macOS and open `apple/Package.swift`. The source is a SwiftUI shared client for iOS 17 and macOS 14. The provided sandbox does not contain Xcode, so an `.xcodeproj` cannot be compiled here; see `apple/README.md` for adding the shared files to an iOS App target.

## Important safety and architecture notes

1. **No browser API keys:** Never add an API key to `src/`, `index.html`, Android resources, or Swift source. The included private Gemini relay requires authentication, an exact origin, bounded requests, and a rate-limit binding. Public multi-user service still requires accounts and tenant policy.
2. **Local mode is labeled:** A local refinement is a deterministic transformation based on the approved registry. It is not proof that a target model agrees with the rule.
3. **Evidence has dates and confidence:** Provider behavior and pricing change. Update the registry only after verification and preserve the registry version on each variant.
4. **Attachments are untrusted:** The SPA extracts text from PDF and DOCX locally and rejects scanned PDFs without a text layer. OCR, cloud indexing, and production prompt-injection scanning require separate reviewed adapters.
5. **Agentic tools are not enabled:** The current clients draft authority and stop conditions and run bounded simulations. They do not execute shell commands, browse, spend money, or mutate external repositories.
6. **Generated SDK snippets are templates:** They intentionally contain provider placeholders and should be reviewed by an engineer before deployment.

## Approval boundary for the next coding phase

The strategic memo in `docs/strategic-summary-memo-v1.5.1.md` identified eleven approved roadmap items and nine release waves because five improvements plus six AI features equals eleven items. The current code implements the deterministic trust layer and local simulation surfaces first. Optional single-owner Gemini prompt synthesizing now has an explicit server-side relay and opt-in data-sharing boundary; its results require human review. Cross-provider evaluation, telemetry-based drift diagnosis, enterprise accounts, public multi-user AI access, and real Agentic tools still require approval of provider contracts, privacy rules, cost controls, and execution policy.
