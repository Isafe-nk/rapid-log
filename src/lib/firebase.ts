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

// Handle redirect result (for native iOS auth flow)
export const handleRedirectResult = async () => {
  try {
    const result = await getRedirectResult(auth);
    if (result) {
      return result.user;
    }
    return null;
  } catch (error) {
    console.error("Error handling redirect result:", error);
    return null;
  }
};

export const logout = () => signOut(auth);
