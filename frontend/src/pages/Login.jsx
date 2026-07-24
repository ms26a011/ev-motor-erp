import React, { useState } from 'react';
import { LockKeyhole, LogIn } from 'lucide-react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import Message from '../components/Message.jsx';

function Login() {
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!auth.loading && auth.user) {
    return <Navigate to="/" replace />;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      await auth.login(username.trim(), password);
      navigate(location.state?.from?.pathname || '/', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-panel" aria-label="ERP login">
        <div className="login-brand">
          <div className="brand-mark">EV</div>
          <div>
            <h1>SBV EV Motor ERP</h1>
            <p>Secure employee access</p>
          </div>
        </div>
        <form className="login-form" onSubmit={handleSubmit}>
          <div className="login-heading">
            <LockKeyhole size={22} />
            <h2>Login</h2>
          </div>
          <Message type="error">{error}</Message>
          <label className="field upgraded-field" htmlFor="username">
            <span>Username / Employee Code</span>
            <input
              autoComplete="username"
              id="username"
              onChange={(event) => setUsername(event.target.value)}
              required
              type="text"
              value={username}
            />
          </label>
          <label className="field upgraded-field" htmlFor="password">
            <span>Password</span>
            <input
              autoComplete="current-password"
              id="password"
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </label>
          <button className="btn primary login-button" disabled={submitting} type="submit">
            <LogIn size={17} />
            {submitting ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </section>
    </main>
  );
}

export default Login;
