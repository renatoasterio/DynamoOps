// Java — current-query snippet, full CRUD example and SDK project files.

import { toPascalCase, toCamelCase, toKebabCase, entityName } from '../naming.js';
import { buildKeyCondition, scanFilter, dq, attrType } from '../expressions.js';

function query(ctx) {
    const header = `import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.dynamodb.DynamoDbClient;
import software.amazon.awssdk.services.dynamodb.model.*;`;
    const client = `DynamoDbClient client = DynamoDbClient.builder()
    .region(Region.of(${dq(ctx.region)}))
    .build();`;
    if (ctx.mode === 'query') {
        const { keyExpr, names, values } = buildKeyCondition(ctx);
        return `${header}
import java.util.Map;

${client}

QueryRequest request = QueryRequest.builder()
    .tableName(${dq(ctx.table)})${ctx.indexName ? `\n    .indexName(${dq(ctx.indexName)})` : ''}
    .keyConditionExpression(${dq(keyExpr)})
    .expressionAttributeNames(${_javaMap(names, dq)})
    .expressionAttributeValues(${_javaMap(values, _javaExprVal)})
    .limit(${ctx.limit})
    .build();

QueryResponse response = client.query(request);
System.out.println("Found: " + response.count() + " items");`;
    }
    if (ctx.mode === 'sql') {
        return `${header}

${client}

ExecuteStatementRequest request = ExecuteStatementRequest.builder()
    .statement(${dq(ctx.statement)})
    .build();

ExecuteStatementResponse response = client.executeStatement(request);
System.out.println("Found: " + response.items().size() + " items");`;
    }
    const filter = scanFilter(ctx);
    const filterLines = filter ? [
        `\n    .filterExpression(${dq(filter.expr)})`,
        filter.names  ? `\n    .expressionAttributeNames(${_javaMap(filter.names, dq)})` : '',
        filter.values ? `\n    .expressionAttributeValues(${_javaMap(filter.values, _javaExprVal)})` : '',
    ].join('') : '';
    return `${header}${filter ? '\nimport java.util.Map;' : ''}

${client}

ScanRequest request = ScanRequest.builder()
    .tableName(${dq(ctx.table)})
    .limit(${ctx.limit})${filterLines}
    .build();

ScanResponse response = client.scan(request);
System.out.println("Found: " + response.count() + " items");`;
}

function crud({ pkName, pkType, skName, skType }, table, region) {
    const pkAttr  = _javaAttrVal(pkType, 'pk-value');
    const skLine  = skName ? `            "${skName}", ${_javaAttrVal(skType, 'sk-value')}` : '';
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

function sdk(tableName, ki, region) {
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

function _javaAttrVal(t, v) {
    return t === 'N' ? `AttributeValue.fromN("${v === 'pk-value' ? '1' : v}")`
                     : `AttributeValue.fromS("${v}")`;
}

// Java Map.of() for expression names / values
function _javaMap(obj, valFn) {
    const entries = Object.entries(obj).map(([k, v]) => `${dq(k)}, ${valFn(v)}`).join(',\n            ');
    return `Map.of(\n            ${entries})`;
}

function javaType(t) { return t === 'N' ? 'Double' : 'String'; }

function _javaExprVal(v) {
    const t = attrType(v);
    if (t === 'N') return `AttributeValue.fromN(${dq(v)})`;
    if (t === 'BOOL') return `AttributeValue.fromBool(${v})`;
    return `AttributeValue.fromS(${dq(v)})`;
}

export default { id: 'java', label: 'Java', query, crud, sdk };
