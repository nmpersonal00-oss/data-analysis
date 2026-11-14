-- SAKINAH RESEARCH — OPTIONAL TWO-DEVICE CLOUD DATABASE
--
-- This is a DEPLOYMENT TEMPLATE, not an applied migration.
-- Run ONLY in a NEW, DEDICATED Supabase project for data-analysis.
-- Do not execute this in an existing Wifey & Hubby or other app database.
-- Supabase Auth provides independent email/password users.
-- In the current GitHub Pages frontend, the encrypted IndexedDB vault works
-- without this SQL; real cloud sync requires a separate authenticated client.

begin;

create schema if not exists sr_private;
revoke all on schema sr_private from public, anon;
grant usage on schema sr_private to authenticated;

create or replace function sr_private.permanent_user()
returns boolean language sql stable security definer set search_path = ''
as $$
  select (select auth.uid()) is not null
   and coalesce((select auth.jwt())->>'is_anonymous','false') <> 'true';
$$;

create table public.sr_studies (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null default 'Boundaries and relationship calm'
    check (length(title) between 1 and 140),
  protocol_version text not null default '1.0.0' check (protocol_version='1.0.0'),
  start_date date not null default date '2026-11-13'
    check (start_date=date '2026-11-13'),
  timezone text not null default 'America/Los_Angeles'
    check(timezone in ('America/Los_Angeles','America/Winnipeg','UTC')),
  status text not null default 'active' check(status in ('active','stopped')),
  stop_at timestamptz,
  stop_reason text check(stop_reason in (
    'physical_contact','uncovered_body','sexual_flirting',
    'undressing','voluntary','other')),
  created_at timestamptz not null default now(),
  constraint sr_stop_fields_consistent check(
    (status='active' and stop_at is null and stop_reason is null)
    or (status='stopped' and stop_at is not null and stop_reason is not null)
  )
);

create table public.sr_members (
  study_id uuid not null references public.sr_studies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check(role in ('owner','participant')),
  nickname text not null check(length(nickname) between 1 and 60),
  agreed_at timestamptz not null default now(),
  primary key(study_id,user_id)
);
create index sr_members_user_idx on public.sr_members(user_id);

create table public.sr_invites (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references public.sr_studies(id) on delete cascade,
  created_by uuid not null default auth.uid() references auth.users(id),
  token_hash text not null check(token_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now()+interval '7 days'),
  used_at timestamptz,
  used_by uuid references auth.users(id),
  unique(study_id,token_hash)
);

create table public.sr_diaries (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references public.sr_studies(id) on delete cascade,
  author_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  local_date date not null,
  calm smallint not null check(calm between 0 and 10),
  tension smallint not null check(tension between 0 and 10),
  anger smallint not null check(anger between 0 and 10),
  happiness smallint not null check(happiness between 0 and 10),
  closeness smallint not null check(closeness between 0 and 10),
  communication smallint check(communication between 0 and 10),
  external_stress smallint check(external_stress between 0 and 10),
  disagreements smallint not null default 0 check(disagreements between 0 and 30),
  tension_episodes smallint not null default 0 check(tension_episodes between 0 and 30),
  anger_episodes smallint not null default 0 check(anger_episodes between 0 and 30),
  sleep_hours numeric(3,1) check(sleep_hours between 0 and 24),
  together_minutes smallint check(together_minutes between 0 and 1440),
  notes text check(length(notes)<=2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(study_id,author_id,local_date)
);
create index sr_diaries_author_day_idx on public.sr_diaries(author_id,study_id,local_date);

create table public.sr_events (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references public.sr_studies(id) on delete cascade,
  author_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  occurred_at timestamptz not null,
  kind text not null check(kind in ('tension','anger','disagreement','repair','positive')),
  severity smallint not null check(severity between 0 and 10),
  duration_minutes smallint not null check(duration_minutes between 0 and 1440),
  context text check(length(context)<=1000),
  created_at timestamptz not null default now()
);
create index sr_events_author_when_idx on public.sr_events(author_id,occurred_at);

create table public.sr_diary_audit (
  id bigint generated always as identity primary key,
  diary_id uuid not null references public.sr_diaries(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  previous jsonb not null,
  revised jsonb not null,
  edited_at timestamptz not null default now()
);

create table public.sr_stops (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null unique references public.sr_studies(id) on delete cascade,
  reported_by uuid not null default auth.uid() references auth.users(id),
  reason text not null check(reason in (
    'physical_contact','uncovered_body','sexual_flirting',
    'undressing','voluntary','other')),
  stopped_at timestamptz not null default now()
);

create or replace function sr_private.is_member(p_study uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select sr_private.permanent_user()
  and exists(select 1 from public.sr_members
     where study_id=p_study and user_id=(select auth.uid()));
$$;
create or replace function sr_private.is_active_member(p_study uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select sr_private.is_member(p_study)
  and exists(select 1 from public.sr_studies
     where id=p_study and status='active');
$$;

create or replace function sr_private.after_study_create()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.sr_members(study_id,user_id,role,nickname)
  values(new.id,new.owner_id,'owner','Researcher');
  return new;
end;
$$;
create trigger sr_add_owner after insert on public.sr_studies
for each row execute function sr_private.after_study_create();

-- The join RPC can be called by authenticated users; all authorization is
-- verified in the function and the plaintext invitation token is never stored.
create or replace function public.sr_join_study(
  p_study uuid,p_invite_token text,p_nickname text
) returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_status text; v_invite uuid;
begin
  if not sr_private.permanent_user() then raise exception 'Sign in first'; end if;
  if length(p_invite_token)<>64 or p_nickname is null
     or length(trim(p_nickname)) not between 1 and 60 then
    raise exception 'Invalid invitation or nickname';
  end if;
  select status into v_status from public.sr_studies
    where id=p_study for update;
  if v_status is distinct from 'active' then raise exception 'Study unavailable'; end if;
  if exists(select 1 from public.sr_members
    where study_id=p_study and user_id=(select auth.uid())) then
    raise exception 'Already participating';
  end if;
  if (select count(*) from public.sr_members where study_id=p_study)>=2 then
    raise exception 'Only two participants are permitted';
  end if;
  select id into v_invite from public.sr_invites
    where study_id=p_study and used_at is null and expires_at>now()
      and token_hash=encode(sha256(convert_to(p_invite_token,'UTF8')),'hex')
    limit 1 for update;
  if v_invite is null then raise exception 'Invalid or expired invitation'; end if;
  insert into public.sr_members(study_id,user_id,role,nickname)
    values(p_study,(select auth.uid()),'participant',trim(p_nickname));
  update public.sr_invites set used_at=now(),used_by=(select auth.uid())
    where id=v_invite;
  return p_study;
end;
$$;
revoke all on function public.sr_join_study(uuid,text,text) from public,anon;
grant execute on function public.sr_join_study(uuid,text,text) to authenticated;

create or replace function sr_private.guard_diary()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_start date; v_zone text; v_status text;
begin
  if new.author_id is distinct from (select auth.uid()) then
    raise exception 'Only your own diary can be recorded';
  end if;
  if tg_op='UPDATE' and (
    new.id is distinct from old.id or
    new.author_id is distinct from old.author_id or
    new.study_id is distinct from old.study_id or
    new.local_date is distinct from old.local_date or
    new.created_at is distinct from old.created_at
  ) then raise exception 'Cannot change entry identity or observation date'; end if;
  select start_date,timezone,status into v_start,v_zone,v_status
    from public.sr_studies where id=new.study_id for share;
  if v_status is distinct from 'active' or not sr_private.is_active_member(new.study_id)
    then raise exception 'Observation has ended or access is denied'; end if;
  if new.local_date<v_start or new.local_date>(now() at time zone v_zone)::date
    then raise exception 'Observation date outside study window'; end if;
  if tg_op='INSERT' then new.created_at:=now(); end if;
  new.updated_at:=now();
  return new;
end;
$$;
create trigger sr_guard_diary before insert or update on public.sr_diaries
for each row execute function sr_private.guard_diary();

create or replace function sr_private.audit_diary()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.sr_diary_audit(diary_id,author_id,previous,revised)
    values(old.id,old.author_id,to_jsonb(old),to_jsonb(new));
  return new;
end;
$$;
create trigger sr_audit_diary after update on public.sr_diaries
for each row execute function sr_private.audit_diary();

create or replace function sr_private.guard_event()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_start date;v_zone text;
begin
  if new.author_id is distinct from (select auth.uid())
     or not sr_private.is_active_member(new.study_id) then
    raise exception 'Not an active member'; end if;
  select start_date,timezone into v_start,v_zone
    from public.sr_studies where id=new.study_id for share;
  if new.occurred_at>now() or
     (new.occurred_at at time zone v_zone)::date<v_start then
    raise exception 'Event outside study window'; end if;
  new.created_at:=now();
  return new;
end;
$$;
create trigger sr_guard_event before insert on public.sr_events
for each row execute function sr_private.guard_event();

create or replace function sr_private.guard_stop()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_status text;
begin
  select status into v_status from public.sr_studies
    where id=new.study_id for update;
  if v_status is distinct from 'active' or
    new.reported_by is distinct from (select auth.uid())
    or not sr_private.is_active_member(new.study_id) then
    raise exception 'Not authorized or already stopped';
  end if;
  new.stopped_at:=now();
  return new;
end;
$$;
create trigger sr_guard_stop before insert on public.sr_stops
for each row execute function sr_private.guard_stop();

create or replace function sr_private.apply_stop()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  update public.sr_studies set status='stopped',
    stop_at=new.stopped_at,stop_reason=new.reason
  where id=new.study_id and status='active';
  return new;
end;
$$;
create trigger sr_apply_stop after insert on public.sr_stops
for each row execute function sr_private.apply_stop();

alter table public.sr_studies enable row level security;
alter table public.sr_members enable row level security;
alter table public.sr_invites enable row level security;
alter table public.sr_diaries enable row level security;
alter table public.sr_events enable row level security;
alter table public.sr_diary_audit enable row level security;
alter table public.sr_stops enable row level security;

create policy sr_studies_read on public.sr_studies for select to authenticated
  using(sr_private.is_member(id));
create policy sr_studies_create on public.sr_studies for insert to authenticated
  with check(owner_id=(select auth.uid()) and sr_private.permanent_user()
    and status='active' and stop_at is null and stop_reason is null);
create policy sr_members_read on public.sr_members for select to authenticated
  using(sr_private.is_member(study_id));
create policy sr_invites_owner_read on public.sr_invites for select to authenticated
  using(created_by=(select auth.uid()) and sr_private.is_member(study_id));
create policy sr_invites_owner_insert on public.sr_invites for insert to authenticated
  with check(created_by=(select auth.uid()) and sr_private.permanent_user() and
    exists(select 1 from public.sr_studies s where s.id=study_id
     and s.owner_id=(select auth.uid()) and s.status='active')
    and used_at is null and used_by is null
    and expires_at>now() and expires_at<=now()+interval '14 days');
create policy sr_diaries_self_read on public.sr_diaries for select to authenticated
  using(author_id=(select auth.uid()) and sr_private.is_member(study_id));
create policy sr_diaries_self_insert on public.sr_diaries for insert to authenticated
  with check(author_id=(select auth.uid()) and sr_private.is_active_member(study_id));
create policy sr_diaries_self_update on public.sr_diaries for update to authenticated
  using(author_id=(select auth.uid()) and sr_private.is_active_member(study_id))
  with check(author_id=(select auth.uid()) and sr_private.is_active_member(study_id));
create policy sr_diaries_self_delete on public.sr_diaries for delete to authenticated
  using(author_id=(select auth.uid()) and sr_private.is_member(study_id));
create policy sr_events_self_read on public.sr_events for select to authenticated
  using(author_id=(select auth.uid()) and sr_private.is_member(study_id));
create policy sr_events_self_insert on public.sr_events for insert to authenticated
  with check(author_id=(select auth.uid()) and sr_private.is_active_member(study_id));
create policy sr_events_self_delete on public.sr_events for delete to authenticated
  using(author_id=(select auth.uid()) and sr_private.is_member(study_id));
create policy sr_audit_self_read on public.sr_diary_audit for select to authenticated
  using(author_id=(select auth.uid()));
create policy sr_stops_member_read on public.sr_stops for select to authenticated
  using(sr_private.is_member(study_id));
create policy sr_stops_member_insert on public.sr_stops for insert to authenticated
  with check(reported_by=(select auth.uid()) and sr_private.is_active_member(study_id));

revoke all on public.sr_studies, public.sr_members, public.sr_invites,
  public.sr_diaries, public.sr_events, public.sr_diary_audit,
  public.sr_stops from anon,authenticated;
grant select,insert on public.sr_studies to authenticated;
grant select on public.sr_members to authenticated;
grant select,insert on public.sr_invites to authenticated;
grant select,insert,update,delete on public.sr_diaries to authenticated;
grant select,insert,delete on public.sr_events to authenticated;
grant select on public.sr_diary_audit to authenticated;
grant select,insert on public.sr_stops to authenticated;

revoke all on all functions in schema sr_private from public,anon,authenticated;
grant execute on function sr_private.permanent_user() to authenticated;
grant execute on function sr_private.is_member(uuid) to authenticated;
grant execute on function sr_private.is_active_member(uuid) to authenticated;

commit;
