# MindCare API

API da clínica: Hono em Cloudflare Workers + Neon (PostgreSQL). Multi-tenant com RLS, papéis
(`admin`, `psicologo`, `recepcao`) e **pré-cadastro por convite com link** (não depende de e-mail).

## Como funciona o pré-cadastro

1. O operador cria a clínica e o primeiro administrador (`POST /platform/clinics`, protegido por `SETUP_TOKEN`).
2. O administrador pré-cadastra a pessoa (`POST /users`: nome, papel, CRP) e recebe um **link**.
3. Ele entrega o link (WhatsApp, por exemplo). A pessoa abre `GET /invites/:token`, informa e-mail e senha
   (`POST /invites/accept`) e já entra.
4. Esqueceu a senha? O administrador gera um novo link (`POST /users/:id/invite`). Links expiram (padrão 7 dias),
   valem uma vez e só o hash do token fica no banco.

## Colocando no ar

O passo a passo ilustrado e o roteiro de teste estão em `../DEPLOY.md`; abaixo, o resumo.

```bash
cd api && npm install

# 1) Neon: com a conexão do DONO do banco, aplique o schema
DATABASE_URL="postgres://dono:...@.../neondb?sslmode=require" npm run migrate

# 2) Neon (SQL editor): papel que a API usa. Não é dono das tabelas, então a RLS vale para ele.
#    CREATE ROLE app_user LOGIN PASSWORD '...' IN ROLE app_runtime;

# 3) Segredos e variáveis
npx wrangler secret put DATABASE_URL     # conexão do app_user (use a URL "pooled" do Neon)
npx wrangler secret put JWT_SECRET       # openssl rand -base64 48
npx wrangler secret put SETUP_TOKEN      # openssl rand -base64 32
npx wrangler secret put TURNSTILE_SECRET # opcional: exige o captcha no login e no aceite
# edite APP_URL e ALLOWED_ORIGIN em wrangler.toml (URL do front)

npm run deploy

# 4) Primeira clínica
curl -X POST https://SEU-WORKER.workers.dev/platform/clinics \
  -H "x-setup-token: $SETUP_TOKEN" -H "content-type: application/json" \
  -d '{"clinic_nome":"Minha Clínica","admin_nome":"Seu Nome","email":"voce@exemplo.com","password":"Senha@1234"}'
```

## Rotas

| Rota | Quem |
|---|---|
| `POST /platform/clinics` | operador (`x-setup-token`) |
| `POST /auth/login`, `GET /invites/:token`, `POST /invites/accept` | público |
| `GET /me`, `POST /auth/change-password` | qualquer usuário logado |
| `GET/POST /users`, `PATCH /users/:id`, `POST /users/:id/invite` | admin |
| `GET/POST /patients`, `GET/PATCH /patients/:id` | admin, psicólogo (só os seus), recepção |
| `PUT /patients/:id/anamnesis` | psicólogo responsável; admin que atende |
| `GET/POST /appointments`, `PATCH /appointments/:id` | admin, recepção (todos); psicólogo (só os seus) |
| `GET /patients/:id/appointments` | histórico de sessões do paciente (o que a RLS permite) |
| `GET /patients/:id/session-notes`, `POST /session-notes`, `POST /session-notes/:id/adendo` | psicólogo autor / admin que atende |
| `GET /audit`, `GET /audit/actions` | admin |
| `GET/POST /blocks`, `DELETE /blocks/:id` | idem |
| `GET /professionals` | qualquer usuário logado |
| `GET/POST /documents`, `GET/PATCH/DELETE /documents/:id` | psicólogo e admin que atende (só o autor edita) |
| `POST /documents/:id/emit`, `POST /documents/:id/annul` | autor do documento |
| `GET /letterheads` | qualquer usuário logado |
| `POST /letterheads`, `PATCH /letterheads/:id` | admin |
| `GET /verify/:codigo` | público |
| `GET /services`, `POST /services`, `PATCH /services/:id` | leitura: todos; escrita: admin e psicólogo (só os próprios preços) |
| `GET/POST /payers`, `PATCH /payers/:id` | admin e recepção (todos); psicólogo (os que criou ou usa) |
| `GET/POST /charges`, `GET/PATCH /charges/:id`, `POST /charges/:id/cancel` | admin e recepção (todas); psicólogo (só as suas) |
| `POST /charges/generate` | admin, recepção |
| `POST /charges/:id/payments` (exige `Idempotency-Key`) | admin, recepção; psicólogo (só as suas) |
| `POST /payments/:id/reverse` | admin; psicólogo (só as suas); recepção não |
| `GET /finance/summary` | todos (cada perfil vê o que a RLS permite) |
| `GET /finance/receivables` | admin, recepção |
| `GET /finance/export?from&to` | admin (CSV) |

`POST /appointments` aceita `recorrencia: { frequencia: "semanal", ocorrencias: 2..52 }`; se uma data conflitar,
nada é gravado. Datas em ISO 8601 com fuso (`2030-03-04T10:00:00-03:00`).

## Documentos psicológicos

Tipos em `shared/documents.ts`: declaração, atestado, relatório, relatório multiprofissional, laudo e parecer
(modalidades da Resolução CFP nº 06/2019), além de encaminhamento e termo de consentimento/contrato (LGPD).

- **Rascunho** pode ser editado e excluído. **Emitir** numera (`2026/0001`, por clínica e ano, sem buracos), gera
  código e hash SHA-256 do conteúdo e **congela** o texto e o papel timbrado usado. Emitido não muda e não se apaga:
  só pode ser **anulado**, com motivo (o registro fica).
- Só o psicólogo autor (ou admin que atende) cria, edita e emite. A recepção não tem acesso a documentos.
- **Verificação pública** (`/verificar/:codigo` no front): confirma número, tipo, profissional, clínica, situação e hash,
  sem revelar a pessoa atendida.
- **Papel timbrado** em três modos: cabeçalho gerado (logo, linhas e rodapé), imagem A4 de fundo, ou só margens para
  imprimir em papel físico. Imagens são PNG/JPEG (SVG é recusado) e ficam guardadas no banco.
- O PDF é gerado no navegador (`src/lib/documentPdf.ts`), a partir do documento emitido, então a segunda via é idêntica.
- Recibos de atendimento ficam de fora de propósito: pessoa física usa o Receita Saúde e pessoa jurídica emite NFS-e.

## Financeiro (fase 1)

Desenho completo no documento "MindCare: desenho do módulo financeiro e da API de NFS-e". Esta fase entrega o núcleo,
sem NFS-e (fases 2 e 4).

- **Dinheiro em centavos** (`valor_centavos`, inteiro) nas rotas novas e `int` no banco. A agenda segue com `valor` em reais.
- **Cobrança** (`charges`): o que há a receber. Líquido = valor − desconto. Uma sessão tem no máximo uma cobrança ativa.
  `status` (`aberta`, `parcial`, `paga`, `cancelada`) e `paid_centavos` são calculados por trigger a partir dos
  pagamentos; a API não consegue gravá-los. Cancelar exige motivo e só vale sem pagamento ativo.
- **Pagamento** (`payments`): imutável (o banco recusa `UPDATE` e `DELETE`). Erro se corrige com **estorno**: uma linha
  nova, de mesmo valor, ligada ao original e com motivo; cada pagamento é estornado uma vez. O pagamento não passa do
  saldo, mesmo com requisições simultâneas (a cobrança é travada durante a validação). `recebido_por`
  (`profissional` ou `clinica`) já fica registrado para o repasse futuro.
- **`Idempotency-Key`** é obrigatório em `POST /charges/:id/payments` (8 a 100 caracteres). Repetir a chave com o mesmo
  pagamento devolve o original (200); reutilizá-la com outro valor ou outra cobrança dá 409.
- **Agenda:** `appointments.payment_status` passa a refletir a cobrança. Cancelar a sessão cancela a cobrança; se há
  pagamento ativo, a sessão só cancela depois do estorno.
- **Geração em lote:** `POST /charges/generate` cria cobranças das sessões realizadas no período (e das faltas, com
  `incluir_faltas`). O valor vem da sessão ou, se faltar, do catálogo; sem preço, a sessão é contada em `sem_valor`.
  Repetir a chamada não duplica.
- **Migração:** a `004_finance.sql` converte sessões `realizado` com valor em cobranças e as marcadas `pago` em um
  pagamento `migrado`. O legado não guardou a data real do pagamento, então ela é a data da sessão (aproximada).
- **Exportação CSV** (admin): `;` como separador, vírgula decimal, BOM para o Excel, estorno em valor negativo e
  texto neutralizado contra fórmulas. Contém nomes de pacientes; cada exportação entra no `audit_log`.
- CPF/CNPJ dos responsáveis são validados (inclusive o CNPJ alfanumérico) e guardados sem máscara.

## Evolução por sessão e auditoria
- **Evolução** (`session_notes`) é registro clínico: não se edita nem se apaga (triggers recusam `UPDATE` e `DELETE`).
  Correção é **adendo**: linha nova ligada à original (`adenda_de`), uma por registro.
- Só o profissional que atendeu grava (trigger confere sessão/paciente/profissional); sessão cancelada não recebe.
  A recepção não vê nem grava; o administrador que atende vê o que produziu.
- **Histórico de atendimentos** vem com o nome do profissional e a contagem de evoluções de cada sessão.
- **Auditoria** (`GET /audit`, só admin): a view `audit_view` junta o nome de quem agiu; a RLS de `audit_log`
  continua valendo. O texto clínico **não** é copiado para a auditoria.

## Regras de segurança

- **Isolamento por clínica e por papel no banco** (RLS). A API só troca o contexto da transação.
- **Dados clínicos separados** (`patient_anamnesis`): recepção e admin que não atende não leem nem gravam.
- A API nunca lê `password_hash` (sem privilégio de coluna). Login/convite passam por funções `SECURITY DEFINER`.
- Papel e status são relidos do banco a cada requisição: desativar ou rebaixar vale na hora.
- Bloqueio de conta após 5 senhas erradas (15 min). Senhas com scrypt (parâmetros guardados no hash).
- Auditoria de criação, visualização e alteração de pacientes e de convites (`audit_log`).
- Sem exclusão física de pacientes e sessões (a API não tem `DELETE`; o papel não tem o privilégio).

## Testes

Precisam de um Postgres 15+ local e de um usuário com `CREATEDB` e `CREATEROLE`
(padrão: `mc_owner` / `owner_pw` em `127.0.0.1:5432`; ajuste com `TEST_PG_HOST` e `TEST_PG_OWNER_PASSWORD`).

```bash
npm test          # recria o banco mindcare_test, aplica as migrations e roda a suíte
npm run typecheck
```

## Pontos de atenção

- **scrypt (N=16384) consome CPU.** Pode estourar o limite do plano gratuito do Workers; confirme o seu plano
  ou reduza `SCRYPT_N` (os hashes antigos continuam válidos, pois guardam os próprios parâmetros).
- Limite de tentativas por IP já vem na API (login e aceite: 10 por minuto; verificação e convite: 30 por minuto), pois
  regras de rate limiting da Cloudflare não existem em `*.workers.dev`. Com domínio próprio, some uma regra de WAF.
- Sessões podem ser registradas no passado (a clínica lança atendimentos retroativos). O antigo cadastro de
  disponibilidade semanal não foi portado: use bloqueios de horário.
- Fora desta fase: prontuário por sessão, NFS-e, repasse, despesas, lembretes, anexos (R2).
