# bodega

Inventario de la bodega de la casa. Texto primero: una línea por caja,
buscar es la app.

Next.js · TypeScript · Supabase · Vercel

---

## 1. Supabase

1. Crear un proyecto nuevo en supabase.com.
2. SQL Editor → pegar `supabase/schema.sql` completo → Run.
   Crea la tabla `cajas`, el bucket privado `fotos` y las políticas RLS.
3. Authentication → Users → Add user, con tu correo y contraseña.
   No hay registro abierto: la app es de un solo usuario.
4. Project Settings → API → copiar la URL y la clave `anon`.

## 2. Local

```bash
cp .env.local.example .env.local   # pegar URL y anon key
npm install
npm run dev
```

## 3. Vercel

```bash
npx vercel
npx vercel --prod
```

Agregar `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY`
en Project Settings → Environment Variables.

---

## Rutas

| Ruta          | Qué hace                                              |
| ------------- | ----------------------------------------------------- |
| `/`           | La lista y el buscador                                |
| `/b/B-04`     | Abre esa caja desplegada. Es el destino del QR        |
| `/etiquetas`  | Hoja de QR imprimible, uno por caja                   |
| `/login`      | Correo y contraseña                                   |

## Uso

- El buscador queda enfocado al abrir. Sin acentos, varias palabras se
  acumulan. Tecla `/` para volver a él.
- Las letras junto al contador filtran por zona.
- Tocar una línea la abre. El texto y el código se editan en el sitio.
- Escribirle `A-01` encima al código crea la zona A.
- `+ nueva caja` sugiere el consecutivo de la zona donde vienes
  trabajando. Nunca reutiliza el número de una caja borrada.
- Tres fotos por caja. Se comprimen a 1400 px antes de subirse.

## Decisiones que conviene no deshacer

- **La lista se ordena por código y nunca se reordena.** Es un estante,
  no un flujo de actividad: que cada caja esté siempre en el mismo
  lugar es la función.
- **El código es la ubicación.** No hay categorías, etiquetas ni
  ubicaciones anidadas. La letra es la zona, el número la caja.
- **Las zonas no son entidades**, son la primera letra del código. Se
  crean y desaparecen solas.
- **El bucket es privado.** Las fotos se sirven con URLs firmadas de
  8 horas, no con enlaces públicos.
- **Escritura agrupada cada 600 ms** por caja, no un UPDATE por tecla.
- **Sistema tipográfico:** Plus Jakarta Sans para lo que escribes tú,
  IBM Plex Mono para códigos, contadores, fechas y tokens de acción.

## Pendientes

- Escanear el QR desde la propia app, para no salir a la cámara.
- Exportar todo a texto plano, como respaldo legible sin la app.
- El plan gratuito de Supabase pausa el proyecto tras 7 días sin
  peticiones. Un ping programado lo evita.
