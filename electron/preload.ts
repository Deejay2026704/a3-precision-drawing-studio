import { contextBridge, ipcRenderer } from 'electron';

/** Narrow, typed API exposed to the renderer (see src/types/a3studio.d.ts). */
contextBridge.exposeInMainWorld('a3Studio', {
  platform: process.platform,
  openDrawing: () => ipcRenderer.invoke('file:open'),
  saveDrawing: (path: string, content: string) => ipcRenderer.invoke('file:save', path, content),
  saveDrawingAs: (content: string, suggestedName: string) => ipcRenderer.invoke('file:saveAs', content, suggestedName),
  setDirty: (dirty: boolean) => ipcRenderer.send('doc:dirty', dirty),
  quit: () => ipcRenderer.send('app:quit'),
});
