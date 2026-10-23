-- Execute UMA vez no Supabase: SQL Editor > New query > Run.
-- Cria a tabela do Histórico de Uso dos servidores.
--  * Qualquer servidor logado no geoportal pode GRAVAR um registro de uso (insert).
--  * Somente o administrador (e-mail abaixo) consegue LER o histórico (select).
--  * Ninguém altera ou apaga registros pelo site.

create table if not exists public.uso_servidores (
    id         bigint generated always as identity primary key,
    criado_em  timestamptz not null default now(),
    email      text not null check (char_length(email) <= 200),
    funcao     text not null check (char_length(funcao) <= 120),
    detalhe    text check (char_length(detalhe) <= 300)
);

create index if not exists uso_servidores_criado_em_idx on public.uso_servidores (criado_em desc);
create index if not exists uso_servidores_email_idx on public.uso_servidores (email);

alter table public.uso_servidores enable row level security;

drop policy if exists "servidores registram uso" on public.uso_servidores;
create policy "servidores registram uso"
on public.uso_servidores for insert
to anon, authenticated
with check (true);

drop policy if exists "somente admin le historico" on public.uso_servidores;
create policy "somente admin le historico"
on public.uso_servidores for select
to authenticated
using ((auth.jwt() ->> 'email') = 'marcossimoesgeo@gmail.com');

grant insert on public.uso_servidores to anon, authenticated;
grant select on public.uso_servidores to authenticated;
