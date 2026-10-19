import { env } from 'node:process';
import { defineConfig } from 'vite';

// GitHub Pages publishes this repository at /PRE1.5.1/, while local Vite runs at /.
// The Pages workflow may supply its repository-specific base path at build time.
// When it does not, the build must still work from a project subpath, so the
// default production base is relative ('./') instead of '/': with an absolute
// base, a bundle served from /PRE1.5.1/ requests /assets/... at the domain
// root, every asset 404s, and the visitor gets a blank white page.
const pagesBasePath = (env.VITE_BASE_PATH ?? '').replace(/^\/+|\/+$/g, '');

// The preview proxy expects the dev server to bind to every interface, not localhost.
// Keeping this setting in source prevents a beginner from needing a second configuration file.
export default defineConfig(({ command }) => ({
  // 'serve' covers both `vite` and `vite preview`; relative bases are a
  // build-time concept, so local servers keep the plain root path.
  base: command === 'serve' ? '/' : pagesBasePath ? `/${pagesBasePath}/` : './',
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
}));
