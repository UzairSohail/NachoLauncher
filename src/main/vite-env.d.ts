/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly MAIN_VITE_API_URL: string;
  readonly ELECTRON_RENDERER_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
