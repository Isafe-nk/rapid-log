import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  GoogleAuthProvider, 
  signInWithPopup, 
  signInWithRedirect,
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
const isNative = () => {
  return typeof (window as any)?.Capacitor !== 'undefined'
    || (window as any)?.__MACOS_NATIVE__ === true;
};

export const signInWithGoogle = async () => {
  try {
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
