import React from 'react';

interface State { hasError: boolean; error: string; }

export default class ErrorBoundary extends React.Component<React.PropsWithChildren, State> {
  state: State = { hasError: false, error: '' };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error: error.message };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('Unhandled render error:', error, info);
  }

  handleReload = (): void => {
    window.electronAPI.invoke('app:reload').catch(() => {
      window.location.reload();
    });
  };

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div style={{ color: '#cdd6f4', padding: 32, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
          <h2 style={{ color: '#f38ba8' }}>Something went wrong</h2>
          {/* Show a user-friendly message, not the raw error which may contain internal paths */}
          <p style={{ color: '#585b70', maxWidth: 480, textAlign: 'center' }}>
            An unexpected error occurred. If this keeps happening, please restart the app.
          </p>
          {process.env.NODE_ENV === 'development' && (
            <pre style={{ color: '#45475a', fontSize: 11, maxWidth: 480 }}>{this.state.error}</pre>
          )}
          <button
            onClick={this.handleReload}
            style={{ background: '#cba6f7', color: '#1e1e2e', border: 'none', borderRadius: 4, padding: '8px 20px', cursor: 'pointer' }}
          >
            Reload app
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
