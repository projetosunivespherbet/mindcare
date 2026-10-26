import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { audit, withSession } from "../db";
import { requireAuth, requireRole } from "../middleware";
import type { AppEnv } from "../types";
import { dateOnly, isoDateTime, readBody, readQuery } from "../validation";

// ================================================================ evolução por sessão

const NOTE_COLS = `n.id, n.appointment_id, n.patient_id, n.professional_id, n.conteudo, n.adenda_de,
  n.created_by, n.created_at, u.nome AS autor_nome, a.starts_at`;

export const notes = new Hono<AppEnv>();
notes.use("*", requireAuth);

// Só quem atende escreve; a recepção nunca (a RLS também barra).
notes.post("/", requireRole("admin", "psicologo"), async (c) => {
  const s = c.get("session");
  const body = await readBody(
    c,
    z.object({
      appointment_id: z.uuid(),
      conteudo: z.string().trim().min(1, "A evolução não pode ficar vazia").max(20000),
    }),
  );
  const row = await withSession(c.get("pool"), s, async (db) => {
    const appt = (await db.query("SELECT patient_id, professional_id FROM appointments WHERE id = $1 AND clinic_id = $2", [body.appointment_id, s.clinicId])).rows[0];
    if (!appt) throw new HTTPException(404, { message: "Sessão não encontrada" });
    if (appt.professional_id !== s.userId) {
      throw new HTTPException(403, { message: "Só o profissional que atendeu registra a evolução" });
    }
    const r = await db.query(
      `INSERT INTO session_notes (clinic_id, appointment_id, patient_id, professional_id, conteudo, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, created_at`,
      [s.clinicId, body.appointment_id, appt.patient_id, s.userId, body.conteudo, s.userId],
    );
    await audit(db, s, "session_note.create", "session_note", r.rows[0].id);
    return r.rows[0];
  });
  return c.json(row, 201);
});

// Adendo: corrige/complementa sem apagar o que foi escrito. Exige motivo visível no próprio texto.
notes.post("/:id/adendo", requireRole("admin", "psicologo"), async (c) => {
  const s = c.get("session");
  const body = await readBody(c, z.object({ conteudo: z.string().trim().min(1).max(20000) }));
  const row = await withSession(c.get("pool"), s, async (db) => {
    const orig = (
      await db.query("SELECT id, appointment_id, patient_id, professional_id FROM session_notes WHERE id = $1 AND clinic_id = $2", [c.req.param("id"), s.clinicId])
    ).rows[0];
    if (!orig) throw new HTTPException(404, { message: "Evolução não encontrada" });
    if (orig.professional_id !== s.userId) throw new HTTPException(403, { message: "Só o autor registra o adendo" });
    const r = await db.query(
      `INSERT INTO session_notes (clinic_id, appointment_id, patient_id, professional_id, conteudo, adenda_de, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, created_at`,
      [s.clinicId, orig.appointment_id, orig.patient_id, orig.professional_id, body.conteudo, orig.id, s.userId],
    );
    await audit(db, s, "session_note.adendo", "session_note", r.rows[0].id);
    return r.rows[0];
  });
  return c.json(row, 201);
});

// ================================================================ histórico de sessões do paciente

const APPT_COLS = `a.id, a.patient_id, a.professional_id, u.nome AS profissional_nome, a.starts_at, a.ends_at, a.tipo,
  a.status, a.valor::float8 AS valor, a.payment_status, a.convenio, a.series_id,
  (SELECT count(*) FROM session_notes n WHERE n.appointment_id = a.id)::int AS evolucoes`;

export const patientHistory = new Hono<AppEnv>();
patientHistory.use("*", requireAuth);

// Linha do tempo do paciente. Como no resto do produto, a RLS decide o que cada perfil vê.
patientHistory.get("/:id/appointments", async (c) => {
  const q = readQuery(
    c,
    z.object({ from: isoDateTime.optional(), to: isoDateTime.optional(), limit: z.coerce.number().int().min(1).max(500).default(200) }),
  );
  if (!!q.from !== !!q.to) throw new HTTPException(400, { message: "Informe from e to juntos" });
  const rows = await withSession(c.get("pool"), c.get("session"), async (db) =>
    (
      await db.query(
        `SELECT ${APPT_COLS}
           FROM appointments a
           LEFT JOIN users u ON u.id = a.professional_id
          WHERE a.patient_id = $1
            AND ($2::timestamptz IS NULL OR (a.starts_at >= $2::timestamptz AND a.starts_at < $3::timestamptz))
          ORDER BY a.starts_at DESC LIMIT $4`,
        [c.req.param("id"), q.from ?? null, q.to ?? null, q.limit],
      )
    ).rows,
  );
  return c.json(rows);
});

// Evolução do paciente, em ordem cronológica, com o adendo visível abaixo do registro corrigido.
patientHistory.get("/:id/session-notes", async (c) => {
  const s = c.get("session");
  if (s.role === "recepcao") throw new HTTPException(403, { message: "Sem permissão para dados clínicos" });
  const rows = await withSession(c.get("pool"), s, async (db) => {
    const r = await db.query(
      `SELECT ${NOTE_COLS}
         FROM session_notes n
         JOIN users u ON u.id = n.created_by
         JOIN appointments a ON a.id = n.appointment_id
        WHERE n.patient_id = $1
        ORDER BY n.created_at`,
      [c.req.param("id")],
    );
    await audit(db, s, "patient.view_clinical", "patient", c.req.param("id"));
    return r.rows;
  });
  return c.json(rows);
});

// ================================================================ auditoria

export const auditLog = new Hono<AppEnv>();
auditLog.use("*", requireRole("admin"));

auditLog.get("/", async (c) => {
  const q = readQuery(
    c,
    z.object({
      from: dateOnly.optional(),
      to: dateOnly.optional(),
      action: z.string().trim().max(60).optional(),
      user_id: z.uuid().optional(),
      limit: z.coerce.number().int().min(1).max(500).default(200),
    }),
  );
  const rows = await withSession(c.get("pool"), c.get("session"), async (db) =>
    (
      await db.query(
        `SELECT v.id, v.at, v.action, v.entity, v.entity_id, v.user_id, v.user_nome
           FROM audit_view v
          WHERE ($1::date IS NULL OR (v.at AT TIME ZONE (SELECT timezone FROM clinics WHERE id = app_clinic()))::date >= $1::date)
            AND ($2::date IS NULL OR (v.at AT TIME ZONE (SELECT timezone FROM clinics WHERE id = app_clinic()))::date <= $2::date)
            AND ($3::text IS NULL OR v.action = $3)
            AND ($4::uuid IS NULL OR v.user_id = $4)
          ORDER BY v.at DESC LIMIT $5`,
        [q.from ?? null, q.to ?? null, q.action ?? null, q.user_id ?? null, q.limit],
      )
    ).rows,
  );
  return c.json(rows);
});

// Ações distintas, para montar o filtro sem chutar a lista.
auditLog.get("/actions", async (c) => {
  const rows = await withSession(c.get("pool"), c.get("session"), async (db) =>
    (await db.query("SELECT DISTINCT action FROM audit_view ORDER BY action")).rows,
  );
  return c.json(rows.map((r) => String(r.action)));
});
