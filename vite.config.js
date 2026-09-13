import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { execSync } from 'node:child_process'

// SHA do commit que gerou este build. Na Vercel vem do ambiente; local, do
// git; sem os dois, 'dev'. Nunca lanca: build nao pode quebrar por causa do
// rotulo de versao.
function shaDoBuild() {
  const daVercel = process.env.VERCEL_GIT_COMMIT_SHA
  if (daVercel) return daVercel.slice(0, 7)
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim()
  } catch {
    return 'dev'
  }
}

export default defineConfig({
  define: {
    __BUILD_SHA__:  JSON.stringify(shaDoBuild()),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString())
  },
  plugins: [
    react(),
    VitePWA({
      // 'prompt' em vez de 'autoUpdate': o service worker novo ESPERA em vez de
      // assumir em silencio, e quem avisa e o src/AtualizacaoDisponivel.jsx.
      // Motivo em 13/09/2026: um cliente ficou quase 7h numa versao antiga com
      // o bundle certo publicado, e nada na tela dizia isso.
      registerType: 'prompt',
      includeAssets: ['icons/*.png'],
      manifest: {
        name: 'Central OS TI',
        short_name: 'OS TI',
        description: 'Sistema de chamados de TI - SEMED Itabuna',
        theme_color: '#185FA5',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*\.supabase\.co\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'supabase-cache',
              expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 }
            }
          }
        ]
      }
    })
  ]
})

