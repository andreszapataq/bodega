"use client";

import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { supabase } from "@/lib/supabase/client";
import { ordenarPorCodigo } from "@/lib/codigo";
import type { Caja } from "@/lib/tipos";

/** Hoja imprimible de etiquetas. Cada QR abre /b/<código>, es decir la
 *  app con esa caja ya desplegada y lista para editar. Ese es el
 *  mecanismo que sostiene la disciplina: ya tienes la caja en la mano
 *  cuando escaneas, así que actualizar cuesta un segundo. */
export default function Etiquetas() {
  const sb = useMemo(() => supabase(), []);
  const [cajas, setCajas] = useState<Caja[]>([]);
  const [qrs, setQrs] = useState<Record<string, string>>({});

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

  return (
    <div className="wrap">
      <div className="meta no-print" style={{ paddingTop: "3.5rem" }}>
        <span>{cajas.length} etiquetas</span>
        <span className="der">
          <button onClick={() => window.print()}>imprimir</button>
          <a href="/">volver</a>
        </span>
      </div>

      <div className="etiquetas">
        {cajas.map((c) => (
          <div className="etiqueta" key={c.id}>
            {qrs[c.codigo] && <img src={qrs[c.codigo]} alt={c.codigo} />}
            <span>{c.codigo}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
