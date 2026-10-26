# MindCare

Software de gestão para psicólogos e clínicas: agenda, pacientes e financeiro.

## Stack

Front: React 18, Vite, TypeScript, Tailwind, shadcn/ui e React Query. API: Hono em Cloudflare Workers com Neon (PostgreSQL).

## Como rodar

```bash
# 1) API (veja api/README.md): defina api/.dev.vars e rode
cd api && npm install && npx wrangler dev        # http://localhost:8787

# 2) Front
cp .env.example .env                              # VITE_API_URL aponta para a API
npm install
npm run dev                                       # http://localhost:8080
```
`VITE_API_URL` é obrigatória também no build (`npm run build` falha sem ela, para não publicar um front cuja CSP
bloqueia a API). Onde cada endereço é aplicado: `ENDERECOS.md`.

Outros comandos: `npm run build`, `npm run typecheck`, `npm run lint`, `npm test` e `npm run test:e2e` (telas + API + Postgres local). Na API: `npm run typecheck` e `npm test` (também exigem Postgres local).
Teste em navegador real (Chrome headless, inclui CSP e PDF): veja `e2e-browser/README.md`.

## Publicação
Veja `DEPLOY.md` (Neon + Cloudflare Workers + Pages, com roteiro de teste no navegador). Os endereços que precisam
de ser trocados quando o domínio mudar estão em `ENDERECOS.md`.

## Backend (fase 2)

A API (Workers + Neon) está em `api/`; veja `api/README.md`. As telas antigas do Supabase ficam em `src/legacy/` e o histórico bruto do banco em `legacy/` — só como referência até serem portados. Rascunhos que ainda não entram no ar ficam em `wip/` (hoje, a NFS-e).

## Roteiro

Veja `roadmap.md`.
