import { env } from 'node:process';
import { defineConfig } from 'vite';

// GitHub Pages publishes this repository at /PRE1.5.1/, while local Vite runs at /.
// The Pages workflow supplies its repository-specific base path at build time.
const pagesBasePath = (env.VITE_BASE_PATH ?? '').replace(/^\/+|\/+$/g, '');
const base = pagesBasePath ? `/${pagesBasePath}/` : '/';

// The preview proxy expects the dev server to bind to every interface, not localhost.
// Keeping this setting in source prevents a beginner from needing a second configuration file.
export default defineConfig({
  base,
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
