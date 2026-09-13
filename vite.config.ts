import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron/simple';

export default defineConfig({
  plugins: [
    react(),
    electron({
      main: {
        entry: ['src/main/index.ts', 'src/main/recorder/encoder.ts'],
      },
      preload: {
        input: 'src/preload/index.ts',
      },
    }),
  ],
});
