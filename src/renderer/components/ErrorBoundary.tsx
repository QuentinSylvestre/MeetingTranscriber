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
    window.electronAPI.invoke('app:reload').catch(() => window.location.reload());
  };

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div className="error-boundary">
          <div className="error-boundary-icon">⚠</div>
          <h2 style={{ color: 'var(--error)' }}>Something went wrong</h2>
          <p style={{ maxWidth: 400 }}>
            An unexpected error occurred. If this keeps happening, please restart the app.
          </p>
          {process.env.NODE_ENV === 'development' && (
            <pre style={{ fontSize: 11, color: 'var(--overlay0)', maxWidth: 480, wordBreak: 'break-all', textAlign: 'left', background: 'var(--crust)', padding: 12, borderRadius: 6 }}>
              {this.state.error}
            </pre>
          )}
          <button className="btn btn-primary" onClick={this.handleReload}>
            Reload app
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
