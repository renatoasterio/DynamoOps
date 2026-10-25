# DynamoOps — Desktop App

GUI desktop para AWS DynamoDB com foco em alta produtividade.

## Licença do projeto

Licença **MIT + Commons Clause** + condição adicional (`LICENSE`): uso livre por qualquer pessoa ou empresa (inclusive uso interno), cópia e modificação com crédito (aviso de copyright); proibido vender ou embutir em produto/serviço pago. Todas as features são gratuitas — não existe sistema de planos/licença no app.

## Stack

- **Electron** + **Express** (port 3457) + **vanilla JS** (ES modules)
- `electron-main.js` — janela principal, menu, carrega o Express
- `server.js` — inicia o Express

## Estrutura

```
src/backend/
  config/aws.js          — AWS clients, cache, assumed role state
  controllers/           — connectionController, tableController
  config/server.js       — HOST 127.0.0.1 + porta (nunca escutar em 0.0.0.0)
  middleware/
    connection.js        — injeta req.clients por request (ou usa assumed role global)
    security.js          — localOnly (Host/Origin) + headers (CSP…)
    errors.js            — asyncHandler + errorHandler (erros AWS → status HTTP)
    validate.js          — router.param de nomes + requireString/Object/Array
  services/
    dynamoService.js     — scan, query, CRUD, truncate, streams
    stsService.js        — AssumeRole STS
    ssoService.js        — login AWS SSO (IAM Identity Center)
  routes/api.js          — todas as rotas Express

public/
  index.html             — SPA completa
  styles.css             — tema dark, CSS variables
  js/
    state/store.js       — state global + config de conexão + getActiveTabConnection()
    api/apiClient.js     — api(), tableApi() e connectedApi(): use tableApi para /tables/<t>/…
    utils/               — html.js (escapeHtml), keySchema, storage, format, dynamoJson, clipboard, download, toast
    codegen/             — geradores puros (sem DOM): languages/<lang>.js exporta { id, label, query, crud, sdk };
                           index.js = registry; expressions.js = encoders de literal (dq, sq, shellQuote…)
  fonts/                 — Inter + JetBrains Mono locais (a CSP não permite origens externas)
    components/
      LoginManager.js    — login, assume role, profiles, env picker
      TabManager.js      — multi-tab com state isolado por tab
      DataViewer.js      — table/json view, inline edit, export
      QueryPanel.js      — scan/query/SQL, filtros, paginação
      ChartView.js       — timeline/distribuição/heatmap (SVG puro)
      Sidebar.js         — lista de tabelas
      SchemaExporter.js  — export CF/Terraform/CDK
```

## Conexão e State

- `config` (store.js): region, profile, endpoint, envTag — conexão ativa
- `state.tabs[]`: cada tab guarda items, queryState, searchTerm, connection
- `/disconnect` reseta assumedRoleInfo + currentConfig no backend
- `resetPreviousSession()` (LoginManager): limpa tudo antes de nova conexão

## Convenções

- Controllers não têm try/catch: lançam (`badRequest`, erros da AWS) e o `errorHandler` responde.
- Toda interpolação de dado em `innerHTML`/atributos passa por `escapeHtml` — dados do DynamoDB não são confiáveis.
- Chamadas de tabela usam `tableApi(...)` (conexão da aba ativa + nome codificado); escritas medidas com `trackedWrite(...)`.
- `localStorage` só via `utils/storage.js` (nunca lança).
- Geradores: todo valor vindo do usuário passa por um encoder de `codegen/expressions.js`; nova linguagem = novo módulo em `codegen/languages/` registrado no `index.js`.
- `npm test` (Jest com ESM: `tests/*.test.mjs` importam `public/js`) e `npm run lint` precisam passar.

## Build

```bash
npm run dev              # Electron dev
npm run build:prod:mac   # DMG arm64
npm run build:prod:win   # NSIS + portable
```
