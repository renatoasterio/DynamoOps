<p align="center">
  <img src="assets/icons/icon.png" alt="DynamoOps" width="88" />
</p>

<h1 align="center">DynamoOps</h1>

<p align="center">
  <strong>Um app desktop gratuito e rápido para o Amazon DynamoDB.</strong><br/>
  Consulte, edite e gerencie suas tabelas sem brigar com o Console da AWS. macOS e Windows.
</p>

<p align="center">
  <a href="https://github.com/renatoasterio/DynamoOps/releases/latest"><img src="https://img.shields.io/github/v/release/renatoasterio/DynamoOps?label=download&color=7c3aed" alt="Última versão" /></a>
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey" alt="macOS e Windows" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT%20%2B%20Commons%20Clause-blue" alt="Licença" /></a>
  <a href="https://dynamoops.io/pt/docs"><img src="https://img.shields.io/badge/docs-dynamoops.io-7c3aed" alt="Documentação" /></a>
</p>

<p align="center">
  <a href="https://github.com/renatoasterio/DynamoOps/releases/latest"><b>Baixar</b></a> ·
  <a href="https://dynamoops.io/pt/docs"><b>Documentação</b></a> ·
  <a href="#compilar-a-partir-do-código"><b>Compilar a partir do código</b></a> ·
  <a href="README.md">Read in English</a>
</p>

<p align="center">
  <img src="docs/screenshots/workspace-overview.jpg" alt="Área de trabalho do DynamoOps com uma tabela aberta" width="900" />
</p>

---

## Por que o DynamoOps

O Console da AWS recarrega a cada clique e a CLI exige decorar sintaxe. O DynamoOps junta tudo o que você faz com DynamoDB numa janela desktop rápida.

- **Todas as funcionalidades são gratuitas.** Não há planos, período de teste, cadastro ou chave de licença.
- **Roda na sua máquina.** Credenciais e dados das tabelas não saem dela, e não há telemetria.
- **Vale no trabalho também.** Empresas, inclusive com fins lucrativos, podem usar internamente.

## Download

Baixe os instaladores mais recentes na **[página de releases](https://github.com/renatoasterio/DynamoOps/releases/latest)**.

| Sistema | Arquivo |
|---|---|
| macOS · Apple Silicon (M1 ou mais novo) | `DynamoOps-<versão>-arm64.dmg` |
| macOS · Intel | `DynamoOps-<versão>-x64.dmg` |
| Windows 10/11 · instalador | `DynamoOps-Setup-<versão>.exe` |
| Windows 10/11 · portátil, sem instalar | `DynamoOps-<versão>-portable.exe` |

Toda release inclui o `SHA256SUMS.txt` para você conferir os arquivos baixados.

> [!NOTE]
> Os instaladores ainda não são assinados com certificados da Apple ou da Microsoft.
> - **macOS:** na primeira abertura, o macOS diz que não consegue verificar o app. Clique em **OK**, abra **Ajustes do Sistema › Privacidade e Segurança**, clique em **Abrir Mesmo Assim** ao lado da mensagem do DynamoOps e confirme. Isso só é necessário uma vez por versão.
> - **Windows:** se o SmartScreen avisar, clique em **Mais informações** e depois em **Executar assim mesmo**.

## Funcionalidades

<table>
<tr>
<td width="50%">

**Conecte em qualquer lugar**
Perfis do AWS CLI, perfis salvos com conexões recentes, Assume Role com histórico de roles, login no AWS SSO (IAM Identity Center) pelo navegador e endpoints customizados para DynamoDB Local e LocalStack. Cada conexão pode ter uma tag de ambiente (dev, qa, staging, prod, local).

**Consulte sem abrir a documentação**
Scan com expressões de filtro, Query por chave na tabela ou em qualquer GSI/LSI, e um editor PartiQL com destaque de sintaxe, autocomplete por contexto, templates gerados a partir do seu schema, formatação e confirmação antes de escritas.

**Edite os dados no lugar**
Duplo clique na célula para editar, ou abra o editor JSON completo. Insira, clone e exclua itens em lote, use templates de inserção por tabela e restaure qualquer versão anterior pelo histórico do item, com diff campo a campo.

</td>
<td width="50%">

**Veja quanto cada operação custa**
A capacidade de leitura e escrita que o DynamoDB informa em cada operação, o total acumulado da sessão por tabela e um alerta de custo.

**Acompanhe mudanças ao vivo**
Um feed em tempo real do DynamoDB Streams com eventos INSERT, MODIFY e REMOVE e resumo das alterações por atributo.

**Gere infraestrutura e código**
Exporte uma tabela como CloudFormation, Terraform ou Pulumi. Gere um snippet da consulta atual ou um projeto completo de acesso a dados (entidades, repositórios, serviços) em TypeScript, Python, Java, C#, Go, Ruby, PHP ou scripts de AWS CLI.

**E mais**
Várias tabelas em abas, visualizações em tabela, JSON e gráficos com heatmap de partições, importação de JSON, CSV e Excel, exportação de JSON e CSV, dashboard da tabela com métricas do CloudWatch, atalhos de teclado, barra lateral recolhível e temas escuro e claro.

</td>
</tr>
</table>

<p align="center">
  <img src="docs/screenshots/sql-autocomplete.jpg" alt="Editor PartiQL com autocomplete" width="440" />
  <img src="docs/screenshots/streams-panel.jpg" alt="Feed ao vivo do DynamoDB Streams" width="440" />
</p>
<p align="center">
  <img src="docs/screenshots/cost-panel.jpg" alt="Painel de análise de custos" width="440" />
  <img src="docs/screenshots/code-generator.jpg" alt="Gerador de código" width="440" />
</p>

## Documentação

O guia completo, funcionalidade por funcionalidade e com capturas de tela, está em **[dynamoops.io/pt/docs](https://dynamoops.io/pt/docs)**. Também há versões em [inglês](https://dynamoops.io/docs) e [espanhol](https://dynamoops.io/es/docs).

Bons pontos de partida:

- [Início rápido](https://dynamoops.io/pt/docs/getting-started/quick-start)
- [Conectando ao DynamoDB](https://dynamoops.io/pt/docs/connections/connecting)
- [Atalhos de teclado](https://dynamoops.io/pt/docs/workspace/keyboard-shortcuts)
- [Segurança e privacidade](https://dynamoops.io/pt/docs/reference/security-and-privacy)

## Atalhos de teclado

`Cmd` no macOS, `Ctrl` no Windows.

| Atalho | Ação |
|---|---|
| `Cmd+Enter` | Executar o Scan, Query ou SQL atual |
| `Cmd+R` | Recarregar a consulta atual |
| `Cmd+W` | Fechar a aba ativa |
| `Cmd+[` / `Cmd+]` | Aba anterior / próxima |
| `Cmd+K` | Buscar tabelas na barra lateral |
| `Cmd+B` | Recolher ou expandir a barra lateral |
| `Cmd+F` | Filtrar os itens carregados |
| `Esc` | Fechar o diálogo aberto |

## Compilar a partir do código

Você precisa de **Node.js 18+**, npm e Git.

```bash
git clone https://github.com/renatoasterio/DynamoOps.git
cd DynamoOps
npm install

npm run electron   # app desktop
npm run dev        # só no navegador, em http://localhost:3457
```

Testes e lint precisam passar antes de um pull request ser aceito:

```bash
npm test
npm run lint
```

Gerar instaladores localmente (saída em `dist/`):

```bash
npm run build:prod:mac            # macOS Apple Silicon (.dmg)
npm run build:prod:mac:universal  # macOS Universal
npm run build:prod:win            # Windows x64 (instalador + portátil)
```

> [!TIP]
> Gerar o instalador de Windows num Mac com Apple Silicon exige o Rosetta, porque as ferramentas de Windows do electron-builder são binários Intel. O workflow de release gera as duas plataformas em máquinas nativas do GitHub, então raramente você vai precisar disso.

### Releases

As releases são geradas pelo [`.github/workflows/release.yml`](.github/workflows/release.yml). A `main` é protegida, então a mudança de versão entra por pull request e a tag é enviada depois do merge:

```bash
# 1. Suba a versão num pull request
git switch -c release/3.0.1
npm version 3.0.1 --no-git-tag-version
git commit -am "chore(release): 3.0.1"
git push -u origin release/3.0.1      # abra o PR, revise e faça o merge

# 2. Crie a tag no commit mergeado na main
git switch main && git pull
git tag v3.0.1
git push origin v3.0.1
```

Enviar a tag dispara o workflow. Ele roda testes e lint, gera os DMGs de macOS e o instalador e a versão portátil de Windows, e publica tudo com checksums numa release do GitHub.

## Arquitetura

Electron com um servidor Express local em `127.0.0.1:3457` e frontend em JavaScript puro (ES modules), sem framework.

```
electron-main.js            Processo principal do Electron: sobe o servidor, abre a janela em sandbox
server.js                   Entry point do Express (modo navegador)
src/backend/
  config/                   Host/porta do servidor e clientes AWS por conexão
  middleware/               API só local (Host/Origin), headers de segurança, erros, validação
  controllers/, services/   DynamoDB, STS, SSO e Streams
  routes/api.js             Rotas /api
public/
  index.html, styles.css    A SPA e seus temas
  js/components/            Componentes de UI (DataViewer, QueryPanel, SqlEditor, TabManager, …)
  js/codegen/               Geradores de código, um módulo por linguagem
  js/utils/, js/state/      Utilitários e estado do app
scripts/build-prod.js       Build de produção (esbuild + electron-builder)
tests/                      Testes Jest
```

### Segurança

- A API local age com as suas credenciais da AWS, então só escuta em `127.0.0.1` e recusa requisições cujo `Host` ou `Origin` não seja o próprio app. Isso protege contra DNS rebinding e contra sites abertos no seu navegador.
- Os dados lidos do DynamoDB são tratados como não confiáveis. Tudo o que vira HTML é escapado, e uma Content Security Policy rígida bloqueia scripts inline.
- A janela do Electron roda em sandbox, sem acesso ao Node.js, não navega para fora do app e só abre links `https:` no seu navegador.

Encontrou uma vulnerabilidade? Veja o [SECURITY.md](SECURITY.md).

## Contribuindo

Issues e pull requests são bem-vindos. Leia o [CONTRIBUTING.md](CONTRIBUTING.md) para o fluxo de trabalho e as convenções do código.

## Licença

O DynamoOps é distribuído sob a **[licença MIT com a Commons Clause](LICENSE)**, mais uma condição contra embutir o software em produtos pagos.

- ✅ Qualquer pessoa ou empresa pode usar de graça, inclusive no trabalho.
- ✅ Você pode copiar, modificar e redistribuir, mantendo o arquivo `LICENSE` e o aviso de copyright.
- ❌ Não é permitido vender o DynamoOps nem cobrar por produto ou serviço baseado nele, inclusive hospedagem, consultoria ou suporte pagos.
- ❌ Não é permitido embutir o DynamoOps, total ou parcialmente, em produto ou serviço pago.

Por causa dessas restrições, a licença é *source-available* (código aberto para uso) e não open source no sentido da [OSI](https://opensource.org/osd).

Copyright © 2026 Renato Asterio.
