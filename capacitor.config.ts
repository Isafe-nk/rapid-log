import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.limky.rapidlog',
  appName: 'Rapid Log',
  webDir: 'dist',
  ios: {
    contentInset: 'automatic',
    backgroundColor: '#fcfcf9',
    preferredContentMode: 'mobile',
    allowsLinkPreview: false,
  },
  server: {
    // Use localhost so Firebase Auth redirects work inside the WebView
    hostname: 'localhost',
    iosScheme: 'capacitor',
  },
};

export default config;
