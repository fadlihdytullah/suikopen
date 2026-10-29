import { createRoot } from 'react-dom/client'
import { App } from './App'

const container = document.getElementById('root')
if (!container) {
  throw new Error('Missing #root')
}

document.documentElement.classList.toggle('mac', window.suikopen.platform === 'darwin')

createRoot(container).render(<App />)
