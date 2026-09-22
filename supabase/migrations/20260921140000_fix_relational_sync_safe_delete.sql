-- Projects with pg_safeupdate reject DELETE statements without a WHERE clause.
-- Replace the relational refresh function created by the previous migration.

create or replace function public.sync_gaubretrail_relational_state(next_payload jsonb)
returns void language plpgsql set search_path = public as $$
begin
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

revoke all on function public.sync_gaubretrail_relational_state(jsonb) from public;
grant execute on function public.sync_gaubretrail_relational_state(jsonb) to service_role;
select public.sync_gaubretrail_relational_state(payload) from public.gaubretrail_state where id = 1;
