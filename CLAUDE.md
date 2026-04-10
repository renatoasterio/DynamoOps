# DynamoOps — Desktop App

GUI desktop para AWS DynamoDB com foco em alta produtividade.

## Branches

| Branch | Descrição |
|--------|-----------|
| `feat/license-system` | **Versão paga** — controle de licença JWT (ES256), planos Free/Pro/Pro+, validação offline, Stripe subscription |
| `feature/no-license` | **Versão sem licença** — todas as features liberadas, sem controle de plano |
| `main` | Base de desenvolvimento |

> A branch atual (`feat/license-system`) é a versão comercial com sistema de licença.

## Stack

- **Electron** + **Express** (port 3457) + **vanilla JS** (ES modules)
- `electron-main.js` — janela principal, menu, IPC para licença
- `server.js` — inicia o Express
- `preload.js` — contextBridge (licenseStatus, licenseActivate, licenseDeactivate)

## Estrutura

```
src/backend/
  config/aws.js          — AWS clients, cache, assumed role state
  controllers/           — connectionController, tableController
  middleware/
    connection.js        — injeta req.clients por request (ou usa assumed role global)
    license.js           — requirePlan('pro') middleware (402 se plano insuficiente)
  services/
    dynamoService.js     — scan, query, CRUD, truncate, streams
    stsService.js        — AssumeRole STS
    licenseService.js    — JWT verify, grace period, refresh online
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
      LicenseManager.js  — UI de ativação, _applyPlanToUI()
      SchemaExporter.js  — export CF/Terraform/CDK
```

## Conexão e State

- `config` (store.js): region, profile, endpoint, envTag — conexão ativa
- `state.tabs[]`: cada tab guarda items, queryState, searchTerm, connection
- `/disconnect` reseta assumedRoleInfo + currentConfig no backend
- `resetPreviousSession()` (LoginManager): limpa tudo antes de nova conexão

## Licença (branch feat/license-system)

- JWT ECDSA P-256 com chave pública embarcada em `licenseService.js`
- Validação offline: JWT válido → plano ativo; expirado → grace period 7 dias → free
- Refresh online: POST /api/license/refresh (30 dias tolerância)
- UI: `_applyPlanToUI()` esconde botões por plano; middleware retorna 402
- Chaves separadas: dev (.env) vs production (.env.production)

## Build

```bash
npm run dev              # Electron dev
npm run build:prod:mac   # DMG arm64
npm run build:prod:win   # NSIS + portable
```
