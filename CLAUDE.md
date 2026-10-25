# DynamoOps — Desktop App

GUI desktop para AWS DynamoDB com foco em alta produtividade.

## Licença do projeto

Código aberto sob **PolyForm Noncommercial 1.0.0** (`LICENSE`): uso, cópia e modificação livres para fins não comerciais, com crédito obrigatório (linha `Required Notice`). Todas as features são gratuitas — não existe sistema de planos/licença no app.

## Stack

- **Electron** + **Express** (port 3457) + **vanilla JS** (ES modules)
- `electron-main.js` — janela principal, menu, carrega o Express
- `server.js` — inicia o Express

## Estrutura

```
src/backend/
  config/aws.js          — AWS clients, cache, assumed role state
  controllers/           — connectionController, tableController
  middleware/
    connection.js        — injeta req.clients por request (ou usa assumed role global)
  services/
    dynamoService.js     — scan, query, CRUD, truncate, streams
    stsService.js        — AssumeRole STS
    ssoService.js        — login AWS SSO (IAM Identity Center)
  routes/api.js          — todas as rotas Express

public/
  index.html             — SPA completa
  styles.css             — tema dark, CSS variables
  js/
    state/store.js       — state global + config de conexão
    api/apiClient.js     — fetch wrapper com headers de conexão
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

## Build

```bash
npm run dev              # Electron dev
npm run build:prod:mac   # DMG arm64
npm run build:prod:win   # NSIS + portable
```
