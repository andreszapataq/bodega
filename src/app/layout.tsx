import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const sans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500"],
  variable: "--font-sans",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "bodega",
  description: "Inventario de la bodega de la casa",
};

export const viewport: Viewport = {
  themeColor: "#121212",
  width: "device-width",
  initialScale: 1,
  /* Safari en iOS acerca la página al enfocar un campo de menos de 16px, y
     el código de la caja se edita a .83rem porque ahí es más pequeño que el
     contenido a propósito. Agrandarlo desalinearía esa fila del resto de la
     lista, así que se le quita al navegador el permiso para acercarse. El
     gesto de pellizcar sigue funcionando: iOS lo respeta siempre. */
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
