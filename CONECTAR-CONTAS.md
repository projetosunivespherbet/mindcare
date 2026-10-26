# Ligar as três contas (GitHub → Cloudflare → Neon)

Cada conta exige **um login seu**. Não há como automatizar sem a sua senha:
GitHub pede código no navegador, Cloudflare exige e-mail confirmado + 2FA, e o Neon só cria
projeto dentro do painel. Abaixo está a ordem que evita retrabalho: o **GitHub primeiro**, porque
o Pages constrói o site a partir do repositório.

Estado desta máquina em 25/10/2026:

| Item | Situação |
|---|---|
| Git | ✅ instalado (`C:\Program Files\Git\cmd\git.exe`) |
| Repositório local | ✅ `main`, 2 commits (`6acf13d` + docs), 203 arquivos, sem segredos |
| GitHub CLI (`gh`) | ⚠️ instalação bloqueada (outro instalador em andamento) — os passos abaixo usam o site |
| Cloudflare (wrangler) | ❌ não autenticado |
| Neon | ❌ sem projeto |

---

## 1. GitHub — criar o repositório e enviar o código

1. Entre em <https://github.com/new>.
2. Nome: `mindcare`. **Private** (é software de gestão em saúde; não use público).
   Não marque "Add a README" — o repositório já tem histórico local.
3. Copie a URL que aparece (ex.: `https://github.com/SEU-USUARIO/mindcare.git`).
4. No terminal, dentro da pasta do projeto:

```powershell
& "C:\Program Files\Git\cmd\git.exe" remote add origin https://github.com/SEU-USUARIO/mindcare.git
& "C:\Program Files\Git\cmd\git.exe" push -u origin main
```

O navegador abre para o login do GitHub (ou você usa um token em *Settings → Developer settings →
Personal access tokens*). **Me passe a URL do repositório** que eu confiro o envio.

> Se o `push` pedir usuário/senha e recusar a senha: o GitHub não aceita senha em Git. Use o token
> acima como "senha", ou instale o `gh` depois e rode `gh auth login`.

---

## 2. Neon — criar o banco e aplicar as migrations

1. Entre em <https://console.neon.tech> e crie o projeto na região **South America (São Paulo)**.
2. Abra *Connection details* e copie a string **direta** do papel dono (`neondb_owner`).
   Ela tem o host sem `-pooler`.
3. Rode, nesta máquina:

```powershell
cd api
npm install
$env:DATABASE_URL="postgresql://neondb_owner:SENHA@ep-xxxx-pooler.../neondb?sslmode=require"   # use a DIRETA aqui
npm run migrate
```

4. Confira a saída: devem aparecer **6 linhas**, terminando em `005_documents_immutable_guard.sql` e
   `006_patient_records.sql`.
5. No **SQL Editor** do Neon, crie o papel que a API usará:

```sql
CREATE ROLE app_user LOGIN PASSWORD 'TROQUE-ESTA-SENHA' IN ROLE app_runtime;
```

6. Copie a string **pooled** (host com `-pooler`) do `app_user` — é a que vai para a API.
   **Não me envie essa string**; ela vai direto para o segredo do Worker.

---

## 3. Cloudflare — API (Worker) e front (Pages)

O projeto usa **dois serviços da Cloudflare, e os dois são obrigatórios** — não é escolha entre um e outro:

| | Pages (front) | Workers (API) |
|---|---|---|
| O que roda | React/Vite compilado (`dist`) | Hono, `api/src/index.ts` |
| Publica como | conectado ao GitHub, a cada `push` | `npx wrangler deploy` |
| URL | `https://SEU-APP.pages.dev` | `https://mindcare-api.SEU-SUBDOMINIO.workers.dev` |
| Guarda segredo | não | sim (`DATABASE_URL`, `JWT_SECRET`, `SETUP_TOKEN`) |

O front é estático; a API precisa de servidor (Postgres, RLS, JWT). Com só o Pages, o site abre e
**nenhuma** chamada funciona. Com só o Worker, a API responde mas não há tela — e o CORS recusa tudo,
porque não existe front em `ALLOWED_ORIGIN`. Ordem: **Neon → Worker → Pages → voltar ao Worker**
(itens 2, 3.1, 3.2 e 3.3).

### 3.1 Worker (API)

```powershell
cd api
npx wrangler login          # abre o navegador; é aqui que eu paro e você autoriza
npx wrangler secret put DATABASE_URL    # cole a string pooled do app_user
npx wrangler secret put JWT_SECRET      # openssl rand -base64 48  (ou qualquer 48 bytes aleatórios)
npx wrangler secret put SETUP_TOKEN     # guarde: só com ele se cria clínica
npx wrangler deploy
```

Anote a URL do Worker que o comando imprimir.

### 3.2 Pages (front)

Painel → *Workers & Pages → Create → Pages → Connect to Git* → escolha o repositório `mindcare`.
- Build command: `npm run build`
- Build output directory: `dist`
- Variável: `VITE_API_URL` = URL do Worker (sem barra no final)
- Variável: `NODE_VERSION` = `22`

Sem `VITE_API_URL` o build **falha de propósito** — é a proteção contra publicar um front cuja CSP
bloqueia a API.

### 3.3 Fechar o circuito (o passo que mais falha)

No `api/wrangler.toml`, troque **os dois** valores pela URL do Pages:

```toml
APP_URL = "https://mindcare.pages.dev"
ALLOWED_ORIGIN = "https://mindcare.pages.dev"
```

E publique de novo: `cd api; npx wrangler deploy`. Depois:

```powershell
$env:API_URL="https://mindcare-api.SEU-SUBDOMINIO.workers.dev"
$env:ALLOWED_ORIGIN="https://SEU-APP.pages.dev"
npm run smoke
```

Todas as linhas precisam sair com ✓.

---

## 4. Dois avisos específicos deste projeto

- **Não configure `TURNSTILE_SECRET`.** O captcha está incompleto no front (falta o widget e a CSP
  liberar `challenges.cloudflare.com`). Se ligar o segredo agora, login e aceite de convite passam a
  devolver 400. Detalhes em `ENDERECOS.md`, item 8.
- **O build local não roda nesta máquina** com o `npm run build` atual: os pacotes ficaram
  incompletos em `node_modules`. O Node aqui é o 22.16 oficial. Para validar localmente, rode
  `npm ci` de novo (e `npm ci` em `api/`); no Pages (Node 22 / Linux) o build funciona.

## 5. O que eu faço assim que você me passar

| Você fornece | Eu faço |
|---|---|
| URL do repositório GitHub | Confiro o envio, aviso se algo ficou fora |
| "loguei no wrangler" | Verifico `wrangler whoami`, publico a API e ajusto `APP_URL`/`ALLOWED_ORIGIN` |
| URL do Worker + URL do Pages | Aplico nos arquivos certos e rodo o `smoke` |
| `SETUP_TOKEN` (ou você roda o `curl`) | Crio a clínica e o primeiro administrador |

Nunca me envie: senha do painel, token do GitHub, `DATABASE_URL`, `JWT_SECRET`. Se precisar, rode você
o comando e me diga só o resultado.
