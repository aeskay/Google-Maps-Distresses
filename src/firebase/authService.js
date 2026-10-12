/**
 * authService.js
 * Firebase Authentication wrapper methods.
 */
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
} from 'firebase/auth';
import { auth, googleProvider, isFirebaseConfigured } from './config';

export async function signUpWithEmail(email, password) {
  if (!auth) throw new Error('Firebase Auth is not configured yet. Please configure it in Settings.');
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  return cred.user;
}

export async function signInWithEmail(email, password) {
  if (!auth) throw new Error('Firebase Auth is not configured yet. Please configure it in Settings.');
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

export async function signInWithGoogle() {
  if (!auth || !googleProvider) throw new Error('Firebase Auth is not configured yet. Please configure it in Settings.');
  const cred = await signInWithPopup(auth, googleProvider);
  return cred.user;
}

export async function signOutUser() {
  if (!auth) return;
  await signOut(auth);
}

export function onAuthChange(callback) {
  if (!auth) {
    callback(null);
    return () => {};
  }
  return onAuthStateChanged(auth, callback);
}

export async function resetPassword(email) {
  if (!auth) throw new Error('Firebase Auth is not configured yet.');
  await sendPasswordResetEmail(auth, email);
}

export function formatAuthError(error) {
  if (!error) return 'An unknown error occurred.';
  const code = error.code || '';
  switch (code) {
    case 'auth/invalid-email':
      return 'The email address is invalid.';
    case 'auth/user-disabled':
      return 'This user account has been disabled.';
    case 'auth/user-not-found':
      return 'No account found with this email. Switch to "Create Account" tab to register!';
    case 'auth/wrong-password':
      return 'Incorrect password. Please try again.';
    case 'auth/invalid-credential':
      return 'Invalid credentials or user does not exist. Click "Create Account" tab if new!';
    case 'auth/email-already-in-use':
      return 'An account with this email address already exists.';
    case 'auth/weak-password':
      return 'Password should be at least 6 characters.';
    case 'auth/popup-closed-by-user':
      return 'Google sign-in popup was closed before completing.';
    case 'auth/network-request-failed':
      return 'Network error. Please check your internet connection.';
    default:
      return error.message || 'Authentication failed.';
  }
}
