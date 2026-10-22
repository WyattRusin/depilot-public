alter table public.listings add column if not exists photos_deleted_at timestamptz;
alter table public.listings add column if not exists rewrites integer not null default 0;
create index if not exists listings_cleanup on public.listings (photos_deleted_at, exported_at, created_at);

create table if not exists public.spend_log (
  id          bigserial primary key,
  created_at  timestamptz not null default now(),
  user_id     uuid references auth.users on delete set null,
  kind        text not null,
  cents       numeric(10,4) not null check (cents >= 0)
);
create index if not exists spend_month on public.spend_log (created_at);
alter table public.spend_log enable row level security;

create or replace function public.consume_listing(p_user uuid, p_daily int, p_monthly int, p_listing uuid)
returns table (ok boolean, reason text, used_today int, used_month int, bonus_credits int, paid boolean)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_today int;
  v_month int;
  v_bonus int;
begin
  select p.bonus_credits into v_bonus from public.profiles p where p.id = p_user for update;
  if not found then
    insert into public.profiles (id) values (p_user) on conflict do nothing;
    v_bonus := 0;
  end if;

  select count(*) into v_today from public.usage_log u
   where u.user_id = p_user and u.paid = false
     and u.created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  select count(*) into v_month from public.usage_log u
   where u.user_id = p_user and u.paid = false
     and u.created_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc';

  if v_today < p_daily and v_month < p_monthly then
    insert into public.usage_log (user_id, paid, listing_id) values (p_user, false, p_listing);
    return query select true, ''::text, v_today + 1, v_month + 1, v_bonus, false;
  elsif v_bonus > 0 then
    update public.profiles set bonus_credits = bonus_credits - 1 where id = p_user;
    insert into public.usage_log (user_id, paid, listing_id) values (p_user, true, p_listing);
    return query select true, ''::text, v_today, v_month, v_bonus - 1, true;
  else
    return query select false, (case when v_month >= p_monthly then 'monthly' else 'daily' end)::text,
                        v_today, v_month, v_bonus, false;
  end if;
end $$;

create or replace function public.usage_counts(p_user uuid)
returns table (used_today int, used_month int)
language sql stable security definer set search_path = public as $$
  select
    count(*) filter (where created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc')::int,
    count(*) filter (where created_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc')::int
  from public.usage_log where user_id = p_user and paid = false;
$$;

create or replace function public.month_spend_cents()
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(cents), 0) from public.spend_log
   where created_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc';
$$;

revoke all on function public.consume_listing(uuid, int, int, uuid) from public, anon, authenticated;
revoke all on function public.usage_counts(uuid)                     from public, anon, authenticated;
revoke all on function public.month_spend_cents()                    from public, anon, authenticated;
grant execute on function public.consume_listing(uuid, int, int, uuid) to service_role;
grant execute on function public.usage_counts(uuid)                     to service_role;
grant execute on function public.month_spend_cents()                    to service_role;
