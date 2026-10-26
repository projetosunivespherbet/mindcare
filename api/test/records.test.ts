import { afterAll, describe, expect, it } from "vitest";
import { withSession } from "../src/db";
import { appPool, at, call, mkClinic, mkUser, ownerPool } from "./helpers";

afterAll(async () => {
  await appPool.end();
  await ownerPool.end();
});

async function cenario() {
  const c = await mkClinic();
  const psiA = await mkUser(c.adminToken, { nome: "Dra. Ana Lima", role: "psicologo", crp: "06/12345" });
  const rec = await mkUser(c.adminToken, { nome: "Rita Recepção", role: "recepcao" });
  const pac = (await call("POST", "/patients", { token: psiA.token, body: { nome: "Maria Souza", data_nascimento: "1990-05-10" } })).json;
  // Sessão realizada: é a única que recebe evolução.
  const s = await call("POST", "/appointments", {
    token: psiA.token,
    body: { patient_id: pac.id, starts_at: at(0, "10:00"), ends_at: at(0, "10:50") },
  });
  expect(s.status).toBe(201);
  await call("PATCH", `/appointments/${s.json.id}`, { token: psiA.token, body: { status: "realizado" } });
  return { ...c, psiA, rec, pac, appt: s.json };
}

const evoluir = (s: Awaited<ReturnType<typeof cenario>>, texto: string) =>
  call("POST", "/session-notes", { token: s.psiA.token, body: { appointment_id: s.appt.id, conteudo: texto } });

describe("evolução por sessão", () => {
  it("o psicólogo registra; a recepção não vê nem escreve; o admin vê a auditoria", async () => {
    const s = await cenario();
    const created = await evoluir(s, "Relatou melhora do sono. Trabalhamos respiração.");
    expect(created.status).toBe(201);

    // Recepção: sem acesso clínico.
    expect((await call("GET", `/patients/${s.pac.id}/session-notes`, { token: s.rec.token })).status).toBe(403);
    expect((await call("POST", "/session-notes", { token: s.rec.token, body: { appointment_id: s.appt.id, conteudo: "x" } })).status).toBe(403);

    // O autor lê a própria evolução.
    const lista = await call("GET", `/patients/${s.pac.id}/session-notes`, { token: s.psiA.token });
    expect(lista.status).toBe(200);
    expect(lista.json).toHaveLength(1);
    expect(lista.json[0].conteudo).toContain("melhora do sono");
    expect(lista.json[0].autor_nome).toBe("Dra. Ana Lima");
  });

  it("só o profissional que atendeu escreve, e só de sessão do próprio paciente", async () => {
    const s = await cenario();
    const psiB = await mkUser(s.adminToken, { nome: "Dr. Bruno Reis", role: "psicologo", crp: "06/54321" });
    // Outro psicólogo nem enxerga a sessão na listagem...
    expect((await call("GET", `/patients/${s.pac.id}/appointments`, { token: psiB.token })).json).toHaveLength(0);
    // ...e não pode gravar evolução na sessão do colega.
    const r = await call("POST", "/session-notes", { token: psiB.token, body: { appointment_id: s.appt.id, conteudo: "intruso" } });
    expect([403, 404]).toContain(r.status);
  });

  it("evolução não se edita nem se apaga, nem pela via direta do banco; correção é adendo", async () => {
    const s = await cenario();
    const n = await evoluir(s, "Primeira versão do registro.");
    const sessao = { userId: s.psiA.id, clinicId: s.clinicId, role: "psicologo" as const, atende: true };

    await expect(
      withSession(appPool as any, sessao, (db) => db.query("UPDATE session_notes SET conteudo = 'trocado' WHERE id = $1", [n.json.id])),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      withSession(appPool as any, sessao, (db) => db.query("DELETE FROM session_notes WHERE id = $1", [n.json.id])),
    ).rejects.toMatchObject({ code: "23514" });

    // O original continua intacto no banco.
    const orig = await ownerPool.query("SELECT conteudo FROM session_notes WHERE id = $1", [n.json.id]);
    expect(orig.rows[0].conteudo).toBe("Primeira versão do registro.");

    const ad = await call("POST", `/session-notes/${n.json.id}/adendo`, { token: s.psiA.token, body: { conteudo: "Complemento: paciente pediu para remarcar." } });
    expect(ad.status).toBe(201);
    const lista = (await call("GET", `/patients/${s.pac.id}/session-notes`, { token: s.psiA.token })).json;
    expect(lista).toHaveLength(2);
    expect(lista[1].adenda_de).toBe(n.json.id);
    // Cada evolução recebe no máximo um adendo.
    expect((await call("POST", `/session-notes/${n.json.id}/adendo`, { token: s.psiA.token, body: { conteudo: "outro" } })).status).toBe(409);
  });

  it("sessão cancelada não recebe evolução", async () => {
    const s = await cenario();
    await call("PATCH", `/appointments/${s.appt.id}`, { token: s.psiA.token, body: { status: "cancelado" } });
    const r = await evoluir(s, "registro indevido");
    expect(r.status).toBe(422);
  });

  it("histórico de atendimentos do paciente traz o profissional e a contagem de evoluções", async () => {
    const s = await cenario();
    await evoluir(s, "Registro.");
    const hist = await call("GET", `/patients/${s.pac.id}/appointments`, { token: s.psiA.token });
    expect(hist.status).toBe(200);
    expect(hist.json).toHaveLength(1);
    expect(hist.json[0].evolucoes).toBe(1);
    expect(hist.json[0].profissional_nome).toBe("Dra. Ana Lima");
    expect(hist.json[0].status).toBe("realizado");
  });
});

describe("consulta de auditoria", () => {
  it("o admin consulta os eventos da clínica, com o nome de quem agiu", async () => {
    const s = await cenario();
    await evoluir(s, "Registro para gerar auditoria.");
    const r = await call("GET", "/audit?limit=100", { token: s.adminToken });
    expect(r.status).toBe(200);
    const acoes = r.json.map((e: any) => e.action);
    expect(acoes).toContain("patient.create");
    expect(acoes).toContain("appointment.create");
    expect(acoes).toContain("session_note.create");
    const criou = r.json.find((e: any) => e.action === "session_note.create");
    expect(criou.user_nome).toBe("Dra. Ana Lima");
    // O conteúdo clínico não é copiado para a auditoria.
    expect(JSON.stringify(r.json)).not.toContain("Registro para gerar auditoria");
  });

  it("filtra por ação e por data; a lista de ações existe", async () => {
    const s = await cenario();
    const acoes = await call("GET", "/audit/actions", { token: s.adminToken });
    expect(acoes.status).toBe(200);
    expect(acoes.json).toContain("patient.create");
    const filtrado = await call("GET", "/audit?action=patient.create", { token: s.adminToken });
    expect(filtrado.json.every((e: any) => e.action === "patient.create")).toBe(true);
    const amanha = new Date(Date.now() + 86400000);
    const futuro = `${amanha.getFullYear()}-${String(amanha.getMonth() + 1).padStart(2, "0")}-${String(amanha.getDate()).padStart(2, "0")}`;
    expect((await call("GET", `/audit?from=${futuro}`, { token: s.adminToken })).json).toHaveLength(0);
  });

  it("psicólogo e recepção não consultam a auditoria", async () => {
    const s = await cenario();
    expect((await call("GET", "/audit", { token: s.psiA.token })).status).toBe(403);
    expect((await call("GET", "/audit", { token: s.rec.token })).status).toBe(403);
  });

  it("a auditoria não cruza clínicas", async () => {
    const s = await cenario();
    const outra = await mkClinic(); // create de clínica + login do admin dela
    await call("POST", "/patients", { token: s.adminToken, body: { nome: "Paciente da primeira" } });
    const r = await call("GET", "/audit?limit=500", { token: outra.adminToken });
    expect(r.status).toBe(200);
    expect(r.json.every((e: any) => e.entity !== "user" || e.user_nome !== "Dra. Ana Lima")).toBe(true);
  });
});
