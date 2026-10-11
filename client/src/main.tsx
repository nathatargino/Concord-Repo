import React from 'react'
import ReactDOM from 'react-dom/client'
import { Router } from './router'
import { initTheme } from './utils/theme'
import './index.css'

initTheme()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Router />
  </React.StrictMode>,
)
