// import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// @ts-ignore
import './index.css'
import App from './App.tsx'

// Render app immediately - backend connection will be initialized lazily when needed
createRoot(document.getElementById('root')!).render(
    <App/>
);
