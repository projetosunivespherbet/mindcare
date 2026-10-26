import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { audit, withSession } from "../db";
import { requireAuth } from "../middleware";
import type { AppEnv } from "../types";
import { isoDateTime, optText, readBody, readQuery } from "../validation";

const COLS = `id, patient_id, professional_id, starts_at, ends_at, tipo, status, valor::float8 AS valor,
              payment_status, convenio, imposto, series_id, created_at, updated_at`;
const MAX_RANGE_MS = 93 * 24 * 3600 * 1000;

const range = z.object({
  from: isoDateTime,
  to: isoDateTime,
  professional_id: z.uuid().optional(),
  patient_id: z.uuid().optional(),
});

function checkRange(from: string, to: string) {
  const span = new Date(to).getTime() - new Date(from).getTime();
  if (!(span > 0) || span > MAX_RANGE_MS) {
    throw new HTTPException(400, { message: "Informe um período válido de até 93 dias" });
  }
}

const appointmentFields = {
  tipo: z.enum(["individual", "grupo"]),
  status: z.enum(["agendado", "confirmado", "realizado", "faltou", "cancelado"]),
  valor: z.number().min(0).max(100000).nullable(),
  payment_status: z.enum(["pendente", "pago", "nao_pago"]),
  convenio: z.boolean(),
  imposto: z.boolean(),
};

export const appointments = new Hono<AppEnv>();
appointments.use("*", requireAuth);

appointments.get("/", async (c) => {
  const q = readQuery(c, range);
  checkRange(q.from, q.to);
  const rows = await withSession(c.get("pool"), c.get("session"), async (db) =>
    (
      await db.query(
        `SELECT ${COLS} FROM appointments
         WHERE starts_at >= $1 AND starts_at < $2
           AND ($3::uuid IS NULL OR professional_id = $3) AND ($4::uuid IS NULL OR patient_id = $4)
         ORDER BY starts_at`,
        [q.from, q.to, q.professional_id ?? null, q.patient_id ?? null],
      )
    ).rows,
  );
  return c.json(rows);
});

// Cria uma sessão ou uma série semanal; se qualquer data conflitar, nada é gravado.
appointments.post("/", async (c) => {
  const s = c.get("session");
  const body = await readBody(
    c,
    z.object({
      patient_id: z.uuid(),
      professional_id: z.uuid().optional(),
      starts_at: isoDateTime,
      ends_at: isoDateTime,
      tipo: appointmentFields.tipo.default("individual"),
      valor: appointmentFields.valor.optional(),
      convenio: z.boolean().default(false),
      imposto: z.boolean().default(false),
      recorrencia: z.object({ frequencia: z.literal("semanal"), ocorrencias: z.number().int().min(2).max(52) }).optional(),
    }),
  );
  const professionalId = s.role === "psicologo" ? s.userId : body.professional_id;
  if (!professionalId) throw new HTTPException(422, { message: "Informe o profissional" });
  const n = body.recorrencia?.ocorrencias ?? 1;

  const rows = await withSession(c.get("pool"), s, async (db) => {
    const patient = (await db.query("SELECT id FROM patients WHERE id = $1", [body.patient_id])).rows[0];
    if (!patient) throw new HTTPException(404, { message: "Paciente não encontrado" });

    const r = await db.query(
      `INSERT INTO appointments (clinic_id, patient_id, professional_id, starts_at, ends_at, tipo, valor, convenio, imposto, series_id, created_by)
       SELECT app_clinic(), $1, $2,
              (($3::timestamptz AT TIME ZONE c.timezone) + g.n * interval '7 days') AT TIME ZONE c.timezone,
              (($4::timestamptz AT TIME ZONE c.timezone) + g.n * interval '7 days') AT TIME ZONE c.timezone,
              $5, $6, $7, $8, $10::uuid, app_user()
       FROM clinics c, generate_series(0, $9::int - 1) AS g(n)
       WHERE c.id = app_clinic()
       RETURNING ${COLS}`,
      [body.patient_id, professionalId, body.starts_at, body.ends_at, body.tipo, body.valor ?? null, body.convenio, body.imposto, n,
       n > 1 ? crypto.randomUUID() : null],
    );
    await audit(db, s, "appointment.create", "appointment", r.rows[0].id);
    return r.rows.sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());
  });
  return c.json(n > 1 ? rows : rows[0], 201);
});

appointments.patch("/:id", async (c) => {
  const s = c.get("session");
  const body = await readBody(
    c,
    z.object({
      ...appointmentFields,
      starts_at: isoDateTime,
      ends_at: isoDateTime,
      professional_id: z.uuid(),
    }).partial(),
  );
  if (s.role === "psicologo" && body.professional_id !== undefined) {
    throw new HTTPException(403, { message: "Apenas a administração ou a recepção troca o profissional" });
  }
  const entries = Object.entries(body).filter(([, v]) => v !== undefined);
  if (entries.length === 0) throw new HTTPException(400, { message: "Nada para atualizar" });

  const row = await withSession(c.get("pool"), s, async (db) => {
    const sets = entries.map(([k], i) => `${k} = $${i + 2}`).join(", ");
    const r = await db.query(`UPDATE appointments SET ${sets} WHERE id = $1 RETURNING ${COLS}`, [
      c.req.param("id"),
      ...entries.map(([, v]) => v),
    ]);
    if (r.rows[0]) await audit(db, s, "appointment.update", "appointment", r.rows[0].id);
    return r.rows[0];
  });
  if (!row) throw new HTTPException(404, { message: "Sessão não encontrada" });
  return c.json(row);
});

export const blocks = new Hono<AppEnv>();
blocks.use("*", requireAuth);

blocks.get("/", async (c) => {
  const q = readQuery(c, range.pick({ from: true, to: true, professional_id: true }));
  checkRange(q.from, q.to);
  const rows = await withSession(c.get("pool"), c.get("session"), async (db) =>
    (
      await db.query(
        `SELECT id, professional_id, starts_at, ends_at, motivo FROM time_blocks
         WHERE starts_at < $2 AND ends_at > $1 AND ($3::uuid IS NULL OR professional_id = $3) ORDER BY starts_at`,
        [q.from, q.to, q.professional_id ?? null],
      )
    ).rows,
  );
  return c.json(rows);
});

blocks.post("/", async (c) => {
  const s = c.get("session");
  const body = await readBody(
    c,
    z.object({ professional_id: z.uuid().optional(), starts_at: isoDateTime, ends_at: isoDateTime, motivo: optText(200) }),
  );
  const professionalId = s.role === "psicologo" ? s.userId : body.professional_id;
  if (!professionalId) throw new HTTPException(422, { message: "Informe o profissional" });
  if (new Date(body.ends_at) <= new Date(body.starts_at)) {
    throw new HTTPException(422, { message: "Horário inválido: o início deve ser antes do fim" });
  }

  const row = await withSession(c.get("pool"), s, async (db) => {
    const clash = await db.query(
      `SELECT 1 FROM appointments WHERE professional_id = $1 AND status <> 'cancelado' AND starts_at < $3 AND ends_at > $2 LIMIT 1`,
      [professionalId, body.starts_at, body.ends_at],
    );
    if (clash.rows.length > 0) throw new HTTPException(409, { message: "Há sessões marcadas neste período" });
    const r = await db.query(
      `INSERT INTO time_blocks (clinic_id, professional_id, starts_at, ends_at, motivo, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, professional_id, starts_at, ends_at, motivo`,
      [s.clinicId, professionalId, body.starts_at, body.ends_at, body.motivo ?? null, s.userId],
    );
    return r.rows[0];
  });
  return c.json(row, 201);
});

blocks.delete("/:id", async (c) => {
  const done = await withSession(c.get("pool"), c.get("session"), async (db) =>
    (await db.query("DELETE FROM time_blocks WHERE id = $1 RETURNING id", [c.req.param("id")])).rows.length,
  );
  if (!done) throw new HTTPException(404, { message: "Bloqueio não encontrado" });
  return c.body(null, 204);
});
