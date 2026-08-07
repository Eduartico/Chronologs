/** Classificação de comerciantes por categoria, em português. Os nomes das
    categorias vêm de `categories.json` e são chaves em inglês — vão tal e qual,
    porque é isso que o parser espera de volta. */
export default function classifyPromptPt(batch, categories) {
  return `Classificas transacções bancárias portuguesas por categoria.

Categorias permitidas (usa exactamente estes nomes): ${categories.join(', ')}.

Comerciantes a classificar:
${batch.map((g, i) => `${i + 1}. "${g.label}" (${g.count} transacções, total ${g.total.toFixed(2)} EUR)`).join('\n')}

Regras:
- Responde SÓ com categorias da lista acima.
- Se não tiveres a certeza razoável sobre um comerciante, omite-o. Preferimos
  nenhuma sugestão a uma sugestão errada.
- "confidence" entre 0 e 1.

Responde em JSON estrito:
{"results": [{"label": "<label exacto>", "category": "<categoria>", "confidence": 0.9}]}`;
}
