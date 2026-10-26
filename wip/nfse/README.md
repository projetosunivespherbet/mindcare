# Rascunho da NFS-e (em andamento — não está no ar)

Arquivos aqui **não são compilados nem migrados**. Ficam fora de `api/` e da raiz de propósito: a API
aplica `api/migrations/*.sql` em ordem e essas duas versões, se ficassem lá, se sobrescreveriam
(`004_finance.sql` e `fiscal.ts` já existem).

| Arquivo | O que é |
|---|---|
| `005_fiscal.sql` | Fase 2 da NFS-e assistida: emissores (CNPJ do profissional) e notas, ligadas a `charges`. |
| `fiscal.ts` | Rotas `/fiscal/*` e `/nfse/*` do rascunho. |

## O que falta antes de entrar

1. **Não compila como está.** Importa `clinicToday`, `notFound` e `setClause` de `./finance`, mas em
   `api/src/routes/finance.ts` eles são locais (não exportados). Exporte os três, ou mova para um
   `api/src/routes/common.ts` usado pelos dois.
2. **Não está conectado.** Falta `app.route("/fiscal", fiscal)` e `app.route("/nfse", nfse)` em
   `api/src/app.ts`, além de `fast-xml-parser` nas dependências da API.
3. **Sem testes.** Nenhum arquivo em `api/test/` cobre as rotas.
4. **Conferência do XML é aproximada.** O `checkXml` só avisa quando não acha um campo; o leiaute do
   XML nacional precisa ser conferido contra a documentação oficial (já anotado no próprio código).
5. **Timestamp da migração.** Renomear para algo depois da última migração aplicada antes de publicar.

## Decisões que o desenho já toma (e que devem ser mantidas)

- Nenhum certificado digital passa pelo sistema: o psicólogo emite no Emissor Nacional e **registra**
  chave de acesso, número e XML.
- A descrição do serviço é fixa (`Serviços de psicologia`): nada clínico entra em documento fiscal.
- Só o profissional emissor registra ou cancela a nota (trigger `fiscal_documents_guard`).
- Nota cancelada libera as cobranças para uma nova nota; rascunho pode ser descartado, emitida não.
- Uma cobrança tem no máximo uma nota ativa (`fiscal_one_active_doc_per_charge`).
