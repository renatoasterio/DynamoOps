// C# — current-query snippet, full CRUD example and SDK project files.

import { toPascalCase, entityName } from '../naming.js';
import { buildKeyCondition, scanFilter, dq, csVerbatim, attrType } from '../expressions.js';

function query(ctx) {
    const header = `using Amazon;
using Amazon.DynamoDBv2;
using Amazon.DynamoDBv2.Model;

var client = new AmazonDynamoDBClient(RegionEndpoint.GetBySystemName(${dq(ctx.region)}));`;
    if (ctx.mode === 'query') {
        const { keyExpr, names, values } = buildKeyCondition(ctx);
        return `${header}

var request = new QueryRequest
{
    TableName = ${dq(ctx.table)},${ctx.indexName ? `\n    IndexName = ${dq(ctx.indexName)},` : ''}
    KeyConditionExpression = ${dq(keyExpr)},
    ExpressionAttributeNames  = ${_csharpNames(names)},
    ExpressionAttributeValues = ${_csharpDict(values, _csExprVal)},
    Limit = ${ctx.limit},
};

var response = await client.QueryAsync(request);
Console.WriteLine($"Found: {response.Items.Count} items");`;
    }
    if (ctx.mode === 'sql') {
        return `${header}

var response = await client.ExecuteStatementAsync(new ExecuteStatementRequest
{
    Statement = ${csVerbatim(ctx.statement)},
});
Console.WriteLine($"Found: {response.Items.Count} items");`;
    }
    const filter = scanFilter(ctx);
    const filterLines = filter ? [
        `\n    FilterExpression = ${dq(filter.expr)},`,
        filter.names  ? `\n    ExpressionAttributeNames  = ${_csharpNames(filter.names)},` : '',
        filter.values ? `\n    ExpressionAttributeValues = ${_csharpDict(filter.values, _csExprVal)},` : '',
    ].join('') : '';
    return `${header}

var response = await client.ScanAsync(new ScanRequest
{
    TableName = ${dq(ctx.table)},
    Limit     = ${ctx.limit},${filterLines}
});
Console.WriteLine($"Found: {response.Items.Count} items");`;
}

function crud({ pkName, pkType, skName, skType }, table, region) {
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
    Console.WriteLine("✅ Created");
}

// ── READ — fetch by key ───────────────────────────────────────────────────
async Task GetItem() {
    var response = await client.GetItemAsync(new GetItemRequest {
        TableName = TABLE,
        Key = ${keyDict},
    });
    Console.WriteLine($"🔍 Item found: {response.Item.Count} attributes");
}

// ── READ — listar (Scan) ──────────────────────────────────────────────────────
async Task ListItems() {
    var response = await client.ScanAsync(new ScanRequest {
        TableName = TABLE,
        Limit     = 50,
    });
    Console.WriteLine($"📋 Listed: {response.Items.Count} items");
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
    Console.WriteLine("✏️  Updated");
}

// ── DELETE ────────────────────────────────────────────────────────────────────
async Task DeleteItem() {
    await client.DeleteItemAsync(new DeleteItemRequest {
        TableName = TABLE,
        Key       = ${keyDict},
    });
    Console.WriteLine("🗑️  Deleted");
}

// ── Run ──────────────────────────────────────────────────────────────────
await CreateItem();
await GetItem();
await ListItems();
await UpdateItem();
await DeleteItem();`;
}

function sdk(tableName, ki, region) {
    const entity  = entityName(tableName);
    const pkCs    = toPascalCase(ki.pkName);
    const skCs    = ki.skName ? toPascalCase(ki.skName) : null;
    const pkT     = csType(ki.pkType);
    const skT     = ki.skType ? csType(ki.skType) : null;
    const skParam = skCs ? `, ${skT} ${skCs.toLowerCase()}` : '';
    const proj    = `${entity}DynamoSdk`;

    return {
        [`${proj}.csproj`]: `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net8.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <AssemblyName>${proj}</AssemblyName>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="AWSSDK.DynamoDBv2" Version="3.7.*" />
    <PackageReference Include="DotNetEnv" Version="3.0.*" />
  </ItemGroup>
</Project>
`,
        'appsettings.json': JSON.stringify({
            AWS: { Region: region },
            DynamoDB: { TableName: tableName }
        }, null, 2),
        '.env.example': `AWS_REGION=${region}
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
`,
        'README.md': `# ${entity} DynamoDB SDK (C# / .NET 8)

## Build & Run

\`\`\`bash
dotnet restore
dotnet run
\`\`\`
`,
        'src/Client/DynamoClientFactory.cs': `using Amazon.DynamoDBv2;
using DotNetEnv;

namespace ${proj}.Client;

public static class DynamoClientFactory
{
    public static IAmazonDynamoDB Create()
    {
        Env.TraversePath().Load();
        var config = new AmazonDynamoDBConfig
        {
            RegionEndpoint = Amazon.RegionEndpoint.GetBySystemName(
                Environment.GetEnvironmentVariable("AWS_REGION") ?? "${region}")
        };
        var endpoint = Environment.GetEnvironmentVariable("DYNAMO_ENDPOINT");
        if (!string.IsNullOrEmpty(endpoint))
            config.ServiceURL = endpoint;
        return new AmazonDynamoDBClient(config);
    }

    public const string TableName = "${tableName}";
}
`,
        [`src/Entities/${entity}.cs`]: `namespace ${proj}.Entities;

public record ${entity}(
    ${pkT} ${pkCs},${skCs ? `\n    ${skT} ${skCs},` : ''}
    string CreatedAt,
    Dictionary<string, object>? Extra = null
)
{
    public static ${entity} Create(${pkT} ${pkCs.toLowerCase()}${skParam}) =>
        new(${pkCs}: ${pkCs.toLowerCase()},${skCs ? `\n           ${skCs}: ${skCs.toLowerCase()},` : ''}
            CreatedAt: DateTime.UtcNow.ToString("O"));
}
`,
        [`src/Repositories/${entity}Repository.cs`]: `using Amazon.DynamoDBv2;
using Amazon.DynamoDBv2.Model;
using ${proj}.Client;
using ${proj}.Entities;

namespace ${proj}.Repositories;

public class ${entity}Repository(IAmazonDynamoDB client)
{
    private readonly string _table = DynamoClientFactory.TableName;

    public async Task SaveAsync(${entity} item)
    {
        var req = new PutItemRequest
        {
            TableName = _table,
            Item = new Dictionary<string, AttributeValue>
            {
                ["${ki.pkName}"] = ${ki.pkType === 'N' ? `new AttributeValue { N = item.${pkCs}.ToString() }` : `new AttributeValue { S = item.${pkCs} }`},${skCs ? `\n                ["${ki.skName}"] = ${ki.skType === 'N' ? `new AttributeValue { N = item.${skCs}.ToString() }` : `new AttributeValue { S = item.${skCs} }`},` : ''}
                ["createdAt"] = new AttributeValue { S = item.CreatedAt },
            }
        };
        await client.PutItemAsync(req);
    }

    public async Task<${entity}?> FindByIdAsync(${pkT} ${pkCs.toLowerCase()}${skParam})
    {
        var resp = await client.GetItemAsync(new GetItemRequest
        {
            TableName = _table,
            Key = new Dictionary<string, AttributeValue>
            {
                ["${ki.pkName}"] = ${ki.pkType === 'N' ? `new AttributeValue { N = ${pkCs.toLowerCase()}.ToString() }` : `new AttributeValue { S = ${pkCs.toLowerCase()} }`},${skCs ? `\n                ["${ki.skName}"] = ${ki.skType === 'N' ? `new AttributeValue { N = ${skCs.toLowerCase()}.ToString() }` : `new AttributeValue { S = ${skCs.toLowerCase()} }`},` : ''}
            }
        });
        if (!resp.IsItemSet) return null;
        return FromMap(resp.Item);
    }

    public async Task<List<${entity}>> FindAllAsync(int limit = 50)
    {
        var resp = await client.ScanAsync(new ScanRequest { TableName = _table, Limit = limit });
        return resp.Items.Select(FromMap).ToList();
    }

    public async Task DeleteAsync(${pkT} ${pkCs.toLowerCase()}${skParam})
    {
        await client.DeleteItemAsync(new DeleteItemRequest
        {
            TableName = _table,
            Key = new Dictionary<string, AttributeValue>
            {
                ["${ki.pkName}"] = ${ki.pkType === 'N' ? `new AttributeValue { N = ${pkCs.toLowerCase()}.ToString() }` : `new AttributeValue { S = ${pkCs.toLowerCase()} }`},${skCs ? `\n                ["${ki.skName}"] = ${ki.skType === 'N' ? `new AttributeValue { N = ${skCs.toLowerCase()}.ToString() }` : `new AttributeValue { S = ${skCs.toLowerCase()} }`},` : ''}
            }
        });
    }

    private static ${entity} FromMap(Dictionary<string, AttributeValue> m) =>
        new(
            ${pkCs}: ${ki.pkType === 'N' ? `double.Parse(m["${ki.pkName}"].N)` : `m["${ki.pkName}"].S`},
            ${skCs ? `${skCs}: ${ki.skType === 'N' ? `double.Parse(m["${ki.skName}"].N)` : `m["${ki.skName}"].S`},` : ''}
            CreatedAt: m.TryGetValue("createdAt", out var ca) ? ca.S : ""
        );
}
`,
        [`src/Services/${entity}Service.cs`]: `using ${proj}.Client;
using ${proj}.Entities;
using ${proj}.Repositories;

namespace ${proj}.Services;

public class ${entity}Service
{
    private readonly ${entity}Repository _repo = new(DynamoClientFactory.Create());

    public async Task<${entity}> CreateAsync(${pkT} ${pkCs.toLowerCase()}${skParam})
    {
        var item = ${entity}.Create(${pkCs.toLowerCase()}${skCs ? `, ${skCs.toLowerCase()}` : ''});
        await _repo.SaveAsync(item);
        return item;
    }

    public async Task<${entity}> GetByIdAsync(${pkT} ${pkCs.toLowerCase()}${skParam})
    {
        var item = await _repo.FindByIdAsync(${pkCs.toLowerCase()}${skCs ? `, ${skCs.toLowerCase()}` : ''});
        return item ?? throw new KeyNotFoundException($"${entity} not found: {${pkCs.toLowerCase()}}");
    }

    public Task<List<${entity}>> ListAllAsync(int limit = 50) => _repo.FindAllAsync(limit);

    public async Task DeleteAsync(${pkT} ${pkCs.toLowerCase()}${skParam})
    {
        await GetByIdAsync(${pkCs.toLowerCase()}${skCs ? `, ${skCs.toLowerCase()}` : ''}); // ensure exists
        await _repo.DeleteAsync(${pkCs.toLowerCase()}${skCs ? `, ${skCs.toLowerCase()}` : ''});
    }
}
`,
        'Program.cs': `using ${proj}.Services;

var service = new ${proj}.Services.${entity}Service();

// Create
var item = await service.CreateAsync(${pkT === 'double' ? '1.0' : '"example-id"'}${skCs ? (skT === 'double' ? ', 1.0' : ', "v1"') : ''});
Console.WriteLine($"✅ Created: {item}");

// Read
var found = await service.GetByIdAsync(item.${pkCs}${skCs ? `, item.${skCs}` : ''});
Console.WriteLine($"🔍 Found: {found}");

// List
var all = await service.ListAllAsync(10);
Console.WriteLine($"📋 Total: {all.Count}");

// Delete
await service.DeleteAsync(item.${pkCs}${skCs ? `, item.${skCs}` : ''});
Console.WriteLine("🗑️  Deleted.");
`,
    };
}

function _csAttrVal(t, v) {
    return t === 'N' ? `new AttributeValue { N = "${v === 'pk-value' ? '1' : v}" }`
                     : `new AttributeValue { S = "${v}" }`;
}

// C# Dictionary<string, AttributeValue>
function _csharpDict(obj, valFn) {
    const entries = Object.entries(obj).map(([k, v]) => `{ ${dq(k)}, ${valFn(v)} }`).join(', ');
    return `new Dictionary<string, AttributeValue> { ${entries} }`;
}

function csType(t) { return t === 'N' ? 'double' : 'string'; }

// C# Dictionary<string, string> for ExpressionAttributeNames
function _csharpNames(obj) {
    const entries = Object.entries(obj).map(([k, v]) => `{ ${dq(k)}, ${dq(v)} }`).join(', ');
    return `new Dictionary<string, string> { ${entries} }`;
}

function _csExprVal(v) {
    const t = attrType(v);
    if (t === 'N') return `new AttributeValue { N = ${dq(v)} }`;
    if (t === 'BOOL') return `new AttributeValue { BOOL = ${v} }`;
    return `new AttributeValue { S = ${dq(v)} }`;
}

export default { id: 'csharp', label: 'C#', query, crud, sdk };
