-- Endurece a imutabilidade do documento emitido.
--
-- O guard de 002_documents.sql comparava `OLD.status = 'rascunho'` / `'emitido'` em literal. Como `status` é
-- texto, qualquer UPDATE de documento emitido passava reto — inclusive mudar o `conteudo` (e quebrar o hash
-- SHA-256 impresso no rodapé). A comparação agora usa `IS DISTINCT FROM`, então um valor de status fora do
-- CHECK da coluna (que o Postgres recusa depois de rodar o BEFORE trigger) já cai na última exceção.

CREATE OR REPLACE FUNCTION documents_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IS DISTINCT FROM 'rascunho' THEN
      RAISE EXCEPTION 'Documento emitido não pode ser excluído; anule-o com um motivo' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status IS NOT DISTINCT FROM 'rascunho' THEN
    IF NEW.status NOT IN ('rascunho', 'emitido') THEN
      RAISE EXCEPTION 'Emita o documento antes de anulá-lo' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status IS NOT DISTINCT FROM 'emitido' AND NEW.status IS NOT DISTINCT FROM 'anulado'
     AND NEW.annul_reason IS NOT NULL AND length(trim(NEW.annul_reason)) >= 5
     AND (to_jsonb(NEW) - 'status' - 'annulled_at' - 'annul_reason' - 'updated_at')
       = (to_jsonb(OLD) - 'status' - 'annulled_at' - 'annul_reason' - 'updated_at') THEN
    NEW.annulled_at := now();
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Documento emitido não pode ser alterado' USING ERRCODE = 'check_violation';
END $$;
