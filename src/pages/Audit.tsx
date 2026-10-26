import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, errMsg } from "@/lib/api";
import { currentMonthRange, dateTimeBR } from "@/lib/datetime";
import type { AuditEntry } from "@/lib/types";

/** Nome legível para as ações gravadas pela API (audit(db, s, "patient.view", ...)). */
const ACAO: Record<string, string> = {
  "patient.create": "Cadastrou paciente",
  "patient.update": "Alterou dados do paciente",
  "patient.view": "Abriu a ficha do paciente",
  "patient.view_clinical": "Acessou dados clínicos",
  "user.create": "Criou usuário",
  "user.update": "Alterou usuário",
  "invite.create": "Gerou link de convite",
  "invite.revoke": "Cancelou link de convite",
  "appointment.create": "Agendou sessão",
  "appointment.update": "Alterou sessão",
  "document.create": "Criou documento",
  "document.update": "Alterou documento",
  "document.emit": "Emitiu documento",
  "document.annul": "Anulou documento",
  "document.view": "Abriu documento",
  "session_note.create": "Registrou evolução",
  "session_note.adendo": "Registrou adendo",
  "service.create": "Criou serviço",
  "service.update": "Alterou serviço",
  "payer.create": "Criou responsável financeiro",
  "payer.update": "Alterou responsável financeiro",
  "charge.create": "Criou cobrança",
  "charge.update": "Alterou cobrança",
  "charge.generate": "Gerou cobranças em lote",
  "payment.create": "Registrou pagamento",
  "payment.reverse": "Estornou pagamento",
  "finance.export": "Exportou o financeiro (CSV)",
};

const ENTIDADE: Record<string, string> = {
  patient: "Paciente",
  user: "Usuário",
  appointment: "Sessão",
  document: "Documento",
  session_note: "Evolução",
  service: "Serviço",
  payer: "Responsável",
  charge: "Cobrança",
  payment: "Pagamento",
};

export default function Audit() {
  const [mes, setMes] = useState(currentMonthRange());
  const [action, setAction] = useState("todas");
  const [limit, setLimit] = useState(200);

  const acoes = useQuery({ queryKey: ["audit-actions"], queryFn: () => api<string[]>("/audit/actions") });
  const entries = useQuery({
    queryKey: ["audit", mes.from, mes.to, action, limit],
    queryFn: () => api<AuditEntry[]>(`/audit?from=${mes.from}&to=${mes.to}${action !== "todas" ? `&action=${encodeURIComponent(action)}` : ""}&limit=${limit}`),
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Auditoria</h1>
        <p className="text-sm text-muted-foreground">
          Quem acessou e alterou o quê. Inclui abertura de ficha, visualização de dados clínicos e exportações.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor="a-de" className="text-xs">De</Label>
          <Input id="a-de" type="date" value={mes.from} onChange={(e) => setMes({ ...mes, from: e.target.value })} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="a-ate" className="text-xs">Até</Label>
          <Input id="a-ate" type="date" value={mes.to} onChange={(e) => setMes({ ...mes, to: e.target.value })} />
        </div>
        <div className="w-64 space-y-1">
          <Label className="text-xs">Ação</Label>
          <Select value={action} onValueChange={setAction}>
            <SelectTrigger aria-label="Ação">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas as ações</SelectItem>
              {(acoes.data ?? []).map((a) => (
                <SelectItem key={a} value={a}>
                  {ACAO[a] ?? a}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-40 space-y-1">
          <Label className="text-xs">Quantidade</Label>
          <Select value={String(limit)} onValueChange={(v) => setLimit(Number(v))}>
            <SelectTrigger aria-label="Quantidade">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="100">100 registros</SelectItem>
              <SelectItem value="200">200 registros</SelectItem>
              <SelectItem value="500">500 registros</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" onClick={() => setMes(currentMonthRange())}>Mês atual</Button>
      </div>

      {entries.isError && <p className="text-sm text-destructive">{errMsg(entries.error, "Não foi possível carregar a auditoria.")}</p>}

      <div className="rounded-xl border bg-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Quando</TableHead>
              <TableHead>Quem</TableHead>
              <TableHead>O que</TableHead>
              <TableHead>Registro</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.data?.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="whitespace-nowrap">{dateTimeBR(e.at)}</TableCell>
                <TableCell>{e.user_nome ?? "—"}</TableCell>
                <TableCell>
                  <span className="font-medium">{ACAO[e.action] ?? e.action}</span>
                  <span className="block text-xs text-muted-foreground">{e.action}</span>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {ENTIDADE[e.entity] ?? e.entity}
                  {e.entity_id ? ` · ${e.entity_id.slice(0, 8)}…` : ""}
                </TableCell>
              </TableRow>
            ))}
            {entries.data?.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                  Nenhum evento no período.
                </TableCell>
              </TableRow>
            )}
            {entries.isLoading && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground py-8">Carregando...</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Card>
        <CardContent className="pt-4 flex gap-3 text-xs text-muted-foreground">
          <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" />
          <p>
            A auditoria é somente leitura: nada aqui pode ser alterado ou apagado pelo app. Os registros ficam guardados
            no banco e a consulta é restrita aos administradores. O conteúdo clínico em si (texto da evolução) não é
            copiado para a auditoria.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
