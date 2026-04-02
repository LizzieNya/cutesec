import { createRoot } from 'react-dom/client'
import { AppProvider } from './context/AppContext'
import App from './App'
import { registerSW } from 'virtual:pwa-register'

const updateSW = registerSW({
  onNeedRefresh() {
    if (confirm('New content is available. Reload?')) {
      updateSW(true)
    }
  },
  onOfflineReady() {
    console.log('App ready to work offline')
  },
})

createRoot(document.getElementById('root')).render(
  <AppProvider>
    <App />
  </AppProvider>
)
