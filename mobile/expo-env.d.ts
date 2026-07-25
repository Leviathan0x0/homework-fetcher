/// <reference types="expo/types" />

// Public (client-visible) environment variables. EXPO_PUBLIC_* values are
// inlined at build time, so only non-secret configuration belongs here.
declare namespace NodeJS {
  interface ProcessEnv {
    readonly EXPO_PUBLIC_API_BASE_URL?: string;
  }
}
