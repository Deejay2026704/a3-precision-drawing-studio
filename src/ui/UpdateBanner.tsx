import { useEffect, useState } from 'react';
import type { UpdateStatus } from '../types/a3studio';

/**
 * Non-modal update notice (bottom of the drawing area). It never interrupts drawing and
 * nothing is downloaded or installed unless the user presses the button.
 */
export function useUpdates(onMessage: (m: string) => void) {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const api = window.a3Studio?.updates;

  useEffect(() => {
    if (!api) return;
    return api.onStatus((s) => {
      setStatus(s);
      if (s.manual && s.state === 'not-available') onMessage(`You have the latest version (${s.current}).`);
      if (s.manual && s.state === 'unsupported') onMessage(s.message);
      if (s.manual && s.state === 'checking') onMessage('Checking for updates…');
    });
  }, [api, onMessage]);

  const check = async () => {
    if (!api) {
      onMessage('Updates are only available in the installed app.');
      return;
    }
    setDismissed(null);
    await api.check(true);
  };
  return { status, check, dismissed, setDismissed };
}

export function UpdateBanner({ status, dismissed, onDismiss }: { status: UpdateStatus | null; dismissed: string | null; onDismiss: (key: string) => void }) {
  const api = window.a3Studio?.updates;
  if (!api || !status) return null;
  const key = `${status.state}:${'version' in status ? status.version : ''}`;
  if (dismissed === key) return null;

  let text: string;
  let actions: { label: string; testId: string; run: () => void; primary?: boolean }[] = [];
  const later = { label: 'Later', testId: 'update-later', run: () => onDismiss(key) };
  switch (status.state) {
    case 'available':
      text = `Version ${status.version} is available (you have ${status.current}).`;
      actions =
        status.mode === 'install'
          ? [{ label: 'Download and install', testId: 'update-download', run: () => void api.download(), primary: true }, later]
          : [{ label: 'Open download page', testId: 'update-open-page', run: () => void api.openReleasePage(), primary: true }, later];
      if (status.mode === 'notify') text += ' Download the new version from the release page.';
      break;
    case 'downloading':
      text = `Downloading version ${status.version}… ${status.percent} %`;
      break;
    case 'downloaded':
      text = `Version ${status.version} is ready. It will be installed when you restart the app.`;
      actions = [{ label: 'Restart now', testId: 'update-restart', run: () => void api.install(), primary: true }, later];
      break;
    case 'error':
      if (!status.manual) return null; // background check at start-up stays silent
      text = `Update failed: ${status.message}`;
      actions = [{ label: 'Dismiss', testId: 'update-dismiss', run: () => onDismiss(key) }];
      break;
    default:
      return null;
  }
  return (
    <div className="update-banner" role="status" data-testid="update-banner" data-state={status.state}>
      <span data-testid="update-text">{text}</span>
      {actions.map((a) => (
        <button key={a.testId} className={a.primary ? 'primary' : ''} data-testid={a.testId} onClick={a.run}>
          {a.label}
        </button>
      ))}
    </div>
  );
}
