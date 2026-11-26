import { contextBridge, ipcRenderer } from 'electron';

/** Narrow, typed API exposed to the renderer (see src/types/a3studio.d.ts). */
contextBridge.exposeInMainWorld('a3Studio', {
  platform: process.platform,
  openDrawing: () => ipcRenderer.invoke('file:open'),
  saveDrawing: (path: string, content: string) => ipcRenderer.invoke('file:save', path, content),
  saveDrawingAs: (content: string, suggestedName: string) => ipcRenderer.invoke('file:saveAs', content, suggestedName),
  exportPdf: (bytes: Uint8Array, suggestedName: string) => ipcRenderer.invoke('file:exportPdf', bytes, suggestedName),
  exportSvg: (content: string, suggestedName: string) => ipcRenderer.invoke('file:exportSvg', content, suggestedName),
  readPath: (filePath: string) => ipcRenderer.invoke('file:readPath', filePath),
  takePendingOpen: () => ipcRenderer.invoke('app:takePendingOpen'),
  onOpenFile: (cb: (filePath: string) => void) => {
    const h = (_e: unknown, p: string) => cb(p);
    ipcRenderer.on('app:openFile', h);
    return () => ipcRenderer.removeListener('app:openFile', h);
  },
  config: () => ipcRenderer.invoke('app:config'),
  autosave: {
    write: (content: string) => ipcRenderer.invoke('autosave:write', content),
    clear: () => ipcRenderer.invoke('autosave:clear'),
    orphans: () => ipcRenderer.invoke('autosave:orphans'),
    read: (id: string) => ipcRenderer.invoke('autosave:read', id),
    remove: (id: string) => ipcRenderer.invoke('autosave:remove', id),
  },
  updates: {
    check: (manual: boolean) => ipcRenderer.invoke('update:check', manual),
    status: () => ipcRenderer.invoke('update:status'),
    download: () => ipcRenderer.invoke('update:download'),
    install: () => ipcRenderer.invoke('update:install'),
    openReleasePage: () => ipcRenderer.invoke('update:openReleasePage'),
    onStatus: (cb: (s: unknown) => void) => {
      const h = (_e: unknown, s: unknown) => cb(s);
      ipcRenderer.on('update:status', h);
      return () => ipcRenderer.removeListener('update:status', h);
    },
  },
  setDirty: (dirty: boolean) => ipcRenderer.send('doc:dirty', dirty),
  quit: () => ipcRenderer.send('app:quit'),
});
