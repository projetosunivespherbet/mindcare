import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Receipt } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChargeDetailDialog, ReceiveDialog } from "@/components/PatientCharges";
import { useAuth } from "@/contexts/AuthContext";
import { API_URL, api, errMsg } from "@/lib/api";
import { currentMonthRange, isoDate, today } from "@/lib/datetime";
import { brl, dateBR, monthLabel } from "@/lib/money";
import type { Charge, ChargeStatus, FinanceSummary } from "@/lib/types";
import { ProfessionalSelect } from "./Patients";

const STATUS: Record<ChargeStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  aberta: { label: "Em aberto", variant: "secondary" },
  parcial: { label: "Parcial", variant: "outline" },
  paga: { label: "Paga", variant: "default" },
  cancelada: { label: "Cancelada", variant: "destructive" },
};

const filterStatus = ["todos", "aberta", "parcial", "paga", "cancelada"] as const;
type FilterStatus = (typeof filterStatus)[number];

function Indicador({ titulo, valor, alerta }: { titulo: string; valor: string; alerta?: boolean }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-xs text-muted-foreground">{titulo}</p>
      <p className={`text-xl font-semibold ${alerta ? "text-destructive" : ""}`}>{valor}</p>
    </div>
  );
}

export default function Finance() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [mes, setMes] = useState<{ from: string; to: string }>(currentMonthRange());
  const [status, setStatus] = useState<FilterStatus>("todos");
  const [professional, setProfessional] = useState("");
  const [receiving, setReceiving] = useState<Charge | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [gerando, setGerando] = useState<{ from: string; to: string } | null>(null);

  const summary = useQuery({
    queryKey: ["finance-summary", mes.from, mes.to],
    queryFn: () => api<FinanceSummary>(`/finance/summary?from=${mes.from}&to=${mes.to}`),
  });

  const charges = useQuery({
    queryKey: ["charges", mes.from, mes.to, status, professional],
    queryFn: () =>
      api<Charge[]>(
        `/charges?from=${mes.from}&to=${mes.to}${status !== "todos" ? `&status=${status}` : ""}${professional ? `&professional_id=${professional}` : ""}`,
      ),
  });

  const gerar = useMutation({
    mutationFn: (args: { from: string; to: string }) => api<{ criadas: number; sem_valor: number }>("/charges/generate", { body: { from: args.from, to: args.to } }),
    onSuccess: ({ criadas, sem_valor }) => {
      toast.success(`${criadas} cobrança(s) gerada(s)${sem_valor ? ` · ${sem_valor} sessão(ões) sem valor` : ""}`);
      void qc.invalidateQueries({ queryKey: ["charges"] });
      void qc.invalidateQueries({ queryKey: ["finance-summary"] });
      setGerando(null);
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  // O CSV exige o cabeçalho Authorization: é baixado com fetch + blob, não com um link direto.
  const exportar = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_URL}/finance/export?from=${mes.from}&to=${mes.to}&format=csv`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("mindcare.token") ?? ""}` },
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error ?? "Não foi possível exportar");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `financeiro-${mes.from}_${mes.to}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    },
    onSuccess: () => toast.success("CSV gerado"),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível exportar"),
  });

  const s = summary.data;
  const canGenerate = user?.role === "admin" || user?.role === "recepcao";
  const podeEstornar = user?.role === "admin" || user?.role === "psicologo";
  const semanal = { from: isoDate(new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() - 6)), to: today() };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Financeiro</h1>
          <p className="text-sm text-muted-foreground">
            {user?.role === "psicologo" ? "Apenas as suas cobranças." : "Cobranças da clínica."}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor="f-de" className="text-xs">De</Label>
            <Input id="f-de" type="date" value={mes.from} onChange={(e) => setMes({ ...mes, from: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="f-ate" className="text-xs">Até</Label>
            <Input id="f-ate" type="date" value={mes.to} onChange={(e) => setMes({ ...mes, to: e.target.value })} />
          </div>
          <Button variant="outline" onClick={() => setMes(currentMonthRange())}>Mês atual</Button>
          {user?.role === "admin" && (
            <Button variant="outline" onClick={() => exportar.mutate()} disabled={exportar.isPending}>
              <Download className="w-4 h-4 mr-1" /> CSV
            </Button>
          )}
        </div>
      </div>

      {summary.isError && <p className="text-sm text-destructive">{errMsg(summary.error, "Não foi possível carregar o resumo.")}</p>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Indicador titulo="Faturado no período" valor={brl(s?.faturado_centavos ?? 0)} />
        <Indicador titulo="Recebido no período" valor={brl(s?.recebido_centavos ?? 0)} />
        <Indicador titulo="Em aberto (hoje)" valor={brl(s?.em_aberto_centavos ?? 0)} />
        <Indicador titulo="Atrasado (hoje)" valor={brl(s?.atrasado_centavos ?? 0)} alerta={(s?.atrasado_centavos ?? 0) > 0} />
      </div>

      {s && s.por_profissional.length > 1 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Por profissional</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Profissional</TableHead>
                  <TableHead className="text-right">Faturado</TableHead>
                  <TableHead className="text-right">Recebido</TableHead>
                  <TableHead className="text-right">Em aberto</TableHead>
                  <TableHead className="text-right">Atrasado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {s.por_profissional.map((p) => (
                  <TableRow key={p.professional_id}>
                    <TableCell className="font-medium">{p.nome}</TableCell>
                    <TableCell className="text-right">{brl(p.faturado_centavos)}</TableCell>
                    <TableCell className="text-right">{brl(p.recebido_centavos)}</TableCell>
                    <TableCell className="text-right">{brl(p.em_aberto_centavos)}</TableCell>
                    <TableCell className="text-right text-destructive">{brl(p.atrasado_centavos)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label className="text-xs">Situação</Label>
            <div className="flex gap-1">
              {filterStatus.map((f) => (
                <Button key={f} size="sm" variant={status === f ? "default" : "outline"} onClick={() => setStatus(f)}>
                  {f === "todos" ? "Todas" : STATUS[f].label}
                </Button>
              ))}
            </div>
          </div>
          {user?.role !== "psicologo" && (
            <div className="w-52 space-y-1">
              <Label className="text-xs">Profissional</Label>
              <ProfessionalSelect value={professional} onChange={setProfessional} allowAll />
            </div>
          )}
        </div>
        {canGenerate && (
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={gerar.isPending}
              onClick={() => {
                setGerando(semanal);
                gerar.mutate(semanal);
              }}
            >
              <Receipt className="w-4 h-4 mr-1" /> Gerar da semana
            </Button>
            <Button
              variant="outline"
              disabled={gerar.isPending}
              onClick={() => {
                const m = currentMonthRange();
                setGerando({ from: m.from, to: m.to });
                gerar.mutate({ from: m.from, to: m.to });
              }}
            >
              Gerar do mês
            </Button>
          </div>
        )}
      </div>
      {gerando && <p className="text-xs text-muted-foreground">Gerando cobranças de {dateBR(gerando.from)} a {dateBR(gerando.to)} (sessões realizadas)...</p>}
      <p className="text-xs text-muted-foreground">
        "Gerar" cria cobranças das sessões marcadas como realizadas no período, usando o valor da sessão ou o catálogo.
        Repetir não duplica.
      </p>

      {charges.isError && <p className="text-sm text-destructive">{errMsg(charges.error)}</p>}

      <div className="rounded-xl border bg-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Paciente</TableHead>
              <TableHead>Referência</TableHead>
              <TableHead>Profissional</TableHead>
              <TableHead className="text-right">Líquido</TableHead>
              <TableHead className="text-right">Pago</TableHead>
              <TableHead className="text-right">Saldo</TableHead>
              <TableHead>Vencimento</TableHead>
              <TableHead>Situação</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {charges.data?.map((c) => (
              <TableRow key={c.id}>
                <TableCell>
                  <button type="button" className="font-medium text-primary hover:underline text-left" onClick={() => setDetailId(c.id)}>
                    {c.paciente_nome ?? "—"}
                  </button>
                </TableCell>
                <TableCell>{monthLabel(c.competencia)}</TableCell>
                <TableCell className="text-muted-foreground">{c.profissional_nome ?? "—"}</TableCell>
                <TableCell className="text-right">{brl(c.liquido_centavos)}</TableCell>
                <TableCell className="text-right">{brl(c.paid_centavos)}</TableCell>
                <TableCell className="text-right">{brl(c.saldo_centavos)}</TableCell>
                <TableCell>{c.vencimento ? dateBR(c.vencimento) : "—"}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-1">
                    {c.atrasada && <Badge variant="destructive">Atrasada</Badge>}
                    <Badge variant={STATUS[c.status].variant}>{STATUS[c.status].label}</Badge>
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  {(c.status === "aberta" || c.status === "parcial") && (
                    <Button size="sm" onClick={() => setReceiving(c)}>Receber</Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {charges.data?.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                  Nenhuma cobrança no período. Se houver sessões realizadas, use "Gerar do mês".
                </TableCell>
              </TableRow>
            )}
            {charges.isLoading && (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-muted-foreground py-8">Carregando...</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <p className="text-xs text-muted-foreground">
        Ver estorno e cancelamento: clique no nome do paciente. Pagamentos são imutáveis — erro se corrige com estorno,
        e o estorno exige motivo. {podeEstornar ? "" : "Seu perfil não pode estornar."}
      </p>

      <ReceiveDialog charge={receiving} onClose={() => setReceiving(null)} />
      <ChargeDetailDialog chargeId={detailId} onClose={() => setDetailId(null)} />
    </div>
  );
}
