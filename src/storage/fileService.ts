import type { AutosaveApi, AutosaveEntry, OpenFileResult } from '../types/a3studio';
import { FILE_EXTENSION } from './documentStorage';

/**
 * Platform adapter for reading/writing drawing files.
 * Uses the Electron preload API when available, otherwise a browser fallback
 * (file picker + download) so the renderer can also run in a plain browser.
 */
export interface FileService {
  open(): Promise<OpenFileResult | null>;
  /** Save to an existing path (Electron only). */
  save(path: string, content: string): Promise<string>;
  saveAs(content: string, suggestedName: string): Promise<string | null>;
  exportSvg(content: string, suggestedName: string): Promise<string | null>;
  exportPdf(bytes: Uint8Array, suggestedName: string): Promise<string | null>;
  readonly canSaveInPlace: boolean;
}

export const baseName = (path: string): string => path.split(/[\\/]/).pop() ?? path;

function browserFileService(): FileService {
  return {
    canSaveInPlace: false,
    open: () =>
      new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = `.${FILE_EXTENSION},.json`;
        input.onchange = async () => {
          const f = input.files?.[0];
          resolve(f ? { path: f.name, content: await f.text() } : null);
        };
        input.click();
      }),
    save: async (path, content) => {
      download(path, content);
      return path;
    },
    saveAs: async (content, name) => {
      download(name, content);
      return name;
    },
    exportSvg: async (content, name) => {
      download(name, content, 'image/svg+xml');
      return name;
    },
    exportPdf: async (bytes, name) => {
      download(name, bytes, 'application/pdf');
      return name;
    },
  };
}

function download(name: string, content: string | Uint8Array, type = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([content as BlobPart], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = baseName(name);
  a.click();
  URL.revokeObjectURL(url);
}

export function getFileService(): FileService {
  const api = window.a3Studio;
  if (!api) return browserFileService();
  return {
    canSaveInPlace: true,
    open: () => api.openDrawing(),
    save: (path, content) => api.saveDrawing(path, content),
    saveAs: (content, name) => api.saveDrawingAs(content, name),
    exportSvg: (content, name) => api.exportSvg(content, name),
    exportPdf: (bytes, name) => api.exportPdf(bytes, name),
  };
}

// ---------------------------------------------------------------------------
// Autosave service (Electron: separate recovery folder in the app's data directory;
// browser fallback: localStorage). Never touches the user's project files.
// ---------------------------------------------------------------------------

function browserAutosave(): AutosaveApi {
  const PREFIX = 'a3-autosave:';
  const own = `${PREFIX}session-${Date.now()}`;
  return {
    write: async (content) => localStorage.setItem(own, content),
    clear: async () => localStorage.removeItem(own),
    orphans: async (): Promise<AutosaveEntry[]> =>
      Object.keys(localStorage)
        .filter((k) => k.startsWith(PREFIX) && k !== own)
        .map((k) => ({ id: k.slice(PREFIX.length), pid: 0, modifiedMs: 0, sizeBytes: localStorage.getItem(k)!.length })),
    read: async (id) => localStorage.getItem(PREFIX + id) ?? '',
    remove: async (id) => localStorage.removeItem(PREFIX + id),
  };
}

export const getAutosaveService = (): AutosaveApi => window.a3Studio?.autosave ?? browserAutosave();
