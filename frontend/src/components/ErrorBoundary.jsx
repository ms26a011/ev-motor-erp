import React from 'react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    console.error('Frontend render error:', error);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="startup-error">
          <h1>EV Motor ERP could not load</h1>
          <p>{this.state.error.message || 'A frontend error stopped the page from rendering.'}</p>
          <small>Keep the backend and frontend windows open, then refresh this page.</small>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
