import { afterEach, describe, expect, it, vi } from "vitest";
import { addDays, addMinutes, atLocal, currentMonthRange, dayOf, hhmm, isoDate, startOfWeek, timeOf, toIsoWithOffset } from "./datetime";

// Testes rodam com o relógio fixo para não depender da data de execução.
const FIXO = new Date(2030, 2, 6, 14, 30); // quarta-feira, 06/03/2030 14:30 local
afterEach(() => vi.useRealTimers());

describe("conversões de data", () => {
  it("formata no fuso local, sem passar por UTC", () => {
    expect(isoDate(new Date(2030, 2, 6, 23, 59))).toBe("2030-03-06");
    expect(isoDate(new Date(2030, 0, 1, 0, 5))).toBe("2030-01-01");
    expect(hhmm(new Date(2030, 2, 6, 9, 5))).toBe("09:05");
  });

  it("gera ISO 8601 com o deslocamento local, que é o que a API exige", () => {
    // Meia-noite é o caso que costuma quebrar com toISOString (vira o dia anterior em UTC−3).
    const iso = toIsoWithOffset(new Date(2030, 2, 4, 0, 0));
    expect(iso.startsWith("2030-03-04T00:00:00")).toBe(true);
    expect(iso).toMatch(/[+-]\d{2}:\d{2}$/);
    expect(new Date(iso).getTime()).toBe(new Date(2030, 2, 4, 0, 0).getTime());
  });

  it("monta e lê horários de ida e volta", () => {
    const d = atLocal("2030-03-04", "10:30");
    expect(d.getHours()).toBe(10);
    expect(timeOf(toIsoWithOffset(d))).toBe("10:30");
  });

  it("calcula fim da sessão somando minutos", () => {
    const ini = atLocal("2030-03-04", "10:00");
    expect(timeOf(addMinutes(toIsoWithOffset(ini), 50))).toBe("10:50");
  });
});

describe("semana", () => {
  it("começa na segunda-feira", () => {
    expect(isoDate(startOfWeek(FIXO))).toBe("2030-03-04"); // segunda
    expect(isoDate(startOfWeek(new Date(2030, 2, 10)))).toBe("2030-03-04"); // domingo cai na segunda anterior
    expect(isoDate(startOfWeek(new Date(2030, 2, 4)))).toBe("2030-03-04"); // segunda continua segunda
  });

  it("avança dias", () => {
    expect(isoDate(addDays(FIXO, 7))).toBe("2030-03-13");
  });
});

describe("filtros", () => {
  it("extrai o dia de um ISO com fuso", () => {
    expect(dayOf(toIsoWithOffset(atLocal("2030-03-04", "10:00")))).toBe("2030-03-04");
  });

  it("devolve o mês corrente completo", () => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXO);
    expect(currentMonthRange()).toEqual({ from: "2030-03-01", to: "2030-03-31" });
    vi.setSystemTime(new Date(2031, 1, 10)); // fevereiro de 2031 tem 28 dias
    expect(currentMonthRange()).toEqual({ from: "2031-02-01", to: "2031-02-28" });
  });
});
