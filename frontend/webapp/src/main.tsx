/// <reference types="vite/client" />
// import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import '@/shell/UI/sse-status-panel/status-panel.css'
import App from '@/shell/UI/App'
import posthog from 'posthog-js'
import { SseStatusPanel } from '@/shell/UI/sse-status-panel'
import { setupUIRpcHandler } from '@/shell/edge/UI-edge/ui-rpc-handler'

// Initialize PostHog (skip in dev mode - npm run electron)
const posthogKey: string | undefined = import.meta.env.VITE_POSTHOG_API_KEY
const posthogHost: string | undefined = import.meta.env.VITE_POSTHOG_HOST

if (posthogKey && !import.meta.env.DEV) {
  posthog.init(posthogKey, {
    api_host: posthogHost,
    person_profiles: 'always',
    autocapture: true,
    capture_pageview: true,
    session_recording: {
      maskAllInputs: true,
      // Mask user content in: CodeMirror editors, xterm terminals, floating window content
      maskTextSelector: '.cm-editor, .cm-content, .xterm, .cy-floating-window-content',
    }
  })
}

// Setup UI RPC handler for main→UI IPC calls (must be before render so it's ready for early calls)
setupUIRpcHandler();

// Render app immediately - backend connection will be initialized lazily when needed
createRoot(document.getElementById('root')!).render(
    <App/>
);

// Initialize SseStatusPanel (waits for mount point via MutationObserver if needed)
SseStatusPanel.init();
