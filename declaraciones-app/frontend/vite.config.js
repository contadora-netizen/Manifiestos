import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/contrato': 'http://localhost:3000',
      '/api/guias': 'http://localhost:3000',
      '/api/transportistas': 'http://localhost:3000',
      '/api/vehiculos': 'http://localhost:3000',
      '/api/pdf': 'http://localhost:3000',
      '/api/dashboard': 'http://localhost:3000',
    }
  },
  preview: {
    host: '0.0.0.0',
    port: parseInt(process.env.PORT) || 4173,
    allowedHosts: ['manifiestos-production.up.railway.app', 'all']
  }
})
