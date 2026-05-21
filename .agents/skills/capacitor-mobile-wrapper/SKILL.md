# Skill: Capacitor Mobile Wrapper Integration

This skill outlines guidelines for packaging the web application inside Capacitor for iOS and macOS compilation.

---

## 📱 Hybrid Wrapper Setup

* **Platforms:** iOS (Native App Shell) and macOS (WKWebView native container wrapper).
* **Wrapper Framework:** Capacitor v8 (`@capacitor/core`, `@capacitor/ios`, `@capacitor/cli`).

---

## 🔐 Google Auth Redirect Handling

Mobile and desktop webviews (specifically WKWebView in macOS native and Capacitor shells) do not support the standard pop-up OAuth flows properly. Always implement the redirect flow fallback:

1. **Authentication Flow:** Use Google Redirect authentication (`signInWithRedirect`).
2. **Redirection Hook:** Listen for authentication redirects during startup by calling `handleRedirectResult()` inside `src/lib/firebase.ts` if a Capacitor or macOS environment is detected:
   ```tsx
   if (typeof (window as any).Capacitor !== 'undefined' || (window as any).__MACOS_NATIVE__) {
     handleRedirectResult();
   }
   ```

---

## 📱 Mobile-Responsive Design Rules

* **Touch Targets:** Make sure all interactive components (buttons, dropdown options, calendar dates) have a minimum touch-target size of `44x44px` for mobile usability.
* **Viewport Safety:** Account for iPhone notch/safe areas when laying out headers or overlays using standard CSS padding or native wrapper styling adjustments.
* **Viewport Scrolling:** Prevent default elastic scroll issues inside iOS wrappers where possible using responsive structural container heights (`min-h-screen`, `h-full`).
