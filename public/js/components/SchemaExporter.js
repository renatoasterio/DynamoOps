import { $ } from '../utils/dom.js';
import { state } from '../state/store.js';
import { showToast } from '../utils/toast.js';

export function initSchemaExporter() {
    const overlay   = $('#schema-export-overlay');
    const closeBtn  = $('#schema-export-close-btn');
    const cfnTab    = $('#schema-tab-cfn');
    const tfTab     = $('#schema-tab-tf');
    const pulumiTab = $('#schema-tab-pulumi');
    const codeEl    = $('#schema-code-output');
    const copyBtn   = $('#schema-copy-btn');
    const exportBtn = $('#schema-export-btn');

    if (!overlay || !exportBtn) return;

    let currentFormat = 'cfn';

    const tabs = [
        { el: cfnTab,    fmt: 'cfn' },
        { el: tfTab,     fmt: 'tf' },
        { el: pulumiTab, fmt: 'pulumi' },
    ];

    exportBtn.addEventListener('click', () => {
        if (!state.tableInfo) return;
        setTab('cfn');
        overlay.classList.remove('hidden');
    });

    closeBtn.addEventListener('click', () => overlay.classList.add('hidden'));
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.add('hidden'); });

    tabs.forEach(({ el, fmt }) => {
        el?.addEventListener('click', () => setTab(fmt));
    });

    copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(codeEl.textContent).then(() => {
            showToast('Schema copied to clipboard', 'success');
        });
    });

    function setTab(fmt) {
        currentFormat = fmt;
        tabs.forEach(({ el, fmt: f }) => el?.classList.toggle('active', f === fmt));
        renderCode();
    }

    function renderCode() {
        const generators = {
            cfn:    generateCloudFormation,
            tf:     generateTerraform,
            pulumi: generatePulumi,
        };
        codeEl.textContent = (generators[currentFormat] || generateCloudFormation)(state.tableInfo);
    }
}

// ── CloudFormation YAML ───────────────────────────────────────────────────────
function generateCloudFormation(table) {
    const name   = table.TableName;
    const logicalId = name.replace(/[^a-zA-Z0-9]/g, '');
    const attrs  = table.AttributeDefinitions || [];
    const keys   = table.KeySchema || [];
    const gsis   = table.GlobalSecondaryIndexes || [];
    const lsis   = table.LocalSecondaryIndexes || [];
    const billing = table.BillingModeSummary?.BillingMode || 'PAY_PER_REQUEST';
    const ttl    = table.TimeToLiveDescription;

    const pk = keys.find(k => k.KeyType === 'HASH')?.AttributeName;
    const sk = keys.find(k => k.KeyType === 'RANGE')?.AttributeName;

    const lines = [
        `AWSTemplateFormatVersion: '2010-09-09'`,
        `Description: DynamoDB table schema exported from DynamoOps`,
        ``,
        `Resources:`,
        `  ${logicalId}:`,
        `    Type: AWS::DynamoDB::Table`,
        `    Properties:`,
        `      TableName: ${name}`,
        `      BillingMode: ${billing}`,
    ];

    // AttributeDefinitions
    lines.push(`      AttributeDefinitions:`);
    attrs.forEach(a => {
        lines.push(`        - AttributeName: ${a.AttributeName}`);
        lines.push(`          AttributeType: ${a.AttributeType}`);
    });

    // KeySchema
    lines.push(`      KeySchema:`);
    lines.push(`        - AttributeName: ${pk}`);
    lines.push(`          KeyType: HASH`);
    if (sk) {
        lines.push(`        - AttributeName: ${sk}`);
        lines.push(`          KeyType: RANGE`);
    }

    // GSIs
    if (gsis.length > 0) {
        lines.push(`      GlobalSecondaryIndexes:`);
        gsis.forEach(gsi => {
            const gsiPk = gsi.KeySchema.find(k => k.KeyType === 'HASH')?.AttributeName;
            const gsiSk = gsi.KeySchema.find(k => k.KeyType === 'RANGE')?.AttributeName;
            lines.push(`        - IndexName: ${gsi.IndexName}`);
            lines.push(`          KeySchema:`);
            lines.push(`            - AttributeName: ${gsiPk}`);
            lines.push(`              KeyType: HASH`);
            if (gsiSk) {
                lines.push(`            - AttributeName: ${gsiSk}`);
                lines.push(`              KeyType: RANGE`);
            }
            lines.push(`          Projection:`);
            lines.push(`            ProjectionType: ${gsi.Projection?.ProjectionType || 'ALL'}`);
            if (gsi.Projection?.NonKeyAttributes?.length > 0) {
                lines.push(`            NonKeyAttributes:`);
                gsi.Projection.NonKeyAttributes.forEach(a => lines.push(`              - ${a}`));
            }
        });
    }

    // LSIs
    if (lsis.length > 0) {
        lines.push(`      LocalSecondaryIndexes:`);
        lsis.forEach(lsi => {
            const lsiSk = lsi.KeySchema.find(k => k.KeyType === 'RANGE')?.AttributeName;
            lines.push(`        - IndexName: ${lsi.IndexName}`);
            lines.push(`          KeySchema:`);
            lines.push(`            - AttributeName: ${pk}`);
            lines.push(`              KeyType: HASH`);
            lines.push(`            - AttributeName: ${lsiSk}`);
            lines.push(`              KeyType: RANGE`);
            lines.push(`          Projection:`);
            lines.push(`            ProjectionType: ${lsi.Projection?.ProjectionType || 'ALL'}`);
        });
    }

    // TTL
    if (ttl?.TimeToLiveStatus === 'ENABLED' && ttl.AttributeName) {
        lines.push(`      TimeToLiveSpecification:`);
        lines.push(`        AttributeName: ${ttl.AttributeName}`);
        lines.push(`        Enabled: true`);
    }

    // Outputs
    lines.push(``, `Outputs:`);
    lines.push(`  ${logicalId}Arn:`);
    lines.push(`    Value: !GetAtt ${logicalId}.Arn`);
    lines.push(`    Export:`);
    lines.push(`      Name: !Sub '\${AWS::StackName}-${name}-arn'`);

    return lines.join('\n');
}

// ── Terraform HCL ─────────────────────────────────────────────────────────────
function generateTerraform(table) {
    const name   = table.TableName;
    const tfName = name.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
    const attrs  = table.AttributeDefinitions || [];
    const keys   = table.KeySchema || [];
    const gsis   = table.GlobalSecondaryIndexes || [];
    const lsis   = table.LocalSecondaryIndexes || [];
    const billing = table.BillingModeSummary?.BillingMode || 'PAY_PER_REQUEST';
    const ttl    = table.TimeToLiveDescription;

    const pk = keys.find(k => k.KeyType === 'HASH')?.AttributeName;
    const sk = keys.find(k => k.KeyType === 'RANGE')?.AttributeName;

    const tfBilling = billing === 'PAY_PER_REQUEST' ? 'PAY_PER_REQUEST' : 'PROVISIONED';

    const lines = [
        `resource "aws_dynamodb_table" "${tfName}" {`,
        `  name         = "${name}"`,
        `  billing_mode = "${tfBilling}"`,
        `  hash_key     = "${pk}"`,
    ];

    if (sk) lines.push(`  range_key    = "${sk}"`);

    lines.push(``);

    // Attributes
    attrs.forEach(a => {
        lines.push(`  attribute {`);
        lines.push(`    name = "${a.AttributeName}"`);
        lines.push(`    type = "${a.AttributeType}"`);
        lines.push(`  }`);
        lines.push(``);
    });

    // GSIs
    gsis.forEach(gsi => {
        const gsiPk = gsi.KeySchema.find(k => k.KeyType === 'HASH')?.AttributeName;
        const gsiSk = gsi.KeySchema.find(k => k.KeyType === 'RANGE')?.AttributeName;
        lines.push(`  global_secondary_index {`);
        lines.push(`    name            = "${gsi.IndexName}"`);
        lines.push(`    hash_key        = "${gsiPk}"`);
        if (gsiSk) lines.push(`    range_key       = "${gsiSk}"`);
        lines.push(`    projection_type = "${gsi.Projection?.ProjectionType || 'ALL'}"`);
        if (gsi.Projection?.NonKeyAttributes?.length > 0) {
            lines.push(`    non_key_attributes = [${gsi.Projection.NonKeyAttributes.map(a => `"${a}"`).join(', ')}]`);
        }
        lines.push(`  }`);
        lines.push(``);
    });

    // LSIs
    lsis.forEach(lsi => {
        const lsiSk = lsi.KeySchema.find(k => k.KeyType === 'RANGE')?.AttributeName;
        lines.push(`  local_secondary_index {`);
        lines.push(`    name            = "${lsi.IndexName}"`);
        lines.push(`    range_key       = "${lsiSk}"`);
        lines.push(`    projection_type = "${lsi.Projection?.ProjectionType || 'ALL'}"`);
        lines.push(`  }`);
        lines.push(``);
    });

    // TTL
    if (ttl?.TimeToLiveStatus === 'ENABLED' && ttl.AttributeName) {
        lines.push(`  ttl {`);
        lines.push(`    attribute_name = "${ttl.AttributeName}"`);
        lines.push(`    enabled        = true`);
        lines.push(`  }`);
        lines.push(``);
    }

    lines.push(`  tags = {`);
    lines.push(`    ManagedBy = "DynamoOps"`);
    lines.push(`  }`);
    lines.push(`}`);

    return lines.join('\n');
}

// ── Pulumi TypeScript ──────────────────────────────────────────────────────────
function generatePulumi(table) {
    const name    = table.TableName;
    const varName = name.replace(/[^a-zA-Z0-9]/g, '_').replace(/^[0-9]/, '_$&');
    const attrs   = table.AttributeDefinitions || [];
    const keys    = table.KeySchema || [];
    const gsis    = table.GlobalSecondaryIndexes || [];
    const lsis    = table.LocalSecondaryIndexes || [];
    const billing = table.BillingModeSummary?.BillingMode || 'PAY_PER_REQUEST';
    const ttl     = table.TimeToLiveDescription;

    const pk = keys.find(k => k.KeyType === 'HASH')?.AttributeName;
    const sk = keys.find(k => k.KeyType === 'RANGE')?.AttributeName;

    const attrTypeMap = { S: 'S', N: 'N', B: 'B' };

    const lines = [
        `import * as pulumi from "@pulumi/pulumi";`,
        `import * as aws from "@pulumi/aws";`,
        ``,
        `const ${varName} = new aws.dynamodb.Table("${varName}", {`,
        `    name: "${name}",`,
        `    billingMode: "${billing}",`,
        `    hashKey: "${pk}",`,
    ];

    if (sk) lines.push(`    rangeKey: "${sk}",`);

    // Attributes
    lines.push(`    attributes: [`);
    attrs.forEach(a => {
        lines.push(`        { name: "${a.AttributeName}", type: "${attrTypeMap[a.AttributeType]}" },`);
    });
    lines.push(`    ],`);

    // GSIs
    if (gsis.length > 0) {
        lines.push(`    globalSecondaryIndexes: [`);
        gsis.forEach(gsi => {
            const gsiPk = gsi.KeySchema.find(k => k.KeyType === 'HASH')?.AttributeName;
            const gsiSk = gsi.KeySchema.find(k => k.KeyType === 'RANGE')?.AttributeName;
            const proj  = gsi.Projection?.ProjectionType || 'ALL';
            const nonKey = gsi.Projection?.NonKeyAttributes || [];
            lines.push(`        {`);
            lines.push(`            name: "${gsi.IndexName}",`);
            lines.push(`            hashKey: "${gsiPk}",`);
            if (gsiSk) lines.push(`            rangeKey: "${gsiSk}",`);
            lines.push(`            projectionType: "${proj}",`);
            if (nonKey.length > 0) {
                lines.push(`            nonKeyAttributes: [${nonKey.map(a => `"${a}"`).join(', ')}],`);
            }
            lines.push(`        },`);
        });
        lines.push(`    ],`);
    }

    // LSIs
    if (lsis.length > 0) {
        lines.push(`    localSecondaryIndexes: [`);
        lsis.forEach(lsi => {
            const lsiSk = lsi.KeySchema.find(k => k.KeyType === 'RANGE')?.AttributeName;
            const proj  = lsi.Projection?.ProjectionType || 'ALL';
            lines.push(`        {`);
            lines.push(`            name: "${lsi.IndexName}",`);
            lines.push(`            rangeKey: "${lsiSk}",`);
            lines.push(`            projectionType: "${proj}",`);
            lines.push(`        },`);
        });
        lines.push(`    ],`);
    }

    // TTL
    if (ttl?.TimeToLiveStatus === 'ENABLED' && ttl.AttributeName) {
        lines.push(`    ttl: {`);
        lines.push(`        attributeName: "${ttl.AttributeName}",`);
        lines.push(`        enabled: true,`);
        lines.push(`    },`);
    }

    lines.push(`    tags: {`);
    lines.push(`        ManagedBy: "DynamoOps",`);
    lines.push(`    },`);
    lines.push(`});`);
    lines.push(``);
    lines.push(`export const ${varName}Arn  = ${varName}.arn;`);
    lines.push(`export const ${varName}Name = ${varName}.name;`);

    return lines.join('\n');
}
