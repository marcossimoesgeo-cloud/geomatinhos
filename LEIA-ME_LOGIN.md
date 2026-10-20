# Configuração do Login de Servidores e Camadas Restritas (Supabase)

O Geoportal de Matinhos possui autenticação real integrada ao **Supabase** (plano gratuito) para diferenciar o acesso entre o **Público em Geral** e **Servidores Municipais**.

---

## 1. Criar o projeto gratuito no Supabase

1. Acesse [https://supabase.com](https://supabase.com) e crie uma conta gratuita (pode entrar com o GitHub).
2. Clique em **New Project**, escolha o nome (ex.: `geoportal-matinhos`), defina uma senha para o banco e selecione a região **South America (São Paulo)**.
3. Aguarde ~1 minuto até o projeto inicializar.

---

## 2. Configurar o Bucket Privado (`restrito`)

1. No painel lateral do Supabase, clique em **SQL Editor** → **New query**.
2. Cole todo o conteúdo do arquivo [`supabase_setup.sql`](./supabase_setup.sql) e clique em **Run**.
   - Isso criará automaticamente o bucket privado **`restrito`** e a regra de segurança (RLS) permitindo leitura apenas para usuários autenticados.

---

## 3. Desativar o auto-cadastro público e criar contas dos servidores

1. No menu lateral do Supabase, vá em **Authentication** → **Providers** → **Email**:
   - Desmarque a opção **Enable Sign Ups** (ou **Allow new users to sign up**) e clique em **Save**. Assim, somente o administrador poderá cadastrar funcionários.
2. Vá em **Authentication** → **Users** → **Add user** → **Create new user**:
   - Informe o **E-mail** institucional e a **Senha** do servidor, marque **Auto Confirm User** e clique em **Create user**.

---

## 4. Conectar o Geoportal ao seu Supabase

No painel novo do Supabase, o endereço (`url`) e a chave (`anonKey`) ficam em lugares separados:

1. **Como achar a `url` (Project URL):**
   - Olhe o endereço do navegador enquanto estiver no painel do Supabase: ele será parecido com `https://supabase.com/dashboard/project/abcdefghijklmnop`.
   - Aquele código final (`abcdefghijklmnop`) é o ID do seu projeto, então sua `url` é `https://abcdefghijklmnop.supabase.co`.
   - *(Alternativa)*: No menu lateral, clique em **Project Settings** (engrenagem no rodapé) → **Data API** → copie o campo **Project URL** (ou clique no botão **Connect** no topo da página).

2. **Como achar a `anonKey` (Chave Pública):**
   - Vá em **Project Settings** (engrenagem) → **API Keys**.
   - Copie a **Publishable key** (começa com `sb_publishable_...`) **OU** clique na aba **Legacy API Keys** e copie a chave **`anon` `public`** (começa com `eyJ...`).
   - ⚠️ **Atenção:** **NUNCA** use a **Secret key** (`sb_secret_...`) nem a `service_role` no geoportal.

3. **Onde colar:**
   - Abra o arquivo [`geoportal_web/js/supabase-config.js`](./geoportal_web/js/supabase-config.js) (e **não** este arquivo `LEIA-ME_LOGIN.md`) e preencha:

```javascript
window.GEO_SUPABASE = {
    url: "https://SEU-CODIGO-DE-PROJETO.supabase.co",
    anonKey: "sb_publishable_2a42kGEPSssk0SGJK-JoTQ_Dp4bwPaL",
    bucket: "restrito",
    manifest: "config_restrito.json"
};
```

4. Salve o arquivo [`geoportal_web/js/supabase-config.js`](./geoportal_web/js/supabase-config.js).

---

## 5. Como tornar uma camada restrita apenas para servidores

Use o utilitário [`restringir_camada.py`](./restringir_camada.py) para mover uma camada pública para a pasta local `restrito/` (que é ignorada pelo Git e não vai para o repositório público):

```powershell
# Listar todas as camadas e seus IDs
& "C:\Program Files\QGIS 3.44.14\bin\python-qgis-ltr.bat" restringir_camada.py --listar

# Mover uma camada para a pasta restrito/
& "C:\Program Files\QGIS 3.44.14\bin\python-qgis-ltr.bat" restringir_camada.py --mover ID_DA_CAMADA
```

Depois, no painel do Supabase (**Storage** → bucket **`restrito`**), faça upload:
- Do arquivo `restrito/config_restrito.json` (na raiz do bucket `restrito`)
- Dos arquivos `.geojson` da pasta `restrito/data/` para dentro de uma pasta `data/` no bucket (`restrito/data/...`).
