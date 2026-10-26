# Conectar contas

Ordem correta: GitHub → Neon → Cloudflare

## 1) GitHub

- Crie o repositório e envie o código.
- O Pages constrói a partir do GitHub, então esta etapa vem primeiro.

## 2) Neon

- Crie o banco.
- Aplique as migrações com a string do papel `neondb_owner`.
- No SQL editor, crie o papel da API:

```sql
CREATE ROLE app_user LOGIN PASSWORD 'TROQUE-ESTA-SENHA' IN ROLE app_runtime;
```

- Use a string `pooled` do `app_user` para a API.

## 3) Cloudflare

### API (Worker)

```bash
cd api
npx wrangler login
npx wrangler secret put DATABASE_URL
npx wrangler secret put JWT_SECRET
npx wrangler secret put SETUP_TOKEN
npx wrangler deploy
```

### Front (Pages)

- Conecte o repositório no Cloudflare Pages.
- Build command: `npm run build`
- Output directory: `dist`
- Variável: `VITE_API_URL` = URL do Worker sem barra final
- Variável: `NODE_VERSION` = `22`

## 4) Fechar o circuito

No arquivo `api/wrangler.toml`, ajuste:

```toml
APP_URL = "https://SEU-APP.pages.dev"
ALLOWED_ORIGIN = "https://SEU-APP.pages.dev"
```

E publique novamente:

```bash
cd api && npx wrangler deploy
```

## 5) Avisos importantes

- Não ative `TURNSTILE_SECRET` antes do front enviar o token.
- O front e a API devem usar HTTPS e sem barra final.
- Use `.pages.dev` ou um domínio real; não misture `localhost` com produção.
