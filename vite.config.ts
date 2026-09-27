/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      workbox: {
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        // the bundled user guides are standalone documents, not SPA routes
        navigateFallbackDenylist: [/^\/user-guide(-hu)?\.html$/],
      },
      manifest: {
        name: 'Order · 订货',
        short_name: 'Order',
        description: 'Restaurant group ordering, kitchen & distribution',
        theme_color: '#1c2b3a',
        background_color: '#f6f5f2',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        // stable vendor chunks cache across deploys
        manualChunks: {
          react: ['react', 'react-dom', 'react-router'],
          data: ['@supabase/supabase-js', '@tanstack/react-query'],
        },
      },
    },
  },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
