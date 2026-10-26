import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarOff, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/contexts/AuthContext";
import { api, errMsg } from "@/lib/api";
import { addDays, addMinutes, atLocal, hhmm, isoDate, startOfWeek, toIsoWithOffset, today, WEEKDAYS } from "@/lib/datetime";
import { APPOINTMENT_STATUS, type Appointment, type AppointmentStatus, type Patient, type Professional, type TimeBlock } from "@/lib/types";

const STATUS = APPOINTMENT_STATUS;
const HOURS = Array.from({ length: 15 }, (_, i) => 7 + i); // 07:00 Ã s 21:00 (sessÃµes que terminam atÃ© 22:00)
const MIN_POR_HORA = 60;

const fmtRange = (ini: Date) => {
  const fim = addDays(ini, 6);
  const opts: Intl.DateTimeFormatOptions = { day: "2-digit", month: "short" };
  return `${ini.toLocaleDateString("pt-BR", opts)} â€“ ${fim.toLocaleDateString("pt-BR", opts)} de ${fim.getFullYear()}`;
};

/** Minutos desde a meia-noite, no fuso local (posiÃ§Ã£o vertical na grade). */
const minutosDoDia = (iso: string) => {
  const d = new Date(iso);
  return d.getHours() * MIN_POR_HORA + d.getMinutes();
};

function PatientSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [q, setQ] = useState("");
  const list = useQuery({ queryKey: ["patients", q], queryFn: () => api<Patient[]>(`/patients?q=${encodeURIComponent(q)}&ativo=true`) });
  return (
    <div className="space-y-2">
      <Input placeholder="Buscar paciente" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar paciente" />
      <Select value={value || "none"} onValueChange={(v) => onChange(v === "none" ? "" : v)}>
        <SelectTrigger aria-label="Paciente">
          <SelectValue placeholder="Escolha o paciente" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">Escolha o paciente</SelectItem>
          {list.data?.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.nome}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function ProfissionalSelect({ value, onChange, allowAll }: { value: string; onChange: (v: string) => void; allowAll?: boolean }) {
  const pros = useQuery({ queryKey: ["professionals"], queryFn: () => api<Professional[]>("/professionals") });
  return (
    <Select value={value || "none"} onValueChange={(v) => onChange(v === "none" ? "" : v)}>
      <SelectTrigger aria-label="Profissional">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">{allowAll ? "Todos os profissionais" : "Escolha o profissional"}</SelectItem>
        {pros.data?.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            {p.nome}
            {p.crp ? ` Â· CRP ${p.crp}` : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ---------------------------------------------------------------- nova sessÃ£o

function NewAppointment({ open, onClose, day }: { open: boolean; onClose: () => void; day: string }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const blank = () => ({ patient: "", professional_id: "", dia: day, hora: "09:00", duracao: "50", semanas: "1" });
  const [f, setF] = useState(blank);

  const create = useMutation({
    mutationFn: async () => {
      const ini = atLocal(f.dia, f.hora);
      const ocorrencias = Number(f.semanas);
      const body: Record<string, unknown> = {
        patient_id: f.patient,
        starts_at: toIsoWithOffset(ini),
        ends_at: addMinutes(toIsoWithOffset(ini), Number(f.duracao)),
        ...(user?.role !== "psicologo" ? { professional_id: f.professional_id } : {}),
        ...(ocorrencias > 1 ? { recorrencia: { frequencia: "semanal", ocorrencias } } : {}),
      };
      return api<Appointment | Appointment[]>("/appointments", { body });
    },
    onSuccess: (r) => {
      const n = Array.isArray(r) ? r.length : 1;
      toast.success(n > 1 ? `${n} sessÃµes agendadas` : "SessÃ£o agendada");
      void qc.invalidateQueries({ queryKey: ["appointments"] });
      onClose();
    },
    // Conflito de horÃ¡rio vem como 409: nada Ã© gravado (nem as semanas seguintes).
    onError: (e) => toast.error(errMsg(e)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!f.patient) return toast.error("Escolha o paciente");
    if (user?.role !== "psicologo" && !f.professional_id) return toast.error("Escolha o profissional");
    create.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Nova sessÃ£o</DialogTitle>
          <DialogDescription>Se alguma data da sÃ©rie conflitar, nenhuma Ã© agendada.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <PatientSelect value={f.patient} onChange={(v) => setF({ ...f, patient: v })} />
          {user?.role !== "psicologo" && (
            <div className="space-y-2">
              <Label>Profissional</Label>
              <ProfissionalSelect value={f.professional_id} onChange={(v) => setF({ ...f, professional_id: v })} />
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="a-dia">Data</Label>
              <Input id="a-dia" type="date" required value={f.dia} onChange={(e) => setF({ ...f, dia: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="a-hora">InÃ­cio</Label>
              <Input id="a-hora" type="time" required value={f.hora} onChange={(e) => setF({ ...f, hora: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="a-dur">DuraÃ§Ã£o (min)</Label>
              <Input id="a-dur" type="number" min={10} max={480} step={5} value={f.duracao} onChange={(e) => setF({ ...f, duracao: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="a-sem">Repetir (semanas)</Label>
              <Input id="a-sem" type="number" min={1} max={52} value={f.semanas} onChange={(e) => setF({ ...f, semanas: e.target.value })} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {Number(f.semanas) > 1 ? `SerÃ£o criadas ${f.semanas} sessÃµes semanais, a partir de ${f.dia.split("-").reverse().join("/")}.` : "SessÃ£o Ãºnica."}
          </p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={create.isPending}>{create.isPending ? "Agendando..." : "Agendar"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- sessÃ£o: mudar situaÃ§Ã£o

function AppointmentDialog({ appt, onClose }: { appt: Appointment | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [remarcar, setRemarcar] = useState(false);
  const [novo, setNovo] = useState({ dia: "", hora: "", duracao: "50", motivo: "" });
  const [motivo, setMotivo] = useState("");

  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) => api(`/appointments/${appt!.id}`, { method: "PATCH", body }),
    onSuccess: () => {
      toast.success("SessÃ£o atualizada");
      void qc.invalidateQueries({ queryKey: ["appointments"] });
      setMotivo("");
      onClose();
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const abrirRemarcar = () => {
    if (!appt) return;
    const d = new Date(appt.starts_at);
    const dur = Math.round((new Date(appt.ends_at).getTime() - d.getTime()) / 60_000);
    setNovo({ dia: isoDate(d), hora: hhmm(d), duracao: String(dur), motivo: "" });
    setRemarcar(true);
  };

  const salvarRemarcacao = (e: FormEvent) => {
    e.preventDefault();
    const ini = atLocal(novo.dia, novo.hora);
    patch.mutate({
      starts_at: toIsoWithOffset(ini),
      ends_at: addMinutes(toIsoWithOffset(ini), Number(novo.duracao)),
    });
    setRemarcar(false);
  };

  return (
    <Dialog open={!!appt} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{appt ? `${hhmm(new Date(appt.starts_at))} â€“ ${hhmm(new Date(appt.ends_at))}` : "SessÃ£o"}</DialogTitle>
          <DialogDescription>
            {appt ? `${new Date(appt.starts_at).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })}` : ""}
            {appt?.series_id ? " Â· faz parte de uma sÃ©rie semanal" : ""}
          </DialogDescription>
        </DialogHeader>

        {appt && !remarcar && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>SituaÃ§Ã£o</Label>
              <div className="flex flex-wrap gap-2">
                {(["confirmado", "realizado", "faltou"] as AppointmentStatus[]).map((st) => (
                  <Button
                    key={st}
                    size="sm"
                    variant={appt.status === st ? "default" : "outline"}
                    disabled={patch.isPending || appt.status === st}
                    onClick={() => patch.mutate({ status: st })}
                  >
                    {STATUS[st].label}
                  </Button>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={abrirRemarcar}>Remarcar</Button>
              {appt.status !== "cancelado" && (
                <Button size="sm" variant="destructive" disabled={patch.isPending} onClick={() => patch.mutate({ status: "cancelado" })}>
                  Cancelar sessÃ£o
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Cancelar a sessÃ£o cancela a cobranÃ§a vinculada. Se houver pagamento registrado, estorne antes â€” o sistema recusa.
            </p>
          </div>
        )}

        {appt && remarcar && (
          <form onSubmit={salvarRemarcacao} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="r-dia">Nova data</Label>
                <Input id="r-dia" type="date" required value={novo.dia} onChange={(e) => setNovo({ ...novo, dia: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="r-hora">Novo inÃ­cio</Label>
                <Input id="r-hora" type="time" required value={novo.hora} onChange={(e) => setNovo({ ...novo, hora: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="r-dur">DuraÃ§Ã£o (min)</Label>
                <Input id="r-dur" type="number" min={10} max={480} step={5} value={novo.duracao} onChange={(e) => setNovo({ ...novo, duracao: e.target.value })} />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRemarcar(false)}>Voltar</Button>
              <Button type="submit" disabled={patch.isPending}>Salvar nova data</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- bloqueio

function BlockDialog({ open, onClose, day }: { open: boolean; onClose: () => void; day: string }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [f, setF] = useState({ professional_id: "", dia: day, de: "12:00", ate: "13:00", motivo: "" });
  const save = useMutation({
    mutationFn: () =>
      api("/blocks", {
        body: {
          ...(user?.role !== "psicologo" ? { professional_id: f.professional_id } : {}),
          starts_at: toIsoWithOffset(atLocal(f.dia, f.de)),
          ends_at: toIsoWithOffset(atLocal(f.dia, f.ate)),
          motivo: f.motivo || null,
        },
      }),
    onSuccess: () => {
      toast.success("HorÃ¡rio bloqueado");
      void qc.invalidateQueries({ queryKey: ["blocks"] });
      onClose();
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Bloquear horÃ¡rio</DialogTitle>
          <DialogDescription>AlmoÃ§o, curso, folga. SessÃµes jÃ¡ marcadas nesse perÃ­odo impedem o bloqueio.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          {user?.role !== "psicologo" && (
            <div className="space-y-2">
              <Label>Profissional</Label>
              <ProfissionalSelect value={f.professional_id} onChange={(v) => setF({ ...f, professional_id: v })} />
            </div>
          )}
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label htmlFor="b-dia">Dia</Label>
              <Input id="b-dia" type="date" required value={f.dia} onChange={(e) => setF({ ...f, dia: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="b-de">De</Label>
              <Input id="b-de" type="time" required value={f.de} onChange={(e) => setF({ ...f, de: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="b-ate">AtÃ©</Label>
              <Input id="b-ate" type="time" required value={f.ate} onChange={(e) => setF({ ...f, ate: e.target.value })} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="b-motivo">Motivo (opcional)</Label>
            <Input id="b-motivo" value={f.motivo} onChange={(e) => setF({ ...f, motivo: e.target.value })} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={save.isPending || (user?.role !== "psicologo" && !f.professional_id)}>Bloquear</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- tela

export default function Agenda() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [professional, setProfessional] = useState("");
  const [newOpen, setNewOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<Appointment | null>(null);
  const [blockOpen, setBlockOpen] = useState<string | null>(null);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const from = toIsoWithOffset(weekStart);
  const to = toIsoWithOffset(addDays(weekStart, 7));

  const appts = useQuery({
    queryKey: ["appointments", from, to, professional],
    queryFn: () => api<Appointment[]>(`/appointments?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}${professional ? `&professional_id=${professional}` : ""}`),
  });
  const blocks = useQuery({
    queryKey: ["blocks", from, to, professional],
    queryFn: () => api<TimeBlock[]>(`/blocks?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}${professional ? `&professional_id=${professional}` : ""}`),
  });

  const byDay = useMemo(() => {
    const map: Record<string, Appointment[]> = {};
    for (const a of appts.data ?? []) {
      const k = isoDate(new Date(a.starts_at));
      (map[k] ??= []).push(a);
    }
    return map;
  }, [appts.data]);

  const blocksByDay = useMemo(() => {
    const map: Record<string, TimeBlock[]> = {};
    for (const b of blocks.data ?? []) {
      const k = isoDate(new Date(b.starts_at));
      (map[k] ??= []).push(b);
    }
    return map;
  }, [blocks.data]);

  const removeBlock = useMutation({
    mutationFn: (id: string) => api(`/blocks/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Bloqueio removido");
      void qc.invalidateQueries({ queryKey: ["blocks"] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const hoje = today();
  const totalSemana = appts.data?.length ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Agenda</h1>
          <p className="text-sm text-muted-foreground">
            {fmtRange(weekStart)} Â· {totalSemana} sessÃ£o(Ãµes)
            {professional ? "" : user?.role === "psicologo" ? "" : " na clÃ­nica"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-52">
            <ProfissionalSelect value={professional} onChange={setProfessional} allowAll />
          </div>
          <Button variant="outline" size="icon" aria-label="Semana anterior" onClick={() => setWeekStart(addDays(weekStart, -7))}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setWeekStart(startOfWeek(new Date()))}>Hoje</Button>
          <Button variant="outline" size="icon" aria-label="PrÃ³xima semana" onClick={() => setWeekStart(addDays(weekStart, 7))}>
            <ChevronRight className="w-4 h-4" />
          </Button>
          <Button variant="outline" onClick={() => setBlockOpen(hoje)}>
            <CalendarOff className="w-4 h-4 mr-1" /> Bloquear
          </Button>
          <Button onClick={() => setNewOpen(hoje)}>
            <Plus className="w-4 h-4 mr-1" /> Nova sessÃ£o
          </Button>
        </div>
      </div>

      {appts.isError && <p className="text-sm text-destructive">{errMsg(appts.error, "NÃ£o foi possÃ­vel carregar a agenda.")}</p>}

      <div className="rounded-xl border bg-card overflow-x-auto">
        <div className="min-w-[880px]">
          {/* cabeÃ§alho */}
          <div className="grid grid-cols-[64px_repeat(7,1fr)] border-b sticky top-14 bg-card/95 backdrop-blur z-[5]">
            <div />
            {days.map((d, i) => (
              <div key={i} className={`px-2 py-2 text-center border-l ${isoDate(d) === hoje ? "bg-primary/5" : ""}`}>
                <p className="text-xs text-muted-foreground">{WEEKDAYS[i]}</p>
                <p className={`text-sm font-semibold ${isoDate(d) === hoje ? "text-primary" : ""}`}>{d.getDate()}/{String(d.getMonth() + 1).padStart(2, "0")}</p>
              </div>
            ))}
          </div>
          {/* grade */}
          <div className="grid grid-cols-[64px_repeat(7,1fr)]">
            <div>
              {HOURS.map((h) => (
                <div key={h} className="h-12 pr-2 text-right text-[11px] text-muted-foreground -translate-y-1.5">
                  {String(h).padStart(2, "0")}:00
                </div>
              ))}
            </div>
            {days.map((d, i) => {
              const key = isoDate(d);
              return (
                <div key={i} className={`relative border-l ${key === hoje ? "bg-primary/[0.03]" : ""}`} style={{ height: HOURS.length * 48 }}>
                  {HOURS.map((h) => (
                    <div key={h} className="h-12 border-b border-dashed border-border/60" />
                  ))}
                  {(blocksByDay[key] ?? []).map((b) => {
                    const s = new Date(b.starts_at);
                    const e = new Date(b.ends_at);
                    const top = s.getHours() * 60 + s.getMinutes();
                    const h = Math.max(20, (e.getTime() - s.getTime()) / 60_000);
                    return (
                      <div
                        key={b.id}
                        className="absolute inset-x-1 rounded bg-muted text-muted-foreground text-[10px] px-1 py-0.5 overflow-hidden"
                        style={{ top: top * 0.8, height: h * 0.8 }}
                        title={`Bloqueado${b.motivo ? `: ${b.motivo}` : ""} â€” clique para remover`}
                      >
                        <button type="button" className="text-left w-full" onClick={() => removeBlock.mutate(b.id)}>
                          {b.motivo || "Bloqueado"}
                        </button>
                      </div>
                    );
                  })}
                  {(byDay[key] ?? []).map((a) => {
                    const top = minutosDoDia(a.starts_at);
                    const durMin = Math.max(20, (new Date(a.ends_at).getTime() - new Date(a.starts_at).getTime()) / 60_000);
                    const st = STATUS[a.status as AppointmentStatus] ?? STATUS.agendado;
                    return (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => setEditing(a)}
                        className={`absolute inset-x-1 rounded border px-1.5 py-0.5 text-left text-[11px] overflow-hidden transition hover:brightness-95 ${
                          a.status === "cancelado"
                            ? "border-destructive/30 bg-destructive/10 line-through"
                            : a.status === "faltou"
                              ? "border-destructive/40 bg-destructive/5"
                              : a.status === "realizado"
                                ? "border-border bg-secondary"
                                : a.status === "confirmado"
                                  ? "border-primary/40 bg-primary/15"
                                  : "border-primary/20 bg-primary/5"
                        }`}
                        style={{ top: top * 0.8, height: durMin * 0.8 }}
                        title={`${a.patient_nome ?? "Paciente"} Â· ${hhmm(new Date(a.starts_at))}â€“${hhmm(new Date(a.ends_at))} Â· ${st.label}`}
                      >
                        <span className="block font-medium truncate">{hhmm(new Date(a.starts_at))} {a.patient_nome ?? "â€”"}</span>
                        <span className="block truncate opacity-75">{a.professional_nome ?? ""}</span>
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    aria-label={`Nova sessÃ£o em ${key}`}
                    className="absolute inset-x-0 bottom-0 h-6 text-[10px] text-muted-foreground hover:bg-primary/5"
                    onClick={() => setNewOpen(key)}
                  >
                    + agendar
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        {(["agendado", "confirmado", "realizado", "faltou", "cancelado"] as AppointmentStatus[]).map((s) => (
          <span key={s} className="flex items-center gap-1">
            <Badge variant={STATUS[s].variant}>{STATUS[s].label}</Badge>
          </span>
        ))}
        <span>
          <Badge variant="secondary">Bloqueado</Badge> â€” clique no bloco para liberar
        </span>
      </div>

      <Card>
        <CardContent className="pt-4 text-xs text-muted-foreground space-y-1">
          <p>Clique numa sessÃ£o para confirmar, marcar presenÃ§a/falta, remarcar ou cancelar.</p>
          <p>
            A grade mostra a semana inteira; as horas vÃªm do relÃ³gio deste computador. SessÃµes da sÃ©rie semanal aparecem
            individualmente â€” cancelar uma nÃ£o afeta as outras.
          </p>
          <p>Marcar como "Realizado" libera o registro da evoluÃ§Ã£o na ficha do paciente (aba Atendimentos).</p>
        </CardContent>
      </Card>

      {newOpen !== null && <NewAppointment open onClose={() => setNewOpen(null)} day={newOpen} />}
      <AppointmentDialog appt={editing} onClose={() => setEditing(null)} />
      {blockOpen !== null && <BlockDialog open onClose={() => setBlockOpen(null)} day={blockOpen} />}
    </div>
  );
}
