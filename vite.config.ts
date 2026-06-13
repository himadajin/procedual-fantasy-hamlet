import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 750,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;

          const normalizedId = id.split('\\').join('/');

          if (normalizedId.includes('/three/')) {
            return 'three-vendor';
          }

          if (
            normalizedId.includes('/@react-three/fiber/') ||
            normalizedId.includes('/@react-three/drei/') ||
            normalizedId.includes('/@react-spring/three/') ||
            normalizedId.includes('/three-stdlib/') ||
            normalizedId.includes('/maath/') ||
            normalizedId.includes('/camera-controls/') ||
            normalizedId.includes('/zustand/') ||
            normalizedId.includes('/suspend-react/') ||
            normalizedId.includes('/its-fine/') ||
            normalizedId.includes('/react-reconciler/') ||
            normalizedId.includes('/tunnel-rat/')
          ) {
            return 'r3f-vendor';
          }

          if (
            normalizedId.includes('/react/') ||
            normalizedId.includes('/react-dom/') ||
            normalizedId.includes('/scheduler/') ||
            normalizedId.includes('/use-sync-external-store/')
          ) {
            return 'react-vendor';
          }

          return 'vendor';
        },
      },
    },
  },
  server: {
    port: 5173,
  },
});
