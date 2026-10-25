// PHP — current-query snippet, full CRUD example and SDK project files.

import { toPascalCase, toCamelCase, toKebabCase, entityName } from '../naming.js';
import { buildKeyCondition, scanFilter, sq, attrType } from '../expressions.js';

function query(ctx) {
    const header = `<?php
require 'vendor/autoload.php';

use Aws\\DynamoDb\\DynamoDbClient;`;
    if (ctx.mode === 'query') {
        const { keyExpr, names, values } = buildKeyCondition(ctx);
        return `${header}
use Aws\\DynamoDb\\Marshaler;

$client = new DynamoDbClient(['region' => ${sq(ctx.region)}, 'version' => 'latest']);
$marshaler = new Marshaler();

$result = $client->query([
    'TableName'                 => ${sq(ctx.table)},${ctx.indexName ? `\n    'IndexName'                 => ${sq(ctx.indexName)},` : ''}
    'KeyConditionExpression'    => ${sq(keyExpr)},
    'ExpressionAttributeNames'  => ${_phpArray(names, sq)},
    'ExpressionAttributeValues' => ${_phpArray(values, _phpExprVal)},
    'Limit'                     => ${ctx.limit},
]);

$items = array_map([$marshaler, 'unmarshalItem'], $result['Items']);
echo "Found " . count($items) . " items\\n";`;
    }
    if (ctx.mode === 'sql') {
        return `${header}

$client = new DynamoDbClient(['region' => ${sq(ctx.region)}, 'version' => 'latest']);

$result = $client->executeStatement([
    'Statement' => ${sq(ctx.statement)},
]);
echo "Found " . count($result['Items']) . " items\\n";`;
    }
    const filter = scanFilter(ctx);
    const filterLines = filter ? [
        `\n    'FilterExpression' => ${sq(filter.expr)},`,
        filter.names  ? `\n    'ExpressionAttributeNames' => ${_phpArray(filter.names, sq)},` : '',
        filter.values ? `\n    'ExpressionAttributeValues' => ${_phpArray(filter.values, _phpExprVal)},` : '',
    ].join('') : '';
    return `${header}
use Aws\\DynamoDb\\Marshaler;

$client   = new DynamoDbClient(['region' => ${sq(ctx.region)}, 'version' => 'latest']);
$marshaler = new Marshaler();

$result = $client->scan([
    'TableName' => ${sq(ctx.table)},
    'Limit'     => ${ctx.limit},${filterLines}
]);

$items = array_map([$marshaler, 'unmarshalItem'], $result['Items']);
echo "Found " . count($items) . " items\\n";`;
}

function crud({ pkName, pkType, skName, skType }, table, region) {
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
    echo "✅ Created\\n";
}

// ── READ — fetch by key ───────────────────────────────────────────────────
function getItem(DynamoDbClient $client, Marshaler $m, string $table, array $key): void {
    $result = $client->getItem(['TableName' => $table, 'Key' => $key]);
    $item   = isset($result['Item']) ? $m->unmarshalItem($result['Item']) : null;
    echo "🔍 Item found: " . json_encode($item) . "\\n";
}

// ── READ — listar (Scan) ──────────────────────────────────────────────────────
function listItems(DynamoDbClient $client, Marshaler $m, string $table): void {
    $result = $client->scan(['TableName' => $table, 'Limit' => 50]);
    $items  = array_map(fn($i) => $m->unmarshalItem($i), $result['Items']);
    echo "📋 Listed " . count($items) . " items\\n";
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
    echo "✏️  Updated\\n";
}

// ── DELETE ────────────────────────────────────────────────────────────────────
function deleteItem(DynamoDbClient $client, string $table, array $key): void {
    $client->deleteItem(['TableName' => $table, 'Key' => $key]);
    echo "🗑️  Deleted\\n";
}

// ── Run ──────────────────────────────────────────────────────────────────
createItem($client, $m, $TABLE, $key);
getItem($client, $m, $TABLE, $key);
listItems($client, $m, $TABLE);
updateItem($client, $m, $TABLE, $key);
deleteItem($client, $TABLE, $key);`;
}

function sdk(tableName, ki, region) {
    const entity  = entityName(tableName);
    const pkPhp   = toCamelCase(ki.pkName);
    const skPhp   = ki.skName ? toCamelCase(ki.skName) : null;
    const pkT     = ki.pkType === 'N' ? 'float' : 'string';
    const skT     = ki.skType ? (ki.skType === 'N' ? 'float' : 'string') : null;
    const skParam = skPhp ? `, ${skT} $${skPhp}` : '';
    const skKey   = skPhp ? `\n            '${ki.skName}' => ['${ki.skType === 'N' ? 'N' : 'S'}' => ${ki.skType === 'N' ? '(string)$' : '$'}${skPhp}],` : '';
    const skField = skPhp ? `\n    private ${skT} $${skPhp};` : '';
    const skGet   = skPhp ? `\n    public function get${toPascalCase(ki.skName)}(): ${skT} { return $this->${skPhp}; }` : '';

    return {
        'composer.json': JSON.stringify({
            name: `example/${toKebabCase(tableName)}-dynamo-sdk`,
            description: `DynamoDB SDK for table: ${tableName}`,
            type: 'project',
            require: {
                php: '>=8.1',
                'aws/aws-sdk-php': '^3.0',
                'vlucas/phpdotenv': '^5.0'
            },
            autoload: { 'psr-4': { 'App\\': 'src/' } },
            scripts: { start: 'php index.php' }
        }, null, 2),
        '.env.example': `AWS_REGION=${region}
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
`,
        'README.md': `# ${entity} DynamoDB SDK (PHP)

## Setup

\`\`\`bash
composer install
cp .env.example .env
php index.php
\`\`\`
`,
        'src/Client/DynamoClient.php': `<?php

namespace App\\Client;

use Aws\\DynamoDb\\DynamoDbClient;
use Dotenv\\Dotenv;

class DynamoClient
{
    private static ?DynamoDbClient $instance = null;
    public const TABLE_NAME = '${tableName}';

    public static function getInstance(): DynamoDbClient
    {
        if (self::$instance === null) {
            $dotenv = Dotenv::createImmutable(__DIR__ . '/../../');
            $dotenv->safeLoad();
            $args = [
                'region'  => $_ENV['AWS_REGION'] ?? '${region}',
                'version' => 'latest',
            ];
            if (!empty($_ENV['DYNAMO_ENDPOINT'])) {
                $args['endpoint'] = $_ENV['DYNAMO_ENDPOINT'];
            }
            self::$instance = new DynamoDbClient($args);
        }
        return self::$instance;
    }
}
`,
        [`src/Entities/${entity}.php`]: `<?php

namespace App\\Entities;

class ${entity}
{
    private string $createdAt;
    private array $extra = [];

    public function __construct(
        private ${pkT} $${pkPhp},${skField ? `\n        ${skField.trim()},` : ''}
    ) {
        $this->createdAt = (new \\DateTime('now', new \\DateTimeZone('UTC')))->format(\\DateTime::ATOM);
    }

    public function get${toPascalCase(ki.pkName)}(): ${pkT} { return $this->${pkPhp}; }${skGet}
    public function getCreatedAt(): string { return $this->createdAt; }

    public function toItem(): array
    {
        $item = [
            '${ki.pkName}' => ['${ki.pkType === 'N' ? 'N' : 'S'}' => ${ki.pkType === 'N' ? '(string)' : ''}$this->${pkPhp}],${skPhp ? `\n            '${ki.skName}' => ['${ki.skType === 'N' ? 'N' : 'S'}' => ${ki.skType === 'N' ? '(string)' : ''}$this->${skPhp}],` : ''}
            'createdAt' => ['S' => $this->createdAt],
        ];
        foreach ($this->extra as $k => $v) {
            $item[$k] = is_numeric($v) ? ['N' => (string)$v] : ['S' => (string)$v];
        }
        return $item;
    }

    public function setExtra(array $extra): self { $this->extra = $extra; return $this; }
}
`,
        [`src/Repositories/${entity}Repository.php`]: `<?php

namespace App\\Repositories;

use App\\Client\\DynamoClient;
use App\\Entities\\${entity};
use Aws\\DynamoDb\\DynamoDbClient;

class ${entity}Repository
{
    private DynamoDbClient $client;
    private string $table;

    public function __construct()
    {
        $this->client = DynamoClient::getInstance();
        $this->table  = DynamoClient::TABLE_NAME;
    }

    public function save(${entity} $item): ${entity}
    {
        $this->client->putItem(['TableName' => $this->table, 'Item' => $item->toItem()]);
        return $item;
    }

    public function findById(${pkT} $${pkPhp}${skParam}): ?${entity}
    {
        $resp = $this->client->getItem([
            'TableName' => $this->table,
            'Key' => [
                '${ki.pkName}' => ['${ki.pkType === 'N' ? 'N' : 'S'}' => ${ki.pkType === 'N' ? '(string)$' : '$'}${pkPhp}],${skKey}
            ],
        ]);
        if (empty($resp['Item'])) return null;
        $e = new ${entity}(
            ${ki.pkType === 'N' ? `(float)$resp['Item']['${ki.pkName}']['N']` : `$resp['Item']['${ki.pkName}']['S']`},
            ${skPhp ? `${ki.skType === 'N' ? `(float)$resp['Item']['${ki.skName}']['N']` : `$resp['Item']['${ki.skName}']['S']`},` : ''}
        );
        return $e;
    }

    public function findAll(int $limit = 50): array
    {
        $resp  = $this->client->scan(['TableName' => $this->table, 'Limit' => $limit]);
        $items = [];
        foreach ($resp['Items'] as $raw) {
            $items[] = new ${entity}(
                ${ki.pkType === 'N' ? `(float)$raw['${ki.pkName}']['N']` : `$raw['${ki.pkName}']['S']`},
                ${skPhp ? `${ki.skType === 'N' ? `(float)$raw['${ki.skName}']['N']` : `$raw['${ki.skName}']['S']`},` : ''}
            );
        }
        return $items;
    }

    public function delete(${pkT} $${pkPhp}${skParam}): void
    {
        $this->client->deleteItem([
            'TableName' => $this->table,
            'Key' => [
                '${ki.pkName}' => ['${ki.pkType === 'N' ? 'N' : 'S'}' => ${ki.pkType === 'N' ? '(string)$' : '$'}${pkPhp}],${skKey}
            ],
        ]);
    }
}
`,
        [`src/Services/${entity}Service.php`]: `<?php

namespace App\\Services;

use App\\Entities\\${entity};
use App\\Repositories\\${entity}Repository;

class ${entity}Service
{
    private ${entity}Repository $repo;

    public function __construct()
    {
        $this->repo = new ${entity}Repository();
    }

    public function create(${pkT} $${pkPhp}${skParam}): ${entity}
    {
        $item = new ${entity}($${pkPhp}${skPhp ? `, $$skPhp` : ''});
        return $this->repo->save($item);
    }

    public function getById(${pkT} $${pkPhp}${skParam}): ${entity}
    {
        $item = $this->repo->findById($${pkPhp}${skPhp ? `, $$skPhp` : ''});
        if (!$item) throw new \\RuntimeException("${entity} not found: $${pkPhp}");
        return $item;
    }

    public function listAll(int $limit = 50): array
    {
        return $this->repo->findAll($limit);
    }

    public function delete(${pkT} $${pkPhp}${skParam}): void
    {
        $this->getById($${pkPhp}${skPhp ? `, $$skPhp` : ''}); // ensure exists
        $this->repo->delete($${pkPhp}${skPhp ? `, $$skPhp` : ''});
    }
}
`,
        'index.php': `<?php

require_once __DIR__ . '/vendor/autoload.php';

use App\\Services\\${entity}Service;

$service = new ${entity}Service();

// Create
$item = $service->create(${ki.pkType === 'N' ? '1.0' : '"example-id"'}${skPhp ? (ki.skType === 'N' ? ', 1.0' : ', "v1"') : ''});
echo "✅ Created: " . $item->get${toPascalCase(ki.pkName)}() . PHP_EOL;

// Read
$found = $service->getById($item->get${toPascalCase(ki.pkName)}()${skPhp ? `, $item->get${toPascalCase(ki.skName)}()` : ''});
echo "🔍 Found: " . $found->get${toPascalCase(ki.pkName)}() . PHP_EOL;

// List
$all = $service->listAll(10);
echo "📋 Total: " . count($all) . PHP_EOL;

// Delete
$service->delete($item->get${toPascalCase(ki.pkName)}()${skPhp ? `, $item->get${toPascalCase(ki.skName)}()` : ''});
echo "🗑️  Deleted." . PHP_EOL;
`,
    };
}

function _phpAttrVal(t, v) {
    return t === 'N' ? `['N' => '${v === 'pk-value' ? '1' : v}']`
                     : `['S' => '${v}']`;
}

// PHP array literal
function _phpArray(obj, valFn) {
    const entries = Object.entries(obj).map(([k, v]) => `${sq(k)} => ${valFn(v)}`).join(', ');
    return `[${entries}]`;
}

function _phpExprVal(v) {
    const t = attrType(v);
    if (t === 'N') return `['N' => ${sq(v)}]`;
    if (t === 'BOOL') return `['BOOL' => ${v}]`;
    return `['S' => ${sq(v)}]`;
}

export default { id: 'php', label: 'PHP', query, crud, sdk };
