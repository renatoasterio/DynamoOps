/**
 * SdkGenerator.js
 * Generates a complete, production-ready SDK project structure as a ZIP file.
 * Each language follows idiomatic conventions: folder layout, naming, design patterns.
 */

import { downloadBlob } from '../utils/download.js';

// ─── Name helpers ─────────────────────────────────────────────────────────────

function toPascalCase(str) {
    return str
        .replace(/[-_\s]+(.)/g, (_, c) => c.toUpperCase())
        .replace(/^(.)/, (_, c) => c.toUpperCase());
}

function toCamelCase(str) {
    const p = toPascalCase(str);
    return p.charAt(0).toLowerCase() + p.slice(1);
}

function toSnakeCase(str) {
    return str
        .replace(/([A-Z])/g, '_$1')
        .replace(/[-\s]+/g, '_')
        .replace(/^_/, '')
        .toLowerCase();
}

function toKebabCase(str) {
    return toSnakeCase(str).replace(/_/g, '-');
}

/** Simple singularize: Policies → Policy, Users → User, Items → Item */
function singularize(name) {
    if (name.endsWith('ies')) return name.slice(0, -3) + 'y';
    if (name.endsWith('ses') || name.endsWith('xes') || name.endsWith('zes')) return name.slice(0, -2);
    if (name.endsWith('s') && !name.endsWith('ss')) return name.slice(0, -1);
    return name;
}

function entityName(tableName) { return toPascalCase(singularize(tableName)); }

/** JS/TS type from DynamoDB attribute type */
function jsType(t) { return t === 'N' ? 'number' : t === 'B' ? 'Buffer' : 'string'; }
function pyType(t) { return t === 'N' ? 'float' : 'str'; }
function javaType(t) { return t === 'N' ? 'Double' : 'String'; }
function csType(t) { return t === 'N' ? 'double' : 'string'; }
function goType(t) { return t === 'N' ? 'float64' : 'string'; }

// ─── Node.js (TypeScript) ─────────────────────────────────────────────────────

export function sdkNodejs(tableName, ki, region) {
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

// ─── Python ───────────────────────────────────────────────────────────────────

export function sdkPython(tableName, ki, region) {
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

// ─── Java (Maven) ─────────────────────────────────────────────────────────────

export function sdkJava(tableName, ki, region) {
    const entity   = entityName(tableName);
    const pkJava   = ki.pkName;
    const skJava   = ki.skName;
    const pkT      = javaType(ki.pkType);
    const skT      = ki.skType ? javaType(ki.skType) : null;
    const base     = `src/main/java/com/example/dynamo`;
    const pkAV     = ki.pkType === 'N' ? `AttributeValue.fromN(String.valueOf(${toCamelCase(pkJava)}))` : `AttributeValue.fromS(${toCamelCase(pkJava)})`;
    const skAV     = skJava ? (ki.skType === 'N' ? `AttributeValue.fromN(String.valueOf(${toCamelCase(skJava)}))` : `AttributeValue.fromS(${toCamelCase(skJava)})`) : null;
    const skParam  = skJava ? `, ${skT} ${toCamelCase(skJava)}` : '';
    const skField  = skJava ? `\n    private ${skT} ${toCamelCase(skJava)};` : '';
    const skGetter = skJava ? `\n    public ${skT} get${toPascalCase(skJava)}() { return ${toCamelCase(skJava)}; }
    public void set${toPascalCase(skJava)}(${skT} ${toCamelCase(skJava)}) { this.${toCamelCase(skJava)} = ${toCamelCase(skJava)}; }` : '';

    return {
        'pom.xml': `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0
         http://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>

    <groupId>com.example</groupId>
    <artifactId>${toKebabCase(tableName)}-dynamo-sdk</artifactId>
    <version>1.0.0</version>
    <packaging>jar</packaging>

    <properties>
        <maven.compiler.source>17</maven.compiler.source>
        <maven.compiler.target>17</maven.compiler.target>
        <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
        <aws.sdk.version>2.21.0</aws.sdk.version>
    </properties>

    <dependencies>
        <dependency>
            <groupId>software.amazon.awssdk</groupId>
            <artifactId>dynamodb</artifactId>
            <version>\${aws.sdk.version}</version>
        </dependency>
        <dependency>
            <groupId>software.amazon.awssdk</groupId>
            <artifactId>dynamodb-enhanced</artifactId>
            <version>\${aws.sdk.version}</version>
        </dependency>
        <dependency>
            <groupId>io.github.cdimascio</groupId>
            <artifactId>dotenv-java</artifactId>
            <version>3.0.0</version>
        </dependency>
    </dependencies>

    <build>
        <plugins>
            <plugin>
                <groupId>org.apache.maven.plugins</groupId>
                <artifactId>maven-jar-plugin</artifactId>
                <configuration>
                    <archive>
                        <manifest>
                            <mainClass>com.example.dynamo.Main</mainClass>
                        </manifest>
                    </archive>
                </configuration>
            </plugin>
        </plugins>
    </build>
</project>
`,
        '.env.example': `AWS_REGION=${region}
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
`,
        'README.md': `# ${entity} DynamoDB SDK (Java / Maven)

## Requirements
- Java 17+, Maven 3.8+

## Build & Run

\`\`\`bash
mvn clean package -q
java -jar target/${toKebabCase(tableName)}-dynamo-sdk-1.0.0.jar
\`\`\`
`,
        [`${base}/client/DynamoClientConfig.java`]: `package com.example.dynamo.client;

import io.github.cdimascio.dotenv.Dotenv;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.dynamodb.DynamoDbClient;
import java.net.URI;

public class DynamoClientConfig {
    private static final Dotenv dotenv = Dotenv.configure().ignoreIfMissing().load();
    private static DynamoDbClient instance;

    public static synchronized DynamoDbClient getInstance() {
        if (instance == null) {
            var builder = DynamoDbClient.builder()
                .region(Region.of(dotenv.get("AWS_REGION", "${region}")));
            String endpoint = dotenv.get("DYNAMO_ENDPOINT", "");
            if (!endpoint.isEmpty()) builder.endpointOverride(URI.create(endpoint));
            instance = builder.build();
        }
        return instance;
    }

    public static final String TABLE_NAME = "${tableName}";
}
`,
        [`${base}/entity/${entity}.java`]: `package com.example.dynamo.entity;

import java.time.Instant;
import java.util.HashMap;
import java.util.Map;

public class ${entity} {
    private ${pkT} ${toCamelCase(pkJava)};${skField}
    private String createdAt;
    private Map<String, Object> extra = new HashMap<>();

    public ${entity}() {}

    public ${pkT} get${toPascalCase(pkJava)}() { return ${toCamelCase(pkJava)}; }
    public void set${toPascalCase(pkJava)}(${pkT} ${toCamelCase(pkJava)}) { this.${toCamelCase(pkJava)} = ${toCamelCase(pkJava)}; }${skGetter}

    public String getCreatedAt() { return createdAt; }
    public void setCreatedAt(String createdAt) { this.createdAt = createdAt; }

    public Map<String, Object> getExtra() { return extra; }
    public void setExtra(Map<String, Object> extra) { this.extra = extra; }

    public static ${entity} create(${pkT} ${toCamelCase(pkJava)}${skParam}) {
        ${entity} e = new ${entity}();
        e.set${toPascalCase(pkJava)}(${toCamelCase(pkJava)});
        ${skJava ? `e.set${toPascalCase(skJava)}(${toCamelCase(skJava)});` : ''}
        e.setCreatedAt(Instant.now().toString());
        return e;
    }

    @Override
    public String toString() {
        return "${entity}{${toCamelCase(pkJava)}=" + ${toCamelCase(pkJava)} + ${skJava ? `", ${toCamelCase(skJava)}=" + ${toCamelCase(skJava)} + ` : ''}", createdAt=" + createdAt + "}";
    }
}
`,
        [`${base}/repository/${entity}Repository.java`]: `package com.example.dynamo.repository;

import com.example.dynamo.client.DynamoClientConfig;
import com.example.dynamo.entity.${entity};
import software.amazon.awssdk.services.dynamodb.DynamoDbClient;
import software.amazon.awssdk.services.dynamodb.model.*;

import java.util.*;

public class ${entity}Repository {
    private final DynamoDbClient client = DynamoClientConfig.getInstance();
    private final String table = DynamoClientConfig.TABLE_NAME;

    public ${entity} save(${entity} item) {
        Map<String, AttributeValue> av = toMap(item);
        client.putItem(PutItemRequest.builder().tableName(table).item(av).build());
        return item;
    }

    public Optional<${entity}> findById(${pkT} ${toCamelCase(pkJava)}${skParam}) {
        Map<String, AttributeValue> key = new HashMap<>();
        key.put("${pkJava}", ${pkAV});
        ${skJava ? `key.put("${skJava}", ${skAV});` : ''}
        var resp = client.getItem(GetItemRequest.builder().tableName(table).key(key).build());
        return resp.hasItem() ? Optional.of(fromMap(resp.item())) : Optional.empty();
    }

    public List<${entity}> findAll(int limit) {
        var resp = client.scan(ScanRequest.builder().tableName(table).limit(limit).build());
        return resp.items().stream().map(this::fromMap).toList();
    }

    public void delete(${pkT} ${toCamelCase(pkJava)}${skParam}) {
        Map<String, AttributeValue> key = new HashMap<>();
        key.put("${pkJava}", ${pkAV});
        ${skJava ? `key.put("${skJava}", ${skAV});` : ''}
        client.deleteItem(DeleteItemRequest.builder().tableName(table).key(key).build());
    }

    private Map<String, AttributeValue> toMap(${entity} item) {
        Map<String, AttributeValue> m = new HashMap<>();
        m.put("${pkJava}", ${pkT === 'Double' ? `AttributeValue.fromN(String.valueOf(item.get${toPascalCase(pkJava)}()))` : `AttributeValue.fromS(item.get${toPascalCase(pkJava)}())`});
        ${skJava ? `m.put("${skJava}", ${skT === 'Double' ? `AttributeValue.fromN(String.valueOf(item.get${toPascalCase(skJava)}()))` : `AttributeValue.fromS(item.get${toPascalCase(skJava)}())`});` : ''}
        if (item.getCreatedAt() != null) m.put("createdAt", AttributeValue.fromS(item.getCreatedAt()));
        return m;
    }

    private ${entity} fromMap(Map<String, AttributeValue> m) {
        ${entity} item = new ${entity}();
        ${pkT === 'Double' ? `item.set${toPascalCase(pkJava)}(Double.parseDouble(m.get("${pkJava}").n()));` : `item.set${toPascalCase(pkJava)}(m.get("${pkJava}").s());`}
        ${skJava ? (skT === 'Double' ? `item.set${toPascalCase(skJava)}(Double.parseDouble(m.get("${skJava}").n()));` : `item.set${toPascalCase(skJava)}(m.get("${skJava}").s());`) : ''}
        if (m.containsKey("createdAt")) item.setCreatedAt(m.get("createdAt").s());
        return item;
    }
}
`,
        [`${base}/service/${entity}Service.java`]: `package com.example.dynamo.service;

import com.example.dynamo.entity.${entity};
import com.example.dynamo.repository.${entity}Repository;
import java.util.List;

public class ${entity}Service {
    private final ${entity}Repository repo = new ${entity}Repository();

    public ${entity} create(${pkT} ${toCamelCase(pkJava)}${skParam}) {
        ${entity} item = ${entity}.create(${toCamelCase(pkJava)}${skJava ? `, ${toCamelCase(skJava)}` : ''});
        return repo.save(item);
    }

    public ${entity} getById(${pkT} ${toCamelCase(pkJava)}${skParam}) {
        return repo.findById(${toCamelCase(pkJava)}${skJava ? `, ${toCamelCase(skJava)}` : ''})
            .orElseThrow(() -> new RuntimeException("${entity} not found: " + ${toCamelCase(pkJava)}));
    }

    public List<${entity}> listAll(int limit) {
        return repo.findAll(limit);
    }

    public void delete(${pkT} ${toCamelCase(pkJava)}${skParam}) {
        getById(${toCamelCase(pkJava)}${skJava ? `, ${toCamelCase(skJava)}` : ''}); // ensure exists
        repo.delete(${toCamelCase(pkJava)}${skJava ? `, ${toCamelCase(skJava)}` : ''});
    }
}
`,
        [`${base}/Main.java`]: `package com.example.dynamo;

import com.example.dynamo.service.${entity}Service;

public class Main {
    public static void main(String[] args) {
        ${entity}Service service = new ${entity}Service();

        // Create
        var item = service.create(${pkT === 'Double' ? '1.0' : '"example-id"'}${skJava ? (skT === 'Double' ? ', 1.0' : ', "v1"') : ''});
        System.out.println("✅ Created: " + item);

        // Read
        var found = service.getById(item.get${toPascalCase(pkJava)}()${skJava ? `, item.get${toPascalCase(skJava)}()` : ''});
        System.out.println("🔍 Found: " + found);

        // List
        var all = service.listAll(10);
        System.out.println("📋 Total: " + all.size());

        // Delete
        service.delete(item.get${toPascalCase(pkJava)}()${skJava ? `, item.get${toPascalCase(skJava)}()` : ''});
        System.out.println("🗑️  Deleted.");
    }
}
`,
    };
}

// ─── C# (.NET) ────────────────────────────────────────────────────────────────

export function sdkCSharp(tableName, ki, region) {
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

// ─── Go ───────────────────────────────────────────────────────────────────────

export function sdkGo(tableName, ki, region) {
    const entity   = entityName(tableName);
    const entitySn = toSnakeCase(entity);
    const pkGo     = toCamelCase(ki.pkName);
    const skGo     = ki.skName ? toCamelCase(ki.skName) : null;
    const pkT      = goType(ki.pkType);
    const skT      = ki.skType ? goType(ki.skType) : null;
    const mod      = `github.com/example/${toKebabCase(tableName)}-dynamo-sdk`;
    const skField  = skGo ? `\n\t${toPascalCase(ki.skName)} ${skT}` : '';
    const skParam  = skGo ? `, ${skGo} ${skT}` : '';

    return {
        'go.mod': `module ${mod}

go 1.21

require (
\tgithub.com/aws/aws-sdk-go-v2 v1.24.0
\tgithub.com/aws/aws-sdk-go-v2/config v1.26.0
\tgithub.com/aws/aws-sdk-go-v2/service/dynamodb v1.26.0
\tgithub.com/joho/godotenv v1.5.1
)
`,
        '.env.example': `AWS_REGION=${region}
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
`,
        'README.md': `# ${entity} DynamoDB SDK (Go)

## Build & Run

\`\`\`bash
go mod tidy
go run cmd/main.go
\`\`\`
`,
        'internal/client/dynamo.go': `package client

import (
\t"context"
\t"os"

\t"github.com/aws/aws-sdk-go-v2/config"
\t"github.com/aws/aws-sdk-go-v2/service/dynamodb"
\t"github.com/joho/godotenv"
)

const TableName = "${tableName}"

func NewClient() *dynamodb.Client {
\t_ = godotenv.Load()
\tcfg, err := config.LoadDefaultConfig(context.Background(),
\t\tconfig.WithRegion(getEnv("AWS_REGION", "${region}")),
\t)
\tif err != nil {
\t\tpanic(err)
\t}
\topts := []func(*dynamodb.Options){}
\tif ep := os.Getenv("DYNAMO_ENDPOINT"); ep != "" {
\t\topts = append(opts, dynamodb.WithEndpointResolverV2(nil)) // set custom endpoint
\t}
\treturn dynamodb.NewFromConfig(cfg, opts...)
}

func getEnv(key, fallback string) string {
\tif v := os.Getenv(key); v != "" {
\t\treturn v
\t}
\treturn fallback
}
`,
        [`internal/entity/${entitySn}.go`]: `package entity

import "time"

type ${entity} struct {
\t${toPascalCase(ki.pkName)} ${pkT}${skField}
\tCreatedAt string
}

func New${entity}(${pkGo} ${pkT}${skParam}) *${entity} {
\treturn &${entity}{
\t\t${toPascalCase(ki.pkName)}: ${pkGo},
\t\t${skGo ? `${toPascalCase(ki.skName)}: ${skGo},` : ''}
\t\tCreatedAt: time.Now().UTC().Format(time.RFC3339),
\t}
}
`,
        [`internal/repository/${entitySn}_repository.go`]: `package repository

import (
\t"context"
\t"fmt"

\t"github.com/aws/aws-sdk-go-v2/service/dynamodb"
\t"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
\t"${mod}/internal/client"
\t"${mod}/internal/entity"
)

type ${entity}Repository struct {
\tclient *dynamodb.Client
\ttable  string
}

func New${entity}Repository(c *dynamodb.Client) *${entity}Repository {
\treturn &${entity}Repository{client: c, table: client.TableName}
}

func (r *${entity}Repository) Save(ctx context.Context, e *entity.${entity}) error {
\titem := map[string]types.AttributeValue{
\t\t"${ki.pkName}": ${ki.pkType === 'N' ? `&types.AttributeValueMemberN{Value: fmt.Sprintf("%v", e.${toPascalCase(ki.pkName)})}` : `&types.AttributeValueMemberS{Value: e.${toPascalCase(ki.pkName)}}`},${skGo ? `\n\t\t"${ki.skName}": ${ki.skType === 'N' ? `&types.AttributeValueMemberN{Value: fmt.Sprintf("%v", e.${toPascalCase(ki.skName)})}` : `&types.AttributeValueMemberS{Value: e.${toPascalCase(ki.skName)}}`},` : ''}
\t\t"createdAt": &types.AttributeValueMemberS{Value: e.CreatedAt},
\t}
\t_, err := r.client.PutItem(ctx, &dynamodb.PutItemInput{
\t\tTableName: &r.table,
\t\tItem:      item,
\t})
\treturn err
}

func (r *${entity}Repository) FindByID(ctx context.Context, ${pkGo} ${pkT}${skParam}) (*entity.${entity}, error) {
\tkey := map[string]types.AttributeValue{
\t\t"${ki.pkName}": ${ki.pkType === 'N' ? `&types.AttributeValueMemberN{Value: fmt.Sprintf("%v", ${pkGo})}` : `&types.AttributeValueMemberS{Value: ${pkGo}}`},${skGo ? `\n\t\t"${ki.skName}": ${ki.skType === 'N' ? `&types.AttributeValueMemberN{Value: fmt.Sprintf("%v", ${skGo})}` : `&types.AttributeValueMemberS{Value: ${skGo}}`},` : ''}
\t}
\tresp, err := r.client.GetItem(ctx, &dynamodb.GetItemInput{
\t\tTableName: &r.table, Key: key,
\t})
\tif err != nil || resp.Item == nil {
\t\treturn nil, err
\t}
\te := &entity.${entity}{}
\tif v, ok := resp.Item["${ki.pkName}"].(*types.AttributeValueMember${ki.pkType === 'N' ? 'N' : 'S'}); ok {
\t\t${ki.pkType === 'N' ? `fmt.Sscanf(v.Value, "%f", &e.${toPascalCase(ki.pkName)})` : `e.${toPascalCase(ki.pkName)} = v.Value`}
\t}
\t${skGo ? `if v, ok := resp.Item["${ki.skName}"].(*types.AttributeValueMember${ki.skType === 'N' ? 'N' : 'S'}); ok { ${ki.skType === 'N' ? `fmt.Sscanf(v.Value, "%f", &e.${toPascalCase(ki.skName)})` : `e.${toPascalCase(ki.skName)} = v.Value`} }` : ''}
\treturn e, nil
}

func (r *${entity}Repository) Delete(ctx context.Context, ${pkGo} ${pkT}${skParam}) error {
\tkey := map[string]types.AttributeValue{
\t\t"${ki.pkName}": ${ki.pkType === 'N' ? `&types.AttributeValueMemberN{Value: fmt.Sprintf("%v", ${pkGo})}` : `&types.AttributeValueMemberS{Value: ${pkGo}}`},${skGo ? `\n\t\t"${ki.skName}": ${ki.skType === 'N' ? `&types.AttributeValueMemberN{Value: fmt.Sprintf("%v", ${skGo})}` : `&types.AttributeValueMemberS{Value: ${skGo}}`},` : ''}
\t}
\t_, err := r.client.DeleteItem(ctx, &dynamodb.DeleteItemInput{
\t\tTableName: &r.table, Key: key,
\t})
\treturn err
}
`,
        [`internal/service/${entitySn}_service.go`]: `package service

import (
\t"context"
\t"fmt"

\t"${mod}/internal/entity"
\t"${mod}/internal/repository"
)

type ${entity}Service struct {
\trepo *repository.${entity}Repository
}

func New${entity}Service(repo *repository.${entity}Repository) *${entity}Service {
\treturn &${entity}Service{repo: repo}
}

func (s *${entity}Service) Create(ctx context.Context, ${pkGo} ${pkT}${skParam}) (*entity.${entity}, error) {
\te := entity.New${entity}(${pkGo}${skGo ? `, ${skGo}` : ''})
\treturn e, s.repo.Save(ctx, e)
}

func (s *${entity}Service) GetByID(ctx context.Context, ${pkGo} ${pkT}${skParam}) (*entity.${entity}, error) {
\te, err := s.repo.FindByID(ctx, ${pkGo}${skGo ? `, ${skGo}` : ''})
\tif err != nil { return nil, err }
\tif e == nil { return nil, fmt.Errorf("${entity} not found: %v", ${pkGo}) }
\treturn e, nil
}

func (s *${entity}Service) Delete(ctx context.Context, ${pkGo} ${pkT}${skParam}) error {
\tif _, err := s.GetByID(ctx, ${pkGo}${skGo ? `, ${skGo}` : ''}); err != nil { return err }
\treturn s.repo.Delete(ctx, ${pkGo}${skGo ? `, ${skGo}` : ''})
}
`,
        'cmd/main.go': `package main

import (
\t"context"
\t"fmt"
\t"log"

\t"${mod}/internal/client"
\t"${mod}/internal/repository"
\t"${mod}/internal/service"
)

func main() {
\tctx := context.Background()
\tc   := client.NewClient()
\trepo := repository.New${entity}Repository(c)
\tsvc  := service.New${entity}Service(repo)

\t// Create
\titem, err := svc.Create(ctx, ${pkT === 'float64' ? '1.0' : '"example-id"'}${skGo ? (skT === 'float64' ? ', 1.0' : ', "v1"') : ''})
\tif err != nil { log.Fatal(err) }
\tfmt.Println("✅ Created:", item)

\t// Read
\tfound, err := svc.GetByID(ctx, item.${toPascalCase(ki.pkName)}${skGo ? `, item.${toPascalCase(ki.skName)}` : ''})
\tif err != nil { log.Fatal(err) }
\tfmt.Println("🔍 Found:", found)

\t// Delete
\tif err := svc.Delete(ctx, item.${toPascalCase(ki.pkName)}${skGo ? `, item.${toPascalCase(ki.skName)}` : ''}); err != nil { log.Fatal(err) }
\tfmt.Println("🗑️  Deleted.")
}
`,
    };
}

// ─── Ruby ─────────────────────────────────────────────────────────────────────

export function sdkRuby(tableName, ki, region) {
    const entity  = entityName(tableName);
    const entitySn = toSnakeCase(entity);
    const pkRb    = toSnakeCase(ki.pkName);
    const skRb    = ki.skName ? toSnakeCase(ki.skName) : null;
    const skArgFn = skRb ? `, ${skRb}:` : '';

    return {
        'Gemfile': `source "https://rubygems.org"

gem "aws-sdk-dynamodb", "~> 1"
gem "dotenv", "~> 3"
`,
        '.env.example': `AWS_REGION=${region}
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
`,
        'README.md': `# ${entity} DynamoDB SDK (Ruby)

## Setup

\`\`\`bash
bundle install
cp .env.example .env
ruby main.rb
\`\`\`
`,
        'lib/client/dynamo_client.rb': `require "aws-sdk-dynamodb"
require "dotenv/load"

module Client
  TABLE_NAME = "${tableName}"

  def self.resource
    @resource ||= begin
      opts = { region: ENV.fetch("AWS_REGION", "${region}") }
      opts[:endpoint] = ENV["DYNAMO_ENDPOINT"] if ENV["DYNAMO_ENDPOINT"]
      Aws::DynamoDB::Resource.new(**opts)
    end
  end

  def self.table
    resource.table(TABLE_NAME)
  end
end
`,
        [`lib/entities/${entitySn}.rb`]: `require "time"

module Entities
  ${entity} = Struct.new(:${pkRb}${skRb ? `, :${skRb}` : ''}, :created_at, :extra, keyword_init: true) do
    def self.build(${pkRb}:${skArgFn})
      new(
        ${pkRb}: ${pkRb},
        ${skRb ? `${skRb}: ${skRb},` : ''}
        created_at: Time.now.utc.iso8601,
        extra: {}
      )
    end

    def to_h
      { "${ki.pkName}" => ${pkRb}${skRb ? `, "${ki.skName}" => ${skRb}` : ''}, "created_at" => created_at }.merge(extra || {})
    end

    def self.from_h(h)
      new(
        ${pkRb}: ${ki.pkType === 'N' ? `h["${ki.pkName}"]&.to_f` : `h["${ki.pkName}"]`},
        ${skRb ? `${skRb}: ${ki.skType === 'N' ? `h["${ki.skName}"]&.to_f` : `h["${ki.skName}"]`},` : ''}
        created_at: h["created_at"],
        extra: h.reject { |k, _| %w[${ki.pkName} ${ki.skName ?? ''} created_at].include?(k) }
      )
    end
  end
end
`,
        [`lib/repositories/${entitySn}_repository.rb`]: `require_relative "../client/dynamo_client"
require_relative "../entities/${entitySn}"

module Repositories
  class ${entity}Repository
    def initialize
      @table = Client.table
    end

    def save(entity)
      @table.put_item(item: entity.to_h)
      entity
    end

    def find_by_id(${pkRb}:${skArgFn})
      key = { "${ki.pkName}" => ${pkRb}${skRb ? `, "${ki.skName}" => ${skRb}` : ''} }
      resp = @table.get_item(key: key)
      resp.item ? Entities::${entity}.from_h(resp.item) : nil
    end

    def find_all(limit: 50)
      resp = @table.scan(limit: limit)
      resp.items.map { |i| Entities::${entity}.from_h(i) }
    end

    def delete(${pkRb}:${skArgFn})
      @table.delete_item(key: { "${ki.pkName}" => ${pkRb}${skRb ? `, "${ki.skName}" => ${skRb}` : ''} })
    end
  end
end
`,
        [`lib/services/${entitySn}_service.rb`]: `require_relative "../repositories/${entitySn}_repository"

module Services
  class ${entity}Service
    def initialize
      @repo = Repositories::${entity}Repository.new
    end

    def create(${pkRb}:${skArgFn} **attrs)
      entity = Entities::${entity}.build(${pkRb}: ${pkRb}${skRb ? `, ${skRb}: ${skRb}` : ''})
      entity = Entities::${entity}.new(**entity.to_h.transform_keys(&:to_sym).merge(extra: attrs))
      @repo.save(entity)
    end

    def get_by_id(${pkRb}:${skArgFn})
      item = @repo.find_by_id(${pkRb}: ${pkRb}${skRb ? `, ${skRb}: ${skRb}` : ''})
      raise "#{entity} not found: #{${pkRb}}" unless item
      item
    end

    def list_all(limit: 50)
      @repo.find_all(limit: limit)
    end

    def delete(${pkRb}:${skArgFn})
      get_by_id(${pkRb}: ${pkRb}${skRb ? `, ${skRb}: ${skRb}` : ''})
      @repo.delete(${pkRb}: ${pkRb}${skRb ? `, ${skRb}: ${skRb}` : ''})
    end
  end
end
`,
        'main.rb': `require_relative "lib/services/${entitySn}_service"

svc = Services::${entity}Service.new

# Create
item = svc.create(${pkRb}: ${ki.pkType === 'N' ? '1.0' : '"example-id"'}${skRb ? (ki.skType === 'N' ? ', v: 1.0' : `, ${skRb}: "v1"`) : ''}, name: "Example Item")
puts "✅ Created: #{item}"

# Read
found = svc.get_by_id(${pkRb}: item.${pkRb}${skRb ? `, ${skRb}: item.${skRb}` : ''})
puts "🔍 Found: #{found}"

# List
all = svc.list_all(limit: 10)
puts "📋 Total: #{all.size}"

# Delete
svc.delete(${pkRb}: item.${pkRb}${skRb ? `, ${skRb}: item.${skRb}` : ''})
puts "🗑️  Deleted."
`,
    };
}

// ─── PHP ──────────────────────────────────────────────────────────────────────

export function sdkPhp(tableName, ki, region) {
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

// ─── AWS CLI ──────────────────────────────────────────────────────────────────

export function sdkCli(tableName, ki, region) {
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

// ─── ZIP builder ──────────────────────────────────────────────────────────────

const SDK_BUILDERS = {
    nodejs:  sdkNodejs,
    python:  sdkPython,
    java:    sdkJava,
    csharp:  sdkCSharp,
    go:      sdkGo,
    ruby:    sdkRuby,
    php:     sdkPhp,
    cli:     sdkCli,
};

/**
 * Builds and downloads a ZIP for the given language.
 * Requires window.JSZip to be loaded.
 * @param {string} lang
 * @param {string} tableName
 * @param {{ pkName, pkType, skName, skType }} ki
 * @param {string} region
 */
export async function downloadSdk(lang, tableName, ki, region) {
    const builder = SDK_BUILDERS[lang];
    if (!builder) throw new Error(`No SDK builder for lang: ${lang}`);
    if (!window.JSZip) throw new Error('JSZip not loaded');

    const files = builder(tableName, ki, region);
    const zip   = new window.JSZip();

    const rootFolder = `${toKebabCase(tableName)}-dynamo-sdk`;

    for (const [path, content] of Object.entries(files)) {
        zip.file(`${rootFolder}/${path}`, content);
    }

    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
    downloadBlob(blob, `${rootFolder}-${lang}.zip`);
}
