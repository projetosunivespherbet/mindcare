# Endereços da aplicação — inventário para a troca

O endereço **final ainda não foi definido**. Quando for, troque os itens marcados **[DEFINIR]**. Esta lista é o
checklist — o que **não** está aqui é derivado automaticamente.

Regra geral: **sempre `https`, nunca barra no final**. `https://app.seudominio.com` ✔ / `https://app.seudominio.com/` ✘

---

## 1. Front (Cloudflare Pages) — aparece em 2 lugares

| # | Onde | Valor hoje | O que fazer |
|---|---|
| 1 | `api/wrangler.toml` → `APP_URL` | `https://SEU-APP.pages.dev` **[DEFINIR]** | URL do site. É o que monta o **link de convite/redefinição de senha** que o admin envia. Se errar, o link chega quebrado. |
| 2 | `api/wrangler.toml` → `ALLOWED_ORIGIN` | `https://SEU-APP.pages.dev` **[DEFINIR]** | Mesmo valor do `APP_URL`. É o **único front** que a API aceita (CORS). Se errar, o app carrega mas nenhuma chamada funciona. |

Depois de editar: `cd api && npx wrangler deploy`.

> **Os dois valores são idênticos, mas precisam ser preenchidos separadamente.** O `wrangler.toml` é TOML e não
deriva um valor do outro. Se o wrangler passar a aceitar config em TS (hoje a 4.151 ignora `wrangler.config.ts` no
`deploy`), vale unificar como `ALLOWED_ORIGIN: APP_URL`.

---

## 2. API (Cloudflare Workers) — aparece em 1 lugar do código

| # | Onde | Valor hoje | O que fazer |
|---|---|
| 3 | `VITE_API_URL` — **variável do build no Pages** | `http://localhost:8787` (`.env.example`, só é referência) | URL da API **[DEFINIR]**. Não fica no repositório: é variável de ambiente no painel do Pages (Settings → Environment variables) e/ou no seu `.env` local. |

- **Build sem ela falha de propósito** (`vite.config.ts`): evita publicar um front cuja CSP bloqueia a API.
- O valor entra em dois consumidores, e os dois são automáticos:
  - `src/lib/api.ts` → todas as chamadas `fetch`;
  - `public/_headers` → `connect-src` da CSP, substituído no build.

---

## 3. Não precisa mexer (derivados do endereço)

| Item | Por quê |
|---|---|
| `public/_headers` (valor `https://SEU-WORKER.SEU-SUBDOMINIO.workers.dev`) | É **placeholder** substituído no build pelo `VITE_API_URL`. Não edite. |
| QR code e link de verificação do documento (`src/lib/documentPdf.ts`) | Usam `window.location.origin` — o endereço do próprio front. Se o domínio mudar, QR **já emitidos** apontam para o domínio antigo: mantenha um redirect. |
| `e2e-browser/flow.mjs` | Troca o placeholder pela API local em tempo de teste. |
| `.github/workflows/ci.yml` (`https://api.exemplo.workers.dev`) | Só para o build de CI; não afeta produção. |
| `api/test/*`, `src/test/*` | Endereços fictícios de teste. |
| `src/legacy/*` | Código Supabase antigo, não compilado. |

---

## 4. Documentação (não afeta o app; atualize para não confundir)

- `DEPLOY.md` — linhas 42, 57, 64-65, 74, 82 (exemplos `SEU-APP` / `SEU-SUBDOMINIO`). **O passo 4 inteiro é a troca dos itens 1 e 2.**
- `api/README.md` — linha 38 (`curl` de criação da clínica).
- `api/scripts/smoke.mjs` — linha 2 (comentário de uso). O `smoke` recebe `API_URL`/`ALLOWED_ORIGIN` por variável, então só o comentário envelhece.

---

## 5. Serviços externos (fora do repositório)

| Serviço | O que configurar |
|---|---|
| Cloudflare Pages | Variável `VITE_API_URL`; depois de trocar, **republicar** (variável nova só vale em build novo). |
| Cloudflare Workers | `APP_URL` e `ALLOWED_ORIGIN` via `wrangler.toml` (ou `[env.production]` se usar ambientes). |
| Neon | Nenhum endereço do app; só `DATABASE_URL` (segredo). |
| Cloudflare Turnstile (se usar) | Adicionar o **domínio do front** na lista de domínios permitidos do widget. **Hoje o captcha não funciona ponta a ponta:** a API já cobra o token (`TURNSTILE_SECRET`), mas não existe widget no front e `Env` não tem `TURNSTILE_SITE_KEY`. Ver item 8. |

---

## 6. Ordem segura da troca

1. Defina `https://app.<dominio>` (front) e `https://api.<dominio>` (API).
2. **Workers**: `APP_URL` e `ALLOWED_ORIGIN` → deploy.
3. **Pages**: `VITE_API_URL` → **republicar**.
4. Rode a verificação: `cd api && API_URL=https://api.<dominio> ALLOWED_ORIGIN=https://app.<dominio> npm run smoke` — tudo ✓.
5. No navegador, confirme: login, abrir **Usuários → gerar link de convite** (o link deve começar com `https://app.<dominio>/convite/...`) e abrir o QR de um documento de teste.

**A opção mais barata:** se usar *domínio próprio no Workers* (`routes`/Custom Domain), a API sai de
`mindcare-api.SEU-SUBDOMINIO.workers.dev` e o caminho de troca passa a ser só o `VITE_API_URL` — o `APP_URL` e o
`ALLOWED_ORIGIN` continuam os mesmos.

---

## 7. Se o endereço mudar **depois** de publicado

- Quem já recebeu um **link de convite** com o domínio antigo: gere de novo (`POST /users/:id/invite`) — links antigos continuam válidos até expirarem, mas abrem o host antigo.
- **QR codes** de documentos já impressos: mantenha o domínio antigo redirecionando para `/verificar/:codigo` no novo (Documents são imutáveis; o código não muda).
- Redefina `ALLOWED_ORIGIN` **e** o `VITE_API_URL`, nesta ordem, para não deixar janela com o app no ar sem API.

---

## 8. Turnstile — endereço importante, mas o recurso está incompleto
O captcha é **opcional e desligado**: sem `TURNSTILE_SECRET`, `verifyTurnstile` devolve `true` e o login segue sem
captcha. Se ligar a chave secreta **sem terminar o front**, o login e o aceite de convite passam a devolver 400 — a
API exige o token que o front nunca envia.

| Falta | Onde |
|---|---|
| Chave **pública** no contrato da API | `TURNSTILE_SITE_KEY` (já declarada em `api/src/types.ts`, ainda não lida em rota nenhuma) |
| Widget e `turnstile` no corpo | `src/pages/Login.tsx` e `src/pages/Invite.tsx` (hoje não enviam o campo) |
| Domínio do front na lista permitida | Painel da Cloudflare → Turnstile |
| `script-src` e `frame-src` da CSP | `public/_headers` — o script vem de `challenges.cloudflare.com`, que a política atual **bloqueia** |

Decisão para a implantação: ou **não** configurar `TURNSTILE_SECRET` (recomendado na primeira publicação — já há
limite por IP e bloqueio de conta), ou terminar os 4 itens acima incluindo o domínio.
