# Regras de arquitetura

- O produto é um sistema de gestão para psicólogos e clínicas.
- O frontend e a API devem ser tratados como camadas separadas; permissões e regras de negócio ficam no servidor.
- Dados clínicos são sensíveis; não excluir registros de forma física e não enviar conteúdo clínico a serviços externos.
- Áreas abandonadas, como mensagens/paciente em ramos antigos, não devem ser reintroduzidas sem revisão explícita.
