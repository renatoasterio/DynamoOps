<p align="center">
  <img src="assets/icons/icon.png" alt="DynamoOps" width="80" />
</p>

<h1 align="center">DynamoOps</h1>

<p align="center">
  <strong>Interface desktop gratuita para Amazon DynamoDB.</strong><br/>
  Consulte, edite e gerencie suas tabelas com a fluidez do MongoDB Compass — no macOS e no Windows.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-PolyForm%20Noncommercial%201.0.0-blue" />
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey" />
  <img src="https://img.shields.io/badge/node-%3E%3D18-green?logo=node.js&logoColor=white" />
  <img src="https://img.shields.io/badge/electron-35.x-47848F?logo=electron&logoColor=white" />
</p>

---

## Por que o DynamoOps?

O AWS Console é lento para o dia a dia e a CLI exige decorar sintaxe. O DynamoOps junta tudo numa interface desktop rápida, com todas as funcionalidades liberadas — sem planos, sem cadastro, sem licença para ativar.

| Problema | Solução |
|---|---|
| Console AWS lento e verboso | Interface local instantânea |
| CLI pouco intuitiva | Scan/Query visual e editor PartiQL com autocomplete |
| Sem visão rápida dos dados | Tabela, JSON (nativo ou DynamoDB JSON) e gráficos |
| Gestão de credenciais complexa | Perfis AWS, Assume Role, AWS SSO e LocalStack |
| Import/Export manual | JSON, CSV e Excel em lote |
| Trocar de tabela perde contexto | Abas com estado independente |

---

## ✨ Funcionalidades

### 🔐 Conexão
- **Perfis AWS** (`~/.aws/credentials`) e **perfis salvos** com conexões recentes.
- **Assume Role (STS)** com histórico de roles e etiqueta de ambiente (dev, qa, staging, prod, local).
- **AWS SSO (IAM Identity Center)**: login pelo navegador, escolha de conta e role.
- **Endpoint customizado**: DynamoDB Local, LocalStack e afins.

### 📊 Visualização
- **Tabela** com colunas ordenáveis, redimensionáveis e reordenáveis, edição inline (duplo clique) e seleção múltipla com exclusão em lote.
- **JSON** em árvore colapsável, alternando entre JSON nativo e **DynamoDB JSON** (`{"S": …}`, `{"N": …}`).
- **Gráficos**: timeline, distribuição e heatmap (SVG puro).
- **Dashboard** da tabela e **Cost Tracker** com o custo estimado de cada operação (RCU/WCU).

### 🔍 Consultas
- **Scan** e **Query** (índice primário e GSIs) com filtros visuais e paginação.
- **PartiQL** com destaque de sintaxe, templates, formatador, erros inline, confirmação antes de escritas e autocomplete de tabelas, colunas, funções e operadores.
- **Histórico** de consultas para reaproveitar com um clique.

### ✏️ Itens
- Inserir, editar, clonar, copiar e excluir itens (editor JSON ou formulário via **templates** por tabela).
- **Histórico de versões** por item com diff visual e restauração.
- **Import** JSON/CSV/Excel e **export** JSON/CSV com seleção de campos.

### 🗃️ Tabelas e esquema
- Criar, excluir e truncar tabelas; criar e excluir **GSIs**.
- **Exportar esquema** para CloudFormation, Terraform e CDK.
- **Gerador de código** da consulta atual e de SDK completo em várias linguagens.
- **DynamoDB Streams**: feed ao vivo de INSERT / MODIFY / REMOVE.

### 🎨 Interface
- Tema escuro e claro, sidebar recolhível, abas e atalhos de teclado.

| Atalho | Ação |
|---|---|
| `Cmd/Ctrl+Enter` | Executar consulta |
| `Cmd/Ctrl+W` | Fechar aba |
| `Cmd/Ctrl+R` | Recarregar dados |
| `Cmd/Ctrl+[` / `]` | Aba anterior / próxima |
| `Cmd/Ctrl+K` | Buscar tabela na sidebar |
| `Cmd/Ctrl+B` | Recolher / expandir a sidebar |
| `Cmd/Ctrl+F` | Filtrar itens carregados |
| `Esc` | Fechar modal |

---

## 🚀 Começando

### Pré-requisitos
- **Node.js** 18+ e **npm**
- Credenciais AWS em `~/.aws/credentials` (ou SSO / LocalStack)

### Instalação

```bash
git clone https://github.com/renatoasterio/dynamo-studio-gui.git
cd dynamo-studio-gui
npm install
```

### Rodar

```bash
# Desktop (Electron)
npm run electron

# Só no navegador → http://localhost:3457
npm run dev
```

### Testes e lint

```bash
npm test       # Jest (inclui testes de segurança da API)
npm run lint   # ESLint (frontend e backend)
```

### Gerar instaladores

```bash
npm run build:prod:mac            # macOS Apple Silicon (.dmg)
npm run build:prod:mac:universal  # macOS Universal
npm run build:prod:win            # Windows x64 (instalador NSIS + portable)
```

Os arquivos ficam em `dist/`. O frontend é empacotado com esbuild numa cópia em staging; os arquivos fonte não são alterados.

> **Windows**: o SDK lê `%USERPROFILE%\.aws\credentials`. Configure com `aws configure`.

---

## 🏗️ Arquitetura

Electron + servidor Express local (porta 3457) + frontend em JavaScript puro (ES modules).

```
electron-main.js            Processo principal do Electron (sobe o Express, janela em sandbox)
server.js                   Entry point do Express (modo navegador)
src/backend/
  config/server.js          Host (127.0.0.1) e porta
  config/aws.js             Clientes AWS e cache por conexão
  middleware/security.js    Só aceita o próprio app (Host/Origin) + headers de segurança (CSP…)
  middleware/errors.js      asyncHandler, erro central, status HTTP a partir dos erros da AWS
  middleware/validate.js    Validação de nomes de tabela/índice e corpos das requisições
  middleware/connection.js  Injeta os clientes AWS por requisição
  controllers/              Handlers finos: connection, table, item, import, sso
  services/                 dynamoService, stsService, ssoService, streamsService
  routes/api.js             Rotas /api
public/
  index.html, styles.css    SPA e tema (variáveis CSS, escuro/claro)
  js/state/store.js         Estado global, por aba, e conexão da aba ativa
  js/api/apiClient.js       api / tableApi / connectedApi (sempre com a conexão da aba)
  js/utils/                 html (escapeHtml), keySchema, storage, format, clipboard, download, toast
  js/components/            DataViewer, QueryPanel, SqlEditor, TabManager, LoginManager, …
scripts/build-prod.js       Build de produção (esbuild + electron-builder)
tests/                      Testes Jest
```

### Segurança

- A API local roda com as credenciais AWS do usuário, então só escuta em `127.0.0.1` e recusa requisições com `Host` ou `Origin` de fora do app (protege contra DNS rebinding e contra sites abertos no navegador).
- Todo dado vindo do DynamoDB é tratado como não confiável: qualquer interpolação em HTML passa por `escapeHtml` (`public/js/utils/html.js`), e a CSP (`script-src 'self'`) bloqueia scripts inline como segunda camada.
- O Electron roda com `sandbox`, sem Node no renderer, sem navegação para fora do app, e só abre links `https:` no navegador padrão.

---

## 🤝 Contribuindo

Issues e pull requests são bem-vindos. Antes de abrir um PR, rode `npm test`.

---

## 📄 Licença

DynamoOps é distribuído sob a **[PolyForm Noncommercial License 1.0.0](LICENSE)**.

- ✅ Você pode usar, copiar, modificar e redistribuir para fins **não comerciais**: uso pessoal, estudo, pesquisa, projetos hobby e organizações sem fins lucrativos (instituições de ensino, ONGs, órgãos públicos).
- ✅ Ao distribuir cópias ou versões modificadas, mantenha o arquivo `LICENSE` e a linha `Required Notice` com o crédito ao autor.
- ❌ Uso comercial não é permitido sem autorização do autor — isso inclui vender ou embutir em produto/serviço pago **e** usar a ferramenta no trabalho de uma empresa com fins lucrativos.

Copyright (c) 2026 Renato Asterio.
