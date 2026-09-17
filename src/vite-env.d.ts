/// <reference types="vite/client" />

// Injected at build time from package.json (see `define` in vite.config.ts).
declare const __APP_VERSION__: string;
/** Однофайловая сборка из релиза (`npm run build:standalone`). */
declare const __STANDALONE__: boolean;

// Optional external token-provider config (see src/lib/authProvider.ts).
interface ImportMetaEnv {
  readonly VITE_TOKEN_PROVIDER_URL?: string;
  readonly VITE_LOGIN_URL?: string;
  readonly VITE_LOGOUT_URL?: string;
}
