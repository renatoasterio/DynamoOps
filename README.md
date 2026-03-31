<p align="center">
  <img src="public/icon.png" alt="DynamoDB GUI" width="80" />
</p>

<h1 align="center">DynamoDB GUI</h1>

<p align="center">
  <strong>A interface visual definitiva para Amazon DynamoDB.</strong><br/>
  Consulte, edite e gerencie suas tabelas com a mesma fluidez do MongoDB Compass — sem sair do seu Mac.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-2.0.0-blueviolet" />
  <img src="https://img.shields.io/badge/platform-macOS-000?logo=apple&logoColor=white" />
  <img src="https://img.shields.io/badge/arch-Apple%20Silicon%20%7C%20Intel-blue" />
  <img src="https://img.shields.io/badge/license-Proprietary-red" />
  <img src="https://img.shields.io/badge/node-%3E%3D18-green?logo=node.js&logoColor=white" />
  <img src="https://img.shields.io/badge/electron-33.x-47848F?logo=electron&logoColor=white" />
</p>

---

## Por que o DynamoDB GUI?

O AWS Console é lento, burocrático e não foi feito para desenvolvedores que precisam de agilidade. Ferramentas CLI exigem memorizar sintaxes. O DynamoDB GUI resolve isso tudo numa interface desktop elegante, rápida e produtiva.

| Problema | Nossa Solução |
|---|---|
| Console AWS lento e verboso | Interface local instantânea, zero latência de navegação |
| CLI pouco intuitiva | Query builder visual com autocomplete context-aware |
| Sem visão rápida dos dados | Dual view: Tabela ↔ JSON estilo MongoDB Compass |
| Gestão de credenciais complexa | Assume Role visual com 1 clique + perfis salvos |
| Import/Export manual e tedioso | Bulk import/export JSON e CSV nativos |
| Trocar de tabela perde contexto | Sistema de abas — múltiplas tabelas abertas simultaneamente |
| Esquema de tabela difícil de exportar | Export para CloudFormation YAML ou Terraform HCL com 1 clique |

---

## ✨ Funcionalidades

### 🔐 Conexão Inteligente
- **Multi-Profile**: Conecte-se usando qualquer perfil AWS configurado (`~/.aws/credentials`).
- **Perfis Salvos**: Salve e carregue configurações de conexão frequentes com um clique.
- **Custom Endpoint**: Suporte completo a DynamoDB Local, LocalStack e endpoints customizados.
- **Assume Role (STS)**: Assuma roles IAM visualmente — informe o ARN e clique. Credenciais temporárias geradas automaticamente via `sts:AssumeRole`, com badge visual indicando o role ativo.
- **Logout Seguro**: Botão de logout no header encerra a sessão e fecha todas as abas abertas automaticamente.

### 🗂️ Sistema de Abas
- **Multi-tabela**: Abra várias tabelas simultaneamente em abas independentes.
- **Contexto preservado**: Cada aba mantém seu próprio estado de query, filtros e paginação.
- **Fechar abas**: Clique no `×` de cada aba ou use o logout para fechar todas de uma vez.
- **Navegação por teclado**: `Cmd+[` / `Cmd+]` para navegar entre abas sem tirar as mãos do teclado.

### 📊 Visualização de Dados
- **Table View**: Dados tabulares com colunas inteligentemente ordenadas (PKs e SKs primeiro), ações inline por registro (Editar, Copiar, Excluir). Detecta automaticamente todas as colunas dos documentos carregados.
- **JSON View (Compass Style)**: Cada documento renderizado como árvore JSON interativa e colapsável — expanda e retraia objetos e arrays com um clique, exatamente como o MongoDB Compass. Layout compacto com separadores sutis.
- **Alternância de view**: Toggle Table ↔ JSON disponível diretamente acima dos dados.

### 🔍 Consultas Avançadas
- **Scan**: Varredura completa da tabela com filtros visuais configuráveis por atributo, tipo e operador.
- **Query**: Queries pelo índice primário ou GSIs com condições de filtro e operadores matemáticos.
- **SQL (PartiQL)**: Editor SQL completo com autocomplete inteligente:
  - **Context-aware**: após `FROM` sugere tabelas, após `WHERE`/`AND`/`OR` sugere colunas e funções, após coluna sugere operadores
  - **Sugestões categorizadas** com ícones: `⌨` keywords, `🗂` tables, `🔑` pk/sk, `≡` attrs, `ƒ` functions, `◈` operators
  - **Funções PartiQL**: `attribute_exists`, `attribute_not_exists`, `begins_with`, `contains`, `size`, `attribute_type`
  - **Condições especiais**: `IS NULL`, `IS NOT NULL`, `IS MISSING`, `IS NOT MISSING`
  - Navegação por teclado (`↑↓` navegar, `Tab`/`Enter` inserir, `Esc` fechar)
  - Editor auto-redimensionável

### ⌨️ Atalhos de Teclado
| Atalho | Ação |
|---|---|
| `Cmd+Enter` | Executar query (funciona dentro do editor SQL) |
| `Cmd+W` | Fechar aba ativa |
| `Cmd+R` | Recarregar dados da tabela |
| `Cmd+[` / `Cmd+]` | Navegar para aba anterior / próxima |
| `Cmd+K` | Focar busca de tabelas na sidebar |
| `Cmd+F` | Focar busca de itens no toolbar |
| `Esc` | Fechar modal aberto |

### 🗃️ Gerenciamento de Tabelas & GSI
- **Criar Tabelas**: Defina Partition Key, Sort Key e tipos de atributo diretamente na interface.
- **Excluir Tabelas**: Confirmação segura em duas etapas (digite o nome para confirmar).
- **Truncar Tabelas**: Limpe todos os dados preservando a estrutura — ideal para desenvolvimento.
- **GSI (Global Secondary Index)**:
  - Crie GSIs visualmente — defina Index Name, Partition Key, Sort Key e Projection (ALL / KEYS_ONLY / INCLUDE)
  - Visualize todos os GSIs ativos no info bar da tabela com suas keys e status
  - Delete GSIs diretamente pelo botão `✕` em cada GSI exibido
  - Operações assíncronas com feedback de status (CREATING / ACTIVE)

### 📄 Exportação de Schema
- Botão **Schema** no info bar de cada tabela abre um modal com o schema completo gerado automaticamente:
  - **CloudFormation YAML** — pronto para usar em stacks AWS, inclui `Resources`, `Outputs`, GSIs, LSIs e TTL
  - **Terraform HCL** — recurso `aws_dynamodb_table` completo com todos os atributos, GSIs, LSIs, TTL e tags
- Botão "Copy to Clipboard" para uso imediato

### ⚡ DynamoDB Streams — Feed em Tempo Real
- Botão **⚡ Stream** no toolbar ativa o painel live (somente se a tabela tiver streams habilitados).
- **Polling automático** a cada 3 segundos usando `GetRecords` via shard iterators.
- Feed exibe: horário · tipo de operação · chaves do item · resumo de mudanças.
- Operações com color-coding: 🟢 **INSERT** · 🟡 **MODIFY** · 🔴 **REMOVE**.
- Para MODIFY, mostra quais campos foram alterados (`~campo`), adicionados (`+campo`) ou removidos (`-campo`).
- Botões **Pause/Resume** e **Clear** no cabeçalho do painel.
- Máximo de 200 eventos em memória (rolling buffer).

### 🕐 Versionamento de Itens
- Cada vez que um item é **editado e salvo**, a versão anterior é armazenada automaticamente no `localStorage`.
- Botão **🕐** em cada linha da tabela abre o modal de **Version History**.
- Modal exibe lista de versões salvas (com data/hora) e um **diff visual lado a lado**:
  - 🟢 Campos adicionados · 🔴 Campos removidos · 🟡 Campos modificados · ⚪ Sem mudança
- Botão **Restore this version** reabre o editor com o conteúdo da versão selecionada.
- Histórico local: até 20 versões por item, sem dependência de backend ou tabela auxiliar.

### 🕒 Histórico de Queries
- Registro automático de todas as queries executadas (Scan, Query, SQL).
- Painel de histórico colapsável com visualização compacta.
- Reutilize queries anteriores com um clique.

### ✏️ CRUD de Itens
- Insira, edite e exclua itens com editor JSON integrado e validação em tempo real.
- Clone itens existentes para criar variações rapidamente.
- Copie o JSON de qualquer item para a área de transferência.

### 📥📤 Import & Export em Lote
- **Export**: Exporte resultados de qualquer consulta para **JSON** ou **CSV** com um clique.
- **Import**: Importe arquivos JSON ou CSV em massa via BatchWrite otimizado, com controle de tamanho de batch.

### 🎨 Design & UX
- **Dark / Light Mode**: Alterne entre temas com um clique — preferência persistida entre sessões.
- **Glassmorphism** na tela de login e micro-animações para experiência fluida.
- **Toast notifications** para feedback instantâneo de cada ação.
- **Janela nativa macOS**: Suporte a drag da janela pelo header com `titleBarStyle: hiddenInset`.

---

## 🏗️ Arquitetura

O projeto segue uma **arquitetura modular** com separação clara de responsabilidades:

```
dynamoGUI/
├── electron-main.js                  # Processo principal Electron
├── server.js                         # Entry point Express (modo web)
├── package.json
│
├── src/backend/                      # 🔧 Backend (Node.js + Express)
│   ├── app.js                        #    Setup Express, middlewares, static files
│   ├── config/
│   │   └── aws.js                    #    Configuração centralizada dos clientes AWS (stateless)
│   ├── middleware/
│   │   └── connection.js             #    Middleware de validação de conexão ativa
│   ├── services/
│   │   ├── dynamoService.js          #    Wrapper DynamoDB SDK v3 (tabelas, itens, GSI)
│   │   └── stsService.js             #    Lógica de AssumeRole (STS)
│   ├── controllers/
│   │   ├── connectionController.js   #    POST /api/connect — handshake e validação
│   │   ├── tableController.js        #    CRUD de tabelas, truncate, GSI
│   │   └── itemController.js         #    Scan, Query, PartiQL, CRUD de itens, import/export
│   └── routes/
│       └── api.js                    #    Roteamento Express
│
└── public/                           # 🎨 Frontend (ES6 Modules, Vanilla JS)
    ├── index.html                    #    SPA shell
    ├── styles.css                    #    Design system completo (dark/light themes)
    └── js/
        ├── app.js                    #    Orquestrador — inicializa e conecta todos os módulos
        ├── api/
        │   └── apiClient.js          #    Fetch wrapper centralizado com error handling
        ├── state/
        │   └── store.js              #    Estado global da aplicação
        ├── utils/
        │   ├── dom.js                #    Helpers de DOM
        │   └── toast.js              #    Sistema de notificações toast
        └── components/
            ├── LoginManager.js       #    Tela de login, logout, troca de conexão
            ├── ProfileManager.js     #    Persistência de perfis de conexão salvos
            ├── ConnectionManager.js  #    Barra de conexão + Assume Role
            ├── ThemeManager.js       #    Dark / Light mode toggle
            ├── KeyboardManager.js    #    Atalhos de teclado globais
            ├── TabManager.js         #    Sistema de abas multi-tabela
            ├── Sidebar.js            #    Lista de tabelas + busca
            ├── TableManager.js       #    Create / Delete / Truncate de tabelas
            ├── GsiManager.js         #    Criação e deleção de GSIs
            ├── SchemaExporter.js     #    Exportação de schema (CloudFormation / Terraform)
            ├── StreamsPanel.js       #    DynamoDB Streams — feed live com polling
            ├── VersionHistory.js     #    Histórico de versões por item + diff visual
            ├── QueryPanel.js         #    Scan / Query / SQL + Autocomplete context-aware
            ├── HistoryManager.js     #    Histórico de queries executadas
            ├── DataViewer.js         #    Table view + JSON Compass view
            └── ItemManager.js        #    CRUD de itens + Import/Export em lote
```

### API REST

| Método | Endpoint | Descrição |
|---|---|---|
| `GET` | `/api/config` | Configuração AWS atual |
| `POST` | `/api/connect` | Estabelecer conexão |
| `POST` | `/api/assume-role` | Assume Role via STS |
| `GET` | `/api/tables` | Listar todas as tabelas |
| `POST` | `/api/tables` | Criar tabela |
| `GET` | `/api/tables/:name` | Descrever tabela |
| `DELETE` | `/api/tables/:name` | Deletar tabela |
| `POST` | `/api/tables/:name/truncate` | Truncar tabela |
| `POST` | `/api/tables/:name/gsi` | Criar GSI |
| `DELETE` | `/api/tables/:name/gsi/:gsiName` | Deletar GSI |
| `GET` | `/api/tables/:name/stream` | Status do stream (enabled, ARN, viewType) |
| `GET` | `/api/tables/:name/stream/records` | Últimos registros do stream (polling) |
| `POST` | `/api/tables/:name/scan` | Scan com filtros |
| `POST` | `/api/tables/:name/query` | Query por índice |
| `POST` | `/api/execute-statement` | PartiQL statement |
| `PUT` | `/api/tables/:name/items` | Criar/atualizar item |
| `DELETE` | `/api/tables/:name/items` | Deletar item |
| `POST` | `/api/tables/:name/batch-write` | Import em lote |

### Stack Tecnológica

| Camada | Tecnologia |
|---|---|
| **Runtime** | Node.js ≥ 18 |
| **Backend** | Express.js 4.x |
| **AWS SDK** | v3 — DynamoDB, DynamoDB Document Client, STS, Credential Providers |
| **Frontend** | Vanilla JS (ES6 Modules), HTML5, CSS3 |
| **Desktop** | Electron 33.x + electron-builder |
| **Target** | macOS (Apple Silicon + Intel Universal) |

---

## 🚀 Começando

### Pré-requisitos

- **Node.js** v18+ e **npm**
- Credenciais AWS configuradas em `~/.aws/credentials`
- (Opcional) **AWS CLI** para gerenciar múltiplos perfis

### Instalação

```bash
git clone <repo-url>
cd dynamoGUI
npm install
```

### Modo Desenvolvimento (Navegador)

```bash
npm run dev
# → http://localhost:3456
```

### Modo Desktop (Electron)

```bash
npm run electron
```

### Builds de desenvolvimento (sem obfuscação)

```bash
# macOS — Apple Silicon
npm run build

# macOS — Universal (Intel + Apple Silicon)
npm run build:universal

# Windows x64
npm run build:win

# Windows x64 + x86
npm run build:win:all
```

### Builds de produção (com obfuscação de código)

O código JS é obfuscado automaticamente em uma cópia staging — **os arquivos fonte nunca são modificados**.

```bash
# macOS — Apple Silicon
npm run build:prod:mac

# macOS — Universal
npm run build:prod:mac:universal

# Windows x64
npm run build:prod:win

# macOS + Windows juntos
npm run build:prod:all
```

Artefatos gerados em `dist/`:

| Arquivo | Plataforma | Descrição |
|---|---|---|
| `DynamoDB GUI-2.0.0-arm64.dmg` | macOS | Installer drag-and-drop |
| `DynamoDB GUI Setup 2.0.0.exe` | Windows | Installer NSIS com wizard |
| `DynamoDB GUI 2.0.0.exe` | Windows | Portable — sem instalação |

#### O que a obfuscação protege
- Renomeia variáveis e funções para nomes hexadecimais
- Codifica string literals em base64
- Injeta control-flow flattening para dificultar análise estática
- Empacota tudo em `.asar` criptografado pelo Electron

> **Credenciais AWS no Windows**: o SDK lê automaticamente `%USERPROFILE%\.aws\credentials`. Configure via AWS CLI (`aws configure`) ou copie o arquivo manualmente.

---

## 🗺️ Roadmap

- [x] Histórico local de queries e scans executados
- [x] Suporte a múltiplos perfis de conexão salvos
- [x] Light mode / Dark mode
- [x] Sistema de abas multi-tabela
- [x] SQL PartiQL com autocomplete context-aware
- [x] JSON view estilo MongoDB Compass
- [x] Atalhos de teclado avançados (`Cmd+Enter`, `Cmd+W`, `Cmd+R`, `Cmd+[/]`, `Cmd+K`)
- [x] Exportação de schema — CloudFormation YAML e Terraform HCL
- [x] GSI — criação e deleção visual de Global Secondary Indexes
- [x] DynamoDB Streams — painel live com polling, feed de eventos INSERT/MODIFY/REMOVE
- [x] Versionamento de itens — histórico local por item com diff visual campo a campo

---
