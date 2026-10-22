create table if not exists public.profiles (
  id                uuid primary key references auth.users on delete cascade,
  email             text,
  full_name         text,
  avatar_url        text,
  location          text not null default 'United States',
  currency          text not null default 'USD',
  domestic_shipping numeric(10,2),
  intl_shipping     numeric(10,2),
  bonus_credits     integer not null default 0 check (bonus_credits >= 0),
  created_at        timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create table if not exists public.listings (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users on delete cascade,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  status       text not null default 'analyzing'
               check (status in ('analyzing', 'pricing', 'ready', 'error')),
  photo_paths  text[] not null default '{}',
  ai           jsonb,
  fields       jsonb,
  description  text,
  price        numeric(10,2),
  pricing      jsonb,
  exported_at  timestamptz,
  error        text
);
create index if not exists listings_user_created on public.listings (user_id, created_at desc);

create table if not exists public.usage_log (
  id          bigserial primary key,
  user_id     uuid not null references auth.users on delete cascade,
  created_at  timestamptz not null default now(),
  paid        boolean not null default false,
  listing_id  uuid
);
create index if not exists usage_user_day on public.usage_log (user_id, created_at);

create table if not exists public.payments (
  stripe_session_id text primary key,
  user_id           uuid not null references auth.users on delete cascade,
  credits           integer not null,
  amount_cents      integer,
  created_at        timestamptz not null default now()
);

create or replace function public.consume_analysis(p_user uuid, p_daily_limit int, p_listing uuid)
returns table (ok boolean, used_today int, daily_limit int, bonus_credits int, paid boolean)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_used  int;
  v_bonus int;
begin
  select p.bonus_credits into v_bonus from public.profiles p where p.id = p_user for update;
  if not found then
    insert into public.profiles (id) values (p_user) on conflict do nothing;
    v_bonus := 0;
  end if;

  select count(*) into v_used from public.usage_log u
   where u.user_id = p_user and u.paid = false
     and u.created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc';

  if v_used < p_daily_limit then
    insert into public.usage_log (user_id, paid, listing_id) values (p_user, false, p_listing);
    return query select true, v_used + 1, p_daily_limit, v_bonus, false;
  elsif v_bonus > 0 then
    update public.profiles set bonus_credits = bonus_credits - 1 where id = p_user;
    insert into public.usage_log (user_id, paid, listing_id) values (p_user, true, p_listing);
    return query select true, v_used, p_daily_limit, v_bonus - 1, true;
  else
    return query select false, v_used, p_daily_limit, v_bonus, false;
  end if;
end $$;

create or replace function public.refund_analysis(p_user uuid, p_listing uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_paid boolean;
begin
  delete from public.usage_log
   where id = (select id from public.usage_log
                where user_id = p_user and listing_id = p_listing
                order by id desc limit 1)
  returning paid into v_paid;
  if v_paid then
    update public.profiles set bonus_credits = bonus_credits + 1 where id = p_user;
  end if;
end $$;

create or replace function public.add_credits(p_user uuid, p_session text, p_credits int, p_amount int)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  insert into public.payments (stripe_session_id, user_id, credits, amount_cents)
  values (p_session, p_user, p_credits, p_amount);
  update public.profiles set bonus_credits = bonus_credits + p_credits where id = p_user;
  return true;
exception when unique_violation then
  return false;
end $$;

revoke all on function public.consume_analysis(uuid, int, uuid) from public, anon, authenticated;
revoke all on function public.refund_analysis(uuid, uuid)       from public, anon, authenticated;
revoke all on function public.add_credits(uuid, text, int, int) from public, anon, authenticated;
grant execute on function public.consume_analysis(uuid, int, uuid) to service_role;
grant execute on function public.refund_analysis(uuid, uuid)       to service_role;
grant execute on function public.add_credits(uuid, text, int, int) to service_role;

alter table public.profiles  enable row level security;
alter table public.listings  enable row level security;
alter table public.usage_log enable row level security;
alter table public.payments  enable row level security;

drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles for select using (auth.uid() = id);

drop policy if exists "own listings" on public.listings;
create policy "own listings" on public.listings for select using (auth.uid() = user_id);

drop policy if exists "own usage" on public.usage_log;
create policy "own usage" on public.usage_log for select using (auth.uid() = user_id);

drop policy if exists "own payments" on public.payments;
create policy "own payments" on public.payments for select using (auth.uid() = user_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', true, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "upload own photos" on storage.objects;
create policy "upload own photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "read own photos" on storage.objects;
create policy "read own photos" on storage.objects for select to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "update own photos" on storage.objects;
create policy "update own photos" on storage.objects for update to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "delete own photos" on storage.objects;
create policy "delete own photos" on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
