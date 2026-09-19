"use client";

import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { supabase } from "@/lib/supabase/client";
import { ordenarPorCodigo, partesCodigo } from "@/lib/codigo";
import type { Caja } from "@/lib/tipos";

/** Hoja imprimible de etiquetas. Cada QR abre /b/<código>, es decir la
 *  app con esa caja ya desplegada y lista para editar. Ese es el
 *  mecanismo que sostiene la disciplina: ya tienes la caja en la mano
 *  cuando escaneas, así que actualizar cuesta un segundo. */
export default function Etiquetas() {
  const sb = useMemo(() => supabase(), []);
  const [cajas, setCajas] = useState<Caja[]>([]);
  const [qrs, setQrs] = useState<Record<string, string>>({});
  const [zona, setZona] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await sb.from("cajas").select("*");
      if (!data) return;
      const lista = (data as Caja[]).sort(ordenarPorCodigo);
      setCajas(lista);

      const base = window.location.origin;
      const mapa: Record<string, string> = {};
      for (const c of lista) {
        mapa[c.codigo] = await QRCode.toDataURL(
          `${base}/b/${encodeURIComponent(c.codigo)}`,
          { margin: 1, width: 400, color: { dark: "#000000", light: "#FFFFFF" } }
        );
      }
      setQrs(mapa);
    })();
  }, [sb]);

  /* Las mismas letras de la lista, derivadas igual: filtrar aquí es la
     única forma de imprimir una zona sola, y una hoja de etiquetas casi
     siempre se imprime por una zona nueva, no por la bodega entera. */
  const zonas = useMemo(
    () =>
      [...new Set(cajas.map((c) => partesCodigo(c.codigo)[0]).filter(Boolean))].sort(),
    [cajas]
  );

  const visibles = useMemo(
    () => (zona ? cajas.filter((c) => partesCodigo(c.codigo)[0] === zona) : cajas),
    [cajas, zona]
  );

  return (
    <div className="wrap">
      <div className="meta no-print" style={{ paddingTop: "3.5rem" }}>
        <span className="izq">
          <span>
            {zona
              ? `${visibles.length} de ${cajas.length} etiquetas`
              : `${cajas.length} etiquetas`}
          </span>
          {zonas.map((z) => (
            <button
              key={z}
              className={`zona${zona === z ? " on" : ""}`}
              onClick={() => setZona(zona === z ? null : z)}
            >
              {z}
            </button>
          ))}
        </span>
        <span className="der">
          {/* La hoja impresa es exactamente la que está en pantalla: no hay
              un segundo criterio escondido en el diálogo de impresión.
              Nombrar la zona en el botón lo dice antes de gastar papel. */}
          <button className="imprimir" onClick={() => window.print()}>
            {zona ? `imprimir ${zona}` : "imprimir"}
          </button>
          <a href="/">volver</a>
        </span>
      </div>

      <div className="etiquetas">
        {visibles.map((c) => (
          <div className="etiqueta" key={c.id}>
            {qrs[c.codigo] && <img src={qrs[c.codigo]} alt={c.codigo} />}
            <span>{c.codigo}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
