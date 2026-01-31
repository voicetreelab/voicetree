/// <reference types="vite/client" />
// import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import '@/shell/UI/sse-status-panel/status-panel.css'
import App from '@/shell/UI/App'
import posthog from 'posthog-js'
import { setupUIRpcHandler } from '@/shell/edge/UI-edge/ui-rpc-handler'
import type { VTSettings } from '@/pure/settings'

// Add platform class to document for platform-specific CSS (e.g., scrollbar handling)
// Windows: scrollbars take physical space, macOS: overlay scrollbars
const platform: string = navigator.platform.toLowerCase()
if (platform.includes('win')) {
  document.documentElement.classList.add('platform-windows')
}

// Initialize PostHog (skip in tests or if explicitly disabled)
const posthogKey: string | undefined = import.meta.env.VITE_POSTHOG_API_KEY
const posthogHost: string | undefined = import.meta.env.VITE_POSTHOG_HOST
const isTestMode: boolean = import.meta.env.MODE === 'test' || import.meta.env.VITE_E2E_TEST === 'true'
const analyticsDisabled: boolean = import.meta.env.VITE_DISABLE_ANALYTICS === 'true' || isTestMode

if (posthogKey && !analyticsDisabled) {
  posthog.init(posthogKey, {
    api_host: posthogHost,
    person_profiles: 'always',
    autocapture: true,
    capture_pageview: true,
    session_recording: {
      maskAllInputs: true,
      // Mask user content in: CodeMirror editors, xterm terminals, floating window content, transcription panel, tab titles, project names/paths
      maskTextSelector: '.cm-editor, .cm-content, .xterm, .cy-floating-window-content, .vt-transcription-content, .recent-tab-text, .terminal-tree-title, .vt-project-name, .vt-project-path',
    },
    // Disable console log recording in session replay (errors still captured via error tracking)
    enable_recording_console_log: false
  })

  // Identify user with email from settings if available (fixes UUID reset on app updates)
  void (async () => {
    if (window.electronAPI) {
      const settings: VTSettings = await window.electronAPI.main.loadSettings()
      if (settings.userEmail) {
        posthog.identify(settings.userEmail, { email: settings.userEmail })
      }
    }
  })()
}

// Setup UI RPC handler for main→UI IPC calls (must be before render so it's ready for early calls)
setupUIRpcHandler();

// Render app immediately - backend connection will be initialized lazily when needed
createRoot(document.getElementById('root')!).render(
    <App/>
);
