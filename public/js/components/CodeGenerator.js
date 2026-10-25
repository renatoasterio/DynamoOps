import { $ } from '../utils/dom.js';
import { state } from '../state/store.js';
import { config } from '../state/store.js';
import { showToast } from '../utils/toast.js';
import { downloadSdk } from './SdkGenerator.js';

let currentLang = 'nodejs';
let currentMode = 'current'; // 'current' | 'crud'

export function initCodeGenerator() {
    $('#code-gen-btn')?.addEventListener('click', openModal);
    $('#code-gen-close-btn')?.addEventListener('click', closeModal);
    $('#code-gen-overlay')?.addEventListener('click', e => {
        if (e.target === $('#code-gen-overlay')) closeModal();
    });

    // Language tabs
    $('#code-gen-overlay')?.querySelectorAll('.code-gen-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            currentLang = tab.dataset.lang;
            $('#code-gen-overlay').querySelectorAll('.code-gen-tab')
                .forEach(t => t.classList.toggle('active', t === tab));
            renderCode();
        });
    });

    // Mode sub-tabs (Current Query / Full CRUD)
    $('#code-gen-overlay')?.querySelectorAll('.code-gen-mode-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            currentMode = tab.dataset.mode;
            $('#code-gen-overlay').querySelectorAll('.code-gen-mode-tab')
                .forEach(t => t.classList.toggle('active', t === tab));
            renderCode();
        });
    });

    $('#code-gen-copy-btn')?.addEventListener('click', () => {
        const code = $('#code-gen-output')?.textContent;
        if (code) {
            navigator.clipboard.writeText(code)
                .then(() => showToast('Code copied!', 'success'))
                .catch(() => showToast('Copy failed', 'error'));
        }
    });

    // SDK download button
    $('#code-gen-sdk-btn')?.addEventListener('click', async () => {
        if (!state.currentTable) { showToast('Select a table first', 'info'); return; }
        const btn = $('#code-gen-sdk-btn');
        const origText = btn.textContent;
        try {
            btn.textContent = '⏳ Generating...';
            btn.disabled = true;
            const ki = getKeyInfo();
            await downloadSdk(currentLang, state.currentTable, ki, config.region || 'us-east-1');
            showToast(`SDK ${currentLang} downloaded!`, 'success');
        } catch (err) {
            showToast(`Failed to generate SDK: ${err.message}`, 'error');
        } finally {
            btn.textContent = origText;
            btn.disabled = false;
        }
    });
}

function openModal() {
    if (!state.currentTable) { showToast('Select a table first', 'info'); return; }
    const overlay = $('#code-gen-overlay');
    if (!overlay) return;

    const badge = $('#code-gen-table-badge');
    if (badge) badge.textContent = state.currentTable;

    // Reset to nodejs / current
    currentLang = 'nodejs'; currentMode = 'current';
    overlay.querySelectorAll('.code-gen-tab').forEach(t => t.classList.toggle('active', t.dataset.lang === 'nodejs'));
    overlay.querySelectorAll('.code-gen-mode-tab').forEach(t => t.classList.toggle('active', t.dataset.mode === 'current'));

    renderCode();
    overlay.classList.remove('hidden');
}

function closeModal() { $('#code-gen-overlay')?.classList.add('hidden'); }

// ─── Context readers ──────────────────────────────────────────────────────────

function getQueryContext() {
    const mode   = state.queryMode || 'scan';
    const table  = state.currentTable || '';
    const region = config.region || 'us-east-1';
    const limit  = parseInt($('#page-size')?.value) || 50;

    if (mode === 'query') {
        const pkName    = $('#query-pk-name')?.value  || 'pk';
        const pkValRaw  = $('#query-pk-value')?.value || 'value';
        const skName    = $('#query-sk-name')?.value  || '';
        const skOp      = $('#query-sk-op')?.value    || '=';
        const skValRaw  = $('#query-sk-value')?.value || '';
        const skVal2Raw = $('#query-sk-value2')?.value || '';
        const indexName = $('#query-index')?.value    || '';
        const pkVal  = pkValRaw  && !isNaN(pkValRaw)  ? Number(pkValRaw)  : pkValRaw;
        const skVal  = skValRaw  && !isNaN(skValRaw)  ? Number(skValRaw)  : skValRaw;
        const skVal2 = skVal2Raw && !isNaN(skVal2Raw) ? Number(skVal2Raw) : skVal2Raw;
        return { mode, table, region, limit, pkName, pkVal, skName, skOp, skVal, skVal2, indexName };
    } else if (mode === 'sql') {
        const statement = $('#sql-statement')?.value?.trim() || `SELECT * FROM "${table}"`;
        return { mode, table, region, limit, statement };
    } else {
        const filterExpr   = $('#scan-filter-expr')?.value?.trim() || '';
        const exprNamesRaw = $('#scan-expr-names')?.value?.trim()  || '';
        const exprValsRaw  = $('#scan-expr-values')?.value?.trim() || '';
        let exprNames = null, exprVals = null;
        try { if (exprNamesRaw) exprNames = JSON.parse(exprNamesRaw); } catch { /**/ }
        try { if (exprValsRaw)  exprVals  = JSON.parse(exprValsRaw);  } catch { /**/ }
        return { mode, table, region, limit, filterExpr, exprNames, exprVals };
    }
}

function getKeyInfo() {
    const schema = state.tableInfo?.KeySchema || [];
    const defs   = state.tableInfo?.AttributeDefinitions || [];
    const pk  = schema.find(k => k.KeyType === 'HASH');
    const sk  = schema.find(k => k.KeyType === 'RANGE');
    const pkType = defs.find(a => a.AttributeName === pk?.AttributeName)?.AttributeType || 'S';
    const skType = sk ? (defs.find(a => a.AttributeName === sk?.AttributeName)?.AttributeType || 'S') : null;
    return {
        pkName: pk?.AttributeName || 'pk',
        pkType,
        skName: sk?.AttributeName || null,
        skType,
    };
}

// ─── Render ───────────────────────────────────────────────────────────────────

function renderCode() {
    const ctx = getQueryContext();
    const ki  = getKeyInfo();

    const modeBadge = $('#code-gen-mode-badge');
    if (modeBadge) {
        if (currentMode === 'crud') {
            modeBadge.textContent = 'CRUD';
            modeBadge.className   = 'code-gen-mode-badge code-gen-mode-crud';
        } else {
            const labels = { scan: 'SCAN', query: 'QUERY', sql: 'PARTIQL' };
            modeBadge.textContent = labels[ctx.mode] || ctx.mode.toUpperCase();
            modeBadge.className   = `code-gen-mode-badge code-gen-mode-${ctx.mode}`;
        }
    }

    const hintEl = $('#code-gen-hint-text');
    if (hintEl) {
        hintEl.innerHTML = currentMode === 'crud'
            ? `Full example · <strong>PK</strong>: ${ki.pkName}${ki.skName ? ` · <strong>SK</strong>: ${ki.skName}` : ''}`
            : `Reflects the current query · <strong>double-click</strong> a cell to edit inline`;
    }

    let code = '';
    if (currentMode === 'crud') {
        code = _dispatchCrud(ki, ctx.table, ctx.region);
    } else {
        code = _dispatchQuery(ctx);
    }

    const output = $('#code-gen-output');
    if (output) output.textContent = code;
}

function _dispatchQuery(ctx) {
    switch (currentLang) {
        case 'nodejs':  return genNodejsQuery(ctx);
        case 'python':  return genPythonQuery(ctx);
        case 'java':    return genJavaQuery(ctx);
        case 'csharp':  return genCsharpQuery(ctx);
        case 'go':      return genGoQuery(ctx);
        case 'ruby':    return genRubyQuery(ctx);
        case 'php':     return genPhpQuery(ctx);
        default:        return genCliQuery(ctx);
    }
}

function _dispatchCrud(ki, table, region) {
    switch (currentLang) {
        case 'nodejs':  return genNodejsCrud(ki, table, region);
        case 'python':  return genPythonCrud(ki, table, region);
        case 'java':    return genJavaCrud(ki, table, region);
        case 'csharp':  return genCsharpCrud(ki, table, region);
        case 'go':      return genGoCrud(ki, table, region);
        case 'ruby':    return genRubyCrud(ki, table, region);
        case 'php':     return genPhpCrud(ki, table, region);
        default:        return genCliCrud(ki, table, region);
    }
}

// ════════════════════════════════════════════════════════════════════════════
//  CURRENT QUERY GENERATORS
// ════════════════════════════════════════════════════════════════════════════

// ─── Node.js v3 ───────────────────────────────────────────────────────────────
function genNodejsQuery(ctx) {
    if (ctx.mode === 'query') {
        const { keyExpr, names, values } = _buildKeyCondition(ctx);
        const lines = [`  TableName: "${ctx.table}",`];
        if (ctx.indexName) lines.push(`  IndexName: "${ctx.indexName}",`);
        lines.push(`  KeyConditionExpression: "${keyExpr}",`);
        lines.push(`  ExpressionAttributeNames: ${_j(names)},`);
        lines.push(`  ExpressionAttributeValues: ${_j(values)},`);
        lines.push(`  Limit: ${ctx.limit},`);
        return `import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";

const client    = new DynamoDBClient({ region: "${ctx.region}" });
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

const client = new DynamoDBClient({ region: "${ctx.region}" });

const { Items } = await client.send(new ExecuteStatementCommand({
  Statement: \`${ctx.statement}\`,
}));
const items = (Items || []).map(item => unmarshall(item));
console.log(\`Found \${items.length} items\`);`;
    }
    // scan
    const lines = [`  TableName: "${ctx.table}",`, `  Limit: ${ctx.limit},`];
    if (ctx.filterExpr) {
        lines.push(`  FilterExpression: "${ctx.filterExpr}",`);
        if (ctx.exprNames) lines.push(`  ExpressionAttributeNames: ${_j(ctx.exprNames)},`);
        if (ctx.exprVals)  lines.push(`  ExpressionAttributeValues: ${_j(ctx.exprVals)},`);
    }
    return `import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";

const client    = new DynamoDBClient({ region: "${ctx.region}" });
const docClient = DynamoDBDocumentClient.from(client);

const { Items } = await docClient.send(new ScanCommand({
${lines.join('\n')}
}));
console.log(\`Found \${Items.length} items\`);`;
}

// ─── Python ───────────────────────────────────────────────────────────────────
function genPythonQuery(ctx) {
    if (ctx.mode === 'query') {
        const { keyExpr, names, values } = _buildKeyCondition(ctx);
        const kwargs = [];
        if (ctx.indexName) kwargs.push(`    IndexName='${ctx.indexName}'`);
        kwargs.push(`    KeyConditionExpression='${keyExpr}'`);
        kwargs.push(`    ExpressionAttributeNames=${JSON.stringify(names)}`);
        kwargs.push(`    ExpressionAttributeValues=${JSON.stringify(values)}`);
        kwargs.push(`    Limit=${ctx.limit}`);
        return `import boto3

dynamodb = boto3.resource('dynamodb', region_name='${ctx.region}')
table    = dynamodb.Table('${ctx.table}')

response = table.query(
${kwargs.join(',\n')}
)
print(f"Found {len(response['Items'])} items")`;
    }
    if (ctx.mode === 'sql') {
        return `import boto3

client = boto3.client('dynamodb', region_name='${ctx.region}')

response = client.execute_statement(
    Statement='${ctx.statement}'
)
print(f"Found {len(response.get('Items', []))} items")`;
    }
    const kwargs = [`    Limit=${ctx.limit}`];
    if (ctx.filterExpr) {
        kwargs.push(`    FilterExpression='${ctx.filterExpr}'`);
        if (ctx.exprNames) kwargs.push(`    ExpressionAttributeNames=${JSON.stringify(ctx.exprNames)}`);
        if (ctx.exprVals)  kwargs.push(`    ExpressionAttributeValues=${JSON.stringify(ctx.exprVals)}`);
    }
    return `import boto3

dynamodb = boto3.resource('dynamodb', region_name='${ctx.region}')
table    = dynamodb.Table('${ctx.table}')

response = table.scan(
${kwargs.join(',\n')}
)
print(f"Found {len(response['Items'])} items")`;
}

// ─── Java ─────────────────────────────────────────────────────────────────────
function genJavaQuery(ctx) {
    if (ctx.mode === 'query') {
        const { keyExpr, names, values } = _buildKeyCondition(ctx);
        const namesStr  = _javaMap(names,  v => `AttributeValue.fromS("${v}")`);
        const valuesStr = _javaMap(values, v => typeof v === 'number' ? `AttributeValue.fromN("${v}")` : `AttributeValue.fromS("${v}")`);
        return `import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.dynamodb.DynamoDbClient;
import software.amazon.awssdk.services.dynamodb.model.*;
import java.util.Map;

DynamoDbClient client = DynamoDbClient.builder()
    .region(Region.of("${ctx.region}"))
    .build();

QueryRequest request = QueryRequest.builder()
    .tableName("${ctx.table}")${ctx.indexName ? `\n    .indexName("${ctx.indexName}")` : ''}
    .keyConditionExpression("${keyExpr}")
    .expressionAttributeNames(${namesStr})
    .expressionAttributeValues(${valuesStr})
    .limit(${ctx.limit})
    .build();

QueryResponse response = client.query(request);
System.out.println("Found: " + response.count() + " items");`;
    }
    if (ctx.mode === 'sql') {
        return `import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.dynamodb.DynamoDbClient;
import software.amazon.awssdk.services.dynamodb.model.*;

DynamoDbClient client = DynamoDbClient.builder()
    .region(Region.of("${ctx.region}"))
    .build();

ExecuteStatementRequest request = ExecuteStatementRequest.builder()
    .statement("${ctx.statement.replace(/"/g, '\\"')}")
    .build();

ExecuteStatementResponse response = client.executeStatement(request);
System.out.println("Found: " + response.items().size() + " items");`;
    }
    return `import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.dynamodb.DynamoDbClient;
import software.amazon.awssdk.services.dynamodb.model.*;

DynamoDbClient client = DynamoDbClient.builder()
    .region(Region.of("${ctx.region}"))
    .build();

ScanRequest request = ScanRequest.builder()
    .tableName("${ctx.table}")
    .limit(${ctx.limit})
    .build();

ScanResponse response = client.scan(request);
System.out.println("Found: " + response.count() + " items");`;
}

// ─── C# ───────────────────────────────────────────────────────────────────────
function genCsharpQuery(ctx) {
    if (ctx.mode === 'query') {
        const { keyExpr, names, values } = _buildKeyCondition(ctx);
        const namesStr  = _csharpDict(names,  v => `new AttributeValue { S = "${v}" }`);
        const valuesStr = _csharpDict(values, v => typeof v === 'number' ? `new AttributeValue { N = "${v}" }` : `new AttributeValue { S = "${v}" }`);
        return `using Amazon;
using Amazon.DynamoDBv2;
using Amazon.DynamoDBv2.Model;

var client = new AmazonDynamoDBClient(RegionEndpoint.GetBySystemName("${ctx.region}"));

var request = new QueryRequest
{
    TableName = "${ctx.table}",${ctx.indexName ? `\n    IndexName = "${ctx.indexName}",` : ''}
    KeyConditionExpression = "${keyExpr}",
    ExpressionAttributeNames  = ${namesStr},
    ExpressionAttributeValues = ${valuesStr},
    Limit = ${ctx.limit},
};

var response = await client.QueryAsync(request);
Console.WriteLine($"Found: {response.Items.Count} items");`;
    }
    if (ctx.mode === 'sql') {
        return `using Amazon;
using Amazon.DynamoDBv2;
using Amazon.DynamoDBv2.Model;

var client = new AmazonDynamoDBClient(RegionEndpoint.GetBySystemName("${ctx.region}"));

var response = await client.ExecuteStatementAsync(new ExecuteStatementRequest
{
    Statement = @"${ctx.statement}",
});
Console.WriteLine($"Found: {response.Items.Count} items");`;
    }
    return `using Amazon;
using Amazon.DynamoDBv2;
using Amazon.DynamoDBv2.Model;

var client = new AmazonDynamoDBClient(RegionEndpoint.GetBySystemName("${ctx.region}"));

var response = await client.ScanAsync(new ScanRequest
{
    TableName = "${ctx.table}",
    Limit     = ${ctx.limit},
});
Console.WriteLine($"Found: {response.Items.Count} items");`;
}

// ─── Go ───────────────────────────────────────────────────────────────────────
function genGoQuery(ctx) {
    if (ctx.mode === 'query') {
        const { keyExpr, names, values } = _buildKeyCondition(ctx);
        const namesStr  = _goMap(names,  () => `aws.String`);
        const valuesStr = _goMapAttr(values);
        return `package main

import (
    "context"
    "fmt"
    "github.com/aws/aws-sdk-go-v2/aws"
    "github.com/aws/aws-sdk-go-v2/config"
    "github.com/aws/aws-sdk-go-v2/service/dynamodb"
    "github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

func main() {
    cfg, _ := config.LoadDefaultConfig(context.TODO(),
        config.WithRegion("${ctx.region}"),
    )
    client := dynamodb.NewFromConfig(cfg)

    result, err := client.Query(context.TODO(), &dynamodb.QueryInput{
        TableName:                 aws.String("${ctx.table}"),${ctx.indexName ? `\n        IndexName:                 aws.String("${ctx.indexName}"),` : ''}
        KeyConditionExpression:    aws.String("${keyExpr}"),
        ExpressionAttributeNames:  ${namesStr},
        ExpressionAttributeValues: ${valuesStr},
        Limit:                     aws.Int32(${ctx.limit}),
    })
    if err != nil { panic(err) }
    fmt.Printf("Found %d items\\n", len(result.Items))
    _ = types.AttributeValueMemberS{} // ensure types imported
}`;
    }
    if (ctx.mode === 'sql') {
        return `package main

import (
    "context"
    "fmt"
    "github.com/aws/aws-sdk-go-v2/aws"
    "github.com/aws/aws-sdk-go-v2/config"
    "github.com/aws/aws-sdk-go-v2/service/dynamodb"
)

func main() {
    cfg, _ := config.LoadDefaultConfig(context.TODO(), config.WithRegion("${ctx.region}"))
    client := dynamodb.NewFromConfig(cfg)

    result, err := client.ExecuteStatement(context.TODO(), &dynamodb.ExecuteStatementInput{
        Statement: aws.String(\`${ctx.statement}\`),
    })
    if err != nil { panic(err) }
    fmt.Printf("Found %d items\\n", len(result.Items))
}`;
    }
    return `package main

import (
    "context"
    "fmt"
    "github.com/aws/aws-sdk-go-v2/aws"
    "github.com/aws/aws-sdk-go-v2/config"
    "github.com/aws/aws-sdk-go-v2/service/dynamodb"
)

func main() {
    cfg, _ := config.LoadDefaultConfig(context.TODO(), config.WithRegion("${ctx.region}"))
    client := dynamodb.NewFromConfig(cfg)

    result, err := client.Scan(context.TODO(), &dynamodb.ScanInput{
        TableName: aws.String("${ctx.table}"),
        Limit:     aws.Int32(${ctx.limit}),
    })
    if err != nil { panic(err) }
    fmt.Printf("Found %d items\\n", len(result.Items))
}`;
}

// ─── Ruby ─────────────────────────────────────────────────────────────────────
function genRubyQuery(ctx) {
    if (ctx.mode === 'query') {
        const { keyExpr, names, values } = _buildKeyCondition(ctx);
        const params = [
            `  table_name: '${ctx.table}',`,
            ctx.indexName ? `  index_name: '${ctx.indexName}',` : null,
            `  key_condition_expression: '${keyExpr}',`,
            `  expression_attribute_names: ${_rubyHash(names)},`,
            `  expression_attribute_values: ${_rubyHash(values)},`,
            `  limit: ${ctx.limit},`,
        ].filter(Boolean);
        return `require 'aws-sdk-dynamodb'

client = Aws::DynamoDB::Client.new(region: '${ctx.region}')

response = client.query(
${params.join('\n')}
)
puts "Found #{response.items.count} items"`;
    }
    if (ctx.mode === 'sql') {
        return `require 'aws-sdk-dynamodb'

client = Aws::DynamoDB::Client.new(region: '${ctx.region}')

response = client.execute_statement(
  statement: '${ctx.statement}'
)
puts "Found #{(response.items || []).count} items"`;
    }
    const params = [`  table_name: '${ctx.table}',`, `  limit: ${ctx.limit},`];
    if (ctx.filterExpr) params.push(`  filter_expression: '${ctx.filterExpr}',`);
    return `require 'aws-sdk-dynamodb'

client = Aws::DynamoDB::Client.new(region: '${ctx.region}')

response = client.scan(
${params.join('\n')}
)
puts "Found #{response.items.count} items"`;
}

// ─── PHP ──────────────────────────────────────────────────────────────────────
function genPhpQuery(ctx) {
    if (ctx.mode === 'query') {
        const { keyExpr, names, values } = _buildKeyCondition(ctx);
        const namesStr  = _phpArray(names,  v => `['S' => '${v}']`);
        const valuesStr = _phpArray(values, v => typeof v === 'number' ? `['N' => '${v}']` : `['S' => '${v}']`);
        return `<?php
require 'vendor/autoload.php';

use Aws\\DynamoDb\\DynamoDbClient;
use Aws\\DynamoDb\\Marshaler;

$client = new DynamoDbClient(['region' => '${ctx.region}', 'version' => 'latest']);
$marshaler = new Marshaler();

$result = $client->query([
    'TableName'                 => '${ctx.table}',${ctx.indexName ? `\n    'IndexName'                 => '${ctx.indexName}',` : ''}
    'KeyConditionExpression'    => '${keyExpr}',
    'ExpressionAttributeNames'  => ${namesStr},
    'ExpressionAttributeValues' => ${valuesStr},
    'Limit'                     => ${ctx.limit},
]);

$items = array_map([$marshaler, 'unmarshalItem'], $result['Items']);
echo "Found " . count($items) . " items\\n";`;
    }
    if (ctx.mode === 'sql') {
        return `<?php
require 'vendor/autoload.php';

use Aws\\DynamoDb\\DynamoDbClient;

$client = new DynamoDbClient(['region' => '${ctx.region}', 'version' => 'latest']);

$result = $client->executeStatement([
    'Statement' => '${ctx.statement}',
]);
echo "Found " . count($result['Items']) . " items\\n";`;
    }
    return `<?php
require 'vendor/autoload.php';

use Aws\\DynamoDb\\DynamoDbClient;
use Aws\\DynamoDb\\Marshaler;

$client   = new DynamoDbClient(['region' => '${ctx.region}', 'version' => 'latest']);
$marshaler = new Marshaler();

$result = $client->scan([
    'TableName' => '${ctx.table}',
    'Limit'     => ${ctx.limit},
]);

$items = array_map([$marshaler, 'unmarshalItem'], $result['Items']);
echo "Found " . count($items) . " items\\n";`;
}

// ─── AWS CLI ──────────────────────────────────────────────────────────────────
function genCliQuery(ctx) {
    if (ctx.mode === 'query') {
        const { keyExpr, names, values } = _buildKeyCondition(ctx);
        const lines = [
            `aws dynamodb query \\`,
            `  --table-name "${ctx.table}" \\`,
            ctx.indexName ? `  --index-name "${ctx.indexName}" \\` : null,
            `  --key-condition-expression "${keyExpr}" \\`,
            `  --expression-attribute-names '${JSON.stringify(names)}' \\`,
            `  --expression-attribute-values '${JSON.stringify(values)}' \\`,
            `  --limit ${ctx.limit} \\`,
            `  --region ${ctx.region}`,
        ].filter(Boolean);
        return lines.join('\n');
    }
    if (ctx.mode === 'sql') {
        return `aws dynamodb execute-statement \\
  --statement '${ctx.statement}' \\
  --region ${ctx.region}`;
    }
    const lines = [
        `aws dynamodb scan \\`,
        `  --table-name "${ctx.table}" \\`,
        `  --limit ${ctx.limit} \\`,
        ctx.filterExpr ? `  --filter-expression "${ctx.filterExpr}" \\` : null,
        ctx.exprNames  ? `  --expression-attribute-names '${JSON.stringify(ctx.exprNames)}' \\` : null,
        ctx.exprVals   ? `  --expression-attribute-values '${JSON.stringify(ctx.exprVals)}' \\` : null,
        `  --region ${ctx.region}`,
    ].filter(Boolean);
    return lines.join('\n');
}

// ════════════════════════════════════════════════════════════════════════════
//  FULL CRUD GENERATORS
// ════════════════════════════════════════════════════════════════════════════

function genNodejsCrud({ pkName, pkType, skName, skType }, table, region) {
    const pkVal  = _jsVal(pkType);
    const skLine = skName ? `, ${skName}: ${_jsVal(skType)}` : '';
    const keyObj = `{ ${pkName}: ${pkVal}${skLine} }`;
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
    ${pkName}: ${pkVal},${skName ? `\n    ${skName}: ${_jsVal(skType)},` : ''}
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

function genPythonCrud({ pkName, pkType, skName, skType }, table, region) {
    const pkVal  = _pyVal(pkType);
    const skLine = skName ? `, '${skName}': ${_pyVal(skType)}` : '';
    const keyExpr = `{'${pkName}': ${pkVal}${skLine}}`;
    return `# ── Full CRUD: ${table} ─────────────────────────────────────────────────
# Instale: pip install boto3
import boto3
from datetime import datetime, timezone

dynamodb = boto3.resource('dynamodb', region_name='${region}')
table    = dynamodb.Table('${table}')

# ── CREATE ────────────────────────────────────────────────────────────────────
def create_item():
    item = {
        '${pkName}': ${pkVal},${skName ? `\n        '${skName}': ${_pyVal(skType)},` : ''}
        'name': 'New Item',
        'createdAt': datetime.now(timezone.utc).isoformat(),
    }
    table.put_item(Item=item)
    print(f"✅ Criado: {item['${pkName}']}")

# ── READ — fetch by key ───────────────────────────────────────────────────
def get_item():
    response = table.get_item(Key=${keyExpr})
    item = response.get('Item')
    print(f"🔍 Item encontrado: {item}")
    return item

# ── READ — listar (Scan) ──────────────────────────────────────────────────────
def list_items():
    response = table.scan(Limit=50)
    items = response['Items']
    print(f"📋 Listados {len(items)} items")
    return items

# ── UPDATE ────────────────────────────────────────────────────────────────────
def update_item():
    response = table.update_item(
        Key=${keyExpr},
        UpdateExpression='SET #name = :name, updatedAt = :ts',
        ExpressionAttributeNames={'#name': 'name'},
        ExpressionAttributeValues={
            ':name': 'Updated Name',
            ':ts': datetime.now(timezone.utc).isoformat(),
        },
        ReturnValues='ALL_NEW',
    )
    print(f"✏️  Atualizado: {response['Attributes']}")

# ── DELETE ────────────────────────────────────────────────────────────────────
def delete_item():
    table.delete_item(Key=${keyExpr})
    print("🗑️  Deletado")

# ── Run ──────────────────────────────────────────────────────────────────
if __name__ == '__main__':
    create_item()
    get_item()
    list_items()
    update_item()
    delete_item()`;
}

function genJavaCrud({ pkName, pkType, skName, skType }, table, region) {
    const pkAttr  = _javaAttrVal(pkType, 'pk-value');
    const skLine  = skName ? `            "${skName}", ${_javaAttrVal(skType, 'sk-value')}` : '';
    const keyMapExtra = skLine ? `,\n${skLine}` : '';
    return `// ── Full CRUD: ${table} ─────────────────────────────────────────────────
// Maven: software.amazon.awssdk:dynamodb:2.x
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.dynamodb.DynamoDbClient;
import software.amazon.awssdk.services.dynamodb.model.*;
import java.time.Instant;
import java.util.Map;

public class DynamoCrud {

    static final String TABLE  = "${table}";
    static DynamoDbClient client = DynamoDbClient.builder()
        .region(Region.of("${region}"))
        .build();

    // ── CREATE ────────────────────────────────────────────────────────────────
    static void createItem() {
        client.putItem(PutItemRequest.builder()
            .tableName(TABLE)
            .item(Map.of(
                "${pkName}", ${pkAttr}${skLine ? `,\n                "${skName}", ${_javaAttrVal(skType, 'sk-value')}` : ''},
                "name",       AttributeValue.fromS("New Item"),
                "createdAt",  AttributeValue.fromS(Instant.now().toString())
            ))
            .build());
        System.out.println("✅ Criado");
    }

    // ── READ — fetch by key ───────────────────────────────────────────────
    static void getItem() {
        var response = client.getItem(GetItemRequest.builder()
            .tableName(TABLE)
            .key(Map.of(
                "${pkName}", ${pkAttr}${skLine ? `,\n                "${skName}", ${_javaAttrVal(skType, 'sk-value')}` : ''}
            ))
            .build());
        System.out.println("🔍 Item encontrado: " + response.item());
    }

    // ── READ — listar (Scan) ──────────────────────────────────────────────────
    static void listItems() {
        var response = client.scan(ScanRequest.builder()
            .tableName(TABLE)
            .limit(50)
            .build());
        System.out.println("📋 Listados: " + response.count() + " items");
    }

    // ── UPDATE ────────────────────────────────────────────────────────────────
    static void updateItem() {
        client.updateItem(UpdateItemRequest.builder()
            .tableName(TABLE)
            .key(Map.of(
                "${pkName}", ${pkAttr}${skLine ? `,\n                "${skName}", ${_javaAttrVal(skType, 'sk-value')}` : ''}
            ))
            .updateExpression("SET #name = :name, updatedAt = :ts")
            .expressionAttributeNames(Map.of("#name", "name"))
            .expressionAttributeValues(Map.of(
                ":name", AttributeValue.fromS("Updated Name"),
                ":ts",   AttributeValue.fromS(Instant.now().toString())
            ))
            .returnValues(ReturnValue.ALL_NEW)
            .build());
        System.out.println("✏️  Atualizado");
    }

    // ── DELETE ────────────────────────────────────────────────────────────────
    static void deleteItem() {
        client.deleteItem(DeleteItemRequest.builder()
            .tableName(TABLE)
            .key(Map.of(
                "${pkName}", ${pkAttr}${skLine ? `,\n                "${skName}", ${_javaAttrVal(skType, 'sk-value')}` : ''}
            ))
            .build());
        System.out.println("🗑️  Deletado");
    }

    public static void main(String[] args) {
        createItem(); getItem(); listItems(); updateItem(); deleteItem();
    }
}`;
}

function genCsharpCrud({ pkName, pkType, skName, skType }, table, region) {
    const pkAttr = _csAttrVal(pkType, 'pk-value');
    const skAttr = skName ? `\n        { "${skName}", ${_csAttrVal(skType, 'sk-value')} },` : '';
    const keyDict = `new Dictionary<string, AttributeValue>\n    {\n        { "${pkName}", ${pkAttr} },${skAttr}\n    }`;
    return `// ── Full CRUD: ${table} ─────────────────────────────────────────────────
// NuGet: AWSSDK.DynamoDBv2
using Amazon;
using Amazon.DynamoDBv2;
using Amazon.DynamoDBv2.Model;
using System.Collections.Generic;

var client = new AmazonDynamoDBClient(RegionEndpoint.GetBySystemName("${region}"));
const string TABLE = "${table}";

// ── CREATE ────────────────────────────────────────────────────────────────────
async Task CreateItem() {
    await client.PutItemAsync(new PutItemRequest {
        TableName = TABLE,
        Item = new Dictionary<string, AttributeValue> {
            { "${pkName}", ${pkAttr} },${skName ? `\n            { "${skName}", ${_csAttrVal(skType, 'sk-value')} },` : ''}
            { "name",      new AttributeValue { S = "New Item" } },
            { "createdAt", new AttributeValue { S = DateTime.UtcNow.ToString("o") } },
        },
    });
    Console.WriteLine("✅ Criado");
}

// ── READ — fetch by key ───────────────────────────────────────────────────
async Task GetItem() {
    var response = await client.GetItemAsync(new GetItemRequest {
        TableName = TABLE,
        Key = ${keyDict},
    });
    Console.WriteLine($"🔍 Item encontrado: {response.Item.Count} atributos");
}

// ── READ — listar (Scan) ──────────────────────────────────────────────────────
async Task ListItems() {
    var response = await client.ScanAsync(new ScanRequest {
        TableName = TABLE,
        Limit     = 50,
    });
    Console.WriteLine($"📋 Listados: {response.Items.Count} items");
}

// ── UPDATE ────────────────────────────────────────────────────────────────────
async Task UpdateItem() {
    await client.UpdateItemAsync(new UpdateItemRequest {
        TableName        = TABLE,
        Key              = ${keyDict},
        UpdateExpression = "SET #name = :name, updatedAt = :ts",
        ExpressionAttributeNames  = new Dictionary<string, string> { { "#name", "name" } },
        ExpressionAttributeValues = new Dictionary<string, AttributeValue> {
            { ":name", new AttributeValue { S = "Updated Name" } },
            { ":ts",   new AttributeValue { S = DateTime.UtcNow.ToString("o") } },
        },
        ReturnValues = ReturnValue.ALL_NEW,
    });
    Console.WriteLine("✏️  Atualizado");
}

// ── DELETE ────────────────────────────────────────────────────────────────────
async Task DeleteItem() {
    await client.DeleteItemAsync(new DeleteItemRequest {
        TableName = TABLE,
        Key       = ${keyDict},
    });
    Console.WriteLine("🗑️  Deletado");
}

// ── Run ──────────────────────────────────────────────────────────────────
await CreateItem();
await GetItem();
await ListItems();
await UpdateItem();
await DeleteItem();`;
}

function genGoCrud({ pkName, pkType, skName, skType }, table, region) {
    const pkAttr = _goAttrVal(pkType, 'pk-value');
    const skEntry = skName ? `\n        "${skName}": ${_goAttrVal(skType, 'sk-value')},` : '';
    return `// ── Full CRUD: ${table} ─────────────────────────────────────────────────
// go get github.com/aws/aws-sdk-go-v2/...
package main

import (
    "context"
    "fmt"
    "time"
    "github.com/aws/aws-sdk-go-v2/aws"
    "github.com/aws/aws-sdk-go-v2/config"
    "github.com/aws/aws-sdk-go-v2/service/dynamodb"
    "github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

const TABLE = "${table}"

var client *dynamodb.Client

func key() map[string]types.AttributeValue {
    return map[string]types.AttributeValue{
        "${pkName}": ${pkAttr},${skEntry}
    }
}

// ── CREATE ────────────────────────────────────────────────────────────────────
func createItem() {
    _, err := client.PutItem(context.TODO(), &dynamodb.PutItemInput{
        TableName: aws.String(TABLE),
        Item: map[string]types.AttributeValue{
            "${pkName}":  ${pkAttr},${skEntry}
            "name":       &types.AttributeValueMemberS{Value: "New Item"},
            "createdAt":  &types.AttributeValueMemberS{Value: time.Now().UTC().Format(time.RFC3339)},
        },
    })
    if err != nil { panic(err) }
    fmt.Println("✅ Criado")
}

// ── READ — fetch by key ───────────────────────────────────────────────────
func getItem() {
    result, err := client.GetItem(context.TODO(), &dynamodb.GetItemInput{
        TableName: aws.String(TABLE),
        Key:       key(),
    })
    if err != nil { panic(err) }
    fmt.Printf("🔍 Item encontrado: %v\\n", result.Item)
}

// ── READ — listar (Scan) ──────────────────────────────────────────────────────
func listItems() {
    result, err := client.Scan(context.TODO(), &dynamodb.ScanInput{
        TableName: aws.String(TABLE),
        Limit:     aws.Int32(50),
    })
    if err != nil { panic(err) }
    fmt.Printf("📋 Listados %d items\\n", len(result.Items))
}

// ── UPDATE ────────────────────────────────────────────────────────────────────
func updateItem() {
    _, err := client.UpdateItem(context.TODO(), &dynamodb.UpdateItemInput{
        TableName:        aws.String(TABLE),
        Key:              key(),
        UpdateExpression: aws.String("SET #name = :name, updatedAt = :ts"),
        ExpressionAttributeNames:  map[string]string{"#name": "name"},
        ExpressionAttributeValues: map[string]types.AttributeValue{
            ":name": &types.AttributeValueMemberS{Value: "Updated Name"},
            ":ts":   &types.AttributeValueMemberS{Value: time.Now().UTC().Format(time.RFC3339)},
        },
        ReturnValues: types.ReturnValueAllNew,
    })
    if err != nil { panic(err) }
    fmt.Println("✏️  Atualizado")
}

// ── DELETE ────────────────────────────────────────────────────────────────────
func deleteItem() {
    _, err := client.DeleteItem(context.TODO(), &dynamodb.DeleteItemInput{
        TableName: aws.String(TABLE),
        Key:       key(),
    })
    if err != nil { panic(err) }
    fmt.Println("🗑️  Deletado")
}

func main() {
    cfg, _ := config.LoadDefaultConfig(context.TODO(), config.WithRegion("${region}"))
    client  = dynamodb.NewFromConfig(cfg)

    createItem(); getItem(); listItems(); updateItem(); deleteItem()
}`;
}

function genRubyCrud({ pkName, pkType, skName, skType }, table, region) {
    const pkVal  = _rubyVal(pkType);
    const skLine = skName ? `\n    '${skName}' => ${_rubyVal(skType)},` : '';
    const keyHash = `{ '${pkName}' => ${pkVal}${skLine ? `,${skLine}` : ''} }`;
    return `# ── Full CRUD: ${table} ─────────────────────────────────────────────────
# gem install aws-sdk-dynamodb
require 'aws-sdk-dynamodb'

CLIENT = Aws::DynamoDB::Client.new(region: '${region}')
TABLE  = '${table}'

KEY = ${keyHash}.freeze

# ── CREATE ────────────────────────────────────────────────────────────────────
def create_item
  CLIENT.put_item(
    table_name: TABLE,
    item: KEY.merge(
      'name'      => 'New Item',
      'createdAt' => Time.now.utc.iso8601
    )
  )
  puts '✅ Criado'
end

# ── READ — fetch by key ───────────────────────────────────────────────────
def get_item
  resp = CLIENT.get_item(table_name: TABLE, key: KEY)
  puts "🔍 Item encontrado: #{resp.item}"
  resp.item
end

# ── READ — listar (Scan) ──────────────────────────────────────────────────────
def list_items
  resp = CLIENT.scan(table_name: TABLE, limit: 50)
  puts "📋 Listados #{resp.items.count} items"
  resp.items
end

# ── UPDATE ────────────────────────────────────────────────────────────────────
def update_item
  resp = CLIENT.update_item(
    table_name:                 TABLE,
    key:                        KEY,
    update_expression:          'SET #name = :name, updatedAt = :ts',
    expression_attribute_names: { '#name' => 'name' },
    expression_attribute_values: {
      ':name' => 'Updated Name',
      ':ts'   => Time.now.utc.iso8601
    },
    return_values: 'ALL_NEW'
  )
  puts "✏️  Atualizado: #{resp.attributes}"
end

# ── DELETE ────────────────────────────────────────────────────────────────────
def delete_item
  CLIENT.delete_item(table_name: TABLE, key: KEY)
  puts '🗑️  Deletado'
end

# ── Run ──────────────────────────────────────────────────────────────────
create_item; get_item; list_items; update_item; delete_item`;
}

function genPhpCrud({ pkName, pkType, skName, skType }, table, region) {
    const pkAttr = _phpAttrVal(pkType, 'pk-value');
    const skEntry = skName ? `\n    '${skName}' => ${_phpAttrVal(skType, 'sk-value')},` : '';
    return `<?php
// ── Full CRUD: ${table} ─────────────────────────────────────────────────
// composer require aws/aws-sdk-php
require 'vendor/autoload.php';

use Aws\\DynamoDb\\DynamoDbClient;
use Aws\\DynamoDb\\Marshaler;

$client   = new DynamoDbClient(['region' => '${region}', 'version' => 'latest']);
$m        = new Marshaler();
$TABLE    = '${table}';
$key      = [
    '${pkName}' => ${pkAttr},${skEntry}
];

// ── CREATE ────────────────────────────────────────────────────────────────────
function createItem(DynamoDbClient $client, Marshaler $m, string $table, array $key): void {
    $item = array_merge($key, $m->marshalItem([
        'name'      => 'New Item',
        'createdAt' => gmdate('c'),
    ]));
    $client->putItem(['TableName' => $table, 'Item' => $item]);
    echo "✅ Criado\\n";
}

// ── READ — fetch by key ───────────────────────────────────────────────────
function getItem(DynamoDbClient $client, Marshaler $m, string $table, array $key): void {
    $result = $client->getItem(['TableName' => $table, 'Key' => $key]);
    $item   = isset($result['Item']) ? $m->unmarshalItem($result['Item']) : null;
    echo "🔍 Item encontrado: " . json_encode($item) . "\\n";
}

// ── READ — listar (Scan) ──────────────────────────────────────────────────────
function listItems(DynamoDbClient $client, Marshaler $m, string $table): void {
    $result = $client->scan(['TableName' => $table, 'Limit' => 50]);
    $items  = array_map(fn($i) => $m->unmarshalItem($i), $result['Items']);
    echo "📋 Listados " . count($items) . " items\\n";
}

// ── UPDATE ────────────────────────────────────────────────────────────────────
function updateItem(DynamoDbClient $client, Marshaler $m, string $table, array $key): void {
    $client->updateItem([
        'TableName'                 => $table,
        'Key'                       => $key,
        'UpdateExpression'          => 'SET #name = :name, updatedAt = :ts',
        'ExpressionAttributeNames'  => ['#name' => 'name'],
        'ExpressionAttributeValues' => $m->marshalItem([':name' => 'Updated Name', ':ts' => gmdate('c')]),
        'ReturnValues'              => 'ALL_NEW',
    ]);
    echo "✏️  Atualizado\\n";
}

// ── DELETE ────────────────────────────────────────────────────────────────────
function deleteItem(DynamoDbClient $client, string $table, array $key): void {
    $client->deleteItem(['TableName' => $table, 'Key' => $key]);
    echo "🗑️  Deletado\\n";
}

// ── Run ──────────────────────────────────────────────────────────────────
createItem($client, $m, $TABLE, $key);
getItem($client, $m, $TABLE, $key);
listItems($client, $m, $TABLE);
updateItem($client, $m, $TABLE, $key);
deleteItem($client, $TABLE, $key);`;
}

function genCliCrud({ pkName, pkType, skName, skType }, table, region) {
    const pkCliVal = pkType === 'N' ? `'{"N":"1"}'` : `'{"S":"pk-value"}'`;
    const skCliLine = skName ? `\n  "${skName}": {"${skType === 'N' ? 'N' : 'S'}": "${skType === 'N' ? '1' : 'sk-value'}"}` : '';
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

// ════════════════════════════════════════════════════════════════════════════
//  SHARED HELPERS
// ════════════════════════════════════════════════════════════════════════════

function _buildKeyCondition(ctx) {
    const { pkName, pkVal, skName, skOp, skVal, skVal2 } = ctx;
    let keyExpr = '#pk = :pkval';
    const names  = { '#pk': pkName };
    const values = { ':pkval': pkVal };
    if (skName && skVal !== '') {
        names['#sk'] = skName;
        if (skOp === 'begins_with') {
            keyExpr += ' AND begins_with(#sk, :skval)'; values[':skval'] = skVal;
        } else if (skOp === 'between') {
            keyExpr += ' AND #sk BETWEEN :skval AND :skval2'; values[':skval'] = skVal; values[':skval2'] = skVal2;
        } else {
            keyExpr += ` AND #sk ${skOp} :skval`; values[':skval'] = skVal;
        }
    }
    return { keyExpr, names, values };
}

function _j(obj) { return JSON.stringify(obj); }

function _indent(s) { return s.split('\n').map((l, i) => i === 0 ? l : '  ' + l).join('\n'); }

// Per-language primitive helpers
function _jsVal(t)   { return t === 'N' ? '1'           : '"pk-value"'; }
function _pyVal(t)   { return t === 'N' ? '1'           : "'pk-value'"; }
function _rubyVal(t) { return t === 'N' ? '1'           : "'pk-value'"; }

function _javaAttrVal(t, v) {
    return t === 'N' ? `AttributeValue.fromN("${v === 'pk-value' ? '1' : v}")`
                     : `AttributeValue.fromS("${v}")`;
}
function _csAttrVal(t, v) {
    return t === 'N' ? `new AttributeValue { N = "${v === 'pk-value' ? '1' : v}" }`
                     : `new AttributeValue { S = "${v}" }`;
}
function _goAttrVal(t, v) {
    return t === 'N' ? `&types.AttributeValueMemberN{Value: "${v === 'pk-value' ? '1' : v}"}`
                     : `&types.AttributeValueMemberS{Value: "${v}"}`;
}
function _phpAttrVal(t, v) {
    return t === 'N' ? `['N' => '${v === 'pk-value' ? '1' : v}']`
                     : `['S' => '${v}']`;
}

// Java Map.of() helper for expression dicts
function _javaMap(obj, valFn) {
    const entries = Object.entries(obj).map(([k, v]) => `"${k}", ${valFn(v)}`).join(',\n            ');
    return `Map.of(\n            ${entries})`;
}

// C# Dictionary helper
function _csharpDict(obj, valFn) {
    const entries = Object.entries(obj).map(([k, v]) => `{ "${k}", ${valFn(v)} }`).join(', ');
    return `new Dictionary<string, AttributeValue> { ${entries} }`;
}

// Go map[string]*string helper for ExpressionAttributeNames
function _goMap(obj) {
    const entries = Object.entries(obj).map(([k, v]) => `"${k}": aws.String("${v}")`).join(', ');
    return `map[string]string{${entries}}`;
}

// Go ExpressionAttributeValues
function _goMapAttr(obj) {
    const entries = Object.entries(obj).map(([k, v]) => {
        const attr = typeof v === 'number'
            ? `&types.AttributeValueMemberN{Value: "${v}"}`
            : `&types.AttributeValueMemberS{Value: "${v}"}`;
        return `"${k}": ${attr}`;
    }).join(', ');
    return `map[string]types.AttributeValue{${entries}}`;
}

// Ruby hash literal
function _rubyHash(obj) {
    const entries = Object.entries(obj).map(([k, v]) =>
        typeof v === 'number' ? `'${k}' => ${v}` : `'${k}' => '${v}'`
    ).join(', ');
    return `{ ${entries} }`;
}

// PHP array literal
function _phpArray(obj, valFn) {
    const entries = Object.entries(obj).map(([k, v]) => `'${k}' => ${valFn(v)}`).join(', ');
    return `[${entries}]`;
}
