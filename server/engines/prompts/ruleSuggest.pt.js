/** Propõe regras de categorização a partir de uma amostra de movimentos por
    categorizar. Os nomes das categorias são as chaves inglesas de
    `categories.json` e vão sem tradução, porque é assim que voltam. */
export default function ruleSuggestPromptPt(samples, categories) {
  return `Estás a ajudar a categorizar transacções de finanças pessoais.
Categorias disponíveis: ${categories.join(', ')}.
Amostra de transacções por categorizar (dados de um banco português):
${JSON.stringify(samples, null, 1)}

Propõe NO MÁXIMO 5 regras de categorização em que tenhas confiança — qualidade
acima de quantidade. Só sugere uma regra quando o comerciante ou a palavra-chave
for inequívoca. Podes também incluir comerciantes portugueses conhecidos que não
apareçam na amostra.
Responde em JSON ESTRITO: {"rules": [{"name": "...", "patterns": ["palavra-chave"], "category": "uma das categorias"}]}`;
}
