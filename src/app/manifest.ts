import type { MetadataRoute } from "next";

/* Instalada en la pantalla de inicio se abre sin las barras del navegador,
   que eran las que achicaban el visor. Antes eso chocaba con escanear
   desde la cámara del sistema, que abre en Chrome; con el escáner dentro
   de la app ya no hace falta salir. Los colores son --noche: aquí no hay
   CSS del que tomarlos. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "bodega",
    short_name: "bodega",
    description: "Inventario de la bodega de la casa",
    lang: "es",
    start_url: "/",
    display: "standalone",
    background_color: "#121212",
    theme_color: "#121212",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
