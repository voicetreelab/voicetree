/// <reference types="vite/client" />
// import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from '@/shell/UI/App'
import posthog from 'posthog-js'
import { SseStatusPanel } from '@/shell/UI/sse-status-panel'
import { setupUIRpcHandler } from '@/shell/edge/UI-edge/ui-rpc-handler'

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

// Initialize UI RPC handler for main→UI function calls
setupUIRpcHandler()

// Render app immediately - backend connection will be initialized lazily when needed
createRoot(document.getElementById('root')!).render(
    <App/>
);

// Initialize SseStatusPanel (waits for mount point via MutationObserver if needed)
SseStatusPanel.init();
