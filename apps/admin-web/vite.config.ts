import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { config as loadEnvFile } from 'dotenv';
import { defineConfig } from 'vite';

// The monorepo keeps shared public config in a root .env.apps, the same file
// scripts/run-expo-with-root-env.cjs feeds to the Expo apps. Vite will not pick
// it up on its own: it only auto-loads .env/.env.local from the app directory,
// and never a custom filename. Without this, src/config/env.ts throws while the
// module is still evaluating and the app renders a blank page.
//
// dotenv does not overwrite variables that already exist, so real deployment
// environment values (Cloudflare Pages, CI) always win over the local file.
const appDir = path.dirname(fileURLToPath(import.meta.url));
loadEnvFile({ path: path.resolve(appDir, '.env.local') });
loadEnvFile({ path: path.resolve(appDir, '../../.env.apps') });

export default defineConfig({
  plugins: [tailwindcss(), react()],
  envPrefix: ['VITE_', 'EXPO_PUBLIC_', 'SUPABASE_', 'BACKEND_RPC_'],
  server: {
    port: 5180,
  },
});
