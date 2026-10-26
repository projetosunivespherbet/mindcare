# Legado (Supabase) — só como referência

Nada aqui é compilado, migrado ou importado pelo app novo. Serve para consultar o comportamento antigo
ao portar as telas para a API atual.

| Pasta / arquivo | O que é |
|---|---|
| `migrations/` | Histórico bruto do Supabase CLI, em ordem de data (2026-04 a 2026-10). É a fonte de verdade do banco antigo. |
| `config.toml` | Configuração do Supabase CLI referente a esse histórico. |
| `../src/legacy/` | Telas antigas do Supabase (agenda, dashboard, financeiro, onboarding). Use como referência ao portar e apague o arquivo depois. |

## Ordem do histórico

1. `20260402191351…` — schema inicial.
2. `20260413233925…` a `20260414000916…` — funções ausentes no baseline, `patients`, `messages`
   (mensageria, **descontinuada**), RLS.
3. `20260423174340…` a `20260622133101…` — perfis, agenda e ajustes de RLS.
4. `20260713192204…` e `20260713192227…` — revisões finais do Supabase.
5. `20261018000000_hardening_fase1.sql` — hardening da fase 1 (feito já no contexto da migração para a API).

## Pendências (ver `../roadmap.md`)

- Excluir a tabela `messages`, que exige confirmação porque contém dados.
- Gerar um baseline limpo com `supabase db dump` do banco real, se ainda for necessário.
