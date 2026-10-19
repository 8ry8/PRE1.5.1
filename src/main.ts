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
import './styles.css';

type ViewName = 'workbench' | 'review' | 'linter' | 'history' | 'evaluation' | 'evidence';
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
  notice: 'Local-first workspace ready. No provider credentials are connected.',
  evaluation: null,
  stressFindings: [],
  driftFindings: [],
};

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
          <span>Local-first mode</span>
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
          </nav>
          <div class="sidebar-note">
            <strong>Trust boundary</strong>
            <p>AI calls are not connected in this build. Local refinements are deterministic and labeled as simulations.</p>
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
        <p class="page-description">Draft a goal, isolate context, select a behavioral class, and produce a prompt with a visible evidence trail. The local engine never claims a live provider call occurred.</p>
      </div>
      <div class="heading-actions">
        <button class="button button-quiet" data-action="new-project">New project</button>
        <button class="button button-secondary" data-action="save-variant" ${variant ? '' : 'disabled'}>Save snapshot</button>
      </div>
    </div>
    <div class="workbench-grid">
      <section class="panel input-panel">
        <div class="panel-heading"><div><span class="panel-kicker">01 / INPUT</span><h3>Task objective</h3></div><span class="pill pill-neutral">No credentials</span></div>
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
          <label class="field-label" for="model-select">Target profile
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
            <small>Files are read locally, hashed, and marked as untrusted data. Scanned PDFs without a text layer are rejected rather than silently misread.</small>
          </div>
          <label class="button button-secondary file-button" for="context-file">Choose file<input id="context-file" type="file" accept=".txt,.csv,.json,.md,.pdf,.docx,text/plain,text/csv,application/json,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" /></label>
        </div>
        ${contextList()}
        <button class="button button-primary refine-button" data-action="refine">${variant ? 'Create new refined branch' : 'Refine with local policy engine'} <span>↗</span></button>
        <p class="microcopy">Local mode applies the approved rule registry. Connect an approved server-side provider adapter later; never put provider keys in this browser.</p>
      </section>
      <section class="panel output-panel">
        <div class="panel-heading"><div><span class="panel-kicker">02 / OUTPUT</span><h3>Refined production prompt</h3></div><div class="output-actions"><button class="icon-button" data-action="copy" ${variant ? '' : 'disabled'}>Copy</button><button class="icon-button" data-action="export-json" ${variant ? '' : 'disabled'}>JSON</button><button class="icon-button" data-action="export-typescript" ${variant ? '' : 'disabled'}>TS</button><button class="icon-button" data-action="export-python" ${variant ? '' : 'disabled'}>Py</button><button class="icon-button" data-action="export-go" ${variant ? '' : 'disabled'}>Go</button><button class="icon-button" data-action="export-java" ${variant ? '' : 'disabled'}>Java</button><button class="icon-button" data-action="export-curl" ${variant ? '' : 'disabled'}>cURL</button></div></div>
        ${variant ? `<div class="output-meta"><span class="pill pill-class">${MODEL_CLASS_LABELS[variant.modelClass]}</span><span class="pill pill-neutral">${variant.outputTier}</span><span class="muted">${formatDate(variant.createdAt)}</span></div><pre class="prompt-output" aria-label="Refined prompt">${escapeHtml(variant.refinedPrompt)}</pre>` : emptyState('No refinement yet', 'Enter a goal and run the local policy engine. Its output will become a versioned snapshot with citations and diagnostics.')}
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
    ${subpageHeading('REVIEW / TRACEABILITY', 'Every change needs a reason.', 'This ledger is intentionally explicit. An “unattributed” change would be a review failure, not a success state.')}
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
  return `<article class="history-card ${isActive ? 'selected' : ''}"><div class="history-card-top"><div><span class="panel-kicker">${variant.parentId ? 'BRANCH' : 'ROOT'} · ${variant.outputTier}</span><h3>${escapeHtml(variant.rawGoal.slice(0, 90) || 'Untitled goal')}</h3></div><span class="pill pill-class">${MODEL_CLASS_LABELS[variant.modelClass]}</span></div><p>${escapeHtml(variant.refinedPrompt.slice(0, 180))}…</p><div class="history-footer"><small>${formatDate(variant.createdAt)} · ${variant.citations.length} citations · ${variant.diagnostics.length} diagnostics</small><div><button class="icon-button" data-action="load-variant" data-id="${variant.id}">Open</button><button class="icon-button" data-action="branch-variant" data-id="${variant.id}">Branch</button></div></div></article>`;
}

function evaluationView(): string {
  const variant = state.activeVariant;
  if (!variant) return pageEmpty('Evaluation & safety', 'Refine a prompt first so the local test suite has a version to run.');
  const evaluation = state.evaluation ?? variant.evaluation;
  return `
    ${subpageHeading('EVALUATION / SAFETY', 'Measure before you trust.', 'The local harness checks rule coverage against five supplied regression cases. It is not an LLM-as-a-judge run until a reviewed provider adapter is connected.')}
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

async function refine(): Promise<void> {
  const modelClass = selectedClass();
  const tier = selectedTier();
  const result = refinePrompt({
    rawGoal: state.rawGoal,
    contextBlocks: state.contextBlocks,
    modelClass,
    targetModel: state.targetModel,
    outputTier: tier,
  });
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
  state.activeVariant = variant;
  state.project = await store.saveVariant(variant);
  state.evaluation = null;
  state.stressFindings = [];
  state.driftFindings = [];
  state.notice = `Created ${variant.parentId ? 'a branch' : 'a root variant'} with ${variant.citations.length} cited rules. No provider call occurred.`;
  state.activeView = 'workbench';
  render();
}

async function handleClick(event: MouseEvent): Promise<void> {
  const target = event.target as HTMLElement;
  const button = target.closest<HTMLElement>('[data-action], [data-view]');
  if (!button) return;
  const view = button.dataset.view as ViewName | undefined;
  if (view) {
    state.activeView = view;
    render();
    return;
  }
  const action = button.dataset.action;
  if (!action) return;
  switch (action) {
    case 'refine': await refine(); break;
    case 'new-project':
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
  if (element.id === 'raw-goal') {
    state.rawGoal = element.value;
    if (state.classSelection === 'auto' || state.tierSelection === 'auto') render();
  }
}

async function handleChange(event: Event): Promise<void> {
  const element = event.target as HTMLInputElement | HTMLSelectElement;
  if (element.id === 'class-select') state.classSelection = element.value as ClassSelection;
  if (element.id === 'model-select') state.targetModel = element.value;
  if (element.id === 'tier-select') state.tierSelection = element.value as TierSelection;
  if (element.id === 'context-file' && element instanceof HTMLInputElement && element.files?.[0]) {
    const block = await contextBlockFromFile(element.files[0]);
    state.contextBlocks = [...state.contextBlocks, block];
    state.notice = block.status === 'ready' ? `${block.name} was read locally and marked untrusted.` : `${block.name} could not be extracted by the local parser.`;
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
