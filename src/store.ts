import { FRAMEWORK_VERSION, makeId, nowIso, type PromptProject, type PromptVariant } from './domain';

const DB_NAME = 'pre-v1-5-1-workspace';
const STORE_NAME = 'projects';
const FALLBACK_KEY = 'pre-v1-5-1-project';

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

export class WorkspaceStore {
  private project: PromptProject = newProject();

  private async openDb(): Promise<IDBDatabase | null> {
    if (typeof indexedDB === 'undefined') return null;
    return new Promise((resolve) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        // The object store keeps one portable project record. A later team-sync
        // release can add accounts without changing the project JSON contract.
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    });
  }

  async load(): Promise<PromptProject> {
    const database = await this.openDb();
    if (database) {
      const result = await new Promise<PromptProject | null>((resolve) => {
        const transaction = database.transaction(STORE_NAME, 'readonly');
        const request = transaction.objectStore(STORE_NAME).getAll();
        request.onsuccess = () => resolve((request.result[0] as PromptProject | undefined) ?? null);
        request.onerror = () => resolve(null);
      });
      database.close();
      if (result) {
        this.project = result;
        return result;
      }
    }

    // localStorage is only a compatibility fallback; the UI labels the product
    // local-first, not IndexedDB-only, so older WebViews still retain work.
    const raw = localStorage.getItem(FALLBACK_KEY);
    if (raw) {
      try {
        this.project = JSON.parse(raw) as PromptProject;
        return this.project;
      } catch {
        localStorage.removeItem(FALLBACK_KEY);
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
        const transaction = database.transaction(STORE_NAME, 'readwrite');
        transaction.objectStore(STORE_NAME).put(this.project);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => resolve();
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
