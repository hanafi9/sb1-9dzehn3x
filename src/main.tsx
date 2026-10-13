import React, { StrictMode, Component, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// ─── Filet de sécurité : plus jamais de page blanche muette ──────────────────
// Toute erreur de rendu s'affiche à l'écran avec sa stack, au lieu de
// démonter silencieusement l'application entière.

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) { return { error }; }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          minHeight: '100vh', background: '#0a0a0f', color: '#e5e7eb',
          fontFamily: 'monospace', padding: '2rem',
        }}>
          <h1 style={{ color: '#f87171', fontSize: '1.2rem', marginBottom: '1rem' }}>
            💥 L'application a planté — voici l'erreur exacte :
          </h1>
          <pre style={{
            background: '#18181b', border: '1px solid #7f1d1d', borderRadius: 8,
            padding: '1rem', whiteSpace: 'pre-wrap', fontSize: '0.8rem',
            color: '#fca5a5', overflow: 'auto',
          }}>
            {this.state.error.message}
            {'\n\n'}
            {this.state.error.stack}
          </pre>
          <p style={{ marginTop: '1rem', fontSize: '0.8rem', color: '#9ca3af' }}>
            Copie ce message et transmets-le pour diagnostic. Recharge la page
            (Ctrl+Shift+R) pour réessayer.
          </p>
          <button
            onClick={() => { this.setState({ error: null }); }}
            style={{
              marginTop: '0.5rem', padding: '0.5rem 1rem', borderRadius: 8,
              background: '#ea580c', color: 'white', border: 'none', cursor: 'pointer',
            }}>
            Réessayer sans recharger
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);
