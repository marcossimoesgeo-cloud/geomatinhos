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

1. No painel do Supabase, vá em **Project Settings** (ícone de engrenagem) → **API**.
2. Copie o **Project URL** e a chave **anon / public**.
3. Abra o arquivo [`geoportal_web/js/supabase-config.js`](./geoportal_web/js/supabase-config.js) e preencha:

```javascript
window.GEO_SUPABASE = {
    url: "https://SEU-PROJETO.supabase.co",
    anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    bucket: "restrito",
    manifest: "config_restrito.json"
};
```

4. Salve o arquivo e envie a atualização para o GitHub (`enviar_github.ps1`).

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
