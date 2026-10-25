// Node.js — current-query snippet, full CRUD example and SDK project files.

import { toCamelCase, toKebabCase, entityName } from '../naming.js';
import { buildKeyCondition, scanFilter, toJson, dq, jsKey, jsTemplate } from '../expressions.js';

function query(ctx) {
    if (ctx.mode === 'query') {
        const { keyExpr, names, values } = buildKeyCondition(ctx);
        const lines = [`  TableName: ${dq(ctx.table)},`];
        if (ctx.indexName) lines.push(`  IndexName: ${dq(ctx.indexName)},`);
        lines.push(`  KeyConditionExpression: ${dq(keyExpr)},`);
        lines.push(`  ExpressionAttributeNames: ${toJson(names)},`);
        lines.push(`  ExpressionAttributeValues: ${toJson(values)},`);
        lines.push(`  Limit: ${ctx.limit},`);
        return `import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";

const client    = new DynamoDBClient({ region: ${dq(ctx.region)} });
const docClient = DynamoDBDocumentClient.from(client);

const params = {
${lines.join('\n')}
};

const { Items } = await docClient.send(new QueryCommand(params));
console.log(\`Found \${Items.length} items\`);`;
    }
    if (ctx.mode === 'sql') {
        return `import { DynamoDBClient, ExecuteStatementCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";

const client = new DynamoDBClient({ region: ${dq(ctx.region)} });

const { Items } = await client.send(new ExecuteStatementCommand({
  Statement: ${jsTemplate(ctx.statement)},
}));
const items = (Items || []).map(item => unmarshall(item));
console.log(\`Found \${items.length} items\`);`;
    }
    // scan
    const lines = [`  TableName: ${dq(ctx.table)},`, `  Limit: ${ctx.limit},`];
    const filter = scanFilter(ctx);
    if (filter) {
        lines.push(`  FilterExpression: ${dq(filter.expr)},`);
        if (filter.names)  lines.push(`  ExpressionAttributeNames: ${toJson(filter.names)},`);
        if (filter.values) lines.push(`  ExpressionAttributeValues: ${toJson(filter.values)},`);
    }
    return `import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";

const client    = new DynamoDBClient({ region: ${dq(ctx.region)} });
const docClient = DynamoDBDocumentClient.from(client);

const { Items } = await docClient.send(new ScanCommand({
${lines.join('\n')}
}));
console.log(\`Found \${Items.length} items\`);`;
}

function crud({ pkName, pkType, skName, skType }, table, region) {
    const pkVal  = _jsVal(pkType);
    const skLine = skName ? `, ${jsKey(skName)}: ${_jsVal(skType)}` : '';
    const keyObj = `{ ${jsKey(pkName)}: ${pkVal}${skLine} }`;
    return `// ── Full CRUD: ${table} ──────────────────────────────────────────────────
// Instale: npm install @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand, GetCommand, UpdateCommand, DeleteCommand, ScanCommand,
} from "@aws-sdk/lib-dynamodb";

const client    = new DynamoDBClient({ region: "${region}" });
const docClient = DynamoDBDocumentClient.from(client);
const TABLE     = "${table}";

// ── CREATE ────────────────────────────────────────────────────────────────────
async function createItem() {
  const item = {
    ${jsKey(pkName)}: ${pkVal},${skName ? `\n    ${jsKey(skName)}: ${_jsVal(skType)},` : ''}
    name: "New Item",
    createdAt: new Date().toISOString(),
  };
  await docClient.send(new PutCommand({ TableName: TABLE, Item: item }));
  console.log("✅ Criado:", item.${pkName});
}

// ── READ — fetch by key ───────────────────────────────────────────────────
async function getItem() {
  const { Item } = await docClient.send(new GetCommand({
    TableName: TABLE,
    Key: ${keyObj},
  }));
  console.log("🔍 Item encontrado:", Item);
  return Item;
}

// ── READ — listar (Scan) ──────────────────────────────────────────────────────
async function listItems() {
  const { Items } = await docClient.send(new ScanCommand({
    TableName: TABLE,
    Limit: 50,
  }));
  console.log(\`📋 Listados \${Items.length} items\`);
  return Items;
}

// ── UPDATE ────────────────────────────────────────────────────────────────────
async function updateItem() {
  const { Attributes } = await docClient.send(new UpdateCommand({
    TableName: TABLE,
    Key: ${keyObj},
    UpdateExpression: "SET #name = :name, updatedAt = :ts",
    ExpressionAttributeNames:  { "#name": "name" },
    ExpressionAttributeValues: { ":name": "Updated Name", ":ts": new Date().toISOString() },
    ReturnValues: "ALL_NEW",
  }));
  console.log("✏️  Atualizado:", Attributes);
}

// ── DELETE ────────────────────────────────────────────────────────────────────
async function deleteItem() {
  await docClient.send(new DeleteCommand({
    TableName: TABLE,
    Key: ${keyObj},
  }));
  console.log("🗑️  Deletado");
}

// ── Run ──────────────────────────────────────────────────────────────────
(async () => {
  await createItem();
  await getItem();
  await listItems();
  await updateItem();
  await deleteItem();
})();`;
}

function sdk(tableName, ki, region) {
    const entity    = entityName(tableName);
    const repoName  = `${entity}Repository`;
    const svcName   = `${entity}Service`;
    const pkJs      = toCamelCase(ki.pkName);
    const skJs      = ki.skName ? toCamelCase(ki.skName) : null;
    const pkT       = jsType(ki.pkType);
    const skT       = ki.skType ? jsType(ki.skType) : null;

    const skField    = skJs ? `\n  ${skJs}: ${skT};` : '';
    const skParam    = skJs ? `, ${skJs}: ${skT}` : '';

    return {
        'package.json': JSON.stringify({
            name: `${toKebabCase(tableName)}-dynamo-sdk`,
            version: '1.0.0',
            description: `DynamoDB SDK for table: ${tableName}`,
            main: 'dist/index.js',
            scripts: {
                build: 'tsc',
                start: 'node dist/index.js',
                dev: 'ts-node src/index.ts',
                test: 'jest'
            },
            dependencies: {
                '@aws-sdk/client-dynamodb': '^3.0.0',
                '@aws-sdk/lib-dynamodb': '^3.0.0',
                dotenv: '^16.0.0'
            },
            devDependencies: {
                typescript: '^5.0.0',
                '@types/node': '^20.0.0',
                'ts-node': '^10.0.0',
                jest: '^29.0.0',
                '@types/jest': '^29.0.0',
                'ts-jest': '^29.0.0'
            }
        }, null, 2),

        'tsconfig.json': JSON.stringify({
            compilerOptions: {
                target: 'ES2020',
                module: 'commonjs',
                lib: ['ES2020'],
                outDir: './dist',
                rootDir: './src',
                strict: true,
                esModuleInterop: true,
                skipLibCheck: true,
                forceConsistentCasingInFileNames: true,
                resolveJsonModule: true,
                declaration: true
            },
            include: ['src/**/*'],
            exclude: ['node_modules', 'dist']
        }, null, 2),

        '.env.example': `AWS_REGION=${region}
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
# Optional: AWS_SESSION_TOKEN=your-session-token
# Optional for local: DYNAMO_ENDPOINT=http://localhost:8000
`,

        'README.md': `# ${entity} DynamoDB SDK (Node.js / TypeScript)

## Setup

\`\`\`bash
npm install
cp .env.example .env   # fill in your credentials
\`\`\`

## Build & Run

\`\`\`bash
npm run build   # compile TypeScript → dist/
npm start       # run compiled output
npm run dev     # run with ts-node (dev mode)
\`\`\`

## Project Structure

\`\`\`
src/
  client/          DynamoDB client singleton
  entities/        ${entity} model / type
  repositories/    ${repoName} — raw DynamoDB operations
  services/        ${svcName} — business logic layer
  index.ts         Entry point / usage example
\`\`\`

## Table

| Attribute | Role | Type |
|-----------|------|------|
| ${ki.pkName} | Partition Key | ${ki.pkType === 'N' ? 'Number' : 'String'} |
${ki.skName ? `| ${ki.skName} | Sort Key | ${ki.skType === 'N' ? 'Number' : 'String'} |` : ''}
`,

        'src/client/dynamoClient.ts': `import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import * as dotenv from 'dotenv';

dotenv.config();

const rawClient = new DynamoDBClient({
    region: process.env.AWS_REGION ?? '${region}',
    ...(process.env.DYNAMO_ENDPOINT && { endpoint: process.env.DYNAMO_ENDPOINT }),
});

export const docClient = DynamoDBDocumentClient.from(rawClient, {
    marshallOptions: { removeUndefinedValues: true },
});

export const TABLE_NAME = '${tableName}';
`,

        [`src/entities/${entity}.ts`]: `export interface ${entity} {
  ${pkJs}: ${pkT};${skField}
  [key: string]: unknown;  // additional attributes
}

export interface Create${entity}Input {
  ${pkJs}: ${pkT};${skField}
  [key: string]: unknown;
}
`,

        [`src/repositories/${repoName}.ts`]: `import {
    GetCommand, PutCommand, DeleteCommand,
    ScanCommand, UpdateCommand, QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { docClient, TABLE_NAME } from '../client/dynamoClient';
import { ${entity}, Create${entity}Input } from '../entities/${entity}';

export class ${repoName} {

    async create(input: Create${entity}Input): Promise<${entity}> {
        const item: ${entity} = { ...input, createdAt: new Date().toISOString() };
        await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
        return item;
    }

    async findById(${pkJs}: ${pkT}${skParam}): Promise<${entity} | null> {
        const { Item } = await docClient.send(new GetCommand({
            TableName: TABLE_NAME,
            Key: { ${ki.pkName}: ${pkJs}${skJs ? `, ${ki.skName}: ${skJs}` : ''} },
        }));
        return (Item as ${entity}) ?? null;
    }

    async findAll(limit = 50): Promise<${entity}[]> {
        const { Items = [] } = await docClient.send(new ScanCommand({
            TableName: TABLE_NAME,
            Limit: limit,
        }));
        return Items as ${entity}[];
    }

    async update(${pkJs}: ${pkT}${skParam}, updates: Partial<${entity}>): Promise<${entity}> {
        const keys = Object.keys(updates).filter(k => k !== '${ki.pkName}'${ki.skName ? ` && k !== '${ki.skName}'` : ''});
        if (keys.length === 0) throw new Error('No fields to update');

        const expr      = keys.map((k, i) => \`#k\${i} = :v\${i}\`).join(', ');
        const exprNames = Object.fromEntries(keys.map((k, i) => [\`#k\${i}\`, k]));
        const exprVals  = Object.fromEntries(keys.map((k, i) => [\`:v\${i}\`, (updates as Record<string, unknown>)[k]]));

        const { Attributes } = await docClient.send(new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { ${ki.pkName}: ${pkJs}${skJs ? `, ${ki.skName}: ${skJs}` : ''} },
            UpdateExpression: \`SET \${expr}\`,
            ExpressionAttributeNames: exprNames,
            ExpressionAttributeValues: exprVals,
            ReturnValues: 'ALL_NEW',
        }));
        return Attributes as ${entity};
    }

    async delete(${pkJs}: ${pkT}${skParam}): Promise<void> {
        await docClient.send(new DeleteCommand({
            TableName: TABLE_NAME,
            Key: { ${ki.pkName}: ${pkJs}${skJs ? `, ${ki.skName}: ${skJs}` : ''} },
        }));
    }
}
`,

        [`src/services/${svcName}.ts`]: `import { ${repoName} } from '../repositories/${repoName}';
import { ${entity}, Create${entity}Input } from '../entities/${entity}';

export class ${svcName} {
    private readonly repo = new ${repoName}();

    async create(input: Create${entity}Input): Promise<${entity}> {
        // Add business rules / validation here
        return this.repo.create(input);
    }

    async getById(${pkJs}: ${jsType(ki.pkType)}${skParam}): Promise<${entity}> {
        const item = await this.repo.findById(${pkJs}${skJs ? `, ${skJs}` : ''});
        if (!item) throw new Error(\`${entity} not found: \${${pkJs}}\`);
        return item;
    }

    async listAll(limit = 50): Promise<${entity}[]> {
        return this.repo.findAll(limit);
    }

    async update(${pkJs}: ${jsType(ki.pkType)}${skParam}, updates: Partial<${entity}>): Promise<${entity}> {
        await this.getById(${pkJs}${skJs ? `, ${skJs}` : ''}); // ensure exists
        return this.repo.update(${pkJs}${skJs ? `, ${skJs}` : ''}, updates);
    }

    async delete(${pkJs}: ${jsType(ki.pkType)}${skParam}): Promise<void> {
        await this.getById(${pkJs}${skJs ? `, ${skJs}` : ''}); // ensure exists
        return this.repo.delete(${pkJs}${skJs ? `, ${skJs}` : ''});
    }
}
`,

        'src/index.ts': `import { ${svcName} } from './services/${svcName}';

async function main() {
    const service = new ${svcName}();

    // ── Create ──────────────────────────────────────────────────────────
    const created = await service.create({
        ${pkJs}: ${pkT === 'number' ? '1' : '"example-id"'},${skJs ? `\n        ${skJs}: ${skT === 'number' ? '1' : '"v1"'},` : ''}
        name: 'Example Item',
    });
    console.log('✅ Created:', created);

    // ── Read ────────────────────────────────────────────────────────────
    const found = await service.getById(created.${pkJs}${skJs ? `, created.${skJs}` : ''});
    console.log('🔍 Found:', found);

    // ── List ────────────────────────────────────────────────────────────
    const all = await service.listAll(10);
    console.log(\`📋 Total fetched: \${all.length}\`);

    // ── Update ──────────────────────────────────────────────────────────
    const updated = await service.update(created.${pkJs}${skJs ? `, created.${skJs}` : ''}, { name: 'Updated Item' });
    console.log('✏️  Updated:', updated);

    // ── Delete ──────────────────────────────────────────────────────────
    await service.delete(created.${pkJs}${skJs ? `, created.${skJs}` : ''});
    console.log('🗑️  Deleted.');
}

main().catch(console.error);
`,
    };
}

function _jsVal(t)   { return t === 'N' ? '1'           : '"pk-value"'; }

function jsType(t) { return t === 'N' ? 'number' : t === 'B' ? 'Buffer' : 'string'; }

export default { id: 'nodejs', label: 'Node.js', query, crud, sdk };
