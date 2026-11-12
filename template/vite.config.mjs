import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The supervisor starts `node server.mjs`; Vite is embedded in that process
// (middlewareMode). This file only supplies the React transform + HMR client.
export default defineConfig({
  plugins: [react()],
  server: {
    // The parent HTTP server owns the port. Do NOT let Vite open a second one.
    middlewareMode: true,
    hmr: { clientPort: undefined },
  },
  appType: 'custom',
})
