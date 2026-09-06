-- ─────────────────────────────────────────────────────────────
-- bodega · esquema
-- Pegar completo en Supabase → SQL Editor → Run.
-- ─────────────────────────────────────────────────────────────

create table if not exists public.cajas (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users on delete cascade default auth.uid(),
  codigo       text not null,
  contenido    text not null default '',
  fotos        text[] not null default '{}',   -- rutas dentro del bucket
  actualizado  timestamptz not null default now(),
  unique (user_id, codigo)
);

alter table public.cajas enable row level security;

drop policy if exists "cajas propias" on public.cajas;
create policy "cajas propias" on public.cajas
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Los proyectos creados después del 30/05/2026 requieren grants explícitos
-- para que PostgREST exponga la tabla. En proyectos viejos es inofensivo.
grant select, insert, update, delete on table public.cajas to authenticated;

-- ── almacenamiento de fotos ──────────────────────────────────
-- Bucket privado. Cada archivo vive en fotos/<user_id>/<uuid>.jpg
insert into storage.buckets (id, name, public, file_size_limit)
values ('fotos', 'fotos', false, 5242880)
on conflict (id) do nothing;

drop policy if exists "fotos propias" on storage.objects;
create policy "fotos propias" on storage.objects
  for all
  using (bucket_id = 'fotos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'fotos' and (storage.foldername(name))[1] = auth.uid()::text);
