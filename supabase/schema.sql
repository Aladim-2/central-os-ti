-- ============================================================
-- CENTRAL OS ELÉTRICA — Schema Supabase
-- Execute no SQL Editor do seu projeto Supabase
-- ============================================================

-- 1. PERFIS DE USUÁRIO (estende auth.users)
create table public.profiles (
  id         uuid references auth.users on delete cascade primary key,
  name       text not null,
  role       text not null check (role in ('gestor', 'eletricista')),
  phone      text,
  initials   text,
  created_at timestamptz default now()
);

-- Trigger: cria perfil automaticamente ao criar usuário
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, name, role, initials)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'role', 'eletricista'),
    coalesce(new.raw_user_meta_data->>'initials', upper(left(split_part(new.email,'@',1),2)))
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- 2. LOCAIS / UNIDADES
create table public.locations (
  id         uuid default gen_random_uuid() primary key,
  name       text not null,
  address    text,
  created_at timestamptz default now()
);

-- 3. ORDENS DE SERVIÇO
create table public.service_orders (
  id               uuid default gen_random_uuid() primary key,
  number           text not null unique,
  location_id      uuid references public.locations,
  sector           text,
  electrician_id   uuid references public.profiles,
  description      text not null,
  priority         text check (priority in ('Alta','Média','Baixa')) default 'Média',
  deadline         date,
  status           text default 'Nova',
  notes            text,
  diagnosis        text,
  materials_needed jsonb default '[]',
  materials_used   jsonb default '[]',
  created_by       uuid references public.profiles,
  created_at       timestamptz default now(),
  received_at      timestamptz,
  started_at       timestamptz,
  completed_at     timestamptz
);

-- Função para gerar número de OS automático
create or replace function public.generate_os_number()
returns trigger language plpgsql as $$
declare
  year_str text := to_char(now(), 'YYYY');
  seq_num  int;
begin
  select coalesce(max(cast(split_part(number, '-', 3) as int)), 0) + 1
    into seq_num
    from public.service_orders
    where number like 'OS-' || year_str || '-%';
  new.number := 'OS-' || year_str || '-' || lpad(seq_num::text, 3, '0');
  return new;
end;
$$;

create trigger set_os_number
  before insert on public.service_orders
  for each row execute procedure public.generate_os_number();

-- 4. HISTÓRICO DE STATUS
create table public.os_history (
  id         uuid default gen_random_uuid() primary key,
  os_id      uuid references public.service_orders on delete cascade,
  status     text not null,
  by_name    text not null,
  by_id      uuid references public.profiles,
  created_at timestamptz default now()
);

-- 5. FOTOS
create table public.os_photos (
  id         uuid default gen_random_uuid() primary key,
  os_id      uuid references public.service_orders on delete cascade,
  stage      text not null check (stage in ('inicial','execucao','final','material')),
  url        text not null,
  caption    text,
  created_at timestamptz default now()
);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table public.profiles        enable row level security;
alter table public.locations       enable row level security;
alter table public.service_orders  enable row level security;
alter table public.os_history      enable row level security;
alter table public.os_photos       enable row level security;

-- Profiles: usuário lê o próprio perfil, gestor lê todos
create policy "Usuário lê próprio perfil" on public.profiles
  for select using (auth.uid() = id);
create policy "Gestor lê todos os perfis" on public.profiles
  for select using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'gestor')
  );
create policy "Usuário atualiza próprio perfil" on public.profiles
  for update using (auth.uid() = id);

-- Locations: todos leem, gestor escreve
create policy "Todos leem locais" on public.locations
  for select using (auth.uid() is not null);
create policy "Gestor gerencia locais" on public.locations
  for all using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'gestor')
  );

-- Service Orders: gestor vê todas, eletricista vê só as suas
create policy "Gestor acessa todas as OS" on public.service_orders
  for all using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'gestor')
  );
create policy "Eletricista acessa próprias OS" on public.service_orders
  for select using (electrician_id = auth.uid());
create policy "Eletricista atualiza próprias OS" on public.service_orders
  for update using (electrician_id = auth.uid());

-- History e Photos: seguem as mesmas regras da OS
create policy "Gestor acessa todo o histórico" on public.os_history
  for all using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'gestor')
  );
create policy "Eletricista acessa histórico das suas OS" on public.os_history
  for all using (
    exists (select 1 from public.service_orders where id = os_id and electrician_id = auth.uid())
  );

create policy "Gestor acessa todas as fotos" on public.os_photos
  for all using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'gestor')
  );
create policy "Eletricista acessa fotos das suas OS" on public.os_photos
  for all using (
    exists (select 1 from public.service_orders where id = os_id and electrician_id = auth.uid())
  );

-- ============================================================
-- STORAGE BUCKET PARA FOTOS
-- ============================================================
insert into storage.buckets (id, name, public) values ('os-photos', 'os-photos', true);

create policy "Usuários autenticados fazem upload" on storage.objects
  for insert with check (bucket_id = 'os-photos' and auth.uid() is not null);
create policy "Fotos são públicas" on storage.objects
  for select using (bucket_id = 'os-photos');
create policy "Usuários deletam próprias fotos" on storage.objects
  for delete using (bucket_id = 'os-photos' and auth.uid() is not null);

-- ============================================================
-- DADOS INICIAIS (execute após o schema)
-- ============================================================
insert into public.locations (name, address) values
  ('EMEF João Pessoa',   'Rua das Flores, 123 — Itabuna/BA'),
  ('EMEF Maria José',    'Av. Princesa Isabel, 456 — Itabuna/BA'),
  ('EMEF Paulo Freire',  'Rua do Cruzeiro, 789 — Itabuna/BA'),
  ('EMEF Dois de Julho', 'Rua Sete de Setembro, 321 — Itabuna/BA'),
  ('SEMED — Sede',       'Av. Jequitibá, 1000 — Itabuna/BA');
