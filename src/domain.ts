import frameworkData from '../shared/framework-rules.json';
import testData from '../shared/test-cases.json';

// These types are deliberately small and portable. Android and Apple mirror this
// contract in Kotlin and Swift so the three clients can exchange project files.
export type ModelClass = 'standard' | 'reasoning' | 'agentic';
export type OutputTier = 'tier1' | 'tier2' | 'tier3';
export type DiagnosticSeverity = 'block' | 'warning' | 'info';

export interface SourceRecord {
  id: string;
  title: string;
  locator: string;
  evidenceType: string;
  verifiedAt: string;
  status: string;
}

export interface FrameworkRule {
  id: string;
  title: string;
  classes: ModelClass[];
  sourceIds: string[];
  locator: string;
  kind: string;
  claim: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface Citation {
  ruleId: string;
  sourceIds: string[];
  locator: string;
  status: 'verified' | 'provided-source' | 'unattributed';
  confidence: 'high' | 'medium' | 'low';
}

export interface ChangeRecord {
  id: string;
  label: 'added' | 'changed' | 'preserved' | 'removed';
  before: string;
  after: string;
  ruleId?: string;
  explanation: string;
}

export interface Diagnostic {
  id: string;
  severity: DiagnosticSeverity;
  title: string;
  message: string;
  ruleId?: string;
  fix?: string;
}

export interface ContextBlock {
  id: string;
  name: string;
  mimeType: string;
  classification: 'stable-instruction' | 'reference-data' | 'example' | 'untrusted-attachment';
  text: string;
  sha256: string;
  status: 'ready' | 'unsupported' | 'error';
}

export interface EvaluationResult {
  mode: 'local-simulation' | 'live-provider';
  createdAt: string;
  suiteVersion: string;
  passed: number;
  total: number;
  score: number;
  notes: string[];
  cases: Array<{
    id: string;
    title: string;
    pass: boolean;
    reason: string;
  }>;
}

export interface StressFinding {
  id: string;
  severity: 'high' | 'medium' | 'low';
  title: string;
  observed: string;
  mitigation: string;
  ruleId: string;
}

export interface PromptVariant {
  id: string;
  parentId: string | null;
  rawGoal: string;
  refinedPrompt: string;
  modelClass: ModelClass;
  targetModel: string;
  outputTier: OutputTier;
  createdAt: string;
  contextBlocks: ContextBlock[];
  citations: Citation[];
  changes: ChangeRecord[];
  diagnostics: Diagnostic[];
  evaluation: EvaluationResult | null;
  // Optional for backward compatibility: absence means deterministic local mode.
  // These are provider results only, never connection details or credentials.
  generation?: {
    mode: 'live-provider';
    provider: string;
    model: string;
    inputTokens?: number;
    outputTokens?: number;
    requestId?: string;
  };
}

export interface PromptProject {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  frameworkVersion: string;
  variants: PromptVariant[];
}

export interface RefinementResult {
  refinedPrompt: string;
  changes: ChangeRecord[];
  citations: Citation[];
  diagnostics: Diagnostic[];
  modelClass: ModelClass;
  targetModel: string;
  outputTier: OutputTier;
}

export interface ModelProfile {
  id: string;
  label: string;
  class: ModelClass;
  provider: string;
  description: string;
  supports: string[];
}

export const FRAMEWORK_VERSION = frameworkData.version;
export const FRAMEWORK_SOURCES = frameworkData.sources as SourceRecord[];
export const FRAMEWORK_RULES = frameworkData.rules as FrameworkRule[];
export const REGRESSION_CASES = testData.cases;

export const MODEL_PROFILES: ModelProfile[] = [
  {
    id: 'standard-fast',
    label: 'Standard / fast instruction model',
    class: 'standard',
    provider: 'Provider adapter required',
    description: 'Direct literal response; use concise instructions and examples for formatting.',
    supports: ['few-shot', 'strict formatting', 'low latency'],
  },
  {
    id: 'reasoning-balanced',
    label: 'Reasoning / balanced effort',
    class: 'reasoning',
    provider: 'Provider adapter required',
    description: 'Internal deliberation; omit manual chain-of-thought text and reserve output headroom.',
    supports: ['zero-shot', 'complex analysis', 'effort controls'],
  },
  {
    id: 'agentic-sandbox',
    label: 'Agentic / sandbox executor',
    class: 'agentic',
    provider: 'Provider adapter required',
    description: 'Multi-step execution; state authority, artifacts, and stop conditions explicitly.',
    supports: ['tools', 'multi-turn tasks', 'completion gates'],
  },
];

export const MODEL_CLASS_LABELS: Record<ModelClass, string> = {
  standard: 'Standard',
  reasoning: 'Reasoning',
  agentic: 'Agentic',
};

export function makeId(prefix: string): string {
  // crypto.randomUUID is supported in modern browsers; the fallback keeps the
  // local-first app usable in older WebViews and beginner test environments.
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
