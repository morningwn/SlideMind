import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['pptxgenjs'] })],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          'presentation-export-worker': resolve(
            'src/main/presentation/presentation-export-worker.ts'
          )
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react()]
  }
})
