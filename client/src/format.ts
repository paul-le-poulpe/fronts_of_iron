// Écriture des nombres affichés par la page (03-Client.md, « Nombres »). Sous `from`, le nombre entier avec
// séparateur de milliers (« 9 999 ») ; au-delà, en milliers (« 10K », « 12,5K », « 125K ») puis en millions
// (« 1,2M », « 125M »), avec une décimale sous 100 et aucune au-dessus.

const full = new Intl.NumberFormat("fr-FR");
const oneDecimal = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });

/** `n` en notation courte à partir de `from` (10 000 par défaut). */
export function compact(n: number, from = 10_000): string {
  const a = Math.abs(n);
  if (a < from) return full.format(n);
  const round = (x: number): number => (x >= 100 ? Math.round(x) : Math.round(x * 10) / 10);
  // 999 960 s'écrit « 1M », pas « 1 000K ».
  const k = round(a / 1000);
  const text = k < 1000 ? `${oneDecimal.format(k)}K` : `${oneDecimal.format(round(a / 1_000_000))}M`;
  return n < 0 ? `-${text}` : text;
}

/** Comme `compact`, sans décimale : entier arrondi sous `from`, puis « 5K », « 135K », « 3M » (écran de bataille). */
export function compactInt(n: number, from = 1000): string {
  const a = Math.abs(n);
  if (a < from) return full.format(Math.round(n));
  const k = Math.round(a / 1000);
  const text = k < 1000 ? `${k}K` : `${Math.round(a / 1_000_000)}M`;
  return n < 0 ? `-${text}` : text;
}

/** Nombre affiché : exact sous 10 000, puis K et M. */
export function num(n: number): string {
  return compact(n);
}
