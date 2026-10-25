// AWS CLI — current-query snippet, full CRUD example and SDK project files.

import { buildKeyCondition, scanFilter, toJson, shellQuote } from '../expressions.js';
import { toDynamoJson } from '../../utils/dynamoJson.js';

function query(ctx) {
    if (ctx.mode === 'query') {
        const { keyExpr, names, values } = buildKeyCondition(ctx);
        const lines = [
            `aws dynamodb query \\`,
            `  --table-name ${shellQuote(ctx.table)} \\`,
            ctx.indexName ? `  --index-name ${shellQuote(ctx.indexName)} \\` : null,
            `  --key-condition-expression ${shellQuote(keyExpr)} \\`,
            `  --expression-attribute-names ${shellQuote(toJson(names))} \\`,
            `  --expression-attribute-values ${shellQuote(toJson(toDynamoJson(values)))} \\`,
            `  --limit ${ctx.limit} \\`,
            `  --region ${ctx.region}`,
        ].filter(Boolean);
        return lines.join('\n');
    }
    if (ctx.mode === 'sql') {
        return `aws dynamodb execute-statement \\
  --statement ${shellQuote(ctx.statement)} \\
  --region ${ctx.region}`;
    }
    const filter = scanFilter(ctx);
    const lines = [
        `aws dynamodb scan \\`,
        `  --table-name ${shellQuote(ctx.table)} \\`,
        `  --limit ${ctx.limit} \\`,
        filter ? `  --filter-expression ${shellQuote(filter.expr)} \\` : null,
        filter?.names  ? `  --expression-attribute-names ${shellQuote(toJson(filter.names))} \\` : null,
        filter?.values ? `  --expression-attribute-values ${shellQuote(toJson(toDynamoJson(filter.values)))} \\` : null,
        `  --region ${ctx.region}`,
    ].filter(Boolean);
    return lines.join('\n');
}

function crud({ pkName, pkType, skName, skType }, table, region) {
    const keyJson = `'{"${pkName}":{"${pkType === 'N' ? 'N' : 'S'}":"${pkType === 'N' ? '1' : 'pk-value'}"}${skName ? `,"${skName}":{"${skType === 'N' ? 'N' : 'S'}":"${skType === 'N' ? '1' : 'sk-value'}"}` : ""}}'`;
    return `# ── Full CRUD: ${table} ─────────────────────────────────────────────────
# Substitua os valores de chave antes de executar

# ── CREATE ────────────────────────────────────────────────────────────────────
aws dynamodb put-item \\
  --table-name "${table}" \\
  --item '{
    "${pkName}": {"${pkType === 'N' ? 'N' : 'S'}": "${pkType === 'N' ? '1' : 'pk-value'}"},${skName ? `\n    "${skName}": {"${skType === 'N' ? 'N' : 'S'}": "${skType === 'N' ? '1' : 'sk-value'}"},` : ''}
    "name":      {"S": "New Item"},
    "createdAt": {"S": "2024-01-01T00:00:00Z"}
  }' \\
  --region ${region}

# ── READ — fetch by key ───────────────────────────────────────────────────
aws dynamodb get-item \\
  --table-name "${table}" \\
  --key ${keyJson} \\
  --region ${region}

# ── READ — listar (Scan) ──────────────────────────────────────────────────────
aws dynamodb scan \\
  --table-name "${table}" \\
  --limit 50 \\
  --region ${region}

# ── UPDATE ────────────────────────────────────────────────────────────────────
aws dynamodb update-item \\
  --table-name "${table}" \\
  --key ${keyJson} \\
  --update-expression "SET #name = :name, updatedAt = :ts" \\
  --expression-attribute-names '{"#name":"name"}' \\
  --expression-attribute-values '{":name":{"S":"Updated Name"},":ts":{"S":"2024-01-01T00:00:00Z"}}' \\
  --return-values ALL_NEW \\
  --region ${region}

# ── DELETE ────────────────────────────────────────────────────────────────────
aws dynamodb delete-item \\
  --table-name "${table}" \\
  --key ${keyJson} \\
  --region ${region}`;
}

function sdk(tableName, ki, region) {
    const pkCli = ki.pkName;
    const skCli = ki.skName;

    return {
        'README.md': `# ${tableName} — AWS CLI Scripts

## Setup

\`\`\`bash
cp config/env.sh.example config/env.sh
# edit config/env.sh with your settings
chmod +x scripts/*.sh
\`\`\`

## Usage

\`\`\`bash
make create   # PutItem
make read     # GetItem
make list     # Scan
make update   # UpdateItem
make delete   # DeleteItem
\`\`\`

## Table: ${tableName}

| Key | Type |
|-----|------|
| ${pkCli} (PK) | ${ki.pkType === 'N' ? 'Number' : 'String'} |
${skCli ? `| ${skCli} (SK) | ${ki.skType === 'N' ? 'Number' : 'String'} |` : ''}
`,
        'config/env.sh.example': `export AWS_REGION="${region}"
export AWS_PROFILE="default"
export TABLE_NAME="${tableName}"
# export AWS_ENDPOINT_URL="http://localhost:8000"   # for local DynamoDB
`,
        'scripts/create.sh': `#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/../config/env.sh"

PK_VALUE=\${1:-"example-id"}
${skCli ? `SK_VALUE=\${2:-"v1"}` : ''}

echo "➕ Creating item in $TABLE_NAME..."

aws dynamodb put-item \\
  --table-name "$TABLE_NAME" \\
  --region "$AWS_REGION" \\
  \${AWS_ENDPOINT_URL:+--endpoint-url "$AWS_ENDPOINT_URL"} \\
  --item '{
    "${pkCli}": {"${ki.pkType === 'N' ? 'N' : 'S'}": "'"$PK_VALUE"'"},
    ${skCli ? `"${skCli}": {"${ki.skType === 'N' ? 'N' : 'S'}": "'"$SK_VALUE"'"},` : ''}
    "createdAt": {"S": "'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'"},
    "name": {"S": "Example Item"}
  }' \\
  --return-consumed-capacity TOTAL

echo "✅ Done."
`,
        'scripts/read.sh': `#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/../config/env.sh"

PK_VALUE=\${1:-"example-id"}
${skCli ? `SK_VALUE=\${2:-"v1"}` : ''}

echo "🔍 Getting item from $TABLE_NAME..."

aws dynamodb get-item \\
  --table-name "$TABLE_NAME" \\
  --region "$AWS_REGION" \\
  \${AWS_ENDPOINT_URL:+--endpoint-url "$AWS_ENDPOINT_URL"} \\
  --key '{
    "${pkCli}": {"${ki.pkType === 'N' ? 'N' : 'S'}": "'"$PK_VALUE"'"}${skCli ? `,\n    "${skCli}": {"${ki.skType === 'N' ? 'N' : 'S'}": "'"$SK_VALUE"'"}` : ''}
  }' \\
  --output json | jq .
`,
        'scripts/list.sh': `#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/../config/env.sh"

LIMIT=\${1:-50}
echo "📋 Scanning $TABLE_NAME (limit: $LIMIT)..."

aws dynamodb scan \\
  --table-name "$TABLE_NAME" \\
  --region "$AWS_REGION" \\
  \${AWS_ENDPOINT_URL:+--endpoint-url "$AWS_ENDPOINT_URL"} \\
  --limit "$LIMIT" \\
  --return-consumed-capacity TOTAL \\
  --output json | jq '{count: .Count, items: .Items}'
`,
        'scripts/update.sh': `#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/../config/env.sh"

PK_VALUE=\${1:-"example-id"}
${skCli ? `SK_VALUE=\${2:-"v1"}` : ''}
NEW_NAME=\${${skCli ? '3' : '2'}:-"Updated Item"}

echo "✏️  Updating item in $TABLE_NAME..."

aws dynamodb update-item \\
  --table-name "$TABLE_NAME" \\
  --region "$AWS_REGION" \\
  \${AWS_ENDPOINT_URL:+--endpoint-url "$AWS_ENDPOINT_URL"} \\
  --key '{
    "${pkCli}": {"${ki.pkType === 'N' ? 'N' : 'S'}": "'"$PK_VALUE"'"}${skCli ? `,\n    "${skCli}": {"${ki.skType === 'N' ? 'N' : 'S'}": "'"$SK_VALUE"'"}` : ''}
  }' \\
  --update-expression "SET #n = :n, updatedAt = :t" \\
  --expression-attribute-names '{"#n":"name"}' \\
  --expression-attribute-values '{":n":{"S":"'"$NEW_NAME"'"},":t":{"S":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'"}}' \\
  --return-values ALL_NEW \\
  --output json | jq .Attributes
`,
        'scripts/delete.sh': `#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/../config/env.sh"

PK_VALUE=\${1:-"example-id"}
${skCli ? `SK_VALUE=\${2:-"v1"}` : ''}

echo "🗑️  Deleting item from $TABLE_NAME..."

aws dynamodb delete-item \\
  --table-name "$TABLE_NAME" \\
  --region "$AWS_REGION" \\
  \${AWS_ENDPOINT_URL:+--endpoint-url "$AWS_ENDPOINT_URL"} \\
  --key '{
    "${pkCli}": {"${ki.pkType === 'N' ? 'N' : 'S'}": "'"$PK_VALUE"'"}${skCli ? `,\n    "${skCli}": {"${ki.skType === 'N' ? 'N' : 'S'}": "'"$SK_VALUE"'"}` : ''}
  }'

echo "✅ Done."
`,
        'Makefile': `.PHONY: create read list update delete

create:
\t@bash scripts/create.sh

read:
\t@bash scripts/read.sh

list:
\t@bash scripts/list.sh

update:
\t@bash scripts/update.sh

delete:
\t@bash scripts/delete.sh
`,
    };
}

export default { id: 'cli', label: 'AWS CLI', query, crud, sdk };
