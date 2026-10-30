# Estoque NTI

Sistema de estoque do setor NTI. Node.js 24 + Express 5 + MySQL 8.4, login com JWT, interface em Tailwind 4.

## Rodar com Docker (recomendado)

Requisito: **Docker Desktop** (Windows 11, com WSL 2).

```powershell
copy .env.example .env      # depois edite o .env: senhas e JWT_SECRET
docker compose up -d --build
```

Abra **http://localhost:3000** e entre com `ADMIN_EMAIL` / `ADMIN_PASSWORD` do `.env`.

Na primeira subida o Compose faz tudo sozinho, nesta ordem: sobe o MySQL, espera ele ficar saudável, roda a migração
(`migrate`: tabelas, categorias, locais e o primeiro admin) e só então liga o app.

### Dia a dia

| O que | Comando |
|---|---|
| Ver o estado | `docker compose ps` |
| Logs do app | `docker compose logs -f app` |
| Parar | `docker compose stop` |
| Ligar de novo | `docker compose start` |
| Atualizar (código novo) | `docker compose up -d --build` |
| Derrubar (mantém os dados) | `docker compose down` |
| Derrubar **e apagar o banco** | `docker compose down -v` |

Os dados do MySQL ficam no volume `estoque-nti_db-data` e sobrevivem a `down`, a atualizações e a reinícios do PC.
Só `down -v` apaga. O app reinicia sozinho (`restart: unless-stopped`) se cair ou se o Docker subir com o Windows.

### Backup e restauração

```powershell
docker compose --profile tools run --rm backup
# gera backups\estoque-AAAAMMDD-HHMMSS.sql.gz (e apaga os com mais de 14 dias; mude em BACKUP_KEEP_DAYS)

docker compose --profile tools run --rm -e FILE=estoque-20261018-103000.sql.gz restore
```

Para agendar todo dia: *Agendador de Tarefas* do Windows, ação "Iniciar um programa" = `docker`, argumentos
`compose --profile tools run --rm backup`, "Iniciar em" = a pasta do projeto. **Copie a pasta `backups` para outra máquina
ou disco** de vez em quando: backup no mesmo computador não protege contra perda do computador.

### Trazer os dados do MySQL que já roda no Windows

```powershell
mkdir backups
mysqldump -u root -p --result-file=backups\migracao.sql estoque_nti
docker compose --profile tools run --rm -e FILE=migracao.sql restore
```

(Use `--result-file`; o `>` do PowerShell grava em UTF-16 e corrompe o arquivo.)
O MySQL do Docker **não usa a porta 3306 do Windows**, então os dois convivem sem conflito.

### HTTPS (opcional)

```powershell
# no .env:  APP_BIND=127.0.0.1   COOKIE_SECURE=true   TRUST_PROXY=1   SITE_ADDRESS=estoque.suaempresa.local
docker compose --profile https up -d --build
```

- `TLS_MODE=internal` (padrão): o Caddy cria uma CA própria. Serve para rede interna; o navegador só deixa de avisar depois
  de instalar o certificado raiz no Windows: `docker compose cp proxy:/data/caddy/pki/authorities/local/root.crt .`
  e dois cliques no arquivo ("Instalar certificado" em *Autoridades de Certificação Raiz Confiáveis*).
- Com domínio público, ponha um e-mail em `TLS_MODE` e o Caddy obtém e renova o certificado Let's Encrypt sozinho.

### Desenvolvimento

```powershell
docker compose -f docker-compose.yml -f docker-compose.dev.yml watch
```

Recarrega o app ao editar `src/` e `public/` e publica o MySQL em `127.0.0.1:3307` para DBeaver/Workbench.

## Rodar sem Docker

Precisa de Node 22+ e MySQL. Preencha a seção "SEM DOCKER" do `.env` e use `npm install`, `npm run setup`, `npm start`.

## Contato de suporte no rodapé

Defina `SUPPORT_EMAIL` e/ou `SUPPORT_PHONE` no `.env` e o rodapé mostra os dois como links clicáveis (`mailto:` e `tel:`).
Se ficarem vazios, o rodapé não mostra contato nenhum (nada de dado inventado).

## Visual (CSS)

O Tailwind é compilado **uma vez** para `public/styles.css` (sem CDN: funciona sem internet e abre mais rápido no celular).
O arquivo já vem pronto no projeto. **Só se você mudar classes de estilo** em `public/app.js` ou `public/*.html`:

```powershell
npm install        # precisa dos pacotes de desenvolvimento
npm run build:css  # regera public/styles.css (o CI avisa se você esquecer)
```

## Endereços (URLs)

A tela atual fica no endereço, então o botão Voltar, o F5 e links diretos funcionam:
`#/painel`, `#/itens`, `#/movimentacoes`, `#/movimentacoes/relatorio` (admin), `#/usuarios` (admin).
Endereço que não existe mostra a página 404 própria (dentro do sistema ou fora dele).

## O que tem no projeto

| Arquivo | Função |
|---|---|
| `Dockerfile` | Imagem em 2 estágios (dependências → runtime), Alpine, usuário sem root, healthcheck |
| `docker-compose.yml` | `db`, `migrate`, `app`, e os opcionais `proxy` (HTTPS), `backup` e `restore` |
| `docker-compose.dev.yml` | Hot reload e porta do banco para desenvolvimento |
| `Caddyfile` | Proxy reverso com HTTPS automático |
| `public/` | Tela (`app.js`, `index.html`, `404.html`), `styles.css` compilado, ícones e `manifest.webmanifest` |
| `styles/input.css` | Origem do CSS (Tailwind + vidro fosco); gera `public/styles.css` |
| `.env.example` | Todas as variáveis, comentadas |
| `.github/workflows/ci.yml` | CI: checa sintaxe, builda a imagem, sobe a stack e faz teste de fumaça |
| `GET /api/health` | Responde 200 se app e banco estão ok (503 se o banco caiu) |

## Segurança: checklist antes de usar de verdade

- [ ] Trocar **todas** as senhas e o `JWT_SECRET` no `.env` (o `.env` nunca vai para o Git; já está no `.gitignore`).
- [ ] Trocar a senha do admin depois do primeiro login e apagar `ADMIN_PASSWORD` do `.env`.
- [ ] O banco não é publicado fora do Docker. Mantenha assim.
- [ ] Se outras máquinas vão acessar, use HTTPS (seção acima). Sem HTTPS, a senha trafega em texto puro na rede.
- [ ] Agendar o backup e testar uma restauração.
- [ ] Atualizar as imagens de vez em quando: `docker compose pull db` e `docker compose build --pull app`.

## Problemas comuns

- **`variable is not set` ao subir:** falta preencher `DB_ROOT_PASSWORD`, `DB_APP_PASSWORD` ou `JWT_SECRET` no `.env`.
- **Porta 3000 ocupada:** mude `APP_PORT` no `.env`.
- **App `unhealthy`:** `docker compose logs app db migrate` mostra o motivo (quase sempre senha diferente da usada na primeira subida).
- **Mudei a senha do banco no `.env` e o app não conecta:** o MySQL só lê a senha ao criar o volume. Troque dentro do MySQL
  ou, se ainda não há dados, `docker compose down -v` e suba de novo.
