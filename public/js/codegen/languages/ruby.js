// Ruby — current-query snippet, full CRUD example and SDK project files.

import { toSnakeCase, entityName } from '../naming.js';
import { buildKeyCondition, scanFilter, sq } from '../expressions.js';

function query(ctx) {
    if (ctx.mode === 'query') {
        const { keyExpr, names, values } = buildKeyCondition(ctx);
        const params = [
            `  table_name: ${sq(ctx.table)},`,
            ctx.indexName ? `  index_name: ${sq(ctx.indexName)},` : null,
            `  key_condition_expression: ${sq(keyExpr)},`,
            `  expression_attribute_names: ${_rubyHash(names)},`,
            `  expression_attribute_values: ${_rubyHash(values)},`,
            `  limit: ${ctx.limit},`,
        ].filter(Boolean);
        return `require 'aws-sdk-dynamodb'

client = Aws::DynamoDB::Client.new(region: ${sq(ctx.region)})

response = client.query(
${params.join('\n')}
)
puts "Found #{response.items.count} items"`;
    }
    if (ctx.mode === 'sql') {
        return `require 'aws-sdk-dynamodb'

client = Aws::DynamoDB::Client.new(region: ${sq(ctx.region)})

response = client.execute_statement(
  statement: ${sq(ctx.statement)}
)
puts "Found #{(response.items || []).count} items"`;
    }
    const params = [`  table_name: ${sq(ctx.table)},`, `  limit: ${ctx.limit},`];
    const filter = scanFilter(ctx);
    if (filter) {
        params.push(`  filter_expression: ${sq(filter.expr)},`);
        if (filter.names)  params.push(`  expression_attribute_names: ${_rubyHash(filter.names)},`);
        if (filter.values) params.push(`  expression_attribute_values: ${_rubyHash(filter.values)},`);
    }
    return `require 'aws-sdk-dynamodb'

client = Aws::DynamoDB::Client.new(region: ${sq(ctx.region)})

response = client.scan(
${params.join('\n')}
)
puts "Found #{response.items.count} items"`;
}

function crud({ pkName, pkType, skName, skType }, table, region) {
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

function sdk(tableName, ki, region) {
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

    def create(${pkRb}:${skArgFn}, **attrs)
      entity = Entities::${entity}.build(${pkRb}: ${pkRb}${skRb ? `, ${skRb}: ${skRb}` : ''})
      entity = Entities::${entity}.new(**entity.to_h.transform_keys(&:to_sym).merge(extra: attrs))
      @repo.save(entity)
    end

    def get_by_id(${pkRb}:${skArgFn})
      item = @repo.find_by_id(${pkRb}: ${pkRb}${skRb ? `, ${skRb}: ${skRb}` : ''})
      raise "${entity} not found: #{${pkRb}}" unless item
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

function _rubyVal(t) { return t === 'N' ? '1'           : "'pk-value'"; }

// Ruby hash literal (the v3 client marshals plain values)
function _rubyHash(obj) {
    const entries = Object.entries(obj).map(([k, v]) =>
        `${sq(k)} => ${typeof v === 'number' || typeof v === 'boolean' ? v : sq(v)}`
    ).join(', ');
    return `{ ${entries} }`;
}

export default { id: 'ruby', label: 'Ruby', query, crud, sdk };
