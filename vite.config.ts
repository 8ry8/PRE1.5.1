import { defineConfig } from 'vite';

// The preview proxy expects the dev server to bind to every interface, not localhost.
// Keeping this setting in source prevents a beginner from needing a second configuration file.
export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 4173,
    strictPort: false,
    // Arena proxies the preview through a generated host name.
    allowedHosts: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    strictPort: false,
    allowedHosts: true,
  },
});
