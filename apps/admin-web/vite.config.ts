import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  envPrefix: ['VITE_', 'EXPO_PUBLIC_', 'SUPABASE_', 'BACKEND_RPC_'],
  server: {
    port: 5180,
  },
});
