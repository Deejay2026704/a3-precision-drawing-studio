/** API exposed by electron/preload.ts through contextBridge. */
export interface OpenFileResult {
  path: string;
  content: string;
}

export interface AutosaveEntry {
  id: string;
  pid: number;
  modifiedMs: number;
  sizeBytes: number;
}

export interface AutosaveApi {
  write(content: string): Promise<void>;
  clear(): Promise<void>;
  orphans(): Promise<AutosaveEntry[]>;
  read(id: string): Promise<string>;
  remove(id: string): Promise<void>;
}

export interface AppConfig {
  version: string;
  platform: string;
  /** Test override of the autosave interval. */
  autosaveIntervalMs: number | null;
}

export type UpdateMode = 'install' | 'notify' | 'unsupported';
/** Mirrors electron/updatePolicy.ts UpdateStatus (+ whether the user asked for the check). */
export type UpdateStatus = { manual?: boolean; mode: UpdateMode } & (
  | { state: 'idle' | 'checking' }
  | { state: 'unsupported'; message: string }
  | { state: 'not-available'; current: string }
  | { state: 'available'; current: string; version: string; releaseUrl: string }
  | { state: 'downloading'; version: string; percent: number }
  | { state: 'downloaded'; version: string }
  | { state: 'error'; message: string }
);

export interface UpdatesApi {
  check(manual: boolean): Promise<UpdateStatus>;
  status(): Promise<UpdateStatus>;
  download(): Promise<UpdateStatus>;
  install(): Promise<boolean>;
  openReleasePage(): Promise<void>;
  onStatus(cb: (s: UpdateStatus) => void): () => void;
}

export interface A3StudioApi {
  readonly platform: string;
  openDrawing(): Promise<OpenFileResult | null>;
  saveDrawing(path: string, content: string): Promise<string>;
  saveDrawingAs(content: string, suggestedName: string): Promise<string | null>;
  exportSvg(content: string, suggestedName: string): Promise<string | null>;
  exportPdf(bytes: Uint8Array, suggestedName: string): Promise<string | null>;
  readPath(filePath: string): Promise<OpenFileResult>;
  takePendingOpen(): Promise<string | null>;
  onOpenFile(cb: (filePath: string) => void): () => void;
  config(): Promise<AppConfig>;
  autosave: AutosaveApi;
  updates: UpdatesApi;
  setDirty(dirty: boolean): void;
  quit(): void;
}

declare global {
  interface Window {
    a3Studio?: A3StudioApi;
  }
}
