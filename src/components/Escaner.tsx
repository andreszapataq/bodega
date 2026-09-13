"use client";

import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { codigoDeQr } from "@/lib/codigo";

/** Lee la etiqueta de una caja con la cámara, sin salir de la app. La
 *  cámara del sistema abre una pestaña nueva por cada QR, que recarga la
 *  lista y las fotos; aquí la lista ya está cargada y solo se abre la caja. */
export default function Escaner({
  onCodigo,
  onCerrar,
}: {
  onCodigo: (codigo: string) => void;
  onCerrar: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  /* Las funciones del padre cambian en cada dibujado. Si la cámara
     dependiera de ellas, se apagaría y volvería a encenderse cada vez que
     la lista de atrás se redibuja. */
  const alLeer = useRef(onCodigo);
  const alCerrar = useRef(onCerrar);
  useEffect(() => {
    alLeer.current = onCodigo;
    alCerrar.current = onCerrar;
  });

  useEffect(() => {
    let vivo = true;
    let flujo: MediaStream | null = null;
    let espera: ReturnType<typeof setTimeout> | undefined;
    const lienzo = document.createElement("canvas");
    const ctx = lienzo.getContext("2d", { willReadFrequently: true });

    /* Se lee el cuadrado central del video, reducido a 640 px: sobra para
       una etiqueta a un palmo, y deja libre el hilo principal entre una
       lectura y otra. El cuadrado es más grande que la mira a propósito,
       para no exigir puntería de pie frente al estante. */
    const mirar = () => {
      if (!vivo) return;
      const video = videoRef.current;
      if (video && ctx && video.readyState >= video.HAVE_CURRENT_DATA && video.videoWidth) {
        const lado = Math.min(video.videoWidth, video.videoHeight);
        const destino = Math.round(Math.min(lado, 640));
        lienzo.width = lienzo.height = destino;
        ctx.drawImage(
          video,
          (video.videoWidth - lado) / 2,
          (video.videoHeight - lado) / 2,
          lado,
          lado,
          0,
          0,
          destino,
          destino
        );
        const imagen = ctx.getImageData(0, 0, destino, destino);
        const leido = jsQR(imagen.data, destino, destino, {
          inversionAttempts: "dontInvert",
        });
        if (leido) {
          const codigo = codigoDeQr(leido.data);
          if (codigo) {
            vivo = false;
            alLeer.current(codigo);
            return;
          }
          setAviso("ese código no es de una caja de la bodega");
        }
      }
      espera = setTimeout(mirar, 150);
    };

    (async () => {
      /* Sin https el navegador ni siquiera ofrece la cámara: pasa al probar
         contra next dev desde el celular. */
      if (!navigator.mediaDevices?.getUserMedia) {
        setAviso("la cámara solo funciona con https. abre la app desde su dirección publicada");
        return;
      }
      try {
        flujo = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment", width: { ideal: 1280 } },
          audio: false,
        });
      } catch (e) {
        setAviso(
          (e as DOMException).name === "NotAllowedError"
            ? "sin permiso para la cámara. actívalo en los ajustes del navegador y vuelve a intentar"
            : "no se pudo abrir la cámara. revisa que ninguna otra app la esté usando"
        );
        return;
      }
      const video = videoRef.current;
      if (!vivo || !video) {
        flujo.getTracks().forEach((t) => t.stop());
        return;
      }
      video.srcObject = flujo;
      await video.play().catch(() => {});
      mirar();
    })();

    const alTeclado = (e: KeyboardEvent) => {
      if (e.key === "Escape") alCerrar.current();
    };
    window.addEventListener("keydown", alTeclado);

    /* Apagar la cámara al salir, no solo dejar de leer: si no, el indicador
       verde del iPhone sigue encendido y la batería se va con él. */
    return () => {
      vivo = false;
      clearTimeout(espera);
      flujo?.getTracks().forEach((t) => t.stop());
      window.removeEventListener("keydown", alTeclado);
    };
  }, []);

  return (
    <div className="escaner">
      {/* playsInline y muted son los que permiten a iOS reproducir la
          cámara dentro de la página y no a pantalla completa aparte. */}
      <video ref={videoRef} playsInline muted autoPlay />
      <div className="escaner-mira" />
      <button className="escaner-x" onClick={onCerrar}>
        cerrar
      </button>
      <div className="escaner-pie">{aviso ?? "apunta al código de la caja"}</div>
    </div>
  );
}
