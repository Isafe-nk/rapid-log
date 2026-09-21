import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  signInWithCredential,
  getRedirectResult,
  signOut
} from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

const googleProvider = new GoogleAuthProvider();

// Always show the account chooser. Signing out clears the Firebase session but
// not Google's own cookie in the web view, so without this Google silently
// reuses the last account and there is no way to switch.
googleProvider.setCustomParameters({ prompt: 'select_account' });

// Detect if running inside a native app wrapper (Capacitor iOS or macOS WKWebView)
export const isNative = () => {
  return typeof (window as any)?.Capacitor !== 'undefined'
    || (window as any)?.__MACOS_NATIVE__ === true;
};

/// The Mac shell specifically, as opposed to any native wrapper. It is the only
/// one that signs in outside this web view.
const isMacNative = () => (window as any)?.__MACOS_NATIVE__ === true;

// The Mac app cannot sign in inside this web view: an embedded web view runs in
// the host app's context, so Google's passkey step never reaches the device and
// the user is stranded on "More ways to verify". The shell runs the flow in a
// system browser sheet instead and hands back an ID token, which is traded for
// a Firebase session here. See macos/RapidLog/GoogleAuth.swift.
let pendingNativeSignIn:
  | { resolve: (idToken: string) => void; reject: (error: Error) => void }
  | null = null;

if (typeof window !== 'undefined') {
  // Called by the shell — with a token, or with a reason it failed. Settling
  // and clearing in one step, so a late second call cannot resolve a promise
  // belonging to a later attempt.
  (window as any).__nativeGoogleSignInResult = (
    idToken: string | null,
    error: string | null
  ) => {
    const pending = pendingNativeSignIn;
    pendingNativeSignIn = null;
    if (!pending) return;
    if (idToken) pending.resolve(idToken);
    else pending.reject(new Error(error || 'Sign in was cancelled.'));
  };
}

const signInThroughMacShell = async () => {
  const bridge = (window as any)?.webkit?.messageHandlers?.googleSignIn;
  if (!bridge) {
    // An older Mac app against a newer web app. Falling back to the redirect
    // flow keeps sign-in possible there, passkeys aside.
    await signInWithRedirect(auth, googleProvider);
    return null;
  }

  // Abandon a previous attempt rather than leaving two promises racing for one
  // callback; the user pressing the button again means they gave up on the first.
  pendingNativeSignIn?.reject(new Error('Sign in was restarted.'));

  const idToken = await new Promise<string>((resolve, reject) => {
    pendingNativeSignIn = { resolve, reject };
    bridge.postMessage('start');
  });

  const result = await signInWithCredential(
    auth,
    GoogleAuthProvider.credential(idToken)
  );
  return result.user;
};

export const signInWithGoogle = async () => {
  try {
    if (isMacNative()) {
      return await signInThroughMacShell();
    }
    if (isNative()) {
      // In Capacitor WebView, popups are blocked — use redirect flow
      await signInWithRedirect(auth, googleProvider);
      // The result will be handled by getRedirectResult in the auth listener
      return null;
    } else {
      // On web, popup works fine
      const result = await signInWithPopup(auth, googleProvider);
      return result.user;
    }
  } catch (error) {
    console.error("Error signing in with Google:", error);
    throw error;
  }
};

// Handle redirect result (for native iOS auth flow).
// Errors are rethrown rather than swallowed: a silent failure here looks
// identical to "never signed in", which is impossible to diagnose from the UI.
export const handleRedirectResult = async () => {
  try {
    const result = await getRedirectResult(auth);
    return result?.user ?? null;
  } catch (error) {
    console.error("Error handling redirect result:", error);
    throw error;
  }
};

export const logout = () => signOut(auth);
