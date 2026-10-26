// Teste de ponta a ponta: telas reais do React + API real (Hono) + Postgres de verdade.
// O fetch do navegador é ligado direto ao app da API, sem rede. Só roda com E2E_PG=1 e um Postgres local
// (usuário mc_owner com CREATEDB/CREATEROLE; veja api/README.md).
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { webcrypto } from "node:crypto";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../api/src/app";
import type { DbPool } from "../../api/src/db";
import { APP_URL_DB, OWNER_ADMIN_URL } from "../../api/test/env";

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pg: any = require("../../api/node_modules/pg");

const OWNER_E2E = OWNER_ADMIN_URL.replace(/\/postgres$/, "/mindcare_e2e");
const APP_E2E = APP_URL_DB.replace(/\/mindcare_test$/, "/mindcare_e2e");
const env = {
  DATABASE_URL: APP_E2E,
  JWT_SECRET: "segredo-e2e-com-tamanho-suficiente-1234567",
  SETUP_TOKEN: "setup-e2e",
  APP_URL: "http://localhost:3000",
  ALLOWED_ORIGIN: "http://localhost:3000",
  SCRYPT_N: "1024",
};
const PASSWORD = "Senha@1234";

describe.skipIf(!process.env.E2E_PG)("fluxo completo: telas + API + Postgres", () => {
  let pool: DbPool;
  let app: ReturnType<typeof createApp>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const seed: Record<string, any> = {};

  const call = async (method: string, path: string, opts: { token?: string; body?: unknown; headers?: Record<string, string> } = {}) => {
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    const res = await app.request(path, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }, env);
    return { status: res.status, json: await res.json().catch(() => null) };
  };

  const openApp = async (path: string, token?: string) => {
    localStorage.clear();
    if (token) localStorage.setItem("mindcare.token", token);
    window.history.pushState({}, "", path);
    vi.resetModules(); // cache do React Query novo a cada tela
    const { default: App } = await import("@/App");
    render(<App />);
  };

  beforeAll(async () => {
    Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
    const admin = new pg.Client({ connectionString: OWNER_ADMIN_URL });
    await admin.connect();
    await admin.query("DROP DATABASE IF EXISTS mindcare_e2e WITH (FORCE)");
    await admin.query("CREATE DATABASE mindcare_e2e");
    await admin.end();
    execFileSync("node", ["api/scripts/migrate.mjs"], { env: { ...process.env, DATABASE_URL: OWNER_E2E }, stdio: "ignore" });
    const owner = new pg.Client({ connectionString: OWNER_E2E });
    await owner.connect();
    await owner.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mc_app') THEN
      CREATE ROLE mc_app LOGIN PASSWORD 'app_pw' IN ROLE app_runtime; END IF; END $$`);
    await owner.end();

    pool = new pg.Pool({ connectionString: APP_E2E });
    app = createApp({ getPool: () => pool });
    vi.stubGlobal("fetch", (input: string, init?: RequestInit) => Promise.resolve(app.request(input, init, env)));

    // dados de apoio, criados pela própria API
    seed.adminEmail = "admin@clinica.test";
    await call("POST", "/platform/clinics", {
      headers: { "x-setup-token": env.SETUP_TOKEN },
      body: { clinic_nome: "Clínica E2E", admin_nome: "Ada Admin", email: seed.adminEmail, password: PASSWORD },
    });
    seed.adminToken = (await call("POST", "/auth/login", { body: { email: seed.adminEmail, password: PASSWORD } })).json.token;
    const created = await call("POST", "/users", { token: seed.adminToken, body: { nome: "Dra. Ana Lima", role: "psicologo", crp: "06/12345" } });
    seed.inviteToken = created.json.invite.link.split("/convite/")[1];
    const second = await call("POST", "/users", { token: seed.adminToken, body: { nome: "Dr. Bruno Reis", role: "psicologo", crp: "06/54321" } });
    const bruno = await call("POST", "/invites/accept", { body: { token: second.json.invite.link.split("/convite/")[1], email: "bruno@clinica.test", password: PASSWORD } });
    seed.brunoToken = bruno.json.token;
  });

  afterEach(() => cleanup());
  beforeEach(() => localStorage.clear());
  afterAll(async () => {
    await pool?.end();
  });

  it("administrador entra pela tela de login e vê o menu de administração", async () => {
    await openApp("/entrar");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("E-mail"), seed.adminEmail);
    await user.type(screen.getByLabelText("Senha"), PASSWORD);
    await user.click(screen.getByRole("button", { name: "Entrar" }));
    expect(await screen.findByRole("heading", { name: "Pacientes" })).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Principal" });
    expect(within(nav).getByText("Usuários")).toBeInTheDocument();
    expect(within(nav).getByText("Papel timbrado")).toBeInTheDocument();
    expect(within(nav).queryByText("Documentos")).not.toBeInTheDocument(); // admin que não atende não produz documentos
    expect(screen.getByText("Clínica E2E")).toBeInTheDocument();
  });

  it("senha errada mostra o erro e não entra", async () => {
    await openApp("/entrar");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("E-mail"), seed.adminEmail);
    await user.type(screen.getByLabelText("Senha"), "Errada@123");
    await user.click(screen.getByRole("button", { name: "Entrar" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Entrar" })).toBeEnabled());
    expect(screen.queryByRole("heading", { name: "Pacientes" })).not.toBeInTheDocument();
  });

  it("psicólogo conclui o cadastro pelo link de convite e já entra", async () => {
    await openApp(`/convite/${seed.inviteToken}`);
    const user = userEvent.setup();
    expect(await screen.findByText("Olá, Dra. Ana Lima")).toBeInTheDocument();
    await user.type(screen.getByLabelText("E-mail"), "ana@clinica.test");
    await user.type(screen.getByLabelText("Senha"), PASSWORD);
    await user.type(screen.getByLabelText("Confirmar senha"), PASSWORD);
    await user.click(screen.getByRole("button", { name: "Concluir cadastro" }));
    expect(await screen.findByRole("heading", { name: "Pacientes" })).toBeInTheDocument();
    expect(screen.getByText("Dra. Ana Lima")).toBeInTheDocument();
    expect(within(screen.getByRole("navigation", { name: "Principal" })).getByText("Documentos")).toBeInTheDocument();
    seed.anaToken = localStorage.getItem("mindcare.token");
  });

  it("o link de convite não vale duas vezes", async () => {
    await openApp(`/convite/${seed.inviteToken}`);
    expect(await screen.findByText("Convite inválido ou expirado")).toBeInTheDocument();
  });

  it("psicólogo vê o próprio paciente, seus documentos e abre o documento emitido", async () => {
    const pac = (await call("POST", "/patients", { token: seed.anaToken, body: { nome: "Maria Souza", data_nascimento: "1990-05-10" } })).json;
    await call("PUT", `/patients/${pac.id}/anamnesis`, { token: seed.anaToken, body: { queixa_principal: "Ansiedade" } });
    const draft = (await call("POST", "/documents", { token: seed.anaToken, body: { patient_id: pac.id, tipo: "declaracao", finalidade: "Comprovar comparecimento", conteudo: { registro: "Compareceu hoje." } } })).json;
    const emitted = (await call("POST", `/documents/${draft.id}/emit`, { token: seed.anaToken, body: {} })).json;
    const rascunho = (await call("POST", "/documents", { token: seed.anaToken, body: { patient_id: pac.id, tipo: "encaminhamento" } })).json;
    seed.emitted = emitted;
    seed.patient = pac;

    await openApp("/pacientes", seed.anaToken);
    expect(await screen.findByRole("link", { name: "Maria Souza" })).toBeInTheDocument();
    cleanup();

    await openApp("/documentos", seed.anaToken);
    expect(await screen.findAllByText("Declaração")).not.toHaveLength(0);
    expect(screen.getByText(emitted.numero)).toBeInTheDocument();
    expect(screen.getByText("Emitido")).toBeInTheDocument();
    expect(screen.getByText("Rascunho")).toBeInTheDocument();
    cleanup();

    await openApp(`/documentos/${emitted.id}`, seed.anaToken);
    expect(await screen.findByRole("button", { name: /Baixar PDF/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Anular documento/ })).toBeInTheDocument();
    expect(screen.getByLabelText("Finalidade")).toBeDisabled(); // emitido é somente leitura
    cleanup();

    await openApp(`/documentos/${rascunho.id}`, seed.anaToken);
    expect(await screen.findByRole("button", { name: /Emitir documento/ })).toBeInTheDocument();
    expect(screen.getByLabelText("Título")).toBeEnabled();
    cleanup();

    await openApp(`/pacientes/${pac.id}`, seed.anaToken);
    expect(await screen.findByRole("heading", { name: "Maria Souza" })).toBeInTheDocument();
  });

  it("outro psicólogo não enxerga o paciente nem os documentos", async () => {
    await openApp("/pacientes", seed.brunoToken);
    expect(await screen.findByRole("heading", { name: "Pacientes" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Nenhum paciente encontrado.")).toBeInTheDocument());
    cleanup();
    await openApp(`/documentos/${seed.emitted.id}`, seed.brunoToken);
    expect(await screen.findByText("Documento não encontrado.")).toBeInTheDocument();
  });

  it("rotas de administração redirecionam quem não é admin", async () => {
    await openApp("/usuarios", seed.anaToken);
    expect(await screen.findByRole("heading", { name: "Pacientes" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Usuários" })).not.toBeInTheDocument();
  });

  it("administração lista a equipe e os papéis timbrados", async () => {
    await call("POST", "/letterheads", { token: seed.adminToken, body: { nome: "Papel da clínica", modo: "padrao", linhas: ["Clínica E2E"], is_default: true } });
    await openApp("/usuarios", seed.adminToken);
    expect(await screen.findByText("Dra. Ana Lima")).toBeInTheDocument();
    expect(screen.getByText("Dr. Bruno Reis")).toBeInTheDocument();
    cleanup();
    await openApp("/papel-timbrado", seed.adminToken);
    expect(await screen.findByText("Papel da clínica")).toBeInTheDocument();
    expect(screen.getByText("Padrão")).toBeInTheDocument();
  });

  it("verificação pública confirma o documento sem login e sem expor o paciente", async () => {
    await openApp(`/verificar/${seed.emitted.codigo}`);
    expect(await screen.findByText("Documento autêntico e válido")).toBeInTheDocument();
    expect(screen.getByText(/Dra\. Ana Lima — CRP 06\/12345/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Maria|Souza/);
    cleanup();
    await openApp("/verificar/ZZZZZZZZZZZZ");
    expect(await screen.findByText("Documento não encontrado")).toBeInTheDocument();
  });

  it("sessão inválida volta para o login", async () => {
    await openApp("/pacientes", "token-invalido");
    expect(await screen.findByText("Entrar na sua conta")).toBeInTheDocument();
  });
});
