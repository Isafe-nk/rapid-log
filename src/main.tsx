import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {MotionConfig} from 'motion/react';
import App from './App.tsx';
import './index.css';

// "user" honours the system's Reduce Motion setting for every motion element:
// movement, scale and layout glides are skipped, fades are kept. Set once here
// rather than element by element, so nothing added later can forget it. Motion
// follows the setting live and reads it as each element mounts.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <App />
    </MotionConfig>
  </StrictMode>,
);
