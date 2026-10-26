# Roteiro

## Fase 1 — limpeza e hardening (feita)
- [x] Remover dependências e arquivos exclusivos do Lovable (broker de sessão, tagger, Playwright e Drizzle do Lovable)
- [x] Remover o ramo do paciente do `AuthContext`
- [x] Migration: remover exposição de e-mail e telefone dos psicólogos, impedir troca de `role`, corrigir fuso da validação de horário
- [x] Migration de baseline para bancos novos
- [x] Corrigir erros de lint (`any`, `require`, hooks) e mover a fonte para o `index.html`

## Fase 2 — modelo da clínica
- [x] API em Hono + Neon (`api/`): clínica, usuários e papéis, RLS multi-tenant
- [x] Pré-cadastro pelos administradores com link de convite (sem e-mail), redefinição de senha pelo admin
- [x] Pacientes cadastrados pela clínica (sem conta própria); dados clínicos separados e restritos
- [x] Agendamento pela clínica (recorrência semanal, remarcação, falta, bloqueios) com conflito validado no banco
- [x] Auditoria de acesso a pacientes; testes de integração e CI no GitHub Actions
- [x] Front na API: login, convite por link, usuários, pacientes (com anamnese)
- [x] Documentos psicológicos (CFP 06/2019 + encaminhamento e termo/LGPD) com numeração, hash, QR de verificação e papel timbrado (3 modos)
- [x] Agenda no front (semana, recorrência, remarcar, falta, bloqueios)
- [x] Dashboard e financeiro/gestão de atendimento
- [x] Histórico de atendimentos na ficha do paciente e evolução por sessão (imutável, com adendo)
- [x] Consulta de auditoria (administrador)
- [ ] Verificação do CRP (manual pelo administrador, no pré-cadastro)

## Publicação
- [x] Guia de deploy (`DEPLOY.md`), cabeçalhos do Pages, script de verificação pós-deploy e limite de tentativas por IP
- [x] CSP bloqueando, testada em Chrome real (13 passos, incluindo envio de imagens, PDF e bloqueios esperados)
- [ ] Primeira publicação e teste na Cloudflare/Neon reais (pendente de executar)

## Fase 3 — clínico e financeiro
- [x] Prontuário e evolução por sessão, sem exclusão física
- [ ] Financeiro unificado (Receita Saúde, NFS-e, cobrança) — desenho da NFS-e em `wip/nfse/`
- [ ] Lembretes, documentos CFP, auditoria e exportação

## Pendências de banco
- [ ] Excluir a tabela `messages` (exige confirmação; contém dados)
- [ ] Gerar baseline com `supabase db dump` do banco real
- [ ] `app_atende` já existe em `001_schema.sql`? Conferir em banco novo (o Supabase antigo precisou de uma migration de "funções ausentes")

## Pendências encontradas na avaliação de 2026-10-25
- [x] **Documentos (CFP 06/2019)**: `documents_guard` deixava passar UPDATE com `status` fora da lista (o `OLD.status`
      em literal não cobria o valor inválido). Corrigido em `005_documents_immutable_guard.sql` (compara com
      `IS DISTINCT FROM`) e coberto por teste no nível do banco.
- [x] **404.html ausente**: recarregar `/pacientes`, `/documentos` etc. no Pages devolvia erro. Criado em `public/`.
- [x] **CSP com a origem de exemplo**: sem `VITE_API_URL` o build publicava a política apontando para o placeholder.
      Agora o build falha de propósito. (A substituição em si já funcionava quando a variável está definida.)
- [ ] **CI**: o job da API não roda `npm run lint` (não há ESLint configurado para `api/`).
- [ ] **Fiscal (NFS-e)**: rascunho em `wip/nfse/` não compila (imports de `clinicToday`, `notFound`, `setClause`),
      não está roteado, sem testes e fora do `migrate`.
- [ ] **Turnstile incompleto**: a API cobra o token se `TURNSTILE_SECRET` existir, mas não há widget no front, nem
      `TURNSTILE_SITE_KEY` em uso, nem domínio/CSP (`challenges.cloudflare.com`). Não configurar o segredo até terminar
      — detalhes em `ENDERECOS.md` item 8.
- [ ] Validar a API contra um Postgres de verdade (`npm test` em `api/`) — a avaliação rodou só o `typecheck`.
- [ ] Unificar `APP_URL`/`ALLOWED_ORIGIN` quando o wrangler aceitar config em TS (hoje `wrangler.config.ts` é
      ignorado no `deploy`; o `wrangler.toml` continua sendo a config real).
