/** API exposed by electron/preload.ts through contextBridge. */
export interface OpenFileResult {
  path: string;
  content: string;
}

export interface A3StudioApi {
  readonly platform: string;
  openDrawing(): Promise<OpenFileResult | null>;
  saveDrawing(path: string, content: string): Promise<string>;
  saveDrawingAs(content: string, suggestedName: string): Promise<string | null>;
  setDirty(dirty: boolean): void;
  quit(): void;
}

declare global {
  interface Window {
    a3Studio?: A3StudioApi;
  }
}
