import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // relative asset paths so the static build also works from a GitHub Pages sub-path
  base: './',
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    // the Rust side rebuilds itself; don't watch its build output
    watch: { ignored: ['**/src-tauri/**'] },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
})
