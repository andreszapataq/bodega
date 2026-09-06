/** "B-04" -> ["B", 4]. La letra ordena alfabéticamente y el número
 *  como número, para que B-10 vaya después de B-9 y no antes. */
export function partesCodigo(cod: string): [string, number] {
  const m = (cod || "").toUpperCase().match(/^([A-Z]*)\D*(\d*)/);
  return [m?.[1] || "", parseInt(m?.[2] ?? "", 10) || 0];
}

export function ordenarPorCodigo<T extends { codigo: string }>(a: T, b: T) {
  const [za, na] = partesCodigo(a.codigo);
  const [zb, nb] = partesCodigo(b.codigo);
  return za === zb ? na - nb : za < zb ? -1 : 1;
}

/** Sin tildes y en minúscula, para que "cafe" encuentre "café". */
export const norm = (s: string) =>
  (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

export function relativo(iso: string | null) {
  if (!iso) return "";
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (d <= 0) return "hoy";
  if (d === 1) return "ayer";
  if (d < 30) return `hace ${d} d`;
  if (d < 365) return `hace ${Math.floor(d / 30)} m`;
  return `hace ${Math.floor(d / 365)} a`;
}
