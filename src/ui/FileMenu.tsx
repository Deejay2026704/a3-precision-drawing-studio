import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';

export interface FileCommands {
  newDrawing(): void | Promise<void>;
  open(): void | Promise<void>;
  save(): void | Promise<void>;
  saveAs(): void | Promise<void>;
  exportSvg(): void | Promise<void>;
  exportPdf(): void | Promise<void>;
  exportPdfA4(): void | Promise<void>;
  toggleAutosave(): void;
  checkForUpdates(): void | Promise<void>;
  readonly autosaveLabel: string;
  exit(): void;
}

/** The File menu (Office-style "File" button at the left of the ribbon tabs). */
export function FileMenu({ commands }: { commands: FileCommands }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);

  const item = (label: string, shortcut: string, run: () => void | Promise<void>, testId: string) => (
    <button
      className="menu-item"
      data-testid={testId}
      onClick={() => {
        setOpen(false);
        void run();
      }}
    >
      <span>{label}</span>
      <span className="menu-shortcut">{shortcut}</span>
    </button>
  );

  return (
    <div className="file-menu" ref={ref}>
      <button className={`tab tab-file${open ? ' active' : ''}`} data-testid="file-menu-button" onClick={() => setOpen(!open)}>
        <Icon name="file" size={16} /> File
      </button>
      {open && (
        <div className="menu" role="menu" data-testid="file-menu">
          {item('New', 'Ctrl+N', commands.newDrawing, 'menu-new')}
          {item('Open…', 'Ctrl+O', commands.open, 'menu-open')}
          <div className="menu-sep" />
          {item('Save', 'Ctrl+S', commands.save, 'menu-save')}
          {item('Save As…', 'Ctrl+Shift+S', commands.saveAs, 'menu-save-as')}
          <div className="menu-sep" />
          {item('Export PDF (A3, true scale)…', 'Ctrl+P', commands.exportPdf, 'menu-export-pdf')}
          {item('Export PDF for an A4 / Letter printer…', '', commands.exportPdfA4, 'menu-export-pdf-a4')}
          {item('Export SVG…', '', commands.exportSvg, 'menu-export-svg')}
          <div className="menu-sep" />
          {item(commands.autosaveLabel, '', commands.toggleAutosave, 'menu-autosave')}
          <div className="menu-sep" />
          {item('Check for updates…', '', commands.checkForUpdates, 'menu-check-updates')}
          <div className="menu-sep" />
          {item('Exit', 'Alt+F4', commands.exit, 'menu-exit')}
        </div>
      )}
    </div>
  );
}
