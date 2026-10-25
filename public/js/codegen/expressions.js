// DynamoDB expression pieces and literal encoders shared by every language
// generator. User input (PartiQL statements, filters, table / attribute names,
// key values) must always go through an encoder so it can't break — or inject
// into — the generated code.

export function buildKeyCondition(ctx) {
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

/** Filter of the current Scan as { expr, names, values }, or null when there is none. */
export function scanFilter(ctx) {
    if (!ctx.filterExpr) return null;
    return { expr: ctx.filterExpr, names: ctx.exprNames || null, values: ctx.exprVals || null };
}

export function toJson(obj) { return JSON.stringify(obj); }

// ─── String literals ──────────────────────────────────────────────────────────

/** "…" — valid double-quoted string in JS, Java, C#, Go and Python. */
export const dq = (s) => JSON.stringify(String(s));

/** JS object key: bare when it is a valid identifier, quoted otherwise (e.g. "created-at"). */
export const jsKey = (name) => (/^[A-Za-z_$][\w$]*$/.test(name) ? name : dq(name));

/** '…' — single-quoted string for Python, Ruby and PHP. */
export const sq = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

/** '…' — POSIX shell argument (a quote becomes '\''). */
export const shellQuote = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;

/** `…` — JS template literal (multi-line PartiQL keeps its line breaks). */
export const jsTemplate = (s) => `\`${String(s).replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${')}\``;

/** @"…" — C# verbatim string (multi-line; quotes are doubled). */
export const csVerbatim = (s) => `@"${String(s).replace(/"/g, '""')}"`;

/** `…` — Go raw string, falling back to "…" when the text contains a backtick. */
export const goRaw = (s) => (String(s).includes('`') ? dq(s) : `\`${s}\``);

/** Plain JS value → Python literal (True / False / None, JSON-style spacing). */
export function pyLiteral(value) {
    if (value === null || value === undefined) return 'None';
    if (value === true) return 'True';
    if (value === false) return 'False';
    if (typeof value === 'number') return String(value);
    if (Array.isArray(value)) return `[${value.map(pyLiteral).join(',')}]`;
    if (typeof value === 'object') return `{${Object.entries(value).map(([k, v]) => `${dq(k)}:${pyLiteral(v)}`).join(',')}}`;
    return dq(value);
}

/** DynamoDB type letter of an expression value. */
export const attrType = (value) => (typeof value === 'number' ? 'N' : typeof value === 'boolean' ? 'BOOL' : 'S');
