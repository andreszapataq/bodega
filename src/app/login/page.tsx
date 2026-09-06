"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

export default function Login() {
  const [correo, setCorreo] = useState("");
  const [clave, setClave] = useState("");
  const [error, setError] = useState("");
  const [entrando, setEntrando] = useState(false);
  const router = useRouter();

  const entrar = async () => {
    setEntrando(true);
    setError("");
    const { error } = await supabase().auth.signInWithPassword({
      email: correo,
      password: clave,
    });
    setEntrando(false);
    if (error) setError("Ese correo y contraseña no coinciden.");
    else router.replace("/");
  };

  return (
    <div className="login">
      <h1>bodega</h1>

      <label htmlFor="correo">correo</label>
      <input
        id="correo"
        type="email"
        autoComplete="email"
        value={correo}
        onChange={(e) => setCorreo(e.target.value)}
      />

      <label htmlFor="clave">contraseña</label>
      <input
        id="clave"
        type="password"
        autoComplete="current-password"
        value={clave}
        onChange={(e) => setClave(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && entrar()}
      />

      <button className="entrar" onClick={entrar} disabled={entrando}>
        {entrando ? "entrando…" : "entrar →"}
      </button>

      {error && <p className="error">{error}</p>}
    </div>
  );
}
