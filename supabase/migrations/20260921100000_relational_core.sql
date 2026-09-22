-- Phase 2: normalized read model. gaubretrail_state remains the write source
-- until the UI is migrated table by table. Every state save refreshes this
-- relational model in the same transaction.

create table if not exists public.editions (
  id text primary key, season text not null check (season in ('summer', 'winter')),
  year integer not null, name text not null, event_date date, site text,
  latitude double precision, longitude double precision, notes text, metadata jsonb not null default '{}'::jsonb
);
create table if not exists public.courses (
  id text primary key, edition_id text not null references public.editions(id) on delete cascade,
  name text not null, distance numeric not null check (distance >= 0), color text, visible boolean not null default true,
  source text, departure_time time, first_duration interval, last_duration interval,
  metadata jsonb not null default '{}'::jsonb, unique (id, edition_id)
);
create table if not exists public.volunteers (
  id text primary key, first_name text not null, last_name text not null, phone text, email text,
  active boolean not null default true, public_visible boolean not null default false, notes text,
  metadata jsonb not null default '{}'::jsonb
);
create table if not exists public.volunteer_editions (
  volunteer_id text not null references public.volunteers(id) on delete cascade,
  edition_id text not null references public.editions(id) on delete cascade,
  primary key (volunteer_id, edition_id)
);
create table if not exists public.posts (
  id text primary key, edition_id text not null references public.editions(id) on delete cascade,
  post_number text not null, name text, required_volunteers integer not null check (required_volunteers > 0),
  event_date date, end_date date, start_time time, end_time time, instructions text,
  public_visible boolean not null default false, latitude double precision, longitude double precision,
  metadata jsonb not null default '{}'::jsonb, unique (edition_id, post_number), unique (id, edition_id)
);
create table if not exists public.post_time_slots (
  post_id text not null references public.posts(id) on delete cascade, position smallint not null,
  start_time time not null, end_time time not null, primary key (post_id, position), check (end_time > start_time)
);
create table if not exists public.post_courses (
  post_id text not null, course_id text not null, edition_id text not null,
  primary key (post_id, course_id),
  foreign key (post_id, edition_id) references public.posts(id, edition_id) on delete cascade,
  foreign key (course_id, edition_id) references public.courses(id, edition_id) on delete cascade
);
create table if not exists public.assignments (
  id text primary key, volunteer_id text not null, post_id text not null, edition_id text not null,
  assignment_date date not null, end_date date, start_time time, end_time time,
  instructions text, notes text, metadata jsonb not null default '{}'::jsonb,
  foreign key (volunteer_id, edition_id) references public.volunteer_editions(volunteer_id, edition_id),
  foreign key (post_id, edition_id) references public.posts(id, edition_id),
  check ((start_time is null and end_time is null) or (start_time is not null and end_time is not null))
);
create index if not exists assignments_volunteer_idx on public.assignments (volunteer_id, assignment_date);
create index if not exists assignments_post_idx on public.assignments (post_id, assignment_date);
create table if not exists public.aid_stations (
  id text primary key, edition_id text not null references public.editions(id) on delete cascade,
  post_id text, station_number text, name text not null, latitude double precision, longitude double precision,
  km numeric, information text, start_time time, end_time time, visible boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  foreign key (post_id, edition_id) references public.posts(id, edition_id)
);
create table if not exists public.aid_station_courses (
  aid_station_id text not null references public.aid_stations(id) on delete cascade,
  course_id text not null, edition_id text not null, primary key (aid_station_id, course_id),
  foreign key (course_id, edition_id) references public.courses(id, edition_id) on delete cascade
);

alter table public.editions enable row level security;
alter table public.courses enable row level security;
alter table public.volunteers enable row level security;
alter table public.volunteer_editions enable row level security;
alter table public.posts enable row level security;
alter table public.post_time_slots enable row level security;
alter table public.post_courses enable row level security;
alter table public.assignments enable row level security;
alter table public.aid_stations enable row level security;
alter table public.aid_station_courses enable row level security;
revoke all on table public.editions, public.courses, public.volunteers, public.volunteer_editions,
  public.posts, public.post_time_slots, public.post_courses, public.assignments, public.aid_stations,
  public.aid_station_courses from anon, authenticated;

create or replace function public.sync_gaubretrail_relational_state(next_payload jsonb)
returns void language plpgsql set search_path = public as $$
begin
  -- Supabase enables pg_safeupdate on some projects. Keep the full refresh
  -- explicit so the extension accepts these deletes.
  delete from assignments where true; delete from post_time_slots where true; delete from post_courses where true; delete from aid_station_courses where true;
  delete from aid_stations where true; delete from volunteer_editions where true; delete from posts where true; delete from courses where true;
  delete from volunteers where true; delete from editions where true;
  insert into editions (id, season, year, name, event_date, site, latitude, longitude, notes, metadata)
  select value->>'id', value->>'season', (value->>'year')::integer, value->>'name', nullif(value->>'date','')::date,
    value->>'site', (value->>'lat')::double precision, (value->>'lng')::double precision, value->>'notes',
    value - array['id','season','year','name','date','site','lat','lng','notes']
  from jsonb_array_elements(next_payload->'editions') as records(value);
  insert into courses (id, edition_id, name, distance, color, visible, source, departure_time, first_duration, last_duration, metadata)
  select value->>'id', value->>'editionId', value->>'name', (value->>'distance')::numeric, value->>'color', coalesce((value->>'visible')::boolean,true), value->>'source',
    nullif(value->>'departureTime','')::time, nullif(value->>'firstDuration','')::interval, nullif(value->>'lastDuration','')::interval,
    value - array['id','editionId','name','distance','color','visible','source','departureTime','firstDuration','lastDuration']
  from jsonb_array_elements(next_payload->'courses') as records(value);
  insert into volunteers (id, first_name, last_name, phone, email, active, public_visible, notes, metadata)
  select value->>'id', value->>'firstName', value->>'lastName', value->>'phone', value->>'email', coalesce((value->>'active')::boolean,true), coalesce((value->>'publicVisible')::boolean,false), value->>'notes',
    value - array['id','firstName','lastName','phone','email','active','publicVisible','notes','editionIds']
  from jsonb_array_elements(next_payload->'volunteers') as records(value);
  insert into volunteer_editions (volunteer_id, edition_id)
  select value->>'id', edition_id from jsonb_array_elements(next_payload->'volunteers') as records(value)
  cross join lateral jsonb_array_elements_text(coalesce(value->'editionIds','[]'::jsonb)) as editions(edition_id)
  union
  select value->>'volunteerId', value->>'editionId' from jsonb_array_elements(next_payload->'assignments') as records(value)
  on conflict do nothing;
  insert into posts (id, edition_id, post_number, name, required_volunteers, event_date, end_date, start_time, end_time, instructions, public_visible, latitude, longitude, metadata)
  select value->>'id', value->>'editionId', value->>'number', value->>'name', (value->>'required')::integer, nullif(value->>'date','')::date, nullif(value->>'endDate','')::date,
    nullif(value->>'start','')::time, nullif(value->>'end','')::time, value->>'instructions', coalesce((value->>'publicVisible')::boolean,false), (value->>'lat')::double precision, (value->>'lng')::double precision,
    value - array['id','editionId','number','name','required','date','endDate','start','end','instructions','publicVisible','lat','lng','timeSlots','courseIds']
  from jsonb_array_elements(next_payload->'posts') as records(value);
  insert into post_time_slots (post_id, position, start_time, end_time)
  select post.value->>'id', slot.position, (slot.value->>0)::time, (slot.value->>1)::time
  from jsonb_array_elements(next_payload->'posts') as post(value)
  cross join lateral jsonb_array_elements(coalesce(post.value->'timeSlots','[]'::jsonb)) with ordinality as slot(value, position);
  insert into post_courses (post_id, course_id, edition_id)
  select post.value->>'id', course_id, post.value->>'editionId' from jsonb_array_elements(next_payload->'posts') as post(value)
  cross join lateral jsonb_array_elements_text(coalesce(post.value->'courseIds','[]'::jsonb)) as courses(course_id);
  insert into assignments (id, volunteer_id, post_id, edition_id, assignment_date, end_date, start_time, end_time, instructions, notes, metadata)
  select value->>'id', value->>'volunteerId', value->>'postId', value->>'editionId', (value->>'date')::date, nullif(value->>'endDate','')::date, nullif(value->>'start','')::time, nullif(value->>'end','')::time, value->>'instructions', value->>'notes',
    value - array['id','volunteerId','postId','editionId','date','endDate','start','end','instructions','notes'] from jsonb_array_elements(next_payload->'assignments') as records(value);
  insert into aid_stations (id, edition_id, post_id, station_number, name, latitude, longitude, km, information, start_time, end_time, visible, metadata)
  select value->>'id', value->>'editionId', nullif(value->>'postId',''), value->>'number', value->>'name', (value->>'lat')::double precision, (value->>'lng')::double precision, (value->>'km')::numeric, value->>'information', nullif(value->>'start','')::time, nullif(value->>'end','')::time, coalesce((value->>'visible')::boolean,true),
    value - array['id','editionId','postId','number','name','lat','lng','km','information','start','end','visible','courseIds'] from jsonb_array_elements(next_payload->'aidStations') as records(value);
  insert into aid_station_courses (aid_station_id, course_id, edition_id)
  select station.value->>'id', course_id, station.value->>'editionId' from jsonb_array_elements(next_payload->'aidStations') as station(value)
  cross join lateral jsonb_array_elements_text(coalesce(station.value->'courseIds','[]'::jsonb)) as courses(course_id);
end; $$;

create or replace function public.save_gaubretrail_state(expected_revision bigint, next_payload jsonb)
returns bigint language plpgsql set search_path = public as $$
declare current_state public.gaubretrail_state%rowtype;
begin
  select * into current_state from public.gaubretrail_state where id = 1 for update;
  if not found or current_state.revision <> expected_revision then raise exception 'GaubreTrail state revision conflict' using errcode = 'P0001'; end if;
  insert into public.gaubretrail_previous_state (id, revision, payload, updated_at) values (1, current_state.revision, current_state.payload, now())
    on conflict (id) do update set revision = excluded.revision, payload = excluded.payload, updated_at = excluded.updated_at;
  perform public.sync_gaubretrail_relational_state(next_payload);
  update public.gaubretrail_state set revision = current_state.revision + 1, payload = next_payload, updated_at = now() where id = 1;
  return current_state.revision + 1;
end; $$;

revoke all on function public.sync_gaubretrail_relational_state(jsonb) from public;
grant execute on function public.sync_gaubretrail_relational_state(jsonb) to service_role;
select public.sync_gaubretrail_relational_state(payload) from public.gaubretrail_state where id = 1;
