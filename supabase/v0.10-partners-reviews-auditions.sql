-- Stuckato v0.10 (23 Sep 2026): practice partners, performance reviews, and private audition takes.
-- Paste the whole file into the Supabase SQL editor and run it once. Safe to run again.
-- Everything a pupil sees of another pupil goes through a function that returns only the few fields needed:
-- pupils never read each other's documents, and nothing here lets pupils message each other.

-- ---------------------------------------------------------------------------------------------
-- 1. Practice partners. The teacher pairs two pupils in the studio; pupils cannot pair themselves.

create table if not exists public.practicigo_partners (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.practicigo_studios(id) on delete cascade,
  a uuid not null references auth.users(id) on delete cascade,
  b uuid not null references auth.users(id) on delete cascade,
  challenge_minutes int,                       -- the pair's current step; raised after three matched days
  created_at timestamptz not null default now(),
  check (a <> b)
);
create unique index if not exists practicigo_partners_pair on public.practicigo_partners (least(a, b), greatest(a, b));
alter table public.practicigo_partners enable row level security;

drop policy if exists "practicigo partners: teacher reads studio, pupils read own" on public.practicigo_partners;
create policy "practicigo partners: teacher reads studio, pupils read own" on public.practicigo_partners for select
  using ((studio_id = public.practicigo_my_studio() and public.practicigo_my_role() = 'teacher') or a = auth.uid() or b = auth.uid());

create or replace function public.practicigo_pair(x uuid, y uuid) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare pid uuid;
begin
  if public.practicigo_my_role() is distinct from 'teacher' then raise exception 'Only the teacher can pair pupils'; end if;
  if x = y then raise exception 'Pick two different pupils'; end if;
  if (select count(*) from public.practicigo_members where user_id in (x, y) and role = 'student' and studio_id = public.practicigo_my_studio()) <> 2 then
    raise exception 'Both pupils must be in your studio';
  end if;
  insert into public.practicigo_partners (studio_id, a, b) values (public.practicigo_my_studio(), x, y)
    on conflict do nothing returning id into pid;
  return pid;
end $$;

create or replace function public.practicigo_unpair(pid uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if public.practicigo_my_role() is distinct from 'teacher' then raise exception 'Only the teacher can unpair pupils'; end if;
  delete from public.practicigo_partners where id = pid and studio_id = public.practicigo_my_studio();
end $$;

-- Minutes a pupil practised on a given day, from their document: guided or own-time sessions plus break-day practice.
create or replace function public.practicigo_minutes_on(doc jsonb, day date) returns int
language sql immutable set search_path = public, extensions as $$
  select coalesce((select sum(coalesce((e->>'minutes')::int, 0))
                     from jsonb_array_elements(coalesce(doc->'weeks', '[]'::jsonb)) w,
                          jsonb_array_elements(coalesce(w->'done', '[]'::jsonb)) e
                    where left(e->>'at', 10) = day::text), 0)
       + coalesce((select sum(coalesce((e->>'minutes')::int, 0))
                     from jsonb_array_elements(coalesce(doc->'breakLog', '[]'::jsonb)) e
                    where left(e->>'at', 10) = day::text and e ? 'note'), 0)
$$;

-- A pupil's partners, with only what the pairing needs: first name, minutes today and yesterday, and whether
-- they are practising right now (only when both pupils are 13 or over and presence is not switched off).
create or replace function public.practicigo_my_partners() returns table (
  pair_id uuid, partner uuid, name text, minutes_today int, minutes_yesterday int, practising_now boolean, challenge_minutes int)
language sql stable security definer set search_path = public, extensions as $$
  select p.id,
         o.user_id,
         split_part(coalesce(o.data->'profile'->>'name', m.name, 'Your partner'), ' ', 1),
         public.practicigo_minutes_on(o.data, current_date),
         public.practicigo_minutes_on(o.data, current_date - 1),
         case when coalesce((me.data->'profile'->>'over13')::boolean, false)
               and coalesce((o.data->'profile'->>'over13')::boolean, false)
               and not coalesce((o.data->'profile'->>'presenceOff')::boolean, false)
              then coalesce((o.data->>'activeUntil')::timestamptz > now(), false) else false end,
         p.challenge_minutes
    from public.practicigo_partners p
    join public.practicigo_students o on o.user_id = case when p.a = auth.uid() then p.b else p.a end
    join public.practicigo_students me on me.user_id = auth.uid()
    left join public.practicigo_members m on m.user_id = o.user_id
   where auth.uid() in (p.a, p.b)
$$;

-- The pair's challenge rises after three matched days; either partner's page may record the new step.
create or replace function public.practicigo_set_challenge(pid uuid, mins int) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if mins < 5 or mins > 180 then raise exception 'Minutes out of range'; end if;
  update public.practicigo_partners set challenge_minutes = mins
   where id = pid and (auth.uid() in (a, b) or (studio_id = public.practicigo_my_studio() and public.practicigo_my_role() = 'teacher'));
end $$;

-- ---------------------------------------------------------------------------------------------
-- 2. Performance reviews and the end-of-term performance class. Pupils pick from two dropdowns only;
-- a performer sees their picks once the teacher releases the review.

create table if not exists public.practicigo_reviews (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.practicigo_studios(id) on delete cascade,
  title text not null,
  kind text not null default 'review' check (kind in ('review', 'class')),
  group_name text,                             -- null = everyone in the studio
  held_on date,
  released boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.practicigo_reviews enable row level security;

create table if not exists public.practicigo_review_picks (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.practicigo_reviews(id) on delete cascade,
  reviewer uuid not null default auth.uid() references auth.users(id) on delete cascade,
  performer uuid not null references auth.users(id) on delete cascade,
  liked text not null,
  improve text not null,
  created_at timestamptz not null default now(),
  unique (review_id, reviewer, performer),
  check (reviewer <> performer),
  check (liked in ('tone','intonation','rhythm','dynamics','phrasing','expression','memory','stage presence','posture','ensemble')),
  check (improve in ('tone','intonation','rhythm','dynamics','phrasing','expression','memory','stage presence','posture','ensemble'))
);
alter table public.practicigo_review_picks enable row level security;

-- Is this pupil part of this review (in the studio and, if it names a group, in that group)?
create or replace function public.practicigo_in_review(rid uuid, who uuid) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select exists (
    select 1 from public.practicigo_reviews r
      join public.practicigo_students s on s.user_id = who and s.studio_id = r.studio_id
     where r.id = rid and (r.group_name is null or coalesce(s.data->'profile'->'groups', '[]'::jsonb) ? r.group_name))
$$;

drop policy if exists "practicigo reviews: read my studio's" on public.practicigo_reviews;
create policy "practicigo reviews: read my studio's" on public.practicigo_reviews for select
  using (studio_id = public.practicigo_my_studio() and (public.practicigo_my_role() = 'teacher' or public.practicigo_in_review(id, auth.uid())));
drop policy if exists "practicigo reviews: teacher writes" on public.practicigo_reviews;
create policy "practicigo reviews: teacher writes" on public.practicigo_reviews for all
  using (studio_id = public.practicigo_my_studio() and public.practicigo_my_role() = 'teacher')
  with check (studio_id = public.practicigo_my_studio() and public.practicigo_my_role() = 'teacher');

drop policy if exists "practicigo picks: teacher, reviewer, or performer once released" on public.practicigo_review_picks;
create policy "practicigo picks: teacher, reviewer, or performer once released" on public.practicigo_review_picks for select
  using (reviewer = auth.uid()
      or exists (select 1 from public.practicigo_reviews r where r.id = review_id and r.studio_id = public.practicigo_my_studio()
                   and (public.practicigo_my_role() = 'teacher' or (performer = auth.uid() and r.released))));
drop policy if exists "practicigo picks: pupils in the review add their own" on public.practicigo_review_picks;
create policy "practicigo picks: pupils in the review add their own" on public.practicigo_review_picks for insert
  with check (reviewer = auth.uid() and public.practicigo_in_review(review_id, auth.uid()) and public.practicigo_in_review(review_id, performer));
drop policy if exists "practicigo picks: reviewer can change or remove theirs before release" on public.practicigo_review_picks;
create policy "practicigo picks: reviewer can change or remove theirs before release" on public.practicigo_review_picks for update
  using (reviewer = auth.uid() and not exists (select 1 from public.practicigo_reviews r where r.id = review_id and r.released))
  with check (reviewer = auth.uid());
drop policy if exists "practicigo picks: reviewer deletes before release, teacher any" on public.practicigo_review_picks;
create policy "practicigo picks: reviewer deletes before release, teacher any" on public.practicigo_review_picks for delete
  using ((reviewer = auth.uid() and not exists (select 1 from public.practicigo_reviews r where r.id = review_id and r.released))
      or exists (select 1 from public.practicigo_reviews r where r.id = review_id and r.studio_id = public.practicigo_my_studio() and public.practicigo_my_role() = 'teacher'));

-- Who a pupil can review in a review: the other pupils in it, first names only.
create or replace function public.practicigo_review_performers(rid uuid) returns table (performer uuid, name text)
language sql stable security definer set search_path = public, extensions as $$
  select s.user_id, split_part(coalesce(s.data->'profile'->>'name', 'Pupil'), ' ', 1)
    from public.practicigo_reviews r
    join public.practicigo_students s on s.studio_id = r.studio_id
   where r.id = rid and public.practicigo_in_review(rid, auth.uid()) and s.user_id <> auth.uid()
     and (r.group_name is null or coalesce(s.data->'profile'->'groups', '[]'::jsonb) ? r.group_name)
   order by 2
$$;

-- ---------------------------------------------------------------------------------------------
-- 3. Private recordings: audition takes (audio for everyone, video from 18). Never public.
-- Path: <studio_id>/<pupil_id>/<file>. The pupil reads and writes their own folder; their teacher reads it.
-- The app plays files through short-lived signed URLs.

insert into storage.buckets (id, name, public) values ('stuckato-private', 'stuckato-private', false) on conflict (id) do nothing;

drop policy if exists "stuckato private: pupil writes own folder" on storage.objects;
create policy "stuckato private: pupil writes own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'stuckato-private' and (storage.foldername(name))[1] = public.practicigo_my_studio()::text
              and (storage.foldername(name))[2] = auth.uid()::text);
drop policy if exists "stuckato private: pupil or their teacher reads" on storage.objects;
create policy "stuckato private: pupil or their teacher reads" on storage.objects for select to authenticated
  using (bucket_id = 'stuckato-private' and (storage.foldername(name))[1] = public.practicigo_my_studio()::text
         and ((storage.foldername(name))[2] = auth.uid()::text or public.practicigo_my_role() = 'teacher'));
drop policy if exists "stuckato private: pupil or their teacher deletes" on storage.objects;
create policy "stuckato private: pupil or their teacher deletes" on storage.objects for delete to authenticated
  using (bucket_id = 'stuckato-private' and (storage.foldername(name))[1] = public.practicigo_my_studio()::text
         and ((storage.foldername(name))[2] = auth.uid()::text or public.practicigo_my_role() = 'teacher'));

-- ---------------------------------------------------------------------------------------------
-- Permissions for the functions above.

revoke execute on function public.practicigo_pair(uuid, uuid) from public, anon;
revoke execute on function public.practicigo_unpair(uuid) from public, anon;
revoke execute on function public.practicigo_minutes_on(jsonb, date) from public, anon;
revoke execute on function public.practicigo_my_partners() from public, anon;
revoke execute on function public.practicigo_set_challenge(uuid, int) from public, anon;
revoke execute on function public.practicigo_in_review(uuid, uuid) from public, anon;
revoke execute on function public.practicigo_review_performers(uuid) from public, anon;
grant execute on function public.practicigo_pair(uuid, uuid) to authenticated;
grant execute on function public.practicigo_unpair(uuid) to authenticated;
grant execute on function public.practicigo_minutes_on(jsonb, date) to authenticated;
grant execute on function public.practicigo_my_partners() to authenticated;
grant execute on function public.practicigo_set_challenge(uuid, int) to authenticated;
grant execute on function public.practicigo_in_review(uuid, uuid) to authenticated;
grant execute on function public.practicigo_review_performers(uuid) to authenticated;
