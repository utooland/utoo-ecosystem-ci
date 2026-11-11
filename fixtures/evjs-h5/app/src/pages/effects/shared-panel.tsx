import { generateCookie } from '@evjs/ev/server-context';
import './shared-panel.css';

export function SharedPanel({ name }: { name: string }) {
  const cookie = generateCookie('ecosystem', name);
  return (
    <main className="ssr-panel">
      <h1>{name} SSR page</h1>
      <p data-testid="server-result">{`${name}: shared server content`}</p>
      <p data-testid="render-origin">{typeof window === 'undefined' ? 'server' : 'browser'}</p>
      <p data-testid="server-cookie">{cookie}</p>
    </main>
  );
}
