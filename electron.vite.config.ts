import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import vue from '@vitejs/plugin-vue'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import Icons from 'unplugin-icons/vite'
import { FileSystemIconLoader } from 'unplugin-icons/loaders'
import IconsResolver from 'unplugin-icons/resolver'
import Components from 'unplugin-vue-components/vite'

const pptistSource = resolve('node_modules/pptist/src')
const pptistPublic = resolve('node_modules/pptist/public')

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['chokidar', 'pptxgenjs', 'pptxtojson'] })],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          'presentation-export-worker': resolve(
            'src/main/presentation/presentation-export-worker.ts'
          ),
          'pptx-read-worker': resolve('src/main/agent/pptx-read-worker.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    publicDir: pptistPublic,
    optimizeDeps: {
      esbuildOptions: {
        loader: {
          '.ts': 'ts'
        }
      }
    },
    resolve: {
      alias: {
        '@': pptistSource,
        '@pptist-theme': resolve('src/renderer/pptist-theme.scss'),
        '@renderer': resolve('src/renderer/src')
      }
    },
    css: {
      preprocessorOptions: {
        scss: {
          additionalData: `
            @use '@pptist-theme' as *;
            @use '@/assets/styles/mixin.scss' as *;
          `
        }
      }
    },
    plugins: [
      react(),
      vue(),
      Components({
        dirs: [],
        dts: false,
        exclude: [/[\\/]\.git[\\/]/, /[\\/]\.nuxt[\\/]/],
        resolvers: [
          IconsResolver({
            prefix: 'i',
            customCollections: ['custom']
          })
        ]
      }),
      Icons({
        compiler: 'vue3',
        autoInstall: false,
        customCollections: {
          custom: FileSystemIconLoader(resolve(pptistSource, 'assets/icons'))
        },
        scale: 1,
        defaultClass: 'i-icon'
      })
    ],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          pptist: resolve('src/renderer/pptist.html'),
          'markdown-pdf': resolve('src/renderer/markdown-pdf.html')
        }
      }
    }
  }
})
