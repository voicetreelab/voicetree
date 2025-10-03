import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import path from 'path'
import { getRendererConfig } from './vite.renderer.config'

export default defineConfig(async () => {
  const rendererConfig = await getRendererConfig();

  return {
    main: {
      // Configuration for electron main process
      plugins: [externalizeDepsPlugin()],
      build: {
        outDir: 'dist-electron/main',
        rollupOptions: {
          input: {
            index: path.resolve(__dirname, 'electron/main.ts')
          }
        }
      }
    },
    preload: {
      // Configuration for preload script
      plugins: [externalizeDepsPlugin()],
      build: {
        outDir: 'dist-electron/preload',
        rollupOptions: {
          input: {
            index: path.resolve(__dirname, 'electron/preload.ts')
          },
          output: {
            format: 'cjs',
            entryFileNames: '[name].js'
          }
        }
      }
    },
    renderer: rendererConfig
  }
});
