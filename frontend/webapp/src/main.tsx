/// <reference types="vite/client" />
// import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from '@/shell/UI/App'
import posthog from 'posthog-js'
import { StatusPanel } from '@/shell/UI/status-panel'

// Initialize PostHog
const posthogKey: string | undefined = import.meta.env.VITE_POSTHOG_API_KEY
const posthogHost: string | undefined = import.meta.env.VITE_POSTHOG_HOST

if (posthogKey) {
  posthog.init(posthogKey, {
    api_host: posthogHost,
    person_profiles: 'always',
    autocapture: true,
    capture_pageview: true,
    session_recording: {
      maskAllInputs: true,
      maskTextSelector: '.node-content, .markdown-editor',
    }
  })
}

// Render app immediately - backend connection will be initialized lazily when needed
createRoot(document.getElementById('root')!).render(
    <App/>
);

// Initialize StatusPanel after React has rendered the mount point
requestAnimationFrame(() => {
  StatusPanel.init();
});
