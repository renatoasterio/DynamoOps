// Identifier casing helpers shared by every language generator.

export function toPascalCase(str) {
    return str
        .replace(/[-_\s]+(.)/g, (_, c) => c.toUpperCase())
        .replace(/^(.)/, (_, c) => c.toUpperCase());
}

export function toCamelCase(str) {
    const p = toPascalCase(str);
    return p.charAt(0).toLowerCase() + p.slice(1);
}

export function toSnakeCase(str) {
    return str
        .replace(/([A-Z])/g, '_$1')
        .replace(/[-\s]+/g, '_')
        .replace(/^_/, '')
        .toLowerCase();
}

export function toKebabCase(str) {
    return toSnakeCase(str).replace(/_/g, '-');
}

export function singularize(name) {
    if (name.endsWith('ies')) return name.slice(0, -3) + 'y';
    if (name.endsWith('ses') || name.endsWith('xes') || name.endsWith('zes')) return name.slice(0, -2);
    if (name.endsWith('s') && !name.endsWith('ss')) return name.slice(0, -1);
    return name;
}

export function entityName(tableName) { return toPascalCase(singularize(tableName)); }
