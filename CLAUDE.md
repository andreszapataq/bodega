# bodega

Inventario de la bodega de una casa. Uso personal, un solo usuario, casi
siempre desde el celular y de pie frente a un estante.

Stack: Next.js (App Router) · TypeScript · Supabase · Vercel.
Todo el acceso a datos es desde el cliente; RLS protege las filas. No hay
Server Actions ni route handlers, y no hacen falta.

## La tesis

Una línea por caja. **Buscar es la app.** Registrar tiene que costar casi
nada, porque los inventarios caseros no se abandonan por falta de
funciones, se abandonan por fricción al registrar.

## Invariantes — no cambiar sin discutirlo

- **La lista se ordena por código y nunca se reordena.** Es un estante, no
  un flujo de actividad. Que cada caja esté siempre en el mismo lugar de
  la lista es la función, no un detalle. Nada de "modificado
  recientemente", nada de reordenar mientras se escribe.
- **El código es la ubicación.** `B-04`: la letra es la zona, el número la
  caja. No agregar categorías, etiquetas, ubicaciones anidadas, cantidades,
  valor, ni fecha de compra.
- **Las zonas no son entidades.** Son la primera letra del código, derivada
  de las cajas que existen. No crear una tabla de zonas ni un CRUD para
  ellas: aparecen y desaparecen solas.
- **Los números no se reciclan.** El consecutivo toma el mayor de la zona y
  suma uno, sin rellenar huecos, porque la etiqueta de una caja borrada
  puede seguir pegada en algún lado.
- **Sin formularios, sin modales, sin diálogos nativos.** Todo se edita en
  el sitio. Un `prompt()` o un `confirm()` del navegador es un error de
  diseño aquí. Confirmar algo se hace en la misma línea.
- **Sin pantalla de ajustes.** Si aparece una opción configurable, casi
  siempre significa que no se tomó una decisión.
- **Tres fotos por caja** (`MAX_FOTOS`). No son un álbum, son evidencia:
  una general del contenido y una o dos de lo que no se describe con
  palabras.
- **El bucket es privado.** URLs firmadas, nunca enlaces públicos.

## Sistema visual

- Fondo gris neutro oscuro, monocromo. **Las fotos son el único color de la
  app**; cualquier acento compite con ellas. El gris es neutro a propósito,
  sin tinte azul, para no desviar la percepción del color de la foto.
- Jerarquía por luminosidad, no por color: código lo más brillante,
  contenido un paso abajo, metadatos en gris.
- **Plus Jakarta Sans** para lo que escribe el usuario: contenido de la
  caja, buscador, pie del visor.
- **IBM Plex Mono** para lo que escribe el sistema: códigos, contadores,
  fechas, tokens de acción. Los códigos van en mono también por legibilidad
  real: en una sans geométrica la `I` y la `l` son el mismo palito.
- Los tokens de color y tipografía viven en `src/app/globals.css`. Usarlos,
  no escribir hex sueltos.
- Nada de Tailwind ni librerías de componentes. CSS plano.

## Convenciones

- Código, comentarios, nombres de variables y textos de interfaz **en
  español**.
- Los comentarios explican **por qué**, no qué. Si un comentario describe lo
  que la línea ya dice, sobra.
- Textos de interfaz en minúscula y sin signos de exclamación.
- Los estados vacíos y los errores dicen qué pasó y qué hacer, no piden
  disculpas.

## Rendimiento

- La lista se pinta antes que las imágenes. Las URLs firmadas se piden en
  lote después de cargar el texto. No bloquear la lista esperando fotos.
- La escritura a Postgres va agrupada cada 600 ms por caja. No un UPDATE
  por tecla.

## Pendientes

- Escanear el QR desde la propia app, sin salir a la cámara del sistema.
- Exportar todo a texto plano, para tener un respaldo legible sin la app.
- El plan gratuito de Supabase pausa el proyecto tras 7 días sin
  peticiones. Resolver con un ping programado.
