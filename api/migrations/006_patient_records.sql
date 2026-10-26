-- Evolução por sessão (prontuário) e consulta da auditoria.
--
-- Princípios clínicos e da LGPD:
--  - a evolução é registro clínico: não se apaga nem se reescreve. Erro se corrige com um *adendo* (nova linha,
--    ligada à original), preservando o que foi escrito e quando.
--  - a recepção nunca enxerga. O psicólogo vê a sessão dos próprios atendimentos; o administrador que atende vê
--    o que produziu. Não há privilégio de UPDATE/DELETE de evolução para a API.
--  - só se registra evolução de sessão que pertence ao profissional e do paciente daquela sessão.

CREATE TABLE session_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL,
  appointment_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  professional_id uuid NOT NULL,
  conteudo text NOT NULL CHECK (length(btrim(conteudo)) BETWEEN 1 AND 20000),
  adenda_de uuid UNIQUE REFERENCES session_notes(id),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, id),
  FOREIGN KEY (clinic_id, appointment_id) REFERENCES appointments (clinic_id, id),
  FOREIGN KEY (clinic_id, patient_id) REFERENCES patients (clinic_id, id),
  FOREIGN KEY (clinic_id, professional_id) REFERENCES users (clinic_id, id)
);
CREATE INDEX session_notes_patient_idx ON session_notes (clinic_id, patient_id, created_at DESC);
CREATE INDEX session_notes_appt_idx ON session_notes (appointment_id);

-- A sessão registra a evolução? Pode; sessão cancelada, não. E o profissional da nota é quem atendeu.
CREATE FUNCTION session_notes_check() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  a appointments%ROWTYPE;
  orig session_notes%ROWTYPE;
BEGIN
  SELECT * INTO a FROM appointments WHERE id = NEW.appointment_id AND clinic_id = NEW.clinic_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sessão não encontrada' USING ERRCODE = 'check_violation';
  END IF;
  IF a.patient_id <> NEW.patient_id THEN
    RAISE EXCEPTION 'A sessão não pertence a este paciente' USING ERRCODE = 'check_violation';
  END IF;
  IF a.professional_id <> NEW.professional_id THEN
    RAISE EXCEPTION 'A evolução é do profissional que atendeu a sessão' USING ERRCODE = 'check_violation';
  END IF;
  IF a.status = 'cancelado' THEN
    RAISE EXCEPTION 'Sessão cancelada não recebe evolução' USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.adenda_de IS NOT NULL THEN
    SELECT * INTO orig FROM session_notes WHERE id = NEW.adenda_de;
    IF NOT FOUND OR orig.patient_id <> NEW.patient_id OR orig.professional_id <> NEW.professional_id THEN
      RAISE EXCEPTION 'Adendo inválido: deve corrigir uma evolução do mesmo paciente e profissional' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER session_notes_check BEFORE INSERT ON session_notes FOR EACH ROW EXECUTE FUNCTION session_notes_check();
REVOKE ALL ON FUNCTION session_notes_check() FROM PUBLIC;

-- Registro clínico não muda e não some.
CREATE FUNCTION session_notes_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Evolução não pode ser alterada nem excluída; registre um adendo' USING ERRCODE = 'check_violation';
END $$;
CREATE TRIGGER session_notes_no_update BEFORE UPDATE ON session_notes FOR EACH ROW EXECUTE FUNCTION session_notes_immutable();
CREATE TRIGGER session_notes_no_delete BEFORE DELETE ON session_notes FOR EACH ROW EXECUTE FUNCTION session_notes_immutable();
REVOKE ALL ON FUNCTION session_notes_immutable() FROM PUBLIC;

CREATE TRIGGER session_notes_clinic_fixed BEFORE UPDATE ON session_notes FOR EACH ROW EXECUTE FUNCTION forbid_clinic_change();

-- ---------------------------------------------------------------- RLS

ALTER TABLE session_notes ENABLE ROW LEVEL SECURITY;

-- Lê quem escreveu (autor do registro) ou a administração que atende, para o paciente.
CREATE POLICY session_notes_select ON session_notes FOR SELECT TO app_runtime
  USING (clinic_id = app_clinic() AND professional_id = app_user());

CREATE POLICY session_notes_insert ON session_notes FOR INSERT TO app_runtime
  WITH CHECK (clinic_id = app_clinic() AND professional_id = app_user() AND created_by = app_user()
              AND (app_role() = 'psicologo' OR (app_role() = 'admin' AND app_atende())));

-- ---------------------------------------------------------------- privilégios

GRANT SELECT, INSERT ON session_notes TO app_runtime;

-- ---------------------------------------------------------------- auditoria (consulta pelo administrador)

-- A auditoria já podia ser lida pelo admin (policy da 001), mas ele não enxerga o nome de quem agiu e a API não
-- lia nada. Esta view junta o nome do autor; a RLS de `audit_log` continua valendo porque a view usa
-- security_invoker (o filtro por clínica roda como app_runtime).  O nome vem por subconsulta porque a policy de
-- `users` não libera a linha de quem agiu — num LEFT JOIN ela sairia sempre nula.
CREATE VIEW audit_view WITH (security_invoker = true) AS
  SELECT a.id, a.at, a.action, a.entity, a.entity_id, a.user_id,
         (SELECT u.nome FROM users u WHERE u.id = a.user_id) AS user_nome
    FROM audit_log a;
GRANT SELECT ON audit_view TO app_runtime;
