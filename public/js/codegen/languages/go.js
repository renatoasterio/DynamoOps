// Go — current-query snippet, full CRUD example and SDK project files.

import { toPascalCase, toCamelCase, toSnakeCase, toKebabCase, entityName } from '../naming.js';
import { buildKeyCondition, scanFilter, dq, goRaw, attrType } from '../expressions.js';

function query(ctx) {
    const imports = (extra) => `package main

import (
    "context"
    "fmt"
    "github.com/aws/aws-sdk-go-v2/aws"
    "github.com/aws/aws-sdk-go-v2/config"
    "github.com/aws/aws-sdk-go-v2/service/dynamodb"${extra ? '\n    "github.com/aws/aws-sdk-go-v2/service/dynamodb/types"' : ''}
)`;
    if (ctx.mode === 'query') {
        const { keyExpr, names, values } = buildKeyCondition(ctx);
        return `${imports(true)}

func main() {
    cfg, _ := config.LoadDefaultConfig(context.TODO(),
        config.WithRegion(${dq(ctx.region)}),
    )
    client := dynamodb.NewFromConfig(cfg)

    result, err := client.Query(context.TODO(), &dynamodb.QueryInput{
        TableName:                 aws.String(${dq(ctx.table)}),${ctx.indexName ? `\n        IndexName:                 aws.String(${dq(ctx.indexName)}),` : ''}
        KeyConditionExpression:    aws.String(${dq(keyExpr)}),
        ExpressionAttributeNames:  ${_goMap(names)},
        ExpressionAttributeValues: ${_goMapAttr(values)},
        Limit:                     aws.Int32(${ctx.limit}),
    })
    if err != nil { panic(err) }
    fmt.Printf("Found %d items\\n", len(result.Items))
}`;
    }
    if (ctx.mode === 'sql') {
        return `${imports(false)}

func main() {
    cfg, _ := config.LoadDefaultConfig(context.TODO(), config.WithRegion(${dq(ctx.region)}))
    client := dynamodb.NewFromConfig(cfg)

    result, err := client.ExecuteStatement(context.TODO(), &dynamodb.ExecuteStatementInput{
        Statement: aws.String(${goRaw(ctx.statement)}),
    })
    if err != nil { panic(err) }
    fmt.Printf("Found %d items\\n", len(result.Items))
}`;
    }
    const filter = scanFilter(ctx);
    const filterLines = filter ? [
        `\n        FilterExpression: aws.String(${dq(filter.expr)}),`,
        filter.names  ? `\n        ExpressionAttributeNames: ${_goMap(filter.names)},` : '',
        filter.values ? `\n        ExpressionAttributeValues: ${_goMapAttr(filter.values)},` : '',
    ].join('') : '';
    return `${imports(Boolean(filter?.values))}

func main() {
    cfg, _ := config.LoadDefaultConfig(context.TODO(), config.WithRegion(${dq(ctx.region)}))
    client := dynamodb.NewFromConfig(cfg)

    result, err := client.Scan(context.TODO(), &dynamodb.ScanInput{
        TableName: aws.String(${dq(ctx.table)}),
        Limit:     aws.Int32(${ctx.limit}),${filterLines}
    })
    if err != nil { panic(err) }
    fmt.Printf("Found %d items\\n", len(result.Items))
}`;
}

function crud({ pkName, pkType, skName, skType }, table, region) {
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
    fmt.Println("✅ Created")
}

// ── READ — fetch by key ───────────────────────────────────────────────────
func getItem() {
    result, err := client.GetItem(context.TODO(), &dynamodb.GetItemInput{
        TableName: aws.String(TABLE),
        Key:       key(),
    })
    if err != nil { panic(err) }
    fmt.Printf("🔍 Item found: %v\\n", result.Item)
}

// ── READ — listar (Scan) ──────────────────────────────────────────────────────
func listItems() {
    result, err := client.Scan(context.TODO(), &dynamodb.ScanInput{
        TableName: aws.String(TABLE),
        Limit:     aws.Int32(50),
    })
    if err != nil { panic(err) }
    fmt.Printf("📋 Listed %d items\\n", len(result.Items))
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
    fmt.Println("✏️  Updated")
}

// ── DELETE ────────────────────────────────────────────────────────────────────
func deleteItem() {
    _, err := client.DeleteItem(context.TODO(), &dynamodb.DeleteItemInput{
        TableName: aws.String(TABLE),
        Key:       key(),
    })
    if err != nil { panic(err) }
    fmt.Println("🗑️  Deleted")
}

func main() {
    cfg, _ := config.LoadDefaultConfig(context.TODO(), config.WithRegion("${region}"))
    client  = dynamodb.NewFromConfig(cfg)

    createItem(); getItem(); listItems(); updateItem(); deleteItem()
}`;
}

function sdk(tableName, ki, region) {
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

function _goAttrVal(t, v) {
    return t === 'N' ? `&types.AttributeValueMemberN{Value: "${v === 'pk-value' ? '1' : v}"}`
                     : `&types.AttributeValueMemberS{Value: "${v}"}`;
}

// Go map[string]string for ExpressionAttributeNames
function _goMap(obj) {
    const entries = Object.entries(obj).map(([k, v]) => `${dq(k)}: ${dq(v)}`).join(', ');
    return `map[string]string{${entries}}`;
}

// Go map[string]types.AttributeValue for ExpressionAttributeValues
function _goMapAttr(obj) {
    const entries = Object.entries(obj).map(([k, v]) => {
        const t = attrType(v);
        const attr = t === 'N' ? `&types.AttributeValueMemberN{Value: ${dq(v)}}`
            : t === 'BOOL' ? `&types.AttributeValueMemberBOOL{Value: ${v}}`
            : `&types.AttributeValueMemberS{Value: ${dq(v)}}`;
        return `${dq(k)}: ${attr}`;
    }).join(', ');
    return `map[string]types.AttributeValue{${entries}}`;
}

function goType(t) { return t === 'N' ? 'float64' : 'string'; }

export default { id: 'go', label: 'Go', query, crud, sdk };
