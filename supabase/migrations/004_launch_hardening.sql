create table if not exists public.rate_limits (
  user_id      uuid not null references auth.users on delete cascade,
  key          text not null,
  window_start timestamptz not null default now(),
  hits         integer not null default 0,
  primary key (user_id, key)
);
alter table public.rate_limits enable row level security;

create or replace function public.take_slot(p_user uuid, p_key text, p_limit int, p_window int)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_ok boolean;
begin
  insert into public.rate_limits as r (user_id, key, window_start, hits)
  values (p_user, p_key, now(), 1)
  on conflict (user_id, key) do update set
    window_start = case when r.window_start < now() - make_interval(secs => p_window) then now() else r.window_start end,
    hits         = case when r.window_start < now() - make_interval(secs => p_window) then 1 else r.hits + 1 end
  returning hits <= p_limit into v_ok;
  return v_ok;
end $$;

create or replace function public.release_slot(p_user uuid, p_key text)
returns void language sql security definer set search_path = public as $$
  delete from public.rate_limits where user_id = p_user and key = p_key;
$$;

create or replace function public.prune_rate_limits()
returns void language sql security definer set search_path = public as $$
  delete from public.rate_limits where window_start < now() - interval '2 days';
$$;

revoke all on function public.take_slot(uuid, text, int, int) from public, anon, authenticated;
revoke all on function public.release_slot(uuid, text)        from public, anon, authenticated;
revoke all on function public.prune_rate_limits()             from public, anon, authenticated;
grant execute on function public.take_slot(uuid, text, int, int) to service_role;
grant execute on function public.release_slot(uuid, text)        to service_role;
grant execute on function public.prune_rate_limits()             to service_role;

drop policy if exists "own profile"  on public.profiles;
drop policy if exists "own listings" on public.listings;
drop policy if exists "own usage"    on public.usage_log;
drop policy if exists "own payments" on public.payments;

update storage.buckets set file_size_limit = 5242880 where id = 'photos';

drop policy if exists "upload own photos" on storage.objects;
create policy "upload own photos" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = auth.uid()::text
    and (select count(*) from storage.objects o
          where o.bucket_id = 'photos' and o.name like auth.uid()::text || '/%'
            and o.name not like '%\_t.jpg'
            and o.created_at > now() - interval '1 day') < 400
  );

create or replace function public.orphan_photos(p_limit int)
returns table (name text) language sql stable security definer set search_path = public, storage as $$
  select o.name from storage.objects o
   where o.bucket_id = 'photos'
     and o.created_at < now() - interval '1 day'
     and not exists (
       select 1 from public.listings l
        where l.user_id::text = (storage.foldername(o.name))[1]
          and l.id::text = (storage.foldername(o.name))[2]
          and l.photos_deleted_at is null)
   limit p_limit;
$$;
revoke all on function public.orphan_photos(int) from public, anon, authenticated;
grant execute on function public.orphan_photos(int) to service_role;
