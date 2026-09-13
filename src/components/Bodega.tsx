"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { comprimir } from "@/lib/imagen";
import { norm, ordenarPorCodigo, partesCodigo, relativo } from "@/lib/codigo";
import { MAX_FOTOS, type Caja } from "@/lib/tipos";

/* Cuánto vale una URL firmada. Ocho horas cubren de sobra una vuelta por
   el estante; lo que no cubren es la pestaña que queda abierta de un día
   para otro, y de eso se encarga refirmar(). */
const VALIDEZ_FIRMA = 60 * 60 * 8;

/** Resalta los términos de búsqueda dentro del texto de la caja. */
function Resaltado({ texto, terminos }: { texto: string; terminos: string[] }) {
  if (!terminos.length) return <>{texto}</>;
  const base = norm(texto);
  const marcas = new Array(texto.length).fill(false);
  terminos.forEach((t) => {
    let i = base.indexOf(t);
    while (i !== -1) {
      for (let k = i; k < i + t.length; k++) marcas[k] = true;
      i = base.indexOf(t, i + t.length);
    }
  });
  const partes: { t: string; on: boolean }[] = [];
  let buf = "";
  let estado = marcas[0];
  for (let i = 0; i < texto.length; i++) {
    if (marcas[i] !== estado) {
      partes.push({ t: buf, on: estado });
      buf = "";
      estado = marcas[i];
    }
    buf += texto[i];
  }
  partes.push({ t: buf, on: estado });
  return (
    <>
      {partes.map((p, i) =>
        p.on ? <mark key={i}>{p.t}</mark> : <span key={i}>{p.t}</span>
      )}
    </>
  );
}

export default function Bodega({ codigoInicial }: { codigoInicial?: string }) {
  const sb = useMemo(() => supabase(), []);
  const router = useRouter();

  const [cajas, setCajas] = useState<Caja[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [q, setQ] = useState("");
  const [zona, setZona] = useState<string | null>(null);
  const [abierta, setAbierta] = useState<string | null>(null);
  const [etiquetaMuerta, setEtiquetaMuerta] = useState<string | null>(null);
  const [porBorrar, setPorBorrar] = useState<string | null>(null);
  const [falloBorrar, setFalloBorrar] = useState<string | null>(null);
  const [visor, setVisor] = useState<{ cajaId: string; i: number } | null>(null);
  const [fotoPorQuitar, setFotoPorQuitar] = useState<string | null>(null);
  const [ampliada, setAmpliada] = useState(false);
  const [listo, setListo] = useState(false);
  const [subiendo, setSubiendo] = useState(false);
  const [uid, setUid] = useState<string | null>(null);

  const inputBuscar = useRef<HTMLInputElement>(null);
  const inputFoto = useRef<HTMLInputElement>(null);
  const tacto = useRef<{ x: number; y: number; arrastro: boolean } | null>(null);
  const ultimaZona = useRef<string | null>(null);
  const guardarTimer = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const porGuardar = useRef<Record<string, Partial<Caja>>>({});
  const codigoGuardado = useRef<Record<string, string>>({});
  const filaAbierta = useRef<HTMLDivElement>(null);
  const llevarArriba = useRef<string | null>(null);

  /* La caja escaneada se abre donde le toca en el estante, y si le toca
     abajo quedaba fuera de la pantalla. Solo la del QR se lleva arriba:
     abrir una caja tocándola ya la tiene uno a la vista, y moverle la
     página ahí sería quitarle el lugar que estaba mirando. Se espera a las
     fuentes porque cambiar de letra reacomoda las líneas de las cajas de
     arriba, y la caja terminaría corrida de donde se la dejó. */
  useEffect(() => {
    if (!abierta || abierta !== llevarArriba.current) return;
    llevarArriba.current = null;
    void document.fonts.ready.then(() =>
      filaAbierta.current?.scrollIntoView({ block: "start" })
    );
  }, [abierta]);

  /* ── carga ───────────────────────────────────────────────── */
  useEffect(() => {
    let vivo = true;
    (async () => {
      const { data: sesion } = await sb.auth.getUser();
      if (!sesion.user) {
        /* El código escaneado viaja al login para poder volver aquí. Sin
           esto se pierde, y entrar te deja en la lista general con la
           caja todavía en la mano. */
        const destino = window.location.pathname;
        router.replace(
          destino === "/" ? "/login" : `/login?volver=${encodeURIComponent(destino)}`
        );
        return;
      }
      if (!vivo) return;
      setUid(sesion.user.id);

      const { data, error } = await sb.from("cajas").select("*");
      if (error || !vivo) return;

      const lista = (data as Caja[]).sort(ordenarPorCodigo);
      setCajas(lista);
      setListo(true);

      /* Una etiqueta pegada puede sobrevivir a su caja: los números no se
         reciclan justamente porque eso pasa. Si el código escaneado ya no
         existe hay que decirlo, no dejar la lista general sin explicar. */
      if (codigoInicial) {
        const c = lista.find((x) => x.codigo === codigoInicial);
        if (c) {
          llevarArriba.current = c.id;
          setAbierta(c.id);
        } else setEtiquetaMuerta(codigoInicial);
      }

      /* Las fotos entran después: la lista no espera por las imágenes.
         El bucket es privado, así que se firman las rutas en un lote. */
      const rutas = lista.flatMap((c) => c.fotos || []);
      if (rutas.length) {
        const { data: firmadas } = await sb.storage
          .from("fotos")
          .createSignedUrls(rutas, VALIDEZ_FIRMA);
        if (firmadas && vivo) {
          const mapa: Record<string, string> = {};
          firmadas.forEach((f) => {
            if (f.path && f.signedUrl) mapa[f.path] = f.signedUrl;
          });
          setUrls((u) => ({ ...u, ...mapa }));
        }
      }
    })();
    return () => {
      vivo = false;
    };
  }, [sb, router, codigoInicial]);

  /* El celular no cierra las pestañas: la app vuelve del bolsillo al día
     siguiente con el mismo DOM y unas URLs que ya vencieron. El navegador
     había soltado esas imágenes de memoria, las vuelve a pedir con el token
     viejo y recibe un 400 —el icono roto que solo se iba refrescando otra
     vez, porque el segundo refresco sí vuelve a firmar—. Aquí se firma de
     nuevo al primer fallo, lo que además cubre la foto que no llegó porque
     la red del celular todavía estaba dormida.
     Se descarta la URL que falló y no la ruta: la pestaña puede seguir viva
     al otro día y vencer otra vez, y la foto tiene que poder recuperarse
     tantas veces como haga falta. */
  const vencidas = useRef(new Set<string>());

  const refirmar = useCallback(
    async (ruta: string) => {
      /* Una sola refirma por ráfaga: las URLs vencen todas juntas, porque
         salieron del mismo lote, así que el primer icono roto renueva la
         lista entera y las demás ya no piden nada. */
      if (!urls[ruta] || vencidas.current.has(urls[ruta])) return;
      const rutas = cajas.flatMap((c) => c.fotos || []);
      rutas.forEach((r) => urls[r] && vencidas.current.add(urls[r]));
      const { data } = await sb.storage
        .from("fotos")
        .createSignedUrls(rutas, VALIDEZ_FIRMA);
      if (!data) return;
      const mapa: Record<string, string> = {};
      data.forEach((f) => {
        if (f.path && f.signedUrl) mapa[f.path] = f.signedUrl;
      });
      setUrls((u) => ({ ...u, ...mapa }));
    },
    [sb, cajas, urls]
  );

  /* ── escritura ───────────────────────────────────────────── */

  /** Vacía contra Postgres lo que una caja tenga pendiente. Vive aparte de
   *  tocar() porque el temporizador no es la única forma de llegar aquí:
   *  irse de la app también tiene que poder forzar la escritura. */
  const escribir = useCallback(
    async (id: string) => {
      const cambios = porGuardar.current[id];
      clearTimeout(guardarTimer.current[id]);
      delete guardarTimer.current[id];
      delete porGuardar.current[id];
      if (!cambios) return;
      const { error } = await sb.from("cajas").update(cambios).eq("id", id);
      if (error) console.error("no se pudo guardar la caja", error);
    },
    [sb]
  );

  /** Bloquear el celular o cambiar de app suspende la pestaña, y los 600 ms
   *  que faltaban no llegan a cumplirse: ese último cambio se perdía. De
   *  pie frente al estante, irse así es lo normal, no la excepción. */
  const guardarPendientes = useCallback(
    () => Promise.all(Object.keys(porGuardar.current).map((id) => escribir(id))),
    [escribir]
  );

  useEffect(() => {
    const alOcultar = () => {
      if (document.visibilityState === "hidden") void guardarPendientes();
    };
    document.addEventListener("visibilitychange", alOcultar);
    return () => {
      document.removeEventListener("visibilitychange", alOcultar);
      void guardarPendientes();
    };
  }, [guardarPendientes]);

  /** El estado responde al instante; la escritura a Postgres se agrupa
   *  cada 600 ms por caja, para no mandar un UPDATE por tecla.
   *
   *  Los cambios se acumulan en vez de reemplazarse: cada llamada reinicia
   *  el temporizador, así que quedarse solo con los últimos perdería el
   *  campo que se tocó justo antes. Pasar del código al contenido en menos
   *  de 600 ms basta para que el código no llegue nunca a la base. */
  const tocar = useCallback(
    (id: string, cambios: Partial<Caja>) => {
      const actualizado = new Date().toISOString();
      setCajas((prev) =>
        prev.map((c) => (c.id === id ? { ...c, ...cambios, actualizado } : c))
      );
      porGuardar.current[id] = { ...porGuardar.current[id], ...cambios, actualizado };
      clearTimeout(guardarTimer.current[id]);
      guardarTimer.current[id] = setTimeout(() => {
        void escribir(id);
      }, 600);
    },
    [escribir]
  );

  /* Postgres ya rechaza el código repetido por la restricción única, pero
     ese error solo llegaba a la consola: la pantalla se quedaba mostrando
     un código que la base nunca aceptó. La lista entera está en memoria,
     así que el choque se ve aquí, mientras escribes. La comparación es
     exacta a propósito: tiene que decir lo mismo que la restricción. */
  const chocaCodigo = (id: string, codigo: string) =>
    cajas.some((c) => c.id !== id && c.codigo === codigo);

  const cambiarCodigo = (id: string, valor: string) => {
    const v = valor.toUpperCase();
    ultimaZona.current = partesCodigo(v)[0] || null;
    /* Lo escrito se ve aunque choque, porque si no no habría cómo
       corregirlo; lo que no ocurre es la escritura, y la línea lo dice. */
    if (chocaCodigo(id, v)) {
      codigoGuardado.current[id] ??= cajas.find((c) => c.id === id)?.codigo ?? "";
      setCajas((prev) => prev.map((c) => (c.id === id ? { ...c, codigo: v } : c)));
      return;
    }
    codigoGuardado.current[id] = v;
    tocar(id, { codigo: v });
  };

  /* Al dejar la caja, un código repetido no puede quedarse en pantalla: la
     base conserva el anterior y la lista mostraría dos iguales, que es
     justo lo que un estante no puede permitirse. */
  const soltar = (id: string | null) => {
    if (!id) return;
    setCajas((prev) => {
      const c = prev.find((x) => x.id === id);
      const guardado = codigoGuardado.current[id];
      if (!c || guardado === undefined || !prev.some((o) => o.id !== id && o.codigo === c.codigo))
        return prev;
      return prev.map((x) => (x.id === id ? { ...x, codigo: guardado } : x));
    });
    delete codigoGuardado.current[id];
  };

  const terminos = useMemo(() => norm(q).split(/\s+/).filter(Boolean), [q]);

  const zonas = useMemo(
    () =>
      [...new Set(cajas.map((c) => partesCodigo(c.codigo)[0]).filter(Boolean))].sort(),
    [cajas]
  );

  /* Orden fijo por código: la lista es el estante, no un flujo de
     actividad. Nada la reordena mientras trabajas. */
  const visibles = useMemo(
    () =>
      cajas
        .filter((c) => {
          /* La caja abierta nunca se filtra a sí misma: escribir dentro de
             ella cambia el texto que el filtro está mirando, y sin esto la
             fila desaparecía bajo los dedos —con el teclado abierto— apenas
             borrabas la palabra que habías buscado. */
          if (c.id === abierta) return true;
          if (zona && partesCodigo(c.codigo)[0] !== zona) return false;
          if (!terminos.length) return true;
          const heno = norm(c.codigo + " " + c.contenido);
          return terminos.every((t) => heno.includes(t));
        })
        .sort(ordenarPorCodigo),
    [cajas, terminos, zona, abierta]
  );

  /* Zona sugerida: la filtrada, si no la última en la que estuviste
     trabajando, si no la que más cajas tiene. Etiquetar ocurre por
     tandas dentro de un mismo sitio. */
  const zonaSugerida = () => {
    if (zona) return zona;
    if (ultimaZona.current) return ultimaZona.current;
    const cuenta: Record<string, number> = {};
    cajas.forEach((c) => {
      const z = partesCodigo(c.codigo)[0];
      if (z) cuenta[z] = (cuenta[z] || 0) + 1;
    });
    return Object.keys(cuenta).sort((a, b) => cuenta[b] - cuenta[a])[0] || "B";
  };

  /* Nunca rellena huecos: toma el mayor de la zona y suma uno, para que
     el número de una caja borrada no reviva en una etiqueta nueva. */
  const siguienteCodigo = () => {
    const p = zonaSugerida();
    const usados = cajas
      .filter((c) => partesCodigo(c.codigo)[0] === p)
      .map((c) => partesCodigo(c.codigo)[1]);
    const n = (usados.length ? Math.max(...usados) : 0) + 1;
    return `${p}-${String(n).padStart(2, "0")}`;
  };

  /* Con código fijo se crea la caja que la etiqueta ya nombra, para poder
     reusar la calcomanía pegada en vez de despegarla. Sin argumento sigue
     el consecutivo de siempre. */
  const crear = async (codigoFijo?: string) => {
    soltar(abierta);
    const codigo = codigoFijo ?? siguienteCodigo();
    ultimaZona.current = partesCodigo(codigo)[0];
    const { data, error } = await sb
      .from("cajas")
      .insert({ codigo, contenido: "", fotos: [] })
      .select()
      .single();
    if (error || !data) return;
    setCajas((prev) => [...prev, data as Caja].sort(ordenarPorCodigo));
    setAbierta((data as Caja).id);
    setEtiquetaMuerta(null);
    setQ("");
  };

  const borrar = async (id: string) => {
    const caja = cajas.find((c) => c.id === id);

    /* La fila antes que las fotos: si el DELETE falla, las fotos siguen en
       su sitio y la caja queda entera. Al revés quedaba una caja viva
       apuntando a fotos ya borradas. */
    const { error } = await sb.from("cajas").delete().eq("id", id);
    if (error) {
      console.error("no se pudo borrar la caja", error);
      setFalloBorrar(id);
      setPorBorrar(null);
      return;
    }

    /* Recién con el DELETE confirmado se cancela lo pendiente: si hubiera
       fallado, esos últimos 600 ms de escritura todavía hacían falta. */
    clearTimeout(guardarTimer.current[id]);
    delete guardarTimer.current[id];
    delete porGuardar.current[id];
    delete codigoGuardado.current[id];

    if (caja?.fotos?.length) await sb.storage.from("fotos").remove(caja.fotos);
    setCajas((prev) => prev.filter((c) => c.id !== id));
    setAbierta(null);
    setPorBorrar(null);
    setFalloBorrar(null);
  };

  const subirFotos = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const caja = cajas.find((c) => c.id === abierta);
    const cupo = MAX_FOTOS - (caja?.fotos?.length || 0);
    const archivos = [...(e.target.files || [])].slice(0, Math.max(cupo, 0));
    e.target.value = "";
    if (!archivos.length || !caja || !uid) return;

    setSubiendo(true);
    const nuevas: string[] = [];
    for (const f of archivos) {
      try {
        const blob = await comprimir(f);
        const ruta = `${uid}/${crypto.randomUUID()}.jpg`;
        const { error } = await sb.storage
          .from("fotos")
          .upload(ruta, blob, { contentType: "image/jpeg" });
        if (error) throw error;
        const { data: firmada } = await sb.storage
          .from("fotos")
          .createSignedUrl(ruta, VALIDEZ_FIRMA);
        if (firmada?.signedUrl)
          setUrls((u) => ({ ...u, [ruta]: firmada.signedUrl }));
        nuevas.push(ruta);
      } catch (err) {
        console.error("no se pudo subir la foto", err);
      }
    }
    if (nuevas.length) tocar(caja.id, { fotos: [...(caja.fotos || []), ...nuevas] });
    setSubiendo(false);
  };

  /* ── acercar la foto ─────────────────────────────────────── */

  const lienzoRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  /* La escala vive en un ref y no en el estado: el pellizco la cambia
     sesenta veces por segundo y eso redibujaría la lista entera. React
     solo necesita saber si hay acercamiento o no; el ancho lo lleva el
     DOM. anchoAjustado es el ancho de la foto cuando cabe en la pantalla,
     que es el 1 del que parten todas las escalas. */
  const escala = useRef(1);
  const anchoAjustado = useRef(0);
  const pellizco = useRef<{ dedos: number; escala: number } | null>(null);

  const restablecerZoom = useCallback(() => {
    escala.current = 1;
    pellizco.current = null;
    if (imgRef.current) imgRef.current.style.width = "";
    lienzoRef.current?.classList.remove("ampliada");
    setAmpliada(false);
  }, []);

  /** Cambia el ancho de la foto y deja quieto el punto que hay entre los
   *  dedos. Sin ese anclaje el acercamiento se va hacia una esquina y
   *  pierdes lo que estabas mirando, que es justo la sensación de control
   *  que da el pellizco. Se mide con los rectángulos reales para no tener
   *  que replicar el centrado ni el relleno del contenedor. */
  const aplicarEscala = useCallback(
    (pedida: number, cx?: number, cy?: number) => {
      const img = imgRef.current;
      const cont = lienzoRef.current;
      if (!img || !cont) return;
      /* Estando ajustada, lo que mide ahora es el 1. */
      if (escala.current === 1) anchoAjustado.current = img.getBoundingClientRect().width;
      const base = anchoAjustado.current;
      /* El tope es el tamaño real del archivo: más allá solo se agrandan
         los píxeles. Una foto más chica que la pantalla no se acerca. */
      const tope = base && img.naturalWidth ? Math.max(img.naturalWidth / base, 1) : 1;
      const nueva = Math.min(Math.max(pedida, 1), tope);
      if (nueva <= 1.01) {
        restablecerZoom();
        return;
      }
      const marco = cont.getBoundingClientRect();
      const px = cx ?? marco.left + marco.width / 2;
      const py = cy ?? marco.top + marco.height / 2;
      const antes = img.getBoundingClientRect();
      const fx = (px - antes.left) / antes.width;
      const fy = (py - antes.top) / antes.height;

      escala.current = nueva;
      /* La clase se pone también a mano porque el ancho se aplica en esta
         misma línea, y el estado de React llega un dibujado tarde. */
      cont.classList.add("ampliada");
      setAmpliada(true);
      img.style.width = `${base * nueva}px`;

      const ahora = img.getBoundingClientRect();
      cont.scrollLeft += ahora.left + fx * ahora.width - px;
      cont.scrollTop += ahora.top + fy * ahora.height - py;
    },
    [restablecerZoom]
  );

  const cerrarVisor = useCallback(() => {
    setVisor(null);
    setFotoPorQuitar(null);
    restablecerZoom();
  }, [restablecerZoom]);

  const quitarFoto = async (cajaId: string, ruta: string) => {
    const caja = cajas.find((c) => c.id === cajaId);
    if (!caja) return;
    await sb.storage.from("fotos").remove([ruta]);
    tocar(cajaId, { fotos: (caja.fotos || []).filter((f) => f !== ruta) });
    cerrarVisor();
  };

  /* ── visor ───────────────────────────────────────────────── */

  /** Un solo paso para las tres formas de pasar de foto: flechas, botones y
   *  dedo. Da la vuelta en los extremos, que en tres fotos es lo natural. */
  const moverVisor = useCallback(
    (paso: number) => {
      setVisor((v) => {
        if (!v) return v;
        const n = cajas.find((c) => c.id === v.cajaId)?.fotos?.length || 0;
        return n > 1 ? { ...v, i: (v.i + paso + n) % n } : v;
      });
      /* Cada foto se abre entera: el acercamiento era de la anterior. */
      restablecerZoom();
    },
    [cajas, restablecerZoom]
  );

  /* El pellizco va con escuchas nativos y no con los de React: hay que
     poder cancelar el gesto para que el navegador no desplace el
     contenedor mientras dos dedos se separan, y los de React no pueden
     porque llegan como pasivos. El arrastre de un dedo sí lo deja pasar:
     recorrer la foto ampliada es el desplazamiento de siempre, y el
     navegador lo hace mejor que nosotros. */
  useEffect(() => {
    const cont = lienzoRef.current;
    if (!visor || !cont) return;
    const separacion = (t: TouchList) =>
      Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);

    const empezar = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      pellizco.current = { dedos: separacion(e.touches), escala: escala.current };
    };
    const mover = (e: TouchEvent) => {
      const p = pellizco.current;
      if (!p || e.touches.length !== 2) return;
      e.preventDefault();
      const t = e.touches;
      aplicarEscala(
        (p.escala * separacion(t)) / p.dedos,
        (t[0].clientX + t[1].clientX) / 2,
        (t[0].clientY + t[1].clientY) / 2
      );
    };
    const terminar = (e: TouchEvent) => {
      if (e.touches.length < 2) pellizco.current = null;
    };

    cont.addEventListener("touchstart", empezar, { passive: false });
    cont.addEventListener("touchmove", mover, { passive: false });
    cont.addEventListener("touchend", terminar);
    cont.addEventListener("touchcancel", terminar);
    return () => {
      cont.removeEventListener("touchstart", empezar);
      cont.removeEventListener("touchmove", mover);
      cont.removeEventListener("touchend", terminar);
      cont.removeEventListener("touchcancel", terminar);
    };
  }, [visor, aplicarEscala]);

  /* Safari amplía la página entera con el pellizco —ignora maximumScale— y
     ese zoom no se iba al cerrar la foto, porque nunca fue de la foto:
     quedaba la lista ampliada. Mientras el visor está abierto el
     acercamiento es nuestro, así que el gesto del navegador sobra. Fuera
     del visor sigue funcionando, que es lo que exige accesibilidad. */
  useEffect(() => {
    if (!visor) return;
    const parar = (e: Event) => e.preventDefault();
    const gestos = ["gesturestart", "gesturechange"];
    gestos.forEach((g) => window.addEventListener(g, parar, { passive: false }));
    return () => gestos.forEach((g) => window.removeEventListener(g, parar));
  }, [visor]);

  /* El deslizar del dedo comparte el visor con el toque que lo cierra, así
     que hay que distinguirlos: si el dedo se movió, el click que iOS manda
     después no es un toque, es la cola del gesto, y no debe cerrar nada. */
  const alTocar = (e: React.TouchEvent) => {
    const t = e.touches[0];
    tacto.current = { x: t.clientX, y: t.clientY, arrastro: false };
  };

  const alDeslizar = (e: React.TouchEvent) => {
    const p = tacto.current;
    if (!p) return;
    /* Dos dedos son un pellizco para mirar la foto de cerca, no un gesto de
       pasar: se abandona el que estaba en curso en vez de resolverlo mal. */
    if (e.touches.length > 1) {
      tacto.current = null;
      return;
    }
    const t = e.touches[0];
    if (Math.abs(t.clientX - p.x) > 10 || Math.abs(t.clientY - p.y) > 10)
      p.arrastro = true;
  };

  const alSoltarDedo = (e: React.TouchEvent) => {
    const p = tacto.current;
    if (!p) return;
    /* Con la foto acercada el arrastre horizontal la recorre, no pasa a la
       siguiente: el desplazamiento es del contenedor y no nuestro. Se mira
       el ref y no el estado porque durante el gesto va un dibujado por
       delante. */
    if (escala.current > 1) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - p.x;
    const dy = t.clientY - p.y;
    /* Solo cuenta si avanza más de lo que se desvía: un movimiento que iba
       hacia arriba no debe terminar cambiando de foto. */
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) moverVisor(dx < 0 ? 1 : -1);
  };

  /* ── teclado ─────────────────────────────────────────────── */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const escribiendo =
        document.activeElement instanceof HTMLTextAreaElement ||
        document.activeElement instanceof HTMLInputElement;

      if (visor) {
        if (e.key === "Escape") cerrarVisor();
        if (e.key === "ArrowRight") moverVisor(1);
        if (e.key === "ArrowLeft") moverVisor(-1);
        return;
      }
      if (e.key === "/" && !escribiendo) {
        e.preventDefault();
        inputBuscar.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visor, cerrarVisor, moverVisor]);

  const cajaVisor = visor ? cajas.find((c) => c.id === visor.cajaId) : null;
  const fotoVisor = cajaVisor ? urls[cajaVisor.fotos[visor!.i]] : null;

  return (
    <div className="wrap">
      <div className="buscar">
        <div className="campo">
          <span>⌕</span>
          <input
            ref={inputBuscar}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="qué estás buscando"
            autoCapitalize="none"
            /* Quien escanea ya tiene la caja en la mano: no viene a buscar,
               y el teclado abierto le tapaba justo la caja que escaneó. */
            autoFocus={!codigoInicial}
            aria-label="Buscar en la bodega"
          />
          {q && (
            <button className="limpiar" onClick={() => setQ("")}>
              limpiar
            </button>
          )}
        </div>

        <div className="meta">
          {/* El contador y las zonas van juntos porque son lo que crece:
              envuelven hacia abajo entre ellos y dejan quieta la navegación
              de la derecha. */}
          <span className="izq">
            <span>
              {!listo
                ? "abriendo"
                : terminos.length || zona
                ? `${visibles.length} de ${cajas.length} cajas`
                : `${cajas.length} cajas`}
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
            <a href="/etiquetas">etiquetas</a>
            <button
              onClick={async () => {
                /* Sin la sesión no hay permiso para escribir: lo pendiente
                   tiene que salir antes, no 600 ms después. */
                await guardarPendientes();
                await sb.auth.signOut();
                router.replace("/login");
              }}
            >
              {/* Dice la acción entera: «salir» se leía como salir de la caja
                  abierta, que es lo que uno está mirando cuando lo lee. */}
              cerrar sesión
            </button>
          </span>
        </div>
      </div>

      {etiquetaMuerta && (
        <div className="muerta">
          <span>
            no existe ninguna caja <strong>{etiquetaMuerta}</strong>
          </span>
          <button onClick={() => crear(etiquetaMuerta)}>crear {etiquetaMuerta}</button>
          <button className="descartar" onClick={() => setEtiquetaMuerta(null)}>
            descartar
          </button>
        </div>
      )}

      <div className="lista">
        {visibles.map((c) => {
          const esta = abierta === c.id;
          return (
            <div className="fila" key={c.id} ref={esta ? filaAbierta : undefined}>
              {esta ? (
                <div className="linea">
                  {/* Cinco con el guión: B-04 es una ubicación, no un
                      nombre. Es también lo que cabe en el campo sin que el
                      texto se desplace y sin que el código empuje el
                      contenido de la fila. */}
                  <input
                    className="cod cod-edit"
                    value={c.codigo}
                    maxLength={5}
                    aria-label="Código de la caja"
                    onChange={(e) => cambiarCodigo(c.id, e.target.value)}
                  />
                  {chocaCodigo(c.id, c.codigo) && (
                    <span className="aviso">ya existe, sin guardar</span>
                  )}
                </div>
              ) : (
                <button
                  className="linea"
                  onClick={() => {
                    soltar(abierta);
                    setAbierta(c.id);
                    setPorBorrar(null);
                    setFalloBorrar(null);
                  }}
                >
                  <span className="cod">{c.codigo}</span>
                  <span className="txt">
                    {c.contenido ? (
                      <Resaltado texto={c.contenido} terminos={terminos} />
                    ) : (
                      <span className="sin">caja sin describir</span>
                    )}
                  </span>
                  {!!c.fotos?.length && (
                    <span className="conteo">{c.fotos.length} ▣</span>
                  )}
                </button>
              )}

              {esta && (
                <div className="detalle">
                  <textarea
                    className="edit"
                    value={c.contenido}
                    rows={1}
                    placeholder="qué hay adentro, separado por comas"
                    /* El contenido se escribe en minúscula y el teclado del
                       celular ponía mayúscula al empezar, que había que ir a
                       deshacer. El autocorrector se queda: es quien pone las
                       tildes. */
                    autoCapitalize="none"
                    onChange={(e) => tocar(c.id, { contenido: e.target.value })}
                    ref={(el) => {
                      if (el) {
                        el.style.height = "auto";
                        el.style.height = el.scrollHeight + "px";
                      }
                    }}
                  />

                  <div className="tiras">
                    {(c.fotos || []).map((ruta, i) => (
                      <button
                        key={ruta}
                        className={`tira${urls[ruta] ? "" : " cargando"}`}
                        onClick={() => urls[ruta] && setVisor({ cajaId: c.id, i })}
                        aria-label={`Ver foto ${i + 1} de ${c.codigo}`}
                      >
                        {urls[ruta] && (
                          <img src={urls[ruta]} alt="" onError={() => refirmar(ruta)} />
                        )}
                      </button>
                    ))}
                    {(c.fotos?.length || 0) < MAX_FOTOS && (
                      <button
                        className="mas-foto"
                        onClick={() => inputFoto.current?.click()}
                        disabled={subiendo}
                      >
                        {subiendo ? "…" : "+ foto"}
                      </button>
                    )}
                  </div>

                  <div className="acciones">
                    <span>{relativo(c.actualizado)}</span>
                    {porBorrar === c.id ? (
                      <>
                        <span className="confirmar">¿borrar {c.codigo}?</span>
                        <button className="confirmar" onClick={() => borrar(c.id)}>
                          sí
                        </button>
                        <button onClick={() => setPorBorrar(null)}>no</button>
                      </>
                    ) : (
                      <button
                        className="peligro"
                        onClick={() => {
                          setPorBorrar(c.id);
                          setFalloBorrar(null);
                        }}
                      >
                        borrar
                      </button>
                    )}
                    {falloBorrar === c.id && (
                      <span className="aviso">
                        no se pudo borrar, revisa la conexión
                      </span>
                    )}
                    <button
                      onClick={() => {
                        soltar(c.id);
                        setAbierta(null);
                      }}
                    >
                      {/* «listo» y no «cerrar»: describe lo que acabas de
                          hacer con la caja, y no repite el verbo de cerrar
                          sesión, que está arriba en la misma pantalla. */}
                      listo
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {listo && !visibles.length && (
          <div className="nada">
            {/* Tres vacíos distintos que antes decían lo mismo. El de la
                zona sola parece imposible —las zonas salen de las cajas que
                existen— pero pasa: basta cambiarle el código a la última
                caja de la zona que estás filtrando. */}
            {!cajas.length ? (
              <>
                la bodega está vacía.
                <br />
                <button onClick={() => crear()}>crear la primera caja</button> y
                escribir qué hay adentro.
              </>
            ) : q ? (
              <>
                {/* Nombrar la zona evita concluir que no tenés algo cuando
                    en realidad está en otra. */}
                nada con «{q}»{zona && ` dentro de la zona ${zona}`}.
                <br />
                <button onClick={() => crear()}>crear una caja nueva</button> y
                escribir ahí lo que buscas.
              </>
            ) : (
              <>
                ya no queda ninguna caja en la zona {zona}.
                <br />
                <button onClick={() => setZona(null)}>ver todas</button> o{" "}
                <button onClick={() => crear()}>crear una caja nueva</button>.
              </>
            )}
          </div>
        )}

        {listo && !!visibles.length && (
          <button className="nueva" onClick={() => crear()}>
            <span>+</span> nueva caja {siguienteCodigo()}
          </button>
        )}
      </div>

      <input
        ref={inputFoto}
        type="file"
        accept="image/*"
        multiple
        style={{ display: "none" }}
        onChange={subirFotos}
      />

      {visor && cajaVisor && (
        <div
          className="visor"
          onClick={() => {
            if (!tacto.current?.arrastro) cerrarVisor();
          }}
          onTouchStart={alTocar}
          onTouchMove={alDeslizar}
          onTouchEnd={alSoltarDedo}
        >
          {fotoVisor && (
            <div
              className="visor-fondo"
              style={{ backgroundImage: `url(${fotoVisor})` }}
            />
          )}
          <button className="visor-x" onClick={cerrarVisor}>
            cerrar
          </button>
          <div ref={lienzoRef} className={`visor-lienzo${ampliada ? " ampliada" : ""}`}>
            {fotoVisor && (
              /* El toque es el atajo del pellizco: lleva de una vez al
                 tamaño real y de vuelta. En escritorio es el único camino,
                 porque ahí no hay dos dedos que leer. Antes tocarla cerraba
                 el visor; cerrar quedó en el fondo, el pie y el botón. */
              <img
                ref={imgRef}
                src={fotoVisor}
                alt={cajaVisor.contenido}
                onError={() => refirmar(cajaVisor.fotos[visor.i])}
                onClick={(e) => {
                  e.stopPropagation();
                  /* Recorrer la foto ampliada termina en un click que no es
                     un toque: es la cola del arrastre, igual que al cerrar. */
                  if (tacto.current?.arrastro) return;
                  if (escala.current > 1) restablecerZoom();
                  else aplicarEscala(Infinity); // hasta donde dé el archivo
                }}
              />
            )}
          </div>
          <div className="visor-pie" onClick={(e) => e.stopPropagation()}>
            <div className="visor-cod">{cajaVisor.codigo}</div>
            <div className="visor-txt">{cajaVisor.contenido}</div>
            <div className="visor-nav">
              {cajaVisor.fotos.length > 1 && (
                <>
                  <button onClick={() => moverVisor(-1)}>←</button>
                  <span>
                    {visor.i + 1} / {cajaVisor.fotos.length}
                  </span>
                  <button onClick={() => moverVisor(1)}>→</button>
                </>
              )}
              {/* Igual que al borrar una caja: la confirmación ocurre en la
                  misma línea, sin diálogos. La foto sigue a la vista mientras
                  se decide, que es lo único que hace falta para decidir. */}
              {fotoPorQuitar === cajaVisor.fotos[visor.i] ? (
                /* La pregunta y sus dos respuestas van en un grupo propio
                   para que no se separen: en un iPhone la fila completa se
                   pasaba por unos pocos píxeles y el «no» quedaba solo en
                   la línea de abajo, lejos del «sí» al que contesta. */
                <span className="visor-confirmar">
                  <span className="confirmar">¿quitar foto?</span>
                  <button
                    className="confirmar"
                    onClick={() => quitarFoto(cajaVisor.id, cajaVisor.fotos[visor.i])}
                  >
                    sí
                  </button>
                  <button onClick={() => setFotoPorQuitar(null)}>no</button>
                </span>
              ) : (
                <button
                  className="peligro"
                  onClick={() => setFotoPorQuitar(cajaVisor.fotos[visor.i])}
                >
                  quitar foto
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
