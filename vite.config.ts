import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron/simple';

// Native modules that must NOT be bundled — they load .node files at runtime
// and rely on node_modules/ being present on disk.
const EXTERNAL_NATIVE = [
  'better-sqlite3',
  'naudiodon',
  'ffmpeg-static',
  'electron-log',
];

export default defineConfig({
  plugins: [
    react(),
    electron({
      main: {
        entry: ['src/main/index.ts', 'src/main/recorder/encoder.ts'],
        vite: {
          build: {
            rollupOptions: {
              external: EXTERNAL_NATIVE,
            },
            rolldownOptions: {
              external: EXTERNAL_NATIVE,
            },
          },
        },
      },
      preload: {
        input: 'src/preload/index.ts',
      },
    }),
  ],
});
