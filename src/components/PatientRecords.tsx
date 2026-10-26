import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, FilePlus2, NotebookPen } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { api, errMsg } from "@/lib/api";
import { dateTimeBR } from "@/lib/datetime";
import { APPOINTMENT_STATUS, type AppointmentStatus, type PatientAppointment, type SessionNote } from "@/lib/types";
import { Link } from "react-router-dom";

const STATUS = APPOINTMENT_STATUS;

/**
 * Evolução de uma sessão. A evolução é imutável: para corrigir, registra-se um adendo.
 * Só o profissional que atendeu pode escrever (a API valida de novo).
 */
function EvolutionForm({ appointmentId, onDone }: { appointmentId: string; onDone: () => void }) {
  const qc = useQueryClient();
  const [texto, setTexto] = useState("");
  const save = useMutation({
    mutationFn: () => api("/session-notes", { body: { appointment_id: appointmentId, conteudo: texto } }),
    onSuccess: () => {
      toast.success("Evolução registrada");
      setTexto("");
      void qc.invalidateQueries({ queryKey: ["patient-notes"] });
      void qc.invalidateQueries({ queryKey: ["patient-history"] });
      onDone();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  return (
    <form
      className="space-y-2 rounded-xl border bg-card p-3"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <Label htmlFor="evo-texto">Evolução da sessão</Label>
      <Textarea
        id="evo-texto"
        required
        rows={6}
        maxLength={20000}
        placeholder="O que aconteceu na sessão, intervenções, observações clínicas..."
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
      />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={save.isPending || !texto.trim()}>
          {save.isPending ? "Salvando..." : "Registrar evolução"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancelar
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        A evolução fica registrada e não pode ser apagada. Correções são feitas com adendo.
      </p>
    </form>
  );
}

function AddendumForm({ noteId, onDone }: { noteId: string; onDone: () => void }) {
  const qc = useQueryClient();
  const [texto, setTexto] = useState("");
  const save = useMutation({
    mutationFn: () => api(`/session-notes/${noteId}/adendo`, { body: { conteudo: texto } }),
    onSuccess: () => {
      toast.success("Adendo registrado");
      setTexto("");
      void qc.invalidateQueries({ queryKey: ["patient-notes"] });
      onDone();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  return (
    <form
      className="mt-2 space-y-2 rounded-lg border-dashed p-3"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <Label htmlFor={`ad-${noteId}`}>Adendo</Label>
      <Textarea id={`ad-${noteId}`} required rows={3} maxLength={20000} value={texto} onChange={(e) => setTexto(e.target.value)} />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={save.isPending || !texto.trim()}>
          {save.isPending ? "Salvando..." : "Registrar adendo"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

export function PatientHistory({ patientId }: { patientId: string }) {
  const { user } = useAuth();
  const [writingFor, setWritingFor] = useState<string | null>(null);
  const [adendaFor, setAdendaFor] = useState<string | null>(null);

  const history = useQuery({
    queryKey: ["patient-history", patientId],
    queryFn: () => api<PatientAppointment[]>(`/patients/${patientId}/appointments?limit=300`),
  });

  const podeEscrever = (a: PatientAppointment) => user?.role === "psicologo" && a.professional_id === user.id;

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Cada linha é uma sessão. A coluna "Evolução" mostra quantos registros clínicos a sessão tem.
      </p>
      <ul className="divide-y rounded-xl border bg-card">
        {history.data?.map((a) => {
          const st = STATUS[a.status as AppointmentStatus] ?? STATUS.agendado;
          const encerrada = a.status === "realizado" || a.status === "faltou";
          return (
            <li key={a.id} className="p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">
                    {dateTimeBR(a.starts_at)} · {a.tipo === "grupo" ? "Grupo" : "Individual"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {a.profissional_nome ?? "—"}
                    {a.valor != null ? ` · R$ ${a.valor.toFixed(2).replace(".", ",")}` : ""}
                    {a.evolucoes > 0 ? ` · ${a.evolucoes} evolução(ões)` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={st.variant}>{st.label}</Badge>
                  {a.status === "realizado" && a.evolucoes === 0 && podeEscrever(a) && (
                    <Button size="sm" variant="outline" onClick={() => setWritingFor(a.id)}>
                      <NotebookPen className="w-4 h-4 mr-1" /> Evolução
                    </Button>
                  )}
                  {a.status === "realizado" && a.evolucoes > 0 && (
                    <Badge variant="secondary">Registrada</Badge>
                  )}
                </div>
              </div>
              {writingFor === a.id && <div className="mt-3"><EvolutionForm appointmentId={a.id} onDone={() => setWritingFor(null)} /></div>}
            </li>
          );
        })}
        {history.isLoading && <li className="p-6 text-center text-sm text-muted-foreground">Carregando...</li>}
        {history.data?.length === 0 && (
          <li className="p-6 text-center text-sm text-muted-foreground">
            Nenhuma sessão registrada. <Link className="text-primary hover:underline" to="/agenda">Abrir a agenda</Link>.
          </li>
        )}
        {history.isError && <li className="p-6 text-center text-sm text-destructive">{errMsg(history.error)}</li>}
      </ul>
      <p className="text-xs text-muted-foreground">Exibindo até 300 sessões, das mais recentes para as mais antigas.</p>
    </div>
  );
}

export function PatientNotes({ patientId }: { patientId: string }) {
  const q = useQuery({ queryKey: ["patient-notes", patientId], queryFn: () => api<SessionNote[]>(`/patients/${patientId}/session-notes`) });
  const [adendaFor, setAdendaFor] = useState<string | null>(null);

  // Adendos aparecem logo abaixo do registro que corrigem.
  const main = (q.data ?? []).filter((n) => !n.adenda_de);
  const addenda = (q.data ?? []).filter((n) => n.adenda_de);

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Evolução por sessão, em ordem cronológica. Registro clínico não é editado nem excluído; correções entram como adendo.
      </p>
      <ul className="space-y-3">
        {main.map((n) => (
          <li key={n.id} className="rounded-xl border bg-card p-3">
            <p className="text-xs text-muted-foreground">
              Sessão de {dateTimeBR(n.starts_at)} · {n.autor_nome}
            </p>
            <p className="mt-1 whitespace-pre-wrap text-sm">{n.conteudo}</p>
            {addenda
              .filter((a) => a.adenda_de === n.id)
              .map((a) => (
                <div key={a.id} className="mt-2 rounded-lg border-l-2 border-primary/40 bg-accent/40 p-2">
                  <p className="text-xs font-medium text-muted-foreground">
                    Adendo · {dateTimeBR(a.created_at)} · {a.autor_nome}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-sm">{a.conteudo}</p>
                </div>
              ))}
            {adendaFor === n.id ? (
              <AddendumForm noteId={n.id} onDone={() => setAdendaFor(null)} />
            ) : (
              <Button size="sm" variant="ghost" className="mt-2" onClick={() => setAdendaFor(n.id)}>
                <FilePlus2 className="w-4 h-4 mr-1" /> Adendo
              </Button>
            )}
          </li>
        ))}
      </ul>
      {q.isLoading && <p className="p-6 text-center text-sm text-muted-foreground">Carregando...</p>}
      {q.data?.length === 0 && (
        <p className="rounded-xl border bg-card p-6 text-center text-sm text-muted-foreground">
          <CalendarClock className="w-5 h-5 mx-auto mb-2 opacity-60" />
          Nenhuma evolução registrada. Elas são escritas na aba "Atendimentos", nas sessões realizadas.
        </p>
      )}
      {q.isError && <p className="text-sm text-destructive">{errMsg(q.error)}</p>}
    </div>
  );
}
