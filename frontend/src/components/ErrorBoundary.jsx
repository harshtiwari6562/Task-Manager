import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('Uncaught error inside React tree:', error, errorInfo);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#F5F3EE',
            fontFamily: 'Inter, sans-serif',
            padding: 24,
            boxSizing: 'border-box',
          }}
        >
          <div
            style={{
              maxWidth: 480,
              width: '100%',
              background: '#FFFFFF',
              borderRadius: 20,
              border: '1px solid #E4E1D6',
              padding: 32,
              textAlign: 'center',
              boxShadow: '0 8px 24px rgba(0,0,0,0.06)',
            }}
          >
            <div style={{ fontSize: 44, marginBottom: 12 }}>⚠️</div>
            <h2
              style={{
                fontFamily: 'Fraunces, serif',
                fontSize: 22,
                color: '#123936',
                margin: '0 0 8px 0',
              }}
            >
              Something went wrong
            </h2>
            <p style={{ color: '#6E7570', fontSize: 13, lineHeight: 1.5, marginBottom: 24 }}>
              The application encountered an unexpected error. Your saved data is safely stored in the database.
            </p>
            <button
              onClick={this.handleReload}
              style={{
                padding: '12px 28px',
                borderRadius: 999,
                background: '#C79A3E',
                color: '#123936',
                fontWeight: 600,
                border: 'none',
                cursor: 'pointer',
                fontSize: 14,
              }}
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
