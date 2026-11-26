import type { OpenFileResult } from '../types/a3studio';
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
  };
}

function download(name: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
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
  };
}
