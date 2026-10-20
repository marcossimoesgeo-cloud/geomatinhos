-- Execute UMA vez no Supabase: SQL Editor > New query > Run.
-- Cria o bucket PRIVADO "restrito" e permite leitura somente a usuários autenticados (servidores).
-- Não existe política de escrita: o upload é feito apenas pelo painel do Supabase (Storage) pelo administrador.

insert into storage.buckets (id, name, public)
values ('restrito', 'restrito', false)
on conflict (id) do update set public = false;

drop policy if exists "servidores leem camadas restritas" on storage.objects;
create policy "servidores leem camadas restritas"
on storage.objects for select
to authenticated
using (bucket_id = 'restrito');
