import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'

export default defineConfig({
  base: process.env.TAURI_ENV_PLATFORM ? '' : '/cutesec/',
  plugins: [
    basicSsl(),
    react(),
  ],
  build: {
    minify: false,
  },
})
