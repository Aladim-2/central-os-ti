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
        // O chunk do gerador de PDF (pdfmake + as seis faces da IBM Plex,
        // ~1,2 MB) fica FORA do precache. Sem isto o import() dinamico nao
        // resolve nada: o workbox precacheia todo asset do build, e o tecnico
        // no celular baixaria, a cada versao, a fonte que a tela dele nunca
        // usa. Quem emite PDF e o gestor, no desktop, e ai o chunk desce por
        // rede no clique. Medido em 18/09/2026, na lista de assets do
        // dist/sw.js: o precache cai de 9 entradas / 1738,99 KiB para 8
        // entradas / 554,76 KiB, e 'pdfRelatorio' nao aparece mais no sw.js.
        // O curinga e por causa do hash que o Vite poe no nome. Hoje o vfsPlex
        // sai DENTRO deste chunk (conferido: a face IBMPlexMono-SemiBold.ttf
        // so aparece nele). Se um dia outro modulo importar o vfsPlex, o
        // Rollup o promove a chunk proprio e ele volta ao precache — a
        // conferencia e reler a lista do dist/sw.js depois do build.
        globIgnores: ['**/assets/pdfRelatorio-*.js'],
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

