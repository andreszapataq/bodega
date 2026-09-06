/** Reduce la foto en el navegador antes de subirla: lado mayor 1400 px,
 *  JPEG 0.72. Baja el almacenamiento y el egress al mismo tiempo. */
export function comprimir(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onerror = () => reject(new Error("no se pudo leer la imagen"));
    lector.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("imagen inválida"));
      img.onload = () => {
        const max = 1400;
        let { width: w, height: h } = img;
        if (w > max || h > max) {
          const f = max / Math.max(w, h);
          w = Math.round(w * f);
          h = Math.round(h * f);
        }
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        c.getContext("2d")!.drawImage(img, 0, 0, w, h);
        c.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("no se pudo comprimir"))),
          "image/jpeg",
          0.72
        );
      };
      img.src = lector.result as string;
    };
    lector.readAsDataURL(file);
  });
}
