import React from 'react'
import { createRoot } from 'react-dom/client'
import './utils/monaco-setup'
import App from './app/App'
import './styles/app.css'

const rootElement = document.getElementById('root')

if (!rootElement) {
throw new Error('Root element "#root" was not found in index.html')
}

createRoot(rootElement).render(
<React.StrictMode>
<App />
</React.StrictMode>,
)