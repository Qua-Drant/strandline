import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // relative asset paths so the static build also works from a GitHub Pages sub-path
  base: './',
  build: {
    // The stylesheet relies on light-dark() (425 uses) with the theme set as an inline
    // color-scheme. Below these versions Lightning CSS rewrites light-dark() into
    // --lightningcss-light/dark variables that only react to color-scheme declared in CSS,
    // which drops every background and chart colour in the production build.
    // All of these support light-dark() natively; WebView2 is evergreen Chromium.
    cssTarget: ['chrome123', 'edge123', 'firefox120', 'safari17.5'],
  },
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    // the Rust side rebuilds itself; don't watch its build output
    watch: { ignored: ['**/src-tauri/**', '**/sandbox/**'] },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
})
