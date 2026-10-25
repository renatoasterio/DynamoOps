// Python — current-query snippet, full CRUD example and SDK project files.

import { toSnakeCase, toKebabCase, entityName } from '../naming.js';
import { buildKeyCondition, scanFilter, sq, pyLiteral } from '../expressions.js';

function query(ctx) {
    if (ctx.mode === 'query') {
        const { keyExpr, names, values } = buildKeyCondition(ctx);
        const kwargs = [];
        if (ctx.indexName) kwargs.push(`    IndexName=${sq(ctx.indexName)}`);
        kwargs.push(`    KeyConditionExpression=${sq(keyExpr)}`);
        kwargs.push(`    ExpressionAttributeNames=${pyLiteral(names)}`);
        kwargs.push(`    ExpressionAttributeValues=${pyLiteral(values)}`);
        kwargs.push(`    Limit=${ctx.limit}`);
        return `import boto3

dynamodb = boto3.resource('dynamodb', region_name=${sq(ctx.region)})
table    = dynamodb.Table(${sq(ctx.table)})

response = table.query(
${kwargs.join(',\n')}
)
print(f"Found {len(response['Items'])} items")`;
    }
    if (ctx.mode === 'sql') {
        return `import boto3

client = boto3.client('dynamodb', region_name=${sq(ctx.region)})

response = client.execute_statement(
    Statement=${sq(ctx.statement)}
)
print(f"Found {len(response.get('Items', []))} items")`;
    }
    const kwargs = [`    Limit=${ctx.limit}`];
    const filter = scanFilter(ctx);
    if (filter) {
        kwargs.push(`    FilterExpression=${sq(filter.expr)}`);
        if (filter.names)  kwargs.push(`    ExpressionAttributeNames=${pyLiteral(filter.names)}`);
        if (filter.values) kwargs.push(`    ExpressionAttributeValues=${pyLiteral(filter.values)}`);
    }
    return `import boto3

dynamodb = boto3.resource('dynamodb', region_name=${sq(ctx.region)})
table    = dynamodb.Table(${sq(ctx.table)})

response = table.scan(
${kwargs.join(',\n')}
)
print(f"Found {len(response['Items'])} items")`;
}

function crud({ pkName, pkType, skName, skType }, table, region) {
    const pkVal  = _pyVal(pkType);
    const skLine = skName ? `, '${skName}': ${_pyVal(skType)}` : '';
    const keyExpr = `{'${pkName}': ${pkVal}${skLine}}`;
    return `# ── Full CRUD: ${table} ─────────────────────────────────────────────────
# Install: pip install boto3
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
    print(f"✅ Created: {item['${pkName}']}")

# ── READ — fetch by key ───────────────────────────────────────────────────
def get_item():
    response = table.get_item(Key=${keyExpr})
    item = response.get('Item')
    print(f"🔍 Item found: {item}")
    return item

# ── READ — listar (Scan) ──────────────────────────────────────────────────────
def list_items():
    response = table.scan(Limit=50)
    items = response['Items']
    print(f"📋 Listed {len(items)} items")
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
    print(f"✏️  Updated: {response['Attributes']}")

# ── DELETE ────────────────────────────────────────────────────────────────────
def delete_item():
    table.delete_item(Key=${keyExpr})
    print("🗑️  Deleted")

# ── Run ──────────────────────────────────────────────────────────────────
if __name__ == '__main__':
    create_item()
    get_item()
    list_items()
    update_item()
    delete_item()`;
}

function sdk(tableName, ki, region) {
    const entity    = entityName(tableName);
    const entitySn  = toSnakeCase(entity);
    const pkSn      = toSnakeCase(ki.pkName);
    const skSn      = ki.skName ? toSnakeCase(ki.skName) : null;
    const pkPy      = pyType(ki.pkType);
    const skPy      = ki.skType ? pyType(ki.skType) : null;
    const skField   = skSn ? `\n    ${skSn}: ${skPy}` : '';
    const skParam   = skSn ? `, ${skSn}: ${skPy}` : '';

    return {
        'requirements.txt': `boto3>=1.26.0
python-dotenv>=1.0.0
mypy-boto3-dynamodb>=1.26.0
`,
        'pyproject.toml': `[build-system]
requires = ["setuptools>=68", "wheel"]
build-backend = "setuptools.backends.legacy:build"

[project]
name = "${toKebabCase(tableName)}-dynamo-sdk"
version = "1.0.0"
description = "DynamoDB SDK for table: ${tableName}"
requires-python = ">=3.10"
dependencies = ["boto3", "python-dotenv"]
`,
        '.env.example': `AWS_REGION=${region}
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
# DYNAMO_ENDPOINT=http://localhost:8000
`,
        'README.md': `# ${entity} DynamoDB SDK (Python)

## Setup

\`\`\`bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
\`\`\`

## Run

\`\`\`bash
python main.py
\`\`\`

## Project Structure

\`\`\`
src/
  client/         DynamoDB client singleton
  entities/       ${entity} dataclass
  repositories/   ${entity}Repository — raw operations
  services/       ${entity}Service — business logic
main.py
\`\`\`
`,
        'src/__init__.py': '',
        'src/client/__init__.py': '',
        'src/client/dynamo_client.py': `import os
import boto3
from dotenv import load_dotenv

load_dotenv()

TABLE_NAME = "${tableName}"

def get_client():
    kwargs = {
        "region_name": os.getenv("AWS_REGION", "${region}"),
    }
    if endpoint := os.getenv("DYNAMO_ENDPOINT"):
        kwargs["endpoint_url"] = endpoint
    return boto3.resource("dynamodb", **kwargs)

def get_table():
    return get_client().Table(TABLE_NAME)
`,
        'src/entities/__init__.py': '',
        [`src/entities/${entitySn}.py`]: `from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

@dataclass
class ${entity}:
    ${pkSn}: ${pkPy}${skField}
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    extra: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict:
        d: dict[str, Any] = {
            "${ki.pkName}": self.${pkSn},
            "created_at": self.created_at,
        }
        ${skSn ? `d["${ki.skName}"] = self.${skSn}` : '# no sort key'}
        d.update(self.extra)
        return d

    @staticmethod
    def from_dict(data: dict) -> "${entity}":
        pk = ${pkPy === 'float' ? 'float' : 'str'}(data["${ki.pkName}"])
        ${skSn ? `sk = ${skPy === 'float' ? 'float' : 'str'}(data["${ki.skName}"])` : ''}
        extra = {k: v for k, v in data.items() if k not in ("${ki.pkName}", "${ki.skName ?? ''}", "created_at")}
        return ${entity}(
            ${pkSn}=pk,
            ${skSn ? `${skSn}=sk,` : ''}
            created_at=data.get("created_at", ""),
            extra=extra,
        )
`,
        'src/repositories/__init__.py': '',
        [`src/repositories/${entitySn}_repository.py`]: `from boto3.dynamodb.conditions import Key, Attr
from src.client.dynamo_client import get_table
from src.entities.${entitySn} import ${entity}

class ${entity}Repository:
    def __init__(self):
        self._table = get_table()

    def create(self, item: ${entity}) -> ${entity}:
        self._table.put_item(Item=item.to_dict())
        return item

    def find_by_id(self, ${pkSn}: ${pkPy}${skParam}) -> ${entity} | None:
        key = {"${ki.pkName}": ${pkSn}${skSn ? `, "${ki.skName}": ${skSn}` : ''}}
        response = self._table.get_item(Key=key)
        item = response.get("Item")
        return ${entity}.from_dict(item) if item else None

    def find_all(self, limit: int = 50) -> list[${entity}]:
        response = self._table.scan(Limit=limit)
        return [${entity}.from_dict(i) for i in response.get("Items", [])]

    def update(self, ${pkSn}: ${pkPy}${skParam}, updates: dict) -> ${entity}:
        key = {"${ki.pkName}": ${pkSn}${skSn ? `, "${ki.skName}": ${skSn}` : ''}}
        reserved = {"${ki.pkName}"${ki.skName ? `, "${ki.skName}"` : ''}}
        fields = {k: v for k, v in updates.items() if k not in reserved}
        if not fields:
            raise ValueError("No fields to update")

        expr_parts = [f"#k{i} = :v{i}" for i in range(len(fields))]
        expr_names = {f"#k{i}": k for i, k in enumerate(fields)}
        expr_vals  = {f":v{i}": v for i, (k, v) in enumerate(fields.items())}

        response = self._table.update_item(
            Key=key,
            UpdateExpression="SET " + ", ".join(expr_parts),
            ExpressionAttributeNames=expr_names,
            ExpressionAttributeValues=expr_vals,
            ReturnValues="ALL_NEW",
        )
        return ${entity}.from_dict(response["Attributes"])

    def delete(self, ${pkSn}: ${pkPy}${skParam}) -> None:
        self._table.delete_item(
            Key={"${ki.pkName}": ${pkSn}${skSn ? `, "${ki.skName}": ${skSn}` : ''}}
        )
`,
        'src/services/__init__.py': '',
        [`src/services/${entitySn}_service.py`]: `from src.repositories.${entitySn}_repository import ${entity}Repository
from src.entities.${entitySn} import ${entity}

class ${entity}Service:
    def __init__(self):
        self._repo = ${entity}Repository()

    def create(self, ${pkSn}: ${pkPy}${skParam}, **kwargs) -> ${entity}:
        item = ${entity}(${pkSn}=${pkSn}${skSn ? `, ${skSn}=${skSn}` : ''}, extra=kwargs)
        return self._repo.create(item)

    def get_by_id(self, ${pkSn}: ${pkPy}${skParam}) -> ${entity}:
        item = self._repo.find_by_id(${pkSn}${skSn ? `, ${skSn}` : ''})
        if not item:
            raise ValueError(f"${entity} not found: {${pkSn}}")
        return item

    def list_all(self, limit: int = 50) -> list[${entity}]:
        return self._repo.find_all(limit)

    def update(self, ${pkSn}: ${pkPy}${skParam}, updates: dict) -> ${entity}:
        self.get_by_id(${pkSn}${skSn ? `, ${skSn}` : ''})  # ensure exists
        return self._repo.update(${pkSn}${skSn ? `, ${skSn}` : ''}, updates)

    def delete(self, ${pkSn}: ${pkPy}${skParam}) -> None:
        self.get_by_id(${pkSn}${skSn ? `, ${skSn}` : ''})  # ensure exists
        self._repo.delete(${pkSn}${skSn ? `, ${skSn}` : ''})
`,
        'main.py': `from src.services.${entitySn}_service import ${entity}Service

def main():
    service = ${entity}Service()

    # Create
    item = service.create(
        ${pkSn}=${pkPy === 'float' ? '1.0' : '"example-id"'},
        ${skSn ? `${skSn}=${skPy === 'float' ? '1.0' : '"v1"'},` : ''}
        name="Example Item",
    )
    print("✅ Created:", item)

    # Read
    found = service.get_by_id(item.${pkSn}${skSn ? `, item.${skSn}` : ''})
    print("🔍 Found:", found)

    # List
    all_items = service.list_all(limit=10)
    print(f"📋 Total fetched: {len(all_items)}")

    # Update
    updated = service.update(item.${pkSn}${skSn ? `, item.${skSn}` : ''}, {"name": "Updated Item"})
    print("✏️  Updated:", updated)

    # Delete
    service.delete(item.${pkSn}${skSn ? `, item.${skSn}` : ''})
    print("🗑️  Deleted.")

if __name__ == "__main__":
    main()
`,
    };
}

function _pyVal(t)   { return t === 'N' ? '1'           : "'pk-value'"; }

function pyType(t) { return t === 'N' ? 'float' : 'str'; }

export default { id: 'python', label: 'Python', query, crud, sdk };
