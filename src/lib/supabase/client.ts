import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/* La sesión vive en localStorage, no en cookies.
 *
 * Aquí no hay servidor que necesite leerla: todo el acceso a datos es del
 * cliente y RLS protege las filas. Una cookie no aportaría nada y sí
 * viajaría en cada petición. En localhost, además, las cookies se
 * comparten entre puertos, así que las de otros proyectos se sumaban a
 * las de este hasta pasarse del límite de cabeceras y devolver un 431. */
let cliente: SupabaseClient | null = null;

export const supabase = () =>
  (cliente ??= createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  ));
