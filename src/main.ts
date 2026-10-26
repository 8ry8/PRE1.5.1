import {
  FRAMEWORK_RULES,
  FRAMEWORK_SOURCES,
  FRAMEWORK_VERSION,
  MODEL_CLASS_LABELS,
  MODEL_PROFILES,
  type ContextBlock,
  type Diagnostic,
  type ModelClass,
  type OutputTier,
  type PromptProject,
  type PromptVariant,
  makeId,
  nowIso,
} from './domain';
import {
  buildRequestPlan,
  contextBlockFromFile,
  diagnoseDrift,
  evaluateLocally,
  inferClassFromGoal,
  inferOutputTier,
  lintRequest,
  refinePrompt,
  stressTest,
} from './engine';
import {
  downloadText,
  exportCurl,
  exportGo,
  exportJava,
  exportJson,
  exportPython,
  exportTypeScript,
} from './exporters';
import { WorkspaceStore } from './store';
import { GeminiRelay, type RelayConnectionStatus } from './ai/gemini';
import geminiSetupGuide from '../docs/gemini-setup.md?raw';
import './styles.css';

type ViewName = 'workbench' | 'review' | 'linter' | 'history' | 'evaluation' | 'evidence' | 'connection';
type ClassSelection = ModelClass | 'auto';
type TierSelection = OutputTier | 'auto';

interface AppState {
  activeView: ViewName;
  project: PromptProject;
  activeVariant: PromptVariant | null;
  rawGoal: string;
  classSelection: ClassSelection;
  targetModel: string;
  tierSelection: TierSelection;
  contextBlocks: ContextBlock[];
  notice: string;
  evaluation: PromptVariant['evaluation'];
  stressFindings: ReturnType<typeof stressTest>;
  driftFindings: string[];
  relayUrl: string;
  connection: RelayConnectionStatus | null;
  connecting: boolean;
  refining: boolean;
  extractingContext: boolean;
  shareWithGemini: boolean;
}

const RELAY_URL_KEY = 'pre-gemini-relay-url';
// This adapter holds only the separate relay password, in memory for this page.
// It is never added to AppState, workspace storage, or exports.
let connectedRelay: GeminiRelay | null = null;

function savedRelayUrl(): string {
  try { return localStorage.getItem(RELAY_URL_KEY) ?? ''; } catch { return ''; }
}

const store = new WorkspaceStore();
const appRoot = document.querySelector<HTMLDivElement>('#app');
if (!appRoot) throw new Error('Application root is missing');
// The guard above narrows the nullable DOM lookup before event handlers close over it.
const root: HTMLDivElement = appRoot;

let state: AppState = {
  activeView: 'workbench',
  project: {
    id: makeId('project'),
    name: 'Untitled prompt project',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    frameworkVersion: 'framework-loading',
    variants: [],
  },
  activeVariant: null,
  rawGoal: '',
  classSelection: 'auto',
  targetModel: 'standard-fast',
  tierSelection: 'auto',
  contextBlocks: [],
  notice: 'Local mode is ready—no key needed. To enable live Gemini refinement, open API connection.',
  evaluation: null,
  stressFindings: [],
  driftFindings: [],
  relayUrl: savedRelayUrl(),
  connection: null,
  connecting: false,
  refining: false,
  extractingContext: false,
  shareWithGemini: false,
};

function busy(): boolean {
  return state.refining || state.connecting || state.extractingContext;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function severityClass(severity: Diagnostic['severity'] | 'high' | 'medium' | 'low'): string {
  return `severity-${severity}`;
}

function selectedClass(): ModelClass {
  return state.classSelection === 'auto' ? inferClassFromGoal(state.rawGoal) : state.classSelection;
}

function selectedTier(): OutputTier {
  return state.tierSelection === 'auto' ? inferOutputTier(state.rawGoal) : state.tierSelection;
}

function currentPlan() {
  if (!state.activeVariant) return null;
  return buildRequestPlan(
    {
      modelClass: state.activeVariant.modelClass,
      targetModel: state.activeVariant.targetModel,
      outputTier: state.activeVariant.outputTier,
    },
    state.activeVariant.refinedPrompt,
  );
}

function renderShell(): void {
  root.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <div class="brand-lockup">
          <div class="brand-mark" aria-hidden="true">↗</div>
          <div>
            <p class="eyebrow">SOURCE-CITED WORKBENCH</p>
            <h1>Prompt Refining Engine <span>v1.5.1</span></h1>
          </div>
        </div>
        <div class="topbar-status">
          <span class="status-dot"></span>
          <button id="connection-status" class="status-link" data-view="connection">Local mode · Connect Gemini</button>
          <span class="status-divider"></span>
          <span id="framework-version">Framework loading</span>
        </div>
      </header>
      <div class="workspace-layout">
        <aside class="sidebar" aria-label="Workspace navigation">
          <div class="project-card">
            <span class="eyebrow">ACTIVE PROJECT</span>
            <strong id="project-name">Untitled prompt project</strong>
            <small id="project-meta">No saved variants</small>
          </div>
          <nav class="nav-list">
            ${navButton('workbench', '01', 'Workbench', 'Refine a prompt')}
            ${navButton('review', '02', 'Review & citations', 'Inspect every change')}
            ${navButton('linter', '03', 'Linter & budget', 'Pre-flight checks')}
            ${navButton('history', '04', 'History', 'Branch and restore')}
            ${navButton('evaluation', '05', 'Eval & safety', 'Regression and drift')}
            ${navButton('evidence', '06', 'Evidence library', 'Rules and sources')}
            ${navButton('connection', '07', 'API connection', 'Set up Gemini')}
          </nav>
          <div class="sidebar-note">
            <strong>Trust boundary</strong>
            <p>Local mode needs no key. Optional Gemini refinement uses a private relay; the provider key stays on the server. Evaluation and tools remain local simulations.</p><button class="button button-quiet" data-view="connection">Connect Gemini →</button>
          </div>
        </aside>
        <main class="main-content">
          <div id="notice" class="notice" role="status"></div>
          <div id="content"></div>
        </main>
      </div>
    </div>
  `;
  root.addEventListener('click', handleClick);
  root.addEventListener('input', handleInput);
  root.addEventListener('change', handleChange);
  render();
}

function navButton(view: ViewName, number: string, label: string, hint: string): string {
  return `<button class="nav-button" data-view="${view}"><span class="nav-number">${number}</span><span><strong>${label}</strong><small>${hint}</small></span></button>`;
}

function render(): void {
  const frameworkVersion = document.querySelector('#framework-version');
  const projectName = document.querySelector('#project-name');
  const projectMeta = document.querySelector('#project-meta');
  const notice = document.querySelector('#notice');
  if (frameworkVersion) frameworkVersion.textContent = state.project.frameworkVersion;
  if (projectName) projectName.textContent = state.project.name;
  if (projectMeta) projectMeta.textContent = `${state.project.variants.length} saved variant${state.project.variants.length === 1 ? '' : 's'}`;
  if (notice) notice.textContent = state.notice;
  const connectionStatus = document.querySelector('#connection-status');
  if (connectionStatus) connectionStatus.textContent = state.connection ? 'Gemini connected · Local by default' : 'Local mode · Connect Gemini';

  document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((button) => {
    button.classList.toggle('active', button.dataset.view === state.activeView);
  });
  const content = document.querySelector<HTMLDivElement>('#content');
  if (!content) return;
  content.innerHTML = viewMarkup();
}

function viewMarkup(): string {
  switch (state.activeView) {
    case 'review': return reviewView();
    case 'linter': return linterView();
    case 'history': return historyView();
    case 'evaluation': return evaluationView();
    case 'evidence': return evidenceView();
    case 'connection': return connectionView();
    case 'workbench':
    default: return workbenchView();
  }
}

function workbenchView(): string {
  const variant = state.activeVariant;
  const modelClass = selectedClass();
  const tier = selectedTier();
  const plan = currentPlan();
  return `
    <div class="page-heading">
      <div>
        <p class="eyebrow">WORKBENCH / ${MODEL_CLASS_LABELS[modelClass].toUpperCase()} POLICY</p>
        <h2>Make every refinement reviewable.</h2>
        <p class="page-description">Draft a goal, isolate context, select a behavioral class, and produce a prompt with a visible evidence trail. Choose the local policy engine, or explicitly send a draft to Gemini through your private relay.</p>
      </div>
      <div class="heading-actions">
        <button class="button button-quiet" data-action="new-project" ${busy() ? 'disabled' : ''}>New project</button>
        <button class="button button-secondary" data-action="save-variant" ${variant && !busy() ? '' : 'disabled'}>Save snapshot</button>
      </div>
    </div>
    <div class="workbench-grid">
      <section class="panel input-panel">
        <div class="panel-heading"><div><span class="panel-kicker">01 / INPUT</span><h3>Task objective</h3></div><button class="icon-button" data-view="connection">${state.connection ? 'Gemini connected' : 'Connect Gemini →'}</button></div>
        <fieldset class="input-fields" ${busy() ? 'disabled' : ''}>
        <legend class="sr-only">Prompt input and refinement</legend>
        <label class="field-label" for="raw-goal">Raw goal or draft prompt</label>
        <textarea id="raw-goal" class="text-input large-input" placeholder="Example: Extract risks from this contract into a strict JSON object with source citations.">${escapeHtml(state.rawGoal)}</textarea>
        <div class="field-row">
          <label class="field-label" for="class-select">Behavioral class
            <select id="class-select" class="select-input">
              ${option('auto', 'Auto-detect', state.classSelection)}
              ${option('standard', 'Standard', state.classSelection)}
              ${option('reasoning', 'Reasoning', state.classSelection)}
              ${option('agentic', 'Agentic', state.classSelection)}
            </select>
          </label>
          <label class="field-label" for="model-select">Target prompt profile
            <select id="model-select" class="select-input">
              ${MODEL_PROFILES.map((profile) => option(profile.id, profile.label, state.targetModel)).join('')}
            </select>
          </label>
        </div>
        <label class="field-label" for="tier-select">Output reliability tier
          <select id="tier-select" class="select-input">
            ${option('auto', `Auto-detect (${tier})`, state.tierSelection)}
            ${option('tier1', 'Tier 1 / strict schema', state.tierSelection)}
            ${option('tier2', 'Tier 2 / JSON object', state.tierSelection)}
            ${option('tier3', 'Tier 3 / fenced parser', state.tierSelection)}
          </select>
        </label>
        <div class="context-dropzone">
          <div>
            <span class="panel-kicker">CONTEXT PIPELINE</span>
            <strong>Attach PDF, Word, CSV, JSON, or Markdown</strong>
            <small>Files are extracted locally and marked untrusted. Text leaves this browser only if you choose Gemini refinement. Scanned PDFs without a text layer are rejected.</small>
          </div>
          <label class="button button-secondary file-button" for="context-file">Choose file<input id="context-file" type="file" accept=".txt,.csv,.json,.md,.pdf,.docx,text/plain,text/csv,application/json,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" /></label>
        </div>
        ${contextList()}
        <button class="button button-primary refine-button" data-action="refine" ${busy() ? 'disabled' : ''}>${state.refining ? 'Refinement in progress…' : state.extractingContext ? 'Reading attachment locally…' : 'Refine with local policy engine'} <span>↗</span></button>
        <div class="gemini-action">
          ${state.connection ? `<label class="consent-label"><input id="gemini-consent" type="checkbox" ${state.shareWithGemini ? 'checked' : ''} /><span>Send this draft and extracted attachment text to my relay and Google Gemini. Provider charges may apply.</span></label><button class="button button-secondary refine-button" data-action="refine-gemini" ${!state.shareWithGemini || !state.rawGoal.trim() || busy() ? 'disabled' : ''}>Refine with Gemini ↗</button>` : `<button class="button button-secondary refine-button" data-view="connection">Set up Gemini / API connection →</button>`}
          <p class="microcopy">Local refinement never makes an AI call. Gemini edits the prompt; it does not execute its task or tools. The target profile above is not the Gemini model.</p>
        </div>
        </fieldset>
      </section>
      <section class="panel output-panel">
        <div class="panel-heading"><div><span class="panel-kicker">02 / OUTPUT</span><h3>Refined production prompt</h3></div><div class="output-actions"><button class="icon-button" data-action="copy" ${variant ? '' : 'disabled'}>Copy</button><button class="icon-button" data-action="export-json" ${variant ? '' : 'disabled'}>JSON</button><button class="icon-button" data-action="export-typescript" ${variant ? '' : 'disabled'}>TS</button><button class="icon-button" data-action="export-python" ${variant ? '' : 'disabled'}>Py</button><button class="icon-button" data-action="export-go" ${variant ? '' : 'disabled'}>Go</button><button class="icon-button" data-action="export-java" ${variant ? '' : 'disabled'}>Java</button><button class="icon-button" data-action="export-curl" ${variant ? '' : 'disabled'}>cURL</button></div></div>
        ${variant ? `<div class="output-meta"><span class="pill pill-class">${MODEL_CLASS_LABELS[variant.modelClass]}</span><span class="pill pill-neutral">${variant.outputTier}</span><span class="pill pill-neutral">${variant.generation ? `Live Gemini · ${escapeHtml(variant.generation.model)}` : 'Local policy'}</span><span class="muted">${formatDate(variant.createdAt)}</span></div><pre class="prompt-output" aria-label="Refined prompt">${escapeHtml(variant.refinedPrompt)}</pre>` : emptyState('No refinement yet', 'Enter a goal and run the local policy engine. Its output will become a versioned snapshot with citations and diagnostics.')}
        ${variant?.generation ? '<div class="annotation-box"><p>AI rewrite: review required. Citations describe the local draft, not independent verification of Gemini’s changes.</p></div>' : ''}
        ${variant ? `<div class="summary-grid"><div><span>Changes</span><strong>${variant.changes.length}</strong></div><div><span>Citations</span><strong>${variant.citations.length}</strong></div><div><span>Diagnostics</span><strong>${variant.diagnostics.length}</strong></div><div><span>Budget</span><strong>${plan ? `${plan.inputTokens} tok` : '—'}</strong></div></div>` : ''}
      </section>
    </div>
    <section class="panel next-panel"><div><span class="panel-kicker">NEXT REVIEW</span><h3>${variant ? 'Review the evidence before exporting.' : 'Start with a concrete outcome.'}</h3><p>${variant ? 'Open Review & citations for line-level changes, then run the linter and local regression suite before handoff.' : 'The engine works best when the first sentence states the goal, the output shape, and any hard constraint you already know.'}</p></div><div class="next-links"><button class="button button-quiet" data-view="review">Review changes →</button><button class="button button-quiet" data-view="linter">Run linter →</button></div></section>
  `;
}

function contextList(): string {
  if (state.contextBlocks.length === 0) return '<p class="empty-inline">No context attached. Keeping this empty is valid.</p>';
  return `<div class="context-list">${state.contextBlocks.map((block) => `<div class="context-item"><div><strong>${escapeHtml(block.name)}</strong><small>${escapeHtml(block.classification)} · ${block.status} · ${block.sha256 ? `${block.sha256.slice(0, 12)}…` : 'not hashed'}</small></div><button class="icon-button danger" data-action="remove-context" data-id="${block.id}">Remove</button></div>`).join('')}</div>`;
}

function reviewView(): string {
  const variant = state.activeVariant;
  if (!variant) return pageEmpty('Review & citations', 'Refine a prompt first so the workbench can show a line-level change ledger.');
  return `
    ${subpageHeading('REVIEW / TRACEABILITY', 'Every change needs a reason.', variant.generation ? 'Gemini’s rewrite is recorded as an unattributed change requiring human review. Rule citations describe the local draft only, not verification of the AI output.' : 'This ledger is intentionally explicit. An “unattributed” change would be a review failure, not a success state.')}
    <div class="review-layout">
      <section class="panel"><div class="panel-heading"><div><span class="panel-kicker">CHANGE LEDGER</span><h3>${variant.changes.length} recorded transformations</h3></div><span class="pill pill-class">${MODEL_CLASS_LABELS[variant.modelClass]}</span></div><div class="change-list">${variant.changes.map(changeMarkup).join('')}</div></section>
      <aside class="panel citation-panel"><div class="panel-heading"><div><span class="panel-kicker">CITATION MATRIX</span><h3>${variant.citations.length} rule references</h3></div></div>${variant.citations.map((citation) => citationMarkup(citation.ruleId, citation.locator, citation.confidence)).join('')}</aside>
    </div>
  `;
}

function changeMarkup(change: PromptVariant['changes'][number]): string {
  return `<article class="change-card"><div class="change-top"><span class="change-label ${change.label}">${change.label}</span><code>${escapeHtml(change.ruleId ?? 'unattributed')}</code></div><p>${escapeHtml(change.explanation)}</p><div class="diff-pair"><div><span>Before</span><pre>${escapeHtml(change.before)}</pre></div><div><span>After</span><pre>${escapeHtml(change.after)}</pre></div></div></article>`;
}

function citationMarkup(ruleId: string, locator: string, confidence: string): string {
  const frameworkRule = FRAMEWORK_RULES.find((candidate) => candidate.id === ruleId);
  if (!frameworkRule) return `<div class="citation-card"><code>${escapeHtml(ruleId)}</code><p>Unresolved rule. Review required.</p></div>`;
  const sources = frameworkRule.sourceIds.map((id) => FRAMEWORK_SOURCES.find((source) => source.id === id)?.title ?? id).join(' · ');
  return `<div class="citation-card"><div class="citation-top"><code>${escapeHtml(ruleId)}</code><span class="confidence ${confidence}">${confidence}</span></div><strong>${escapeHtml(frameworkRule.title)}</strong><p>${escapeHtml(frameworkRule.claim)}</p><small>${escapeHtml(locator)}</small><small class="source-line">${escapeHtml(sources)}</small></div>`;
}

function linterView(): string {
  const variant = state.activeVariant;
  if (!variant) return pageEmpty('Linter & budget', 'Refine a prompt first so the pre-flight engine has a concrete request to inspect.');
  const plan = currentPlan();
  if (!plan) return pageEmpty('Linter & budget', 'No request plan available.');
  const diagnostics = lintRequest(plan, variant.refinedPrompt);
  return `
    ${subpageHeading('LINTER / COST CONTROL', 'Block silent failures before dispatch.', 'These diagnostics are deterministic. Illustrative cost is not a provider quote and must be replaced by a dated provider registry before production.')}
    <div class="metrics-grid"><div class="metric-card"><span>Input estimate</span><strong>${plan.inputTokens.toLocaleString()}</strong><small>tokens</small></div><div class="metric-card"><span>Output reserve</span><strong>${plan.maxOutputTokens.toLocaleString()}</strong><small>tokens</small></div><div class="metric-card"><span>Context limit</span><strong>${plan.contextLimit.toLocaleString()}</strong><small>tokens</small></div><div class="metric-card"><span>Illustrative cost</span><strong>$${plan.estimatedCostUsd.toFixed(4)}</strong><small>not a provider quote</small></div></div>
    <section class="panel"><div class="panel-heading"><div><span class="panel-kicker">REQUEST PLAN</span><h3>${escapeHtml(plan.targetModel)}</h3></div><span class="pill pill-${diagnostics.some((diagnostic) => diagnostic.severity === 'block') ? 'danger' : 'success'}">${diagnostics.some((diagnostic) => diagnostic.severity === 'block') ? 'Blocked' : 'Reviewable'}</span></div><div class="plan-grid"><div><span>Behavioral class</span><strong>${MODEL_CLASS_LABELS[plan.modelClass]}</strong></div><div><span>Output tier</span><strong>${plan.outputTier}</strong></div><div><span>Temperature</span><strong>${plan.temperature ?? 'provider-controlled'}</strong></div><div><span>Reasoning effort</span><strong>${plan.reasoningEffort ?? 'not applicable'}</strong></div></div><div class="diagnostic-list">${diagnostics.map(diagnosticMarkup).join('')}</div></section>
  `;
}

function diagnosticMarkup(diagnostic: Diagnostic): string {
  return `<article class="diagnostic ${severityClass(diagnostic.severity)}"><div class="diagnostic-icon">${diagnostic.severity === 'block' ? '!' : diagnostic.severity === 'warning' ? '△' : 'i'}</div><div><div class="diagnostic-title"><strong>${escapeHtml(diagnostic.title)}</strong><span>${diagnostic.severity}</span></div><p>${escapeHtml(diagnostic.message)}</p>${diagnostic.fix ? `<small><strong>Fix:</strong> ${escapeHtml(diagnostic.fix)}</small>` : ''}${diagnostic.ruleId ? `<code>${escapeHtml(diagnostic.ruleId)}</code>` : ''}</div></article>`;
}

function historyView(): string {
  const variants = [...state.project.variants].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  return `
    ${subpageHeading('HISTORY / BRANCHES', 'Keep the prompt lifecycle reproducible.', 'A saved variant records its parent, model class, context blocks, citations, and diagnostics. Local history is stored in IndexedDB with a localStorage compatibility fallback.')}
    <section class="panel history-panel"><div class="panel-heading"><div><span class="panel-kicker">PROJECT</span><h3>${escapeHtml(state.project.name)}</h3></div><button class="button button-secondary" data-action="rename-project">Rename project</button></div>${variants.length === 0 ? emptyState('No saved variants', 'Run a refinement to create the first checkpoint.') : `<div class="history-list">${variants.map(historyCard).join('')}</div>`}</section>
  `;
}

function historyCard(variant: PromptVariant): string {
  const isActive = state.activeVariant?.id === variant.id;
  return `<article class="history-card ${isActive ? 'selected' : ''}"><div class="history-card-top"><div><span class="panel-kicker">${variant.parentId ? 'BRANCH' : 'ROOT'} · ${variant.outputTier}</span><h3>${escapeHtml(variant.rawGoal.slice(0, 90) || 'Untitled goal')}</h3></div><span class="pill pill-class">${MODEL_CLASS_LABELS[variant.modelClass]}</span></div><p>${escapeHtml(variant.refinedPrompt.slice(0, 180))}…</p><div class="history-footer"><small>${formatDate(variant.createdAt)} · ${variant.generation ? `Live Gemini / ${escapeHtml(variant.generation.model)}` : 'Local policy'} · ${variant.citations.length} draft citations · ${variant.diagnostics.length} diagnostics</small><div><button class="icon-button" data-action="load-variant" data-id="${variant.id}">Open</button><button class="icon-button" data-action="branch-variant" data-id="${variant.id}">Branch</button></div></div></article>`;
}

function evaluationView(): string {
  const variant = state.activeVariant;
  if (!variant) return pageEmpty('Evaluation & safety', 'Refine a prompt first so the local test suite has a version to run.');
  const evaluation = state.evaluation ?? variant.evaluation;
  return `
    ${subpageHeading('EVALUATION / SAFETY', 'Measure before you trust.', 'The local harness checks rule metadata against five supplied regression cases. These checks remain simulations even when Gemini refinement is connected; they do not validate the AI rewrite.')}
    <div class="action-strip"><button class="button button-primary" data-action="run-evaluation">Run local regression suite</button><button class="button button-secondary" data-action="run-stress">Run bounded stress test</button><button class="button button-secondary" data-action="run-drift" ${state.project.variants.length < 2 ? 'disabled' : ''}>Diagnose branch drift</button></div>
    ${evaluation ? evaluationMarkup(evaluation) : emptyState('No evaluation yet', 'Run the deterministic suite to compare this variant against the five framework fixtures.')}
    ${state.stressFindings.length ? `<section class="panel"><div class="panel-heading"><div><span class="panel-kicker">ADVERSARIAL CHECKS</span><h3>${state.stressFindings.length} bounded findings</h3></div><span class="pill pill-neutral">No live tools</span></div><div class="finding-list">${state.stressFindings.map(stressMarkup).join('')}</div></section>` : ''}
    ${state.driftFindings.length ? `<section class="panel"><div class="panel-heading"><div><span class="panel-kicker">DRIFT DIAGNOSIS</span><h3>Human review required</h3></div></div><ul class="plain-list">${state.driftFindings.map((finding) => `<li>${escapeHtml(finding)}</li>`).join('')}</ul></section>` : ''}
  `;
}

function evaluationMarkup(evaluation: NonNullable<PromptVariant['evaluation']>): string {
  return `<section class="panel"><div class="panel-heading"><div><span class="panel-kicker">REGRESSION RESULT</span><h3>${evaluation.passed}/${evaluation.total} cases passed</h3></div><span class="score-badge">${evaluation.score}%</span></div><div class="case-list">${evaluation.cases.map((item) => `<article class="case-row ${item.pass ? 'pass' : 'fail'}"><span>${item.pass ? '✓' : '×'}</span><div><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.reason)}</p></div></article>`).join('')}</div><div class="annotation-box">${evaluation.notes.map((note) => `<p>${escapeHtml(note)}</p>`).join('')}</div></section>`;
}

function stressMarkup(finding: ReturnType<typeof stressTest>[number]): string {
  return `<article class="finding ${severityClass(finding.severity)}"><div class="finding-header"><strong>${escapeHtml(finding.title)}</strong><span>${finding.severity}</span></div><p>${escapeHtml(finding.observed)}</p><small><strong>Mitigation:</strong> ${escapeHtml(finding.mitigation)}</small><code>${escapeHtml(finding.ruleId)}</code></article>`;
}

function evidenceView(): string {
  return `
    ${subpageHeading('EVIDENCE / REGISTRY', 'Make framework claims inspectable.', 'Sources are labeled as provided, observed, or unverified. The registry is data, not a promise that every external model behavior remains current.')}
    <section class="panel"><div class="panel-heading"><div><span class="panel-kicker">SOURCES</span><h3>${FRAMEWORK_SOURCES.length} source records</h3></div><span class="pill pill-neutral">${state.project.frameworkVersion}</span></div><div class="source-list">${FRAMEWORK_SOURCES.map((source) => `<article class="source-card"><div><span class="source-type">${escapeHtml(source.evidenceType)}</span><h3>${escapeHtml(source.title)}</h3><p>${escapeHtml(source.locator)}</p></div><span class="confidence medium">${escapeHtml(source.status)}</span></article>`).join('')}</div></section>
    <section class="panel"><div class="panel-heading"><div><span class="panel-kicker">RULES</span><h3>${FRAMEWORK_RULES.length} inspectable rules</h3></div></div><div class="rule-grid">${FRAMEWORK_RULES.map((frameworkRule) => `<article class="rule-card"><div class="rule-card-top"><code>${escapeHtml(frameworkRule.id)}</code><span class="confidence ${frameworkRule.confidence}">${frameworkRule.confidence}</span></div><h3>${escapeHtml(frameworkRule.title)}</h3><p>${escapeHtml(frameworkRule.claim)}</p><small>${escapeHtml(frameworkRule.locator)}</small></article>`).join('')}</div></section>
  `;
}

function connectionView(): string {
  return `
    ${subpageHeading('SETTINGS / GEMINI', 'Connect your Gemini API safely.', 'GitHub Pages hosts only the frontend. Your Gemini API key belongs in a separate Cloudflare Worker secret—not in this site, a GitHub file, or a VITE_ variable.')}
    <div class="connection-grid">
      <section class="panel setup-panel">
        <div class="panel-heading"><div><span class="panel-kicker">01 / ONE-TIME SERVER SETUP</span><h3>Where do I put my API key?</h3></div></div>
        <ol class="setup-steps">
          <li><strong>Deploy without a terminal.</strong><p>Add the four private repository secrets from the setup guide, then run <strong>GitHub Actions → Deploy private Gemini relay</strong> on <code>main</code>. The workflow deploys the Worker, configures its secrets, and checks Gemini access. The guide also includes a manual setup option.</p><p><a href="https://github.com/8ry8/PRE1.5.1/settings/secrets/actions" target="_blank" rel="noopener noreferrer">Open private repository secrets ↗</a> · <a href="https://github.com/8ry8/PRE1.5.1/actions/workflows/gemini-relay.yml" target="_blank" rel="noopener noreferrer">Open relay deployment workflow ↗</a></p></li>
          <li><strong>Your Gemini key stays in a Worker secret.</strong><p>The deployment workflow sets this for you. For manual setup in Cloudflare, open <strong>Workers &amp; Pages → pre-gemini-relay → Settings → Variables and Secrets</strong>. Add a <strong>Secret</strong> named <code>GEMINI_API_KEY</code> and paste your key there.</p></li>
          <li><strong>Protect the relay with a different password.</strong><p>The workflow also sets your chosen secret named <code>RELAY_ACCESS_TOKEN</code>: a random password of at least 32 characters. Do not reuse the Gemini key. Anyone with this password can spend your API quota.</p></li>
          <li><strong>Set the origin and model.</strong><p>Set <code>ALLOWED_ORIGIN</code> to this website’s origin: <code>${escapeHtml(window.location.origin)}</code> (no path or trailing slash). Set <code>GEMINI_MODEL</code> to a model available to your key. Then connect below.</p></li>
        </ol>
        <button class="button button-secondary" data-action="download-gemini-guide">Download step-by-step setup guide</button>
        <p class="microcopy">The Gemini key must not be added to GitHub Pages build settings. A build-time secret can still leak if included in the browser bundle. Mobile clients remain local-only.</p>
      </section>
      <section class="panel connection-panel">
        <div class="panel-heading"><div><span class="panel-kicker">02 / CONNECT THIS BROWSER</span><h3>Private Gemini relay</h3></div><span class="pill ${state.connection ? 'pill-success' : 'pill-neutral'}">${state.connection ? 'Connected' : 'Not connected'}</span></div>
        ${state.connection ? `<div class="annotation-box"><p>Connected to <strong>${escapeHtml(state.connection.model)}</strong> via <code>${escapeHtml(connectedRelay?.url ?? '')}</code>. Key and model access checked; generation still depends on quota and billing.</p></div>` : ''}
        <fieldset class="input-fields" ${busy() ? 'disabled' : ''}>
          <legend class="sr-only">Relay connection details</legend>
          <label class="field-label" for="relay-url">Worker URL<input id="relay-url" class="text-input" type="url" value="${escapeHtml(state.relayUrl)}" placeholder="https://pre-gemini-relay.your-account.workers.dev" autocomplete="url" spellcheck="false" /></label>
          <label class="field-label" for="relay-password">Relay access password — NOT your Gemini API key<input id="relay-password" class="text-input" type="password" placeholder="Your separate RELAY_ACCESS_TOKEN" autocomplete="off" maxlength="256" spellcheck="false" aria-describedby="password-help" /></label>
          <p id="password-help" class="microcopy">The password stays in page memory, not browser storage or project exports. Reloading or disconnecting clears it. Only the Worker URL is remembered. Use a relay you control.</p>
          <div class="action-strip"><button class="button button-primary" data-action="connect-gemini">${state.connecting ? 'Checking Gemini…' : 'Test & connect'}</button><button class="button button-secondary" data-action="disconnect-gemini" ${state.connection ? '' : 'disabled'}>Disconnect</button></div>
        </fieldset>
        <p class="microcopy">Testing checks model access without generating a prompt. After connecting, return to Workbench, approve sending the draft, and choose <strong>Refine with Gemini</strong>. Nothing is sent automatically.</p>
        <div class="annotation-box"><p>This relay is for private, single-owner use. It is not a public multi-user AI service. Keep the access password private and set Google-side quota and billing controls.</p></div>
      </section>
    </div>
  `;
}

function subpageHeading(kicker: string, title: string, description: string): string {
  return `<div class="page-heading"><div><p class="eyebrow">${escapeHtml(kicker)}</p><h2>${escapeHtml(title)}</h2><p class="page-description">${escapeHtml(description)}</p></div><div class="heading-actions"><button class="button button-secondary" data-view="workbench">Back to workbench</button></div></div>`;
}

function pageEmpty(title: string, description: string): string {
  return `${subpageHeading('WORKSPACE', title, description)}${emptyState('Nothing to review yet', 'Use the workbench to create a versioned refinement first.')}`;
}

function emptyState(title: string, description: string): string {
  return `<div class="empty-state"><div class="empty-icon">○</div><h3>${escapeHtml(title)}</h3><p>${escapeHtml(description)}</p></div>`;
}

function option(value: string, label: string, selected: string): string {
  return `<option value="${escapeHtml(value)}" ${value === selected ? 'selected' : ''}>${escapeHtml(label)}</option>`;
}

async function connectGemini(): Promise<void> {
  if (busy()) return;
  const password = document.querySelector<HTMLInputElement>('#relay-password')?.value ?? '';
  state.relayUrl = document.querySelector<HTMLInputElement>('#relay-url')?.value ?? state.relayUrl;
  state.connecting = true;
  connectedRelay = null;
  state.connection = null;
  state.shareWithGemini = false;
  state.notice = 'Checking your relay, Gemini key, and model access…';
  render(); // Remove the password field value before any network I/O.
  try {
    const adapter = new GeminiRelay(state.relayUrl, password);
    const status = await adapter.testConnection();
    connectedRelay = adapter;
    state.connection = status;
    state.relayUrl = adapter.url;
    try { localStorage.setItem(RELAY_URL_KEY, adapter.url); } catch { /* Optional URL preference only. */ }
    state.notice = `Gemini connected (${status.model}). Return to Workbench and choose Refine with Gemini. Local mode still works without a provider call.`;
  } catch (error) {
    state.notice = error instanceof Error ? error.message : 'Connection failed. Check the Worker setup.';
  } finally {
    state.connecting = false;
    render();
  }
}

async function refine(useGemini = false): Promise<void> {
  if (busy()) return;
  const adapter = connectedRelay;
  if (useGemini && (!adapter || !state.shareWithGemini)) {
    state.notice = 'Connect your private relay and approve sending this draft before using Gemini.';
    render();
    return;
  }
  if (!state.rawGoal.trim()) {
    state.notice = 'Enter a goal before refining. No provider request was made.';
    render();
    return;
  }
  const result = refinePrompt({
    rawGoal: state.rawGoal,
    contextBlocks: state.contextBlocks,
    modelClass: selectedClass(),
    targetModel: state.targetModel,
    outputTier: selectedTier(),
  });
  const preflight = [...result.diagnostics, ...lintRequest(buildRequestPlan(result, result.refinedPrompt), result.refinedPrompt)];
  if (useGemini && preflight.some((item) => item.severity === 'block')) {
    state.notice = 'The local pre-flight checks blocked this request. Reduce the input and review the linter before sending to Gemini.';
    render();
    return;
  }
  // Capture the complete draft before awaiting the provider. Pending requests
  // cannot be duplicated or mixed with edits, project changes, or history loads.
  const variant: PromptVariant = {
    id: makeId('variant'),
    parentId: state.activeVariant?.id ?? null,
    rawGoal: state.rawGoal.trim(),
    refinedPrompt: result.refinedPrompt,
    modelClass: result.modelClass,
    targetModel: result.targetModel,
    outputTier: result.outputTier,
    createdAt: nowIso(),
    contextBlocks: [...state.contextBlocks],
    citations: result.citations,
    changes: result.changes,
    diagnostics: result.diagnostics,
    evaluation: null,
  };
  state.refining = true;
  state.notice = useGemini ? 'Gemini is refining the draft. A brief provider hiccup is retried by the relay automatically.' : 'Applying the local policy engine…';
  render();
  try {
    if (useGemini && adapter) {
      const response = await adapter.refine({
        prompt: result.refinedPrompt,
        modelClass: result.modelClass,
        outputTier: result.outputTier,
        targetModel: result.targetModel,
        citations: result.citations.map((citation) => citation.ruleId),
        projectVariantId: variant.id,
      });
      variant.refinedPrompt = response.text;
      variant.generation = {
        mode: 'live-provider', provider: response.provider, model: response.model,
        inputTokens: response.inputTokens, outputTokens: response.outputTokens, requestId: response.requestId,
      };
      variant.changes = [...result.changes, {
        id: makeId('change'), label: 'changed', before: result.refinedPrompt, after: response.text,
        explanation: 'Gemini rewrote the local draft. This change is unattributed and requires human review; inherited citations do not verify the AI rewrite.',
      }];
      variant.diagnostics = [...result.diagnostics, ...lintRequest(buildRequestPlan(result, response.text), response.text), {
        id: makeId('diag'), severity: 'warning', title: 'AI rewrite needs review',
        message: 'Rule citations describe the local draft, not independent verification of Gemini’s text. Evaluation and safety checks remain local simulations.',
        fix: 'Review the AI change in Review & citations before exporting or using the prompt.',
      }];
    }
    state.project = await store.saveVariant(variant);
    state.activeVariant = variant;
    state.evaluation = null;
    state.stressFindings = [];
    state.driftFindings = [];
    state.notice = variant.generation
      ? `Gemini refinement saved (${variant.generation.model}). Review the unattributed AI change before use.`
      : `Created ${variant.parentId ? 'a branch' : 'a root variant'} with ${variant.citations.length} cited rules. No provider call occurred.`;
  } catch (error) {
    state.notice = `${error instanceof Error ? error.message : 'Refinement failed.'} Your previous output is unchanged.`;
  } finally {
    state.refining = false;
    if (useGemini) state.shareWithGemini = false;
    render();
  }
}

async function handleClick(event: MouseEvent): Promise<void> {
  const target = event.target as HTMLElement;
  const button = target.closest<HTMLElement>('[data-action], [data-view]');
  if (!button || (button instanceof HTMLButtonElement && button.disabled)) return;
  const view = button.dataset.view as ViewName | undefined;
  if (view) {
    state.activeView = view;
    render();
    return;
  }
  const action = button.dataset.action;
  if (!action || busy()) return;
  switch (action) {
    case 'refine': await refine(); break;
    case 'refine-gemini': await refine(true); break;
    case 'connect-gemini': await connectGemini(); break;
    case 'disconnect-gemini':
      connectedRelay = null;
      state.connection = null;
      state.shareWithGemini = false;
      state.notice = 'Disconnected. The relay password was cleared from page memory. Local mode is still available.';
      render();
      break;
    case 'download-gemini-guide': downloadText('gemini-setup.md', geminiSetupGuide, 'text/markdown'); break;
    case 'new-project':
      state.shareWithGemini = false;
      state.rawGoal = '';
      state.contextBlocks = [];
      state.activeVariant = null;
      state.evaluation = null;
      state.notice = 'New in-memory project started. Existing snapshots remain in History.';
      render();
      break;
    case 'save-variant':
      if (state.activeVariant) {
        state.project = await store.saveVariant(state.activeVariant);
        state.notice = 'Snapshot saved to the local workspace.';
        render();
      }
      break;
    case 'copy':
      if (state.activeVariant) {
        await navigator.clipboard?.writeText(state.activeVariant.refinedPrompt);
        state.notice = 'Refined prompt copied to clipboard.';
        render();
      }
      break;
    case 'export-json':
      if (state.activeVariant) downloadText('prompt-variant.json', exportJson(state.activeVariant), 'application/json');
      break;
    case 'remove-context':
      state.shareWithGemini = false;
      state.contextBlocks = state.contextBlocks.filter((block) => block.id !== button.dataset.id);
      state.notice = 'Context block removed from the pending refinement. Existing variants remain unchanged.';
      render();
      break;
    case 'load-variant':
      loadVariant(button.dataset.id, false);
      break;
    case 'branch-variant':
      loadVariant(button.dataset.id, true);
      break;
    case 'rename-project': {
      const name = window.prompt('Project name', state.project.name);
      if (name !== null) {
        state.project = await store.rename(name);
        state.notice = 'Project name saved locally.';
        render();
      }
      break;
    }
    case 'run-evaluation':
      if (state.activeVariant) {
        const evaluation = evaluateLocally(state.activeVariant);
        const updated = { ...state.activeVariant, evaluation };
        state.activeVariant = updated;
        state.evaluation = evaluation;
        state.project = await store.saveVariant(updated);
        state.notice = `Local regression complete: ${evaluation.passed}/${evaluation.total} cases passed.`;
        render();
      }
      break;
    case 'run-stress':
      if (state.activeVariant) {
        state.stressFindings = stressTest(state.activeVariant);
        state.notice = 'Bounded local stress test complete. No live tools were called.';
        render();
      }
      break;
    case 'run-drift': {
      const current = state.activeVariant;
      const previous = state.project.variants.find((variant) => variant.id !== current?.id);
      if (current && previous) {
        state.driftFindings = diagnoseDrift(previous, current);
        state.notice = 'Drift diagnosis is ready for human review.';
        render();
      }
      break;
    }
    case 'export-python': if (state.activeVariant) downloadText('prompt-variant.py', exportPython(state.activeVariant), 'text/x-python'); break;
    case 'export-typescript': if (state.activeVariant) downloadText('prompt-variant.ts', exportTypeScript(state.activeVariant), 'text/typescript'); break;
    case 'export-curl': if (state.activeVariant) downloadText('prompt-variant.curl.txt', exportCurl(state.activeVariant)); break;
    case 'export-go': if (state.activeVariant) downloadText('prompt-variant.go', exportGo(state.activeVariant), 'text/x-go'); break;
    case 'export-java': if (state.activeVariant) downloadText('PromptVariant.java', exportJava(state.activeVariant), 'text/x-java-source'); break;
    default: break;
  }
}

function loadVariant(id: string | undefined, branch: boolean): void {
  if (!id) return;
  const variant = state.project.variants.find((candidate) => candidate.id === id);
  if (!variant) return;
  state.shareWithGemini = false;
  state.activeVariant = variant;
  state.rawGoal = variant.rawGoal;
  state.classSelection = variant.modelClass;
  state.targetModel = variant.targetModel;
  state.tierSelection = variant.outputTier;
  state.contextBlocks = [...variant.contextBlocks];
  state.activeView = 'workbench';
  state.notice = branch ? `Loaded ${id} as the parent for a new branch.` : `Loaded ${id}. No data was changed.`;
  render();
}

async function handleInput(event: Event): Promise<void> {
  const element = event.target as HTMLInputElement | HTMLTextAreaElement;
  if (busy()) return;
  if (element.id === 'raw-goal') {
    state.shareWithGemini = false;
    state.rawGoal = element.value;
    // Updating auto-detection must not lose the textarea focus/caret on each key.
    const start = element.selectionStart;
    const end = element.selectionEnd;
    const wasFocused = document.activeElement === element;
    render();
    const textarea = document.querySelector<HTMLTextAreaElement>('#raw-goal');
    if (wasFocused && textarea) {
      textarea.focus();
      textarea.setSelectionRange(start, end);
    }
  }
  if (element.id === 'relay-url') state.relayUrl = element.value;
}

async function handleChange(event: Event): Promise<void> {
  const element = event.target as HTMLInputElement | HTMLSelectElement;
  // A blur/change on connection inputs must not re-render and erase the password.
  if (element.id === 'relay-url' || element.id === 'relay-password' || busy()) return;
  if (element.id === 'gemini-consent' && element instanceof HTMLInputElement) state.shareWithGemini = element.checked;
  if (['class-select', 'model-select', 'tier-select'].includes(element.id)) state.shareWithGemini = false;
  if (element.id === 'class-select') state.classSelection = element.value as ClassSelection;
  if (element.id === 'model-select') state.targetModel = element.value;
  if (element.id === 'tier-select') state.tierSelection = element.value as TierSelection;
  if (element.id === 'context-file' && element instanceof HTMLInputElement && element.files?.[0]) {
    const file = element.files[0];
    state.shareWithGemini = false;
    state.extractingContext = true;
    state.notice = `Reading ${file.name} locally. Wait for extraction before refining.`;
    render();
    try {
      const block = await contextBlockFromFile(file);
      state.contextBlocks = [...state.contextBlocks, block];
      state.notice = block.status === 'ready' ? `${block.name} was read locally and marked untrusted.` : `${block.name} could not be extracted by the local parser.`;
    } finally {
      state.extractingContext = false;
    }
  }
  render();
}

async function boot(): Promise<void> {
  // Render the shell FIRST, before any storage I/O. Boot used to await
  // IndexedDB/localStorage before touching #app, so a blocked, throwing,
  // or malformed store left visitors on an empty white page forever.
  // Now the UI always paints; the saved project is applied afterwards.
  renderShell();
  try {
    state.project = await store.load();
  } catch {
    state.notice = 'Saved workspace could not be read, so a fresh in-memory workspace was started. Browser storage may be blocked or corrupted.';
    render();
    return;
  }
  state.project.frameworkVersion = state.project.frameworkVersion || FRAMEWORK_VERSION;
  const latest = [...state.project.variants].sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  if (latest) {
    state.activeVariant = latest;
    state.rawGoal = latest.rawGoal;
    state.classSelection = latest.modelClass;
    state.targetModel = latest.targetModel;
    state.tierSelection = latest.outputTier;
    state.contextBlocks = [...latest.contextBlocks];
  }
  // render() only refreshes the already-mounted shell; renderShell() would
  // register the root event listeners a second time.
  render();
}

void boot();
