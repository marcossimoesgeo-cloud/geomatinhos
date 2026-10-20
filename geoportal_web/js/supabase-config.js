/**
 * Configuração do login de servidores (Supabase).
 * Preencha 'url' e 'anonKey' após criar o projeto (veja LEIA-ME_LOGIN.md).
 * A chave "anon public" é pública por projeto do Supabase; a proteção dos dados
 * vem das regras (RLS) do bucket privado, não do sigilo desta chave.
 * NUNCA coloque aqui a chave "service_role".
 */
window.GEO_SUPABASE = {
    url: "https://gbdeftfhayevbyvepwqp.supabase.co",
    anonKey: "sb_publishable_2a42kGEPSssk0SGJK-JoTQ_Dp4bwPaL",
    bucket: "restrito",                 // bucket PRIVADO com as camadas restritas
    manifest: "config_restrito.json"    // lista das camadas restritas dentro do bucket
};
