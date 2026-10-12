/**
 * AuthModal.jsx
 * Firebase Authentication Modal for Email/Password and Google popup sign-in.
 */
import React, { useState } from 'react';
import {
  signInWithEmail,
  signUpWithEmail,
  signInWithGoogle,
  resetPassword,
  formatAuthError,
} from '../../firebase/authService';

export default function AuthModal({ onClose, addToast }) {
  const [tab, setTab] = useState('signin'); // 'signin' | 'signup'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  async function handleEmailAuth(e) {
    e.preventDefault();
    setErrorMsg('');
    setLoading(true);

    try {
      if (tab === 'signup') {
        if (password !== confirmPassword) {
          setErrorMsg('Passwords do not match.');
          setLoading(false);
          return;
        }
        await signUpWithEmail(email, password);
        addToast('success', 'Account created', 'Welcome to Google Distress Locator!');
        onClose();
      } else {
        await signInWithEmail(email, password);
        addToast('success', 'Signed in', `Signed in as ${email}`);
        onClose();
      }
    } catch (err) {
      setErrorMsg(formatAuthError(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogleSignIn() {
    setErrorMsg('');
    setLoading(true);
    try {
      const user = await signInWithGoogle();
      addToast('success', 'Signed in with Google', `Welcome, ${user.displayName || user.email}!`);
      onClose();
    } catch (err) {
      setErrorMsg(formatAuthError(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleForgotPassword() {
    if (!email) {
      setErrorMsg('Please enter your email above first to reset password.');
      return;
    }
    try {
      await resetPassword(email);
      addToast('info', 'Password Reset Email Sent', `Check inbox for ${email}`);
    } catch (err) {
      setErrorMsg(formatAuthError(err));
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 420 }}>
        <div className="modal__header">
          <div className="modal__title">
            {tab === 'signin' ? 'Sign in to Cloud Account' : 'Create Cloud Account'}
          </div>
          <button className="btn btn--ghost btn--icon" onClick={onClose}>✕</button>
        </div>

        <div className="modal__body">
          {/* Tab switcher */}
          <div className="segmented-group" style={{ width: '100%', marginBottom: 18 }}>
            <button
              type="button"
              className={`segmented-btn ${tab === 'signin' ? 'segmented-btn--active' : ''}`}
              style={{ flex: 1 }}
              onClick={() => { setTab('signin'); setErrorMsg(''); }}
            >
              Sign In
            </button>
            <button
              type="button"
              className={`segmented-btn ${tab === 'signup' ? 'segmented-btn--active' : ''}`}
              style={{ flex: 1 }}
              onClick={() => { setTab('signup'); setErrorMsg(''); }}
            >
              Create Account
            </button>
          </div>

          {errorMsg && (
            <div style={{ padding: '10px 14px', background: '#fee2e2', border: '1px solid #fecaca', color: '#dc2626', borderRadius: 'var(--radius-md)', marginBottom: 14, fontSize: 12, fontWeight: 500 }}>
              {errorMsg}
            </div>
          )}

          <form onSubmit={handleEmailAuth}>
            <div className="form-group">
              <label className="form-label">Email Address</label>
              <input
                type="email"
                className="form-input"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="name@example.com"
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">Password</label>
              <input
                type="password"
                className="form-input"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
              />
            </div>

            {tab === 'signup' && (
              <div className="form-group">
                <label className="form-label">Confirm Password</label>
                <input
                  type="password"
                  className="form-input"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                />
              </div>
            )}

            <button
              type="submit"
              className="btn btn--primary"
              style={{ width: '100%', justifyContent: 'center', marginTop: 6 }}
              disabled={loading}
            >
              {loading ? <span className="spinner" /> : (tab === 'signin' ? 'Sign In' : 'Register Account')}
            </button>
          </form>

          {tab === 'signin' && (
            <div style={{ textAlign: 'center', marginTop: 10 }}>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                style={{ fontSize: 12, color: 'var(--text-muted)' }}
                onClick={handleForgotPassword}
              >
                Forgot your password?
              </button>
            </div>
          )}

          <div className="divider" style={{ margin: '16px 0' }} />

          <button
            type="button"
            className="btn btn--secondary"
            style={{ width: '100%', justifyContent: 'center', gap: 8 }}
            onClick={handleGoogleSignIn}
            disabled={loading}
          >
            <span>🌐</span> Sign in with Google
          </button>
        </div>
      </div>
    </div>
  );
}
