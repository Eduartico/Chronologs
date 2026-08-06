/** Tinta de fundo a partir de qualquer notação de cor — `hsl()` incluída.
    O sufixo hex (`${c}22`) só funciona em `#rrggbb`; as paletas daqui são
    todas `hsl()`, o valor saía inválido e o botão herdava o cinzento do SO. */
export function tint(color, pct = 14) {
  if (!color) return 'var(--surface-2)';
  return `color-mix(in srgb, ${color} ${pct}%, transparent)`;
}
