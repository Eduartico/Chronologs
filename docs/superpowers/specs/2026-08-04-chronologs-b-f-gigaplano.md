# Gigaplano B→F — Chronologs

Sub-projecto A (contas, cofres e movimentos internos) está entregue e verificado.
Este documento cobre os cinco restantes num plano único.

**Contexto que A deixou pronto e que B→F reaproveitam:**

- `projections.spendingTransactions` — tudo sem movimentos internos.
- `projections.accounts` / `vaults` / `vaultTotal` / `vaultReconciliation` — alimenta F directamente.
- Categorias de sistema `internal transfer` e `cash withdrawal`, protegidas.
- Ícones `accounts`, `vault`, `cash` acrescentados ao `Icon.jsx`.

---

## B — Memória de estado da UI

**Problema (nas palavras do Eduardo):** «fui olhar ali a tabela de investimentos e fui
voltar pra transações e eu perdi minha pesquisa».

Cada página guarda o seu estado em `useState`, que morre ao desmontar. A página
activa também não sobrevive a um F5.

**Desenho.** Um hook `usePersistentState(key, initial)` sobre `sessionStorage`:
sobrevive à navegação e ao refresh, morre ao fechar o separador — que é o âmbito
certo para um filtro. Um único ficheiro, `web/src/lib/usePersistentState.js`.

**Onde aplicar:**

| Ficheiro | Estado a preservar |
|---|---|
| `App.jsx` | página activa |
| `Transactions.jsx` | pesquisa, filtros, ordenação, página |
| `PendingReview.jsx` | ordenação, agrupamento |
| `Categories.jsx` | separador activo |
| `Investments.jsx` | separador, filtros |
| `Travel.jsx` | separador |
| `Duplicates.jsx` | mostrar anuladas |
| `Rules.jsx` | separador |
| `Insights.jsx` | intervalo de datas, granularidade |

**Aceitação:** navegar Transacções → Investimentos → Transacções mantém pesquisa,
filtros e ordenação. Um F5 mantém a página activa.

---

## C — Viagens

**Problemas relatados:**

1. Não dá para editar viagens, nem as detectadas nem as guardadas.
2. «marquei como não foi viagem, e quando eu faço detectar viagens de novo, ela
   aparece aqui de novo» — a rejeição não persiste.
3. Datas em `aaaa-mm-dd`: «a gente tá na Europa, meu amigo, põe dia, mês, ano».
4. Marrocos detectado por engano — provavelmente `MA` lido como código de país.
5. Espanha (Tui): bate-volta de 1 dia detectado como 3.
6. Espanha (Valência): fim-de-semana de 3 dias detectado até ao dia 6 do mês seguinte.
7. Duas viagens chamam-se «Espanha» — falta poder nomear (Tui, Valência).
8. «Verificar etiquetagem» só oferece marcar tudo na janela; falta ver as
   transacções uma a uma e perceber o que está e o que não está marcado.
9. Bilhetes comprados semanas antes da viagem não são associados.

**Desenho.**

- **Formato de data.** `web/src/lib/format.js` com `formatDate` em `dd/mm/aaaa`,
  aplicado em toda a aplicação, não só nas viagens. Os `<input type="date">`
  mantêm ISO — é o que a norma exige — mas todo o texto passa a europeu.
- **Edição.** Um `TravelEditor` usado nos dois sítios (proposta e guardada), com
  nome, país, cidade, data de início e fim. Uma proposta editada e guardada
  regista as datas do utilizador, não as detectadas.
- **Rejeição persistente.** Evento `travel_rejected` no ledger com uma assinatura
  estável da proposta (país + janela). `detectTravels` passa a receber as
  rejeições e omite o que já foi recusado; um separador «Recusadas» mostra-as e
  permite repor — o «limbo» que o Eduardo pediu.
- **Falso positivo `MA`.** O extractor de país aceita tokens de duas letras
  demasiado à vontade. Passa a exigir que o token esteja na posição de país do
  descritivo do terminal e a excluir tokens que sejam palavras comuns
  portuguesas/inglesas. Teste de regressão com a linha real que gerou Marrocos.
- **Fronteiras da viagem.** A janela passa a fechar no último movimento
  estrangeiro em vez de esticar até ao próximo movimento nacional, e uma folga
  configurável deixa de ser aplicada a viagens de um dia.
- **Etiquetagem.** `GET /travels/:id/transactions` já existe; o ecrã passa a
  listar cada transacção com o seu estado de etiqueta e permite marcar/desmarcar
  individualmente, em vez de só «marcar tudo».
- **Bilhetes antecipados.** Uma segunda passagem procura, antes da viagem,
  movimentos de companhias aéreas/alojamento cujo destino case com o país da
  viagem, e propõe-nos para associação — proposta, nunca automático.

**Aceitação:** a viagem de Tui fica com 1 dia; Valência com 3; Marrocos não
reaparece depois de recusada; as duas viagens a Espanha podem ter nomes
distintos; todas as datas aparecem em dd/mm/aaaa.

---

## D — Análises

**Diagnóstico do Eduardo:** «os cinco painéis da tab de análise são inúteis».
Confirmado no código: `computeInsights` gera `You spent X% on Y` sobre o top-5 por
valor absoluto, em inglês, sem excluir nada.

**Painéis a remover:** Spending summary, Top spending categories (na forma
actual), Unusual spending, Recurring subscriptions (na forma actual).

**Painéis novos:**

1. **Para onde foi o dinheiro** — despesa por categoria no período, com
   comparação contra a média dos períodos anteriores. Já sem internos (A).
2. **Ritmo mensal** — receita, despesa e o que sobrou, com o mês corrente
   projectado a partir do ritmo até à data.
3. **Compromissos recorrentes** — subscrições a sério. `detectRecurringSubscriptions`
   actualmente agrupa por descrição com ≥2 ocorrências e ≤2 valores distintos, o
   que apanha a lavandaria (WASHTUR, três máquinas no mesmo dia). Passa a exigir
   **regularidade no intervalo** (mensal/anual ±25%) e ≥3 ocorrências em meses
   distintos. A lavandaria deixa de aparecer; o Spotify continua.
4. **O que mudou** — as maiores variações de categoria face ao período anterior,
   em euros e não em percentagem, com a transacção responsável.
5. **Poupança** — quanto entrou nos cofres, quanto saiu, e para onde foi
   quando saiu. Vem directamente de A.

Texto todo em português. Insights sem número escondem-se em vez de dizerem 0,0%.

**Aceitação:** «income» nunca aparece como categoria de despesa; a lavandaria não
aparece como subscrição; nenhum painel fala inglês.

---

## E — UI e ícones

| Queixa | Correcção |
|---|---|
| Sino de notificações preto e desalinhado do título | Herda `currentColor` como os restantes; alinhado no eixo do logótipo |
| Sino grande e feio quando colapsado | Move-se para o rodapé da barra, tamanho do ícone de navegação |
| Ordem do menu não reflecte o uso | Dashboard, Transacções, Por rever, Análises, Contas, Investimentos, Viagens, Categorias, Regras, Duplicados, Ligações, Definições |
| Ícones feios: viagens, ligações, regras, análises | Viagens → mala; Ligações → dois nós ligados; Regras → folha com linhas; Análises → brilho de IA (quatro pontas) |
| Viagens e travel partilham o mesmo ícone | Categoria `travel` → avião; navegação Viagens → mala |
| Poucos ícones de categoria | Acrescentar: café, ginásio, animais, presentes, seguros, impostos, beleza, bricolage, telemóvel, streaming, estacionamento, combustível |
| Tabela de categorias mal aproveitada | «Acções» → «Editar»; cor e ícone só no modo de edição; ícone menor na listagem |
| Tudo pequeno demais | Escala base 13px → 14px, com os tamanhos derivados a acompanhar |
| Tags mal editáveis | Renomear e mudar cor de uma tag a partir da própria lista |

**Aceitação:** o sino tem a mesma cor dos outros ícones e está alinhado; nenhum
ícone se repete entre navegação e categorias.

---

## F — Investimentos → Activos

**Pedido:** «talvez a tabela de investimentos devia virar outra coisa, né, uma
tabela de assets».

A página passa a **Activos** e junta, num só sítio: ETFs (já existe), skins CS2
(já existe) e **poupança por cofre** (vem de A). Cada linha traz classe, valor
actual, custo e resultado, com um total no topo. O separador de navegação passa a
«Activos»; a página de Contas continua a ser a vista operacional das contas.

**Aceitação:** o Fundo de Emergência aparece na lista de activos com o seu saldo;
o total de activos inclui a poupança.

---

## Ordem de execução

B (base para todo o resto) → E (ícones e escala, que C/D/F vão usar) → C → D → F.
