import Bodega from "@/components/Bodega";

/** Destino del QR pegado en la caja: /b/B-04 abre la app con esa caja
 *  ya desplegada y lista para editar, sin buscarla. */
export default async function Caja({
  params,
}: {
  params: Promise<{ codigo: string }>;
}) {
  const { codigo } = await params;
  return <Bodega codigoInicial={decodeURIComponent(codigo).toUpperCase()} />;
}
