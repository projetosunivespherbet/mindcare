import type { DbPool, Session } from "./db";

export type Env = {
  DATABASE_URL: string;
  JWT_SECRET: string;
  SETUP_TOKEN?: string;
  TURNSTILE_SECRET?: string;
  /** Chave pública do Turnstile, usada pelo front. Precisa existir junto com TURNSTILE_SECRET. */
  TURNSTILE_SITE_KEY?: string;
  APP_URL: string;
  ALLOWED_ORIGIN: string;
  SCRYPT_N?: string;
};

export type AppEnv = {
  Bindings: Env;
  Variables: { pool: DbPool; session: Session };
};
