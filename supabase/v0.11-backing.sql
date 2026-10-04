-- Stuckato v0.11: backing tracks. Run once in the Supabase SQL editor, after v0.10.
--
-- Pupils' own backing tracks need nothing new: they go in <studio>/<pupil>/ in the private bucket under the v0.10
-- policies (the pupil writes their own folder; the pupil or their teacher reads and deletes).
--
-- The exam accompaniment is the teacher's file, which every pupil in the studio plays along with. It lives in
-- <studio>/teacher/: only the studio's teacher may write or delete there, and anyone in the studio may read it.

drop policy if exists "stuckato private: teacher writes studio teacher folder" on storage.objects;
create policy "stuckato private: teacher writes studio teacher folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'stuckato-private' and (storage.foldername(name))[1] = public.practicigo_my_studio()::text
              and (storage.foldername(name))[2] = 'teacher' and public.practicigo_my_role() = 'teacher');

drop policy if exists "stuckato private: studio reads teacher folder" on storage.objects;
create policy "stuckato private: studio reads teacher folder" on storage.objects for select to authenticated
  using (bucket_id = 'stuckato-private' and (storage.foldername(name))[1] = public.practicigo_my_studio()::text
         and (storage.foldername(name))[2] = 'teacher');

drop policy if exists "stuckato private: teacher deletes studio teacher folder" on storage.objects;
create policy "stuckato private: teacher deletes studio teacher folder" on storage.objects for delete to authenticated
  using (bucket_id = 'stuckato-private' and (storage.foldername(name))[1] = public.practicigo_my_studio()::text
         and (storage.foldername(name))[2] = 'teacher' and public.practicigo_my_role() = 'teacher');
