/// <reference types="vite/client" />
// import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import posthog from 'posthog-js'

// Initialize PostHog
const posthogKey = import.meta.env.VITE_POSTHOG_API_KEY
const posthogHost = import.meta.env.VITE_POSTHOG_HOST

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
