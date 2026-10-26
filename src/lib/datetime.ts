/**
 * Datas e horários do front. O servidor guarda instantes (ISO com fuso) e a clínica tem um `timezone`.
 * A agenda é montada no fuso do **navegador**, que é o de quem usa — para uma clínica em São Paulo isso
 * coincide com o da clínica. A comparação "é hoje?" usa os dois lados no mesmo fuso, nunca string crua.
 */

const pad = (n: number) => String(n).padStart(2, "0");

/** Date → "AAAA-MM-DD" no fuso local (não usa toISOString, que converte para UTC e erra perto da meia-noite). */
export const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Date → "HH:MM" local. */
export const hhmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** Momento atual. Existe para os testes poderem fixar o relógio com `vi.setSystemTime`, sem mock de módulo. */
export const now = () => new Date();

export const today = () => isoDate(now());

/** "AAAA-MM-DD" + "HH:MM" → Date local. */
export const atLocal = (day: string, time: string) => {
  const [y, m, d] = day.split("-").map(Number);
  const [h, min] = time.split(":").map(Number);
  return new Date(y, m - 1, d, h, min, 0, 0);
};

/** Date → ISO 8601 **com deslocamento local** (o que a API exige: `2030-03-04T10:00:00-03:00`). */
export const toIsoWithOffset = (d: Date) => {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const abs = Math.abs(off);
  return `${isoDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:00${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
};

/** Soma minutos a um ISO e devolve ISO com fuso. */
export const addMinutes = (iso: string, minutes: number) => toIsoWithOffset(new Date(new Date(iso).getTime() + minutes * 60_000));

/** Segunda-feira da semana de `d` (semana começa na segunda). */
export function startOfWeek(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = x.getDay(); // 0 = domingo
  x.setDate(x.getDate() + (day === 0 ? -6 : 1 - day));
  return x;
}

export const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};

export const WEEKDAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

/** "2030-03-04T10:00:00-03:00" → "10:00" no fuso do navegador. */
export const timeOf = (iso: string) => hhmm(new Date(iso));

/** "2030-03-04T10:00:00-03:00" → "04/03/2030 10:00". */
export const dateTimeBR = (iso: string) => `${new Date(iso).toLocaleDateString("pt-BR")} ${timeOf(iso)}`;

/** "2026-10-25T13:42:10Z" → "25/10/2026 13:42". */
export const dateTimeShort = dateTimeBR;

/** ISO com fuso → "AAAA-MM-DD" no fuso do navegador (para filtros da API, que recebem date-only). */
export const dayOf = (iso: string) => isoDate(new Date(iso));

/** Primeiro e último dia do mês corrente, em "AAAA-MM-DD". */
export function currentMonthRange() {
  const n = now();
  return {
    from: isoDate(new Date(n.getFullYear(), n.getMonth(), 1)),
    to: isoDate(new Date(n.getFullYear(), n.getMonth() + 1, 0)),
  };
}
