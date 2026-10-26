import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CalendarDays, Users, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import { api, errMsg } from "@/lib/api";
import { addDays, currentMonthRange, dateTimeBR, isoDate, startOfWeek, toIsoWithOffset, today } from "@/lib/datetime";
import { brl } from "@/lib/money";
import { APPOINTMENT_STATUS, type Appointment, type AppointmentStatus, type Charge, type FinanceSummary, type Patient } from "@/lib/types";

function Indicador({ titulo, valor, detalhe, destaque }: { titulo: string; valor: string; detalhe?: string; destaque?: boolean }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-xs text-muted-foreground">{titulo}</p>
      <p className={`text-2xl font-semibold ${destaque ? "text-destructive" : ""}`}>{valor}</p>
      {detalhe && <p className="text-xs text-muted-foreground mt-1">{detalhe}</p>}
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const semanaIni = startOfWeek(new Date());
  const from = toIsoWithOffset(semanaIni);
  const to = toIsoWithOffset(addDays(semanaIni, 7));
  const mes = currentMonthRange();
  const agora = new Date().toISOString();

  const semana = useQuery({
    queryKey: ["appointments", from, to, "dashboard"],
    queryFn: () => api<Appointment[]>(`/appointments?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
  });
  const resumo = useQuery({
    queryKey: ["finance-summary", mes.from, mes.to],
    queryFn: () => api<FinanceSummary>(`/finance/summary?from=${mes.from}&to=${mes.to}`),
  });
  const pacientes = useQuery({ queryKey: ["patients", "", "dashboard"], queryFn: () => api<Patient[]>("/patients?ativo=true") });
  const abertas = useQuery({
    queryKey: ["charges", "abertas", "dashboard"],
    queryFn: () => api<Charge[]>(`/charges?from=${mes.from}&to=${mes.to}&status=aberta`),
  });

  const proximas = useMemo(
    () =>
      (semana.data ?? [])
        .filter((a) => a.starts_at >= agora && a.status !== "cancelado")
        .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
        .slice(0, 6),
    [semana.data, agora],
  );

  const doDia = (semana.data ?? []).filter((a) => isoDate(new Date(a.starts_at)) === today());
  const realizadas = doDia.filter((a) => a.status === "realizado").length;
  const faltas = (semana.data ?? []).filter((a) => a.status === "faltou").length;
  const s = resumo.data;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Olá, {user?.nome.split(" ")[0]}</h1>
        <p className="text-sm text-muted-foreground">Resumo da semana e do mês. {user?.clinic_nome}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Indicador titulo="Sessões hoje" valor={String(doDia.length)} detalhe={`${realizadas} realizada(s) · ${doDia.length - realizadas} por fazer`} />
        <Indicador titulo="Nesta semana" valor={String(semana.data?.length ?? 0)} detalhe={`${faltas} falta(s)`} />
        <Indicador titulo="Pacientes ativos" valor={String(pacientes.data?.length ?? 0)} />
        <Indicador titulo="Cobranças em aberto no mês" valor={String(abertas.data?.length ?? 0)} detalhe={brl(abertas.data?.reduce((n, c) => n + c.saldo_centavos, 0) ?? 0)} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Indicador titulo="Faturado no mês" valor={brl(s?.faturado_centavos ?? 0)} />
        <Indicador titulo="Recebido no mês" valor={brl(s?.recebido_centavos ?? 0)} />
        <Indicador titulo="A receber" valor={brl(s?.em_aberto_centavos ?? 0)} />
        <Indicador titulo="Atrasado" valor={brl(s?.atrasado_centavos ?? 0)} destaque={(s?.atrasado_centavos ?? 0) > 0} />
      </div>

      {(semana.isError || resumo.isError) && (
        <p className="text-sm text-destructive">{errMsg(semana.error ?? resumo.error, "Não foi possível carregar o resumo.")}</p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <CalendarDays className="w-4 h-4" /> Próximas sessões
            </CardTitle>
            <Button asChild size="sm" variant="ghost">
              <Link to="/agenda">Agenda <ArrowRight className="w-3 h-3 ml-1" /></Link>
            </Button>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {proximas.map((a) => {
                const st = APPOINTMENT_STATUS[a.status as AppointmentStatus] ?? APPOINTMENT_STATUS.agendado;
                return (
                  <li key={a.id} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <Link to={`/pacientes/${a.patient_id}`} className="font-medium text-primary hover:underline truncate block">
                        {a.patient_nome ?? "Paciente"}
                      </Link>
                      <p className="text-xs text-muted-foreground">{dateTimeBR(a.starts_at)}</p>
                    </div>
                    <Badge variant={st.variant}>{st.label}</Badge>
                  </li>
                );
              })}
              {proximas.length === 0 && (
                <li className="py-6 text-center text-sm text-muted-foreground">
                  Nenhuma sessão a caminho. <Link to="/agenda" className="text-primary hover:underline">Agendar</Link>.
                </li>
              )}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Wallet className="w-4 h-4" /> Cobranças em aberto
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {(abertas.data ?? []).slice(0, 6).map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{c.paciente_nome ?? "—"}</p>
                    <p className="text-xs text-muted-foreground">
                      {c.competencia.slice(5, 7)}/{c.competencia.slice(0, 4)} · saldo {brl(c.saldo_centavos)}
                    </p>
                  </div>
                  {c.atrasada ? <Badge variant="destructive">Atrasada</Badge> : <Badge variant="secondary">Em aberto</Badge>}
                </li>
              ))}
              {(abertas.data?.length ?? 0) === 0 && (
                <li className="py-6 text-center text-sm text-muted-foreground">Nada em aberto no mês.</li>
              )}
            </ul>
            <div className="mt-3 flex justify-end">
              <Button asChild size="sm" variant="ghost">
                <Link to="/financeiro">Financeiro <ArrowRight className="w-3 h-3 ml-1" /></Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="pt-4 flex-wrap gap-3 text-xs text-muted-foreground">
          <Users className="w-4 h-4 shrink-0" />
          <p>
            Os valores seguem o que o seu perfil pode ver: o psicólogo vê as próprias cobranças; a administração e a
            recepção veem a clínica.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
