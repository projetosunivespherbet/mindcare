import type { DocumentData, DocumentTypeKey, LetterheadData } from "@shared/documents";

export type Role = "admin" | "psicologo" | "recepcao";

export const ROLE_LABEL: Record<Role, string> = {
  admin: "Administração",
  psicologo: "Psicólogo(a)",
  recepcao: "Recepção",
};

export interface Me {
  id: string;
  nome: string;
  email: string;
  role: Role;
  crp: string | null;
  atende: boolean;
  telefone: string | null;
  clinic_nome: string;
  timezone: string;
}

export interface AppUser {
  id: string;
  nome: string;
  email: string | null;
  role: Role;
  crp: string | null;
  atende: boolean;
  telefone: string | null;
  status: "convidado" | "ativo" | "inativo";
  last_login_at: string | null;
}

export interface InviteLink {
  token: string;
  link: string;
  expires_at: string;
}

export interface Professional {
  id: string;
  nome: string;
  crp: string | null;
}

export interface Anamnesis {
  queixa_principal: string | null;
  historico_familiar: string | null;
  medicamentos: string | null;
  tratamentos_anteriores: string | null;
  expectativas: string | null;
}

export interface Patient {
  id: string;
  nome: string;
  data_nascimento: string | null;
  telefone: string | null;
  email: string | null;
  genero: string | null;
  estado_civil: string | null;
  profissao: string | null;
  professional_id: string | null;
  ativo: boolean;
}

export interface PatientDetail extends Patient {
  anamnesis: Anamnesis | null;
}

export interface LetterheadRow extends LetterheadData {
  id: string;
  nome: string;
  is_default: boolean;
  ativo: boolean;
}

export interface DocListItem {
  id: string;
  patient_id: string;
  tipo: DocumentTypeKey;
  titulo: string;
  status: "rascunho" | "emitido" | "anulado";
  numero: string | null;
  data_documento: string;
  emitted_at: string | null;
  paciente_nome: string;
}

export interface DocFull extends DocumentData {
  id: string;
  patient_id: string;
  professional_id: string;
  letterhead: LetterheadData | null;
}

export interface VerifyResult {
  tipo: DocumentTypeKey;
  titulo: string;
  numero: string;
  status: "emitido" | "anulado";
  emitted_at: string;
  annulled_at: string | null;
  psicologo_nome: string;
  psicologo_crp: string;
  clinica_nome: string;
  content_hash: string;
}

export type ChargeStatus = "aberta" | "parcial" | "paga" | "cancelada";
export type PaymentMethod = "pix" | "dinheiro" | "cartao" | "transferencia" | "boleto" | "convenio" | "outro";

export interface Charge {
  id: string;
  patient_id: string;
  paciente_nome: string | null;
  professional_id: string;
  profissional_nome: string | null;
  descricao: string;
  competencia: string; // AAAA-MM-01
  valor_centavos: number;
  desconto_centavos: number;
  liquido_centavos: number;
  paid_centavos: number;
  saldo_centavos: number;
  vencimento: string | null;
  status: ChargeStatus;
  cancel_reason: string | null;
  atrasada: boolean;
}

export interface Payment {
  id: string;
  charge_id: string;
  valor_centavos: number;
  metodo: PaymentMethod;
  pago_em: string;
  observacao: string | null;
  reverses_id: string | null;
  motivo_estorno: string | null;
  estornado: boolean;
}

export interface ChargeDetail extends Charge {
  pagamentos: Payment[];
}

// ---------------------------------------------------------------- agenda

export type AppointmentStatus = "agendado" | "confirmado" | "realizado" | "faltou" | "cancelado";

/** Rótulos e cores usados na agenda, no histórico e no dashboard. */
export const APPOINTMENT_STATUS: Record<AppointmentStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  agendado: { label: "Agendado", variant: "outline" },
  confirmado: { label: "Confirmado", variant: "default" },
  realizado: { label: "Realizado", variant: "secondary" },
  faltou: { label: "Faltou", variant: "destructive" },
  cancelado: { label: "Cancelado", variant: "destructive" },
};

export interface Appointment {
  id: string;
  patient_id: string;
  professional_id: string;
  professional_nome?: string;
  patient_nome?: string;
  starts_at: string;
  ends_at: string;
  tipo: "individual" | "grupo";
  status: AppointmentStatus;
  valor: number | null;
  payment_status: "pendente" | "pago" | "nao_pago";
  convenio: boolean;
  series_id: string | null;
}

/** Item do histórico de sessões do paciente (traz o profissional e quantas evoluções já tem). */
export interface PatientAppointment extends Appointment {
  profissional_nome: string | null;
  evolucoes: number;
}

export interface TimeBlock {
  id: string;
  professional_id: string;
  starts_at: string;
  ends_at: string;
  motivo: string | null;
}

// ---------------------------------------------------------------- clínico e auditoria

export interface SessionNote {
  id: string;
  appointment_id: string;
  patient_id: string;
  professional_id: string;
  conteudo: string;
  adenda_de: string | null;
  created_by: string;
  created_at: string;
  autor_nome: string;
  starts_at: string;
}

export interface AuditEntry {
  id: string;
  at: string;
  action: string;
  entity: string;
  entity_id: string | null;
  user_id: string;
  user_nome: string | null;
}

// ---------------------------------------------------------------- financeiro

export interface FinanceSummary {
  periodo: { from: string; to: string };
  faturado_centavos: number;
  recebido_centavos: number;
  em_aberto_centavos: number;
  atrasado_centavos: number;
  por_profissional: { professional_id: string; nome: string; faturado_centavos: number; recebido_centavos: number; em_aberto_centavos: number; atrasado_centavos: number }[];
}

export interface Service {
  id: string;
  nome: string;
  valor_centavos: number;
  duracao_min: number | null;
  professional_id: string | null;
  ativo: boolean;
}
