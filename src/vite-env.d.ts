/// <reference types="vite/client" />

// Injected at build time from package.json (see `define` in vite.config.ts).
declare const __APP_VERSION__: string;

// Optional external token-provider config (see src/lib/authProvider.ts).
interface ImportMetaEnv {
  readonly VITE_TOKEN_PROVIDER_URL?: string;
  readonly VITE_LOGIN_URL?: string;
}
