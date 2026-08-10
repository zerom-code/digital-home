-- ============================================================================
-- 0004_storage.sql — приватный бакет для фотографий и документов
--
-- Путь строго {household_id}/{item_id}/{uuid}.{ext}: первый сегмент — это
-- household_id, и именно по нему политика решает, кому файл виден.
-- Отдача наружу — только через signed URL с коротким сроком жизни.
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('docs', 'docs', false)
on conflict (id) do nothing;


create policy docs_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'docs'
    and public.is_household_member(((storage.foldername(name))[1])::uuid)
  );

create policy docs_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'docs'
    and public.can_write(((storage.foldername(name))[1])::uuid)
  );

create policy docs_update on storage.objects
  for update to authenticated
  using      (bucket_id = 'docs' and public.can_write(((storage.foldername(name))[1])::uuid))
  with check (bucket_id = 'docs' and public.can_write(((storage.foldername(name))[1])::uuid));

create policy docs_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'docs'
    and public.can_write(((storage.foldername(name))[1])::uuid)
  );
