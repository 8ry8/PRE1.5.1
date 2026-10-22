import { FRAMEWORK_VERSION, makeId, nowIso, type PromptProject, type PromptVariant } from './domain';

const DB_NAME = 'pre-v1-5-1-workspace';
const STORE_NAME = 'projects';
const FALLBACK_KEY = 'pre-v1-5-1-project';
// Storage must never be able to hang or crash first paint: IndexedDB can be
// blocked by another tab holding an older version, and localStorage can
// throw a SecurityError in sandboxed frames. Every read below is guarded,
// timed, and shape-validated so boot always reaches a rendered UI.
const DB_OPEN_TIMEOUT_MS = 2_000;

function newProject(): PromptProject {
  const timestamp = nowIso();
  return {
    id: makeId('project'),
    name: 'Untitled prompt project',
    createdAt: timestamp,
    updatedAt: timestamp,
    frameworkVersion: FRAMEWORK_VERSION,
    variants: [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function isVariant(value: unknown): value is PromptVariant {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.rawGoal === 'string' &&
    typeof value.refinedPrompt === 'string' &&
    typeof value.createdAt === 'string' &&
    typeof value.targetModel === 'string' &&
    (value.modelClass === 'standard' || value.modelClass === 'reasoning' || value.modelClass === 'agentic') &&
    (value.outputTier === 'tier1' || value.outputTier === 'tier2' || value.outputTier === 'tier3') &&
    Array.isArray(value.contextBlocks) &&
    Array.isArray(value.citations) &&
    Array.isArray(value.changes) &&
    Array.isArray(value.diagnostics) &&
    (value.generation === undefined || (isRecord(value.generation) &&
      value.generation.mode === 'live-provider' &&
      typeof value.generation.provider === 'string' && typeof value.generation.model === 'string'))
  );
}

/**
 * Validate an untrusted persisted record before the UI touches it. Anything
 * stored by an older build, a hand-edited backup, or a corrupted write is
 * either repaired with defaults or rejected outright — a malformed
 * `variants` field must never throw before first render (blank screen).
 */
export function normalizeProject(value: unknown): PromptProject | null {
  if (!isRecord(value) || !Array.isArray(value.variants)) return null;
  const timestamp = nowIso();
  return {
    id: stringOr(value.id, makeId('project')),
    name: stringOr(value.name, 'Untitled prompt project'),
    createdAt: stringOr(value.createdAt, timestamp),
    updatedAt: stringOr(value.updatedAt, timestamp),
    frameworkVersion: stringOr(value.frameworkVersion, FRAMEWORK_VERSION),
    // Drop individually broken variants instead of discarding the project.
    variants: value.variants.filter(isVariant),
  };
}

export class WorkspaceStore {
  private project: PromptProject = newProject();

  private async openDb(): Promise<IDBDatabase | null> {
    if (typeof indexedDB === 'undefined') return null;
    return new Promise((resolve) => {
      let settled = false;
      const done = (database: IDBDatabase | null) => {
        if (settled) return;
        settled = true;
        resolve(database);
      };
      // A version-change transaction held by another tab fires onblocked
      // and would otherwise leave this promise (and the whole app) pending
      // forever on an empty #app. Fall back to localStorage instead.
      const timer = setTimeout(() => done(null), DB_OPEN_TIMEOUT_MS);
      const finish = (database: IDBDatabase | null) => {
        clearTimeout(timer);
        done(database);
      };
      try {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => {
          // The object store keeps one portable project record. A later team-sync
          // release can add accounts without changing the project JSON contract.
          if (!request.result.objectStoreNames.contains(STORE_NAME)) {
            request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
          }
        };
        request.onsuccess = () => finish(request.result);
        request.onerror = () => finish(null);
        request.onblocked = () => finish(null);
      } catch {
        finish(null);
      }
    });
  }

  async load(): Promise<PromptProject> {
    const database = await this.openDb();
    if (database) {
      const result = await new Promise<PromptProject | null>((resolve) => {
        try {
          const transaction = database.transaction(STORE_NAME, 'readonly');
          const request = transaction.objectStore(STORE_NAME).getAll();
          request.onsuccess = () => resolve(normalizeProject(request.result[0]));
          request.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      });
      database.close();
      if (result) {
        this.project = result;
        return result;
      }
    }

    // localStorage is only a compatibility fallback; the UI labels the product
    // local-first, not IndexedDB-only, so older WebViews still retain work.
    // Access itself can throw (blocked cookies, sandboxed iframe), so it is
    // guarded exactly like the IndexedDB path above.
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(FALLBACK_KEY);
    } catch {
      raw = null;
    }
    if (raw) {
      try {
        const restored = normalizeProject(JSON.parse(raw));
        if (restored) {
          this.project = restored;
          return this.project;
        }
        localStorage.removeItem(FALLBACK_KEY);
      } catch {
        try {
          localStorage.removeItem(FALLBACK_KEY);
        } catch {
          // Removal is best-effort; a fresh in-memory project follows anyway.
        }
      }
    }
    this.project = newProject();
    return this.project;
  }

  async save(project: PromptProject): Promise<void> {
    this.project = { ...project, updatedAt: nowIso() };
    const database = await this.openDb();
    if (database) {
      await new Promise<void>((resolve) => {
        try {
          const transaction = database.transaction(STORE_NAME, 'readwrite');
          transaction.objectStore(STORE_NAME).put(this.project);
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => resolve();
        } catch {
          resolve();
        }
      });
      database.close();
    }
    try {
      localStorage.setItem(FALLBACK_KEY, JSON.stringify(this.project));
    } catch {
      // Storage quotas are reported in the UI by the caller; a failed fallback
      // must not discard the in-memory project for the current session.
    }
  }

  current(): PromptProject {
    return this.project;
  }

  async saveVariant(variant: PromptVariant, name?: string): Promise<PromptProject> {
    const updated: PromptProject = {
      ...this.project,
      name: name?.trim() || this.project.name,
      variants: [...this.project.variants.filter((candidate) => candidate.id !== variant.id), variant],
      updatedAt: nowIso(),
    };
    await this.save(updated);
    return this.project;
  }

  async rename(name: string): Promise<PromptProject> {
    await this.save({ ...this.project, name: name.trim() || 'Untitled prompt project' });
    return this.project;
  }
}
