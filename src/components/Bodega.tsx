"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { comprimir } from "@/lib/imagen";
import { norm, ordenarPorCodigo, partesCodigo, relativo } from "@/lib/codigo";
import { MAX_FOTOS, type Caja } from "@/lib/tipos";

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
  const [porBorrar, setPorBorrar] = useState<string | null>(null);
  const [falloBorrar, setFalloBorrar] = useState<string | null>(null);
  const [visor, setVisor] = useState<{ cajaId: string; i: number } | null>(null);
  const [listo, setListo] = useState(false);
  const [subiendo, setSubiendo] = useState(false);
  const [uid, setUid] = useState<string | null>(null);

  const inputBuscar = useRef<HTMLInputElement>(null);
  const inputFoto = useRef<HTMLInputElement>(null);
  const ultimaZona = useRef<string | null>(null);
  const guardarTimer = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const porGuardar = useRef<Record<string, Partial<Caja>>>({});
  const codigoGuardado = useRef<Record<string, string>>({});

  /* ── carga ───────────────────────────────────────────────── */
  useEffect(() => {
    let vivo = true;
    (async () => {
      const { data: sesion } = await sb.auth.getUser();
      if (!sesion.user) {
        router.replace("/login");
        return;
      }
      if (!vivo) return;
      setUid(sesion.user.id);

      const { data, error } = await sb.from("cajas").select("*");
      if (error || !vivo) return;

      const lista = (data as Caja[]).sort(ordenarPorCodigo);
      setCajas(lista);
      setListo(true);

      if (codigoInicial) {
        const c = lista.find((x) => x.codigo === codigoInicial);
        if (c) setAbierta(c.id);
      }

      /* Las fotos entran después: la lista no espera por las imágenes.
         El bucket es privado, así que se firman las rutas en un lote. */
      const rutas = lista.flatMap((c) => c.fotos || []);
      if (rutas.length) {
        const { data: firmadas } = await sb.storage
          .from("fotos")
          .createSignedUrls(rutas, 60 * 60 * 8);
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
          if (zona && partesCodigo(c.codigo)[0] !== zona) return false;
          if (!terminos.length) return true;
          const heno = norm(c.codigo + " " + c.contenido);
          return terminos.every((t) => heno.includes(t));
        })
        .sort(ordenarPorCodigo),
    [cajas, terminos, zona]
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

  const crear = async () => {
    soltar(abierta);
    const codigo = siguienteCodigo();
    ultimaZona.current = partesCodigo(codigo)[0];
    const { data, error } = await sb
      .from("cajas")
      .insert({ codigo, contenido: "", fotos: [] })
      .select()
      .single();
    if (error || !data) return;
    setCajas((prev) => [...prev, data as Caja].sort(ordenarPorCodigo));
    setAbierta((data as Caja).id);
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
          .createSignedUrl(ruta, 60 * 60 * 8);
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

  const quitarFoto = async (cajaId: string, ruta: string) => {
    const caja = cajas.find((c) => c.id === cajaId);
    if (!caja) return;
    await sb.storage.from("fotos").remove([ruta]);
    tocar(cajaId, { fotos: (caja.fotos || []).filter((f) => f !== ruta) });
    setVisor(null);
  };

  /* ── teclado ─────────────────────────────────────────────── */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const escribiendo =
        document.activeElement instanceof HTMLTextAreaElement ||
        document.activeElement instanceof HTMLInputElement;

      if (visor) {
        const caja = cajas.find((c) => c.id === visor.cajaId);
        const n = caja?.fotos?.length || 0;
        if (e.key === "Escape") setVisor(null);
        if (e.key === "ArrowRight" && n > 1)
          setVisor((v) => v && { ...v, i: (v.i + 1) % n });
        if (e.key === "ArrowLeft" && n > 1)
          setVisor((v) => v && { ...v, i: (v.i - 1 + n) % n });
        return;
      }
      if (e.key === "/" && !escribiendo) {
        e.preventDefault();
        inputBuscar.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visor, cajas]);

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
            autoFocus
            aria-label="Buscar en la bodega"
          />
          {q && (
            <button className="limpiar" onClick={() => setQ("")}>
              limpiar
            </button>
          )}
        </div>

        <div className="meta">
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
              salir
            </button>
          </span>
        </div>
      </div>

      <div className="lista">
        {visibles.map((c) => {
          const esta = abierta === c.id;
          return (
            <div className="fila" key={c.id}>
              {esta ? (
                <div className="linea">
                  <input
                    className="cod cod-edit"
                    value={c.codigo}
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
                        {urls[ruta] && <img src={urls[ruta]} alt="" />}
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
                      cerrar
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {listo && !visibles.length && (
          <div className="nada">
            Nada con «{q || zona}».
            <br />
            <button onClick={crear}>Crear una caja nueva</button> y escribir ahí lo
            que buscas.
          </div>
        )}

        {listo && !!visibles.length && (
          <button className="nueva" onClick={crear}>
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
        <div className="visor" onClick={() => setVisor(null)}>
          {fotoVisor && (
            <div
              className="visor-fondo"
              style={{ backgroundImage: `url(${fotoVisor})` }}
            />
          )}
          <button className="visor-x" onClick={() => setVisor(null)}>
            cerrar
          </button>
          <div className="visor-lienzo">
            {fotoVisor && <img src={fotoVisor} alt={cajaVisor.contenido} />}
          </div>
          <div className="visor-pie" onClick={(e) => e.stopPropagation()}>
            <div className="visor-cod">{cajaVisor.codigo}</div>
            <div className="visor-txt">{cajaVisor.contenido}</div>
            <div className="visor-nav">
              {cajaVisor.fotos.length > 1 && (
                <>
                  <button
                    onClick={() =>
                      setVisor(
                        (v) =>
                          v && {
                            ...v,
                            i: (v.i - 1 + cajaVisor.fotos.length) % cajaVisor.fotos.length,
                          }
                      )
                    }
                  >
                    ←
                  </button>
                  <span>
                    {visor.i + 1} / {cajaVisor.fotos.length}
                  </span>
                  <button
                    onClick={() =>
                      setVisor((v) => v && { ...v, i: (v.i + 1) % cajaVisor.fotos.length })
                    }
                  >
                    →
                  </button>
                </>
              )}
              <button onClick={() => quitarFoto(cajaVisor.id, cajaVisor.fotos[visor.i])}>
                quitar foto
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
