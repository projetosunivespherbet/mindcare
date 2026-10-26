import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/contexts/AuthContext";
import { api, errMsg } from "@/lib/api";
import { brl, centsToInput, dateBR, monthLabel, newIdempotencyKey, parseBRL } from "@/lib/money";
import type { Charge, ChargeDetail, ChargeStatus, PatientDetail, PaymentMethod } from "@/lib/types";
import { ProfessionalSelect } from "@/pages/Patients";

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "pix", label: "Pix" },
  { value: "dinheiro", label: "Dinheiro" },
  { value: "cartao", label: "CartÃ£o" },
  { value: "transferencia", label: "TransferÃªncia" },
  { value: "boleto", label: "Boleto" },
  { value: "convenio", label: "ConvÃªnio" },
  { value: "outro", label: "Outro" },
];
const METHOD_LABEL = Object.fromEntries(METHODS.map((m) => [m.value, m.label])) as Record<PaymentMethod, string>;

const STATUS: Record<ChargeStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  aberta: { label: "Em aberto", variant: "secondary" },
  parcial: { label: "Parcial", variant: "outline" },
  paga: { label: "Paga", variant: "default" },
  cancelada: { label: "Cancelada", variant: "destructive" },
};

const today = () => new Date().toLocaleDateString("sv-SE"); // AAAA-MM-DD no fuso do navegador

function MethodSelect({ value, onChange, id }: { value: PaymentMethod; onChange: (v: PaymentMethod) => void; id?: string }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as PaymentMethod)}>
      <SelectTrigger id={id} aria-label="Forma de pagamento">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {METHODS.map((m) => (
          <SelectItem key={m.value} value={m.value}>
            {m.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ---------------------------------------------------------------- nova cobranÃ§a

function NewChargeDialog({ patient, open, onClose }: { patient: PatientDetail; open: boolean; onClose: () => void }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const needsProfessional = !patient.professional_id && user?.role !== "psicologo";
  const blank = () => ({ valor: "", mes: today().slice(0, 7), vencimento: "", pago: false, metodo: "pix" as PaymentMethod, pagoEm: today(), professional_id: "" });
  const [f, setF] = useState(blank);
  const key = useRef(newIdempotencyKey());
  useEffect(() => {
    if (open) {
      setF(blank());
      key.current = newIdempotencyKey();
    }
  }, [open]);

  const create = useMutation({
    mutationFn: async () => {
      const cents = parseBRL(f.valor);
      if (!cents) throw new Error("Informe um valor vÃ¡lido, por exemplo 200 ou 200,00");
      if (needsProfessional && !f.professional_id) throw new Error("Escolha o psicÃ³logo responsÃ¡vel");
      const charge = await api<Charge>("/charges", {
        body: {
          patient_id: patient.id,
          competencia: f.mes,
          valor_centavos: cents,
          ...(f.vencimento ? { vencimento: f.vencimento } : {}),
          ...(needsProfessional ? { professional_id: f.professional_id } : {}),
        },
      });
      if (!f.pago) return { paymentFailed: null as string | null };
      try {
        await api(`/charges/${charge.id}/payments`, {
          headers: { "Idempotency-Key": key.current },
          body: { valor_centavos: cents, metodo: f.metodo, pago_em: f.pagoEm },
        });
        return { paymentFailed: null as string | null };
      } catch (e) {
        return { paymentFailed: errMsg(e, "erro inesperado") };
      }
    },
    onSuccess: ({ paymentFailed }) => {
      void qc.invalidateQueries({ queryKey: ["charges"] });
      if (paymentFailed) toast.error(`CobranÃ§a registrada, mas o pagamento nÃ£o foi: ${paymentFailed}. Use "Receber" na lista.`);
      else toast.success(f.pago ? "CobranÃ§a e pagamento registrados" : "CobranÃ§a registrada");
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error && !("status" in e) ? e.message : errMsg(e)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nova cobranÃ§a</DialogTitle>
          <DialogDescription>Para {patient.nome}. Se o pagamento jÃ¡ foi feito, registre tudo de uma vez.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="c-valor">Valor (R$)</Label>
              <Input id="c-valor" inputMode="decimal" required placeholder="200,00" value={f.valor} onChange={(e) => setF({ ...f, valor: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="c-mes">MÃªs de referÃªncia</Label>
              <Input id="c-mes" type="month" required value={f.mes} onChange={(e) => setF({ ...f, mes: e.target.value })} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="c-venc">Vencimento (opcional)</Label>
              <Input id="c-venc" type="date" value={f.vencimento} onChange={(e) => setF({ ...f, vencimento: e.target.value })} />
            </div>
          </div>
          {needsProfessional && (
            <div className="space-y-2">
              <Label htmlFor="c-prof">PsicÃ³logo responsÃ¡vel</Label>
              <ProfessionalSelect id="c-prof" value={f.professional_id} onChange={(v) => setF({ ...f, professional_id: v })} />
            </div>
          )}
          <div className="flex items-center gap-3">
            <Switch id="c-pago" checked={f.pago} onCheckedChange={(v) => setF({ ...f, pago: v })} />
            <Label htmlFor="c-pago">JÃ¡ foi pago</Label>
          </div>
          {f.pago && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="c-metodo">Forma de pagamento</Label>
                <MethodSelect id="c-metodo" value={f.metodo} onChange={(v) => setF({ ...f, metodo: v })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="c-pagoem">Data do pagamento</Label>
                <Input id="c-pagoem" type="date" required max={today()} value={f.pagoEm} onChange={(e) => setF({ ...f, pagoEm: e.target.value })} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? "Salvando..." : "Registrar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- receber

export function ReceiveDialog({ charge, onClose }: { charge: Charge | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ valor: "", metodo: "pix" as PaymentMethod, pagoEm: today() });
  const key = useRef(newIdempotencyKey());
  useEffect(() => {
    if (charge) {
      setF({ valor: centsToInput(charge.saldo_centavos), metodo: "pix", pagoEm: today() });
      key.current = newIdempotencyKey();
    }
  }, [charge?.id]);

  const receive = useMutation({
    mutationFn: async () => {
      const cents = parseBRL(f.valor);
      if (!cents) throw new Error("Informe um valor vÃ¡lido");
      return api(`/charges/${charge!.id}/payments`, {
        headers: { "Idempotency-Key": key.current },
        body: { valor_centavos: cents, metodo: f.metodo, pago_em: f.pagoEm },
      });
    },
    onSuccess: () => {
      toast.success("Pagamento registrado");
      void qc.invalidateQueries({ queryKey: ["charges"] });
      void qc.invalidateQueries({ queryKey: ["charge", charge?.id] });
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error && !("status" in e) ? e.message : errMsg(e)),
  });

  return (
    <Dialog open={!!charge} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Registrar pagamento</DialogTitle>
          <DialogDescription>
            {charge ? `ReferÃªncia ${monthLabel(charge.competencia)} Â· saldo ${brl(charge.saldo_centavos)}` : ""}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            receive.mutate();
          }}
          className="space-y-4"
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="r-valor">Valor (R$)</Label>
              <Input id="r-valor" inputMode="decimal" required value={f.valor} onChange={(e) => setF({ ...f, valor: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="r-metodo">Forma</Label>
              <MethodSelect id="r-metodo" value={f.metodo} onChange={(v) => setF({ ...f, metodo: v })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="r-data">Data</Label>
              <Input id="r-data" type="date" required max={today()} value={f.pagoEm} onChange={(e) => setF({ ...f, pagoEm: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={receive.isPending}>
              {receive.isPending ? "Salvando..." : "Registrar pagamento"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- detalhes (estorno e cancelamento)

type Action = { kind: "reverse"; paymentId: string } | { kind: "cancel" } | null;

export function ChargeDetailDialog({ chargeId, onClose }: { chargeId: string | null; onClose: () => void }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [action, setAction] = useState<Action>(null);
  const [motivo, setMotivo] = useState("");
  useEffect(() => {
    setAction(null);
    setMotivo("");
  }, [chargeId]);

  const q = useQuery({ queryKey: ["charge", chargeId], queryFn: () => api<ChargeDetail>(`/charges/${chargeId}`), enabled: !!chargeId });
  const c = q.data;
  const canReverse = user?.role === "admin" || user?.role === "psicologo";

  const run = useMutation({
    mutationFn: () =>
      action?.kind === "reverse"
        ? api(`/payments/${action.paymentId}/reverse`, { body: { motivo } })
        : api(`/charges/${chargeId}/cancel`, { body: { motivo } }),
    onSuccess: () => {
      toast.success(action?.kind === "reverse" ? "Pagamento estornado" : "CobranÃ§a cancelada");
      setAction(null);
      setMotivo("");
      void qc.invalidateQueries({ queryKey: ["charges"] });
      void qc.invalidateQueries({ queryKey: ["charge", chargeId] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  return (
    <Dialog open={!!chargeId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{c ? `CobranÃ§a ${monthLabel(c.competencia)}` : "CobranÃ§a"}</DialogTitle>
          <DialogDescription>
            {c ? `${brl(c.liquido_centavos)} Â· pago ${brl(c.paid_centavos)} Â· saldo ${brl(c.saldo_centavos)}` : "Carregando..."}
          </DialogDescription>
        </DialogHeader>
        {c && (
          <div className="space-y-3">
            {c.status === "cancelada" && <p className="text-sm text-destructive">Cancelada: {c.cancel_reason}</p>}
            <ul className="divide-y rounded-xl border bg-card">
              {c.pagamentos.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                  <div className="min-w-0">
                    <p className={p.estornado ? "line-through text-muted-foreground" : "font-medium"}>
                      {p.reverses_id ? "Estorno " : ""}
                      {brl(p.valor_centavos)} Â· {METHOD_LABEL[p.metodo]}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {dateBR(p.pago_em)}
                      {p.motivo_estorno ? ` Â· ${p.motivo_estorno}` : ""}
                      {p.estornado ? " Â· estornado" : ""}
                    </p>
                  </div>
                  {canReverse && !p.reverses_id && !p.estornado && c.status !== "cancelada" && (
                    <Button size="sm" variant="outline" onClick={() => setAction({ kind: "reverse", paymentId: p.id })}>
                      Estornar
                    </Button>
                  )}
                </li>
              ))}
              {c.pagamentos.length === 0 && <li className="p-4 text-center text-sm text-muted-foreground">Nenhum pagamento registrado.</li>}
            </ul>
            {action && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  run.mutate();
                }}
                className="space-y-2 rounded-xl border p-3"
              >
                <Label htmlFor="d-motivo">{action.kind === "reverse" ? "Motivo do estorno" : "Motivo do cancelamento"}</Label>
                <Input id="d-motivo" required minLength={5} maxLength={300} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
                <div className="flex gap-2">
                  <Button type="submit" size="sm" variant="destructive" disabled={run.isPending}>
                    {run.isPending ? "Salvando..." : action.kind === "reverse" ? "Confirmar estorno" : "Confirmar cancelamento"}
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setAction(null)}>
                    Voltar
                  </Button>
                </div>
              </form>
            )}
          </div>
        )}
        <DialogFooter className="sm:justify-between">
          {c && c.status === "aberta" && c.paid_centavos === 0 ? (
            <Button variant="outline" onClick={() => setAction({ kind: "cancel" })}>
              Cancelar cobranÃ§a
            </Button>
          ) : (
            <span />
          )}
          <Button onClick={onClose}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- aba

export function PatientCharges({ patient }: { patient: PatientDetail }) {
  const [creating, setCreating] = useState(false);
  const [receiving, setReceiving] = useState<Charge | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["charges", { patientId: patient.id }], queryFn: () => api<Charge[]>(`/charges?patient_id=${patient.id}`) });
  const emAberto = (q.data ?? []).filter((c) => c.status === "aberta" || c.status === "parcial").reduce((n, c) => n + c.saldo_centavos, 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Em aberto: <span className="font-semibold text-foreground">{brl(emAberto)}</span>
        </p>
        <Button onClick={() => setCreating(true)}>
          <Plus className="w-4 h-4 mr-2" /> Nova cobranÃ§a
        </Button>
      </div>
      {q.isError && <p className="text-sm text-destructive">{errMsg(q.error, "NÃ£o foi possÃ­vel carregar as cobranÃ§as.")}</p>}
      <ul className="divide-y rounded-xl border bg-card">
        {q.data?.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
            <button type="button" onClick={() => setDetailId(c.id)} className="min-w-0 text-left">
              <p className="font-medium text-primary hover:underline">
                {monthLabel(c.competencia)} Â· {brl(c.liquido_centavos)}
              </p>
              <p className="text-xs text-muted-foreground">
                Pago {brl(c.paid_centavos)} Â· saldo {brl(c.saldo_centavos)}
                {c.vencimento ? ` Â· vence ${dateBR(c.vencimento)}` : ""}
                {c.profissional_nome ? ` Â· ${c.profissional_nome}` : ""}
              </p>
            </button>
            <div className="flex items-center gap-2">
              {c.atrasada && <Badge variant="destructive">Atrasada</Badge>}
              <Badge variant={STATUS[c.status].variant}>{STATUS[c.status].label}</Badge>
              {(c.status === "aberta" || c.status === "parcial") && (
                <Button size="sm" onClick={() => setReceiving(c)}>
                  Receber
                </Button>
              )}
            </div>
          </li>
        ))}
        {q.data?.length === 0 && <li className="p-6 text-center text-sm text-muted-foreground">Nenhuma cobranÃ§a para este paciente.</li>}
        {q.isLoading && <li className="p-6 text-center text-sm text-muted-foreground">Carregando...</li>}
      </ul>
      <NewChargeDialog patient={patient} open={creating} onClose={() => setCreating(false)} />
      <ReceiveDialog charge={receiving} onClose={() => setReceiving(null)} />
      <ChargeDetailDialog chargeId={detailId} onClose={() => setDetailId(null)} />
    </div>
  );
}
