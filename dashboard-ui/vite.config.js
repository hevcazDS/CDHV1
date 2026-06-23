import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3001',
      '/health': 'http://localhost:3001',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // Vendors de uso constante (shell/layout) en chunks propios para que
        // el navegador los cachee entre despliegues. recharts/qrcode NO van
        // aquí a propósito: se quedan en el chunk diferido de la página que
        // los usa (Métricas / QR), no en la carga inicial.
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-mantine': ['@mantine/core', '@mantine/hooks', '@mantine/form'],
          'vendor-query': ['@tanstack/react-query'],
        },
      },
    },
  },
});
