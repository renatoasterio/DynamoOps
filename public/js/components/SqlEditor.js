// SqlEditor.js — PartiQL editor enhancements for the SQL query mode:
// syntax highlighting (overlay), statement templates, formatter, inline
// errors, statement-kind pill (read vs write) and small editing helpers.
import { $ } from '../utils/dom.js';
import { state } from '../state/store.js';

// ─── Vocabulary ──────────────────────────────────────────────────────────────
const KEYWORDS = new Set([
    'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'BETWEEN', 'LIKE', 'IS', 'NULL',
    'MISSING', 'ORDER', 'BY', 'ASC', 'DESC', 'LIMIT', 'INSERT', 'INTO', 'VALUE', 'UPDATE',
    'SET', 'REMOVE', 'DELETE', 'RETURNING', 'ALL', 'OLD', 'NEW', 'TRUE', 'FALSE', 'AS',
    'EXISTS', 'NONE', 'DISTINCT',
]);
const FUNCTIONS = new Set([
    'attribute_exists', 'attribute_not_exists', 'attribute_type', 'begins_with',
    'contains', 'size', 'list_append', 'if_not_exists',
]);
// Clauses that start a new line when formatting
const LINE_CLAUSES = new Set(['FROM', 'WHERE', 'SET', 'REMOVE', 'VALUE', 'RETURNING', 'LIMIT', 'ORDER']);

const TOKEN_RE = /(--[^\n]*)|('(?:[^'\\]|\\.)*'?)|("(?:[^"\\]|\\.)*"?)|(\b\d+(?:\.\d+)?\b)|(\b[A-Za-z_]\w*\b)|(<>|!=|>=|<=|[=<>])|([(){}\[\],.;*?:])|(\s+)|(.)/g;

function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}

// ─── Statement kind ──────────────────────────────────────────────────────────
/** @returns {{kind: 'read'|'write'|'unknown', verb: string}} */
export function sqlStatementKind(sql) {
    const s = String(sql || '').replace(/^(?:\s+|--[^\n]*\n?)+/, '');
    const m = s.match(/^([A-Za-z]+)/);
    const verb = (m ? m[1] : '').toUpperCase();
    if (verb === 'SELECT') return { kind: 'read', verb };
    if (verb === 'INSERT' || verb === 'UPDATE' || verb === 'DELETE') return { kind: 'write', verb };
    return { kind: 'unknown', verb };
}

// ─── Highlighting ────────────────────────────────────────────────────────────
export function highlightPartiQL(sql) {
    let out = '';
    String(sql || '').replace(TOKEN_RE, (m, comment, sq, dq, num, word, op) => {
        if (comment)      out += `<span class="sql-tk-comment">${esc(m)}</span>`;
        else if (sq)      out += `<span class="sql-tk-string">${esc(m)}</span>`;
        else if (dq)      out += `<span class="sql-tk-ident">${esc(m)}</span>`;
        else if (num)     out += `<span class="sql-tk-number">${esc(m)}</span>`;
        else if (word) {
            if (FUNCTIONS.has(m.toLowerCase()))      out += `<span class="sql-tk-fn">${esc(m)}</span>`;
            else if (KEYWORDS.has(m.toUpperCase()))  out += `<span class="sql-tk-kw">${esc(m)}</span>`;
            else                                     out += esc(m);
        }
        else if (op)      out += `<span class="sql-tk-op">${esc(m)}</span>`;
        else              out += esc(m);
        return m;
    });
    return out;
}

// ─── Formatter ───────────────────────────────────────────────────────────────
/** Uppercases keywords and puts each major clause on its own line. Strings/identifiers untouched. */
export function formatPartiQL(sql) {
    const tokens = [];
    String(sql || '').replace(TOKEN_RE, (m, comment, sq, dq, num, word, op, punct, ws) => {
        if (ws) return m;
        if (comment) tokens.push({ t: 'comment', v: m });
        else if (sq || dq || num) tokens.push({ t: 'lit', v: m });
        else if (word) {
            if (FUNCTIONS.has(m.toLowerCase()))      tokens.push({ t: 'fn', v: m.toLowerCase() });
            else if (KEYWORDS.has(m.toUpperCase()))  tokens.push({ t: 'kw', v: m.toUpperCase() });
            else                                     tokens.push({ t: 'word', v: m });
        }
        else if (op) tokens.push({ t: 'op', v: m });
        else tokens.push({ t: 'punct', v: m });
        return m;
    });

    let out = '';
    let depth = 0; // inside (...) / {...} / [...] we never break lines
    const NO_SPACE_BEFORE = new Set([',', ')', ']', '}', '.', ';']);
    const NO_SPACE_AFTER  = new Set(['(', '[', '{', '.']);

    tokens.forEach((tok, i) => {
        const prev = tokens[i - 1];
        const v = tok.v;
        if (tok.t === 'comment') { out += (out ? '\n' : '') + v + '\n'; return; }

        const opens  = tok.t === 'punct' && (v === '(' || v === '[' || v === '{');
        const closes = tok.t === 'punct' && (v === ')' || v === ']' || v === '}');
        if (closes) depth = Math.max(0, depth - 1);

        let sep = '';
        if (out && !out.endsWith('\n')) {
            if (depth === 0 && tok.t === 'kw' && LINE_CLAUSES.has(v) && !(v === 'ORDER' && prev?.v === 'ORDER')) {
                sep = '\n';
            } else if (depth === 0 && tok.t === 'kw' && (v === 'AND' || v === 'OR')) {
                sep = '\n  ';
            } else if (NO_SPACE_BEFORE.has(v) || (prev && (NO_SPACE_AFTER.has(prev.v) || prev.t === 'fn'))) {
                sep = '';
            } else {
                sep = ' ';
            }
        }
        out += sep + v;
        if (opens) depth += 1;
    });
    return out.trim();
}

// ─── Templates ───────────────────────────────────────────────────────────────
export function buildSqlTemplates() {
    const t  = state.currentTable || 'table_name';
    const ks = state.tableInfo?.KeySchema || [];
    const pk = ks.find((k) => k.KeyType === 'HASH')?.AttributeName || 'pk';
    const sk = ks.find((k) => k.KeyType === 'RANGE')?.AttributeName || null;
    const q  = (n) => `"${n}"`;
    const keyCond = `${q(pk)} = 'value'` + (sk ? `\n  AND ${q(sk)} = 'value'` : '');

    const items = [
        { group: 'Read',  label: 'Select all',                     sql: `SELECT * FROM ${q(t)}` },
        { group: 'Read',  label: `By partition key (${pk})`,       sql: `SELECT * FROM ${q(t)}\nWHERE ${q(pk)} = 'value'` },
        sk && { group: 'Read', label: `Sort key prefix (${sk})`,   sql: `SELECT * FROM ${q(t)}\nWHERE ${q(pk)} = 'value'\n  AND begins_with(${q(sk)}, 'prefix')` },
        sk && { group: 'Read', label: `Sort key range (${sk})`,    sql: `SELECT * FROM ${q(t)}\nWHERE ${q(pk)} = 'value'\n  AND ${q(sk)} BETWEEN 'from' AND 'to'` },
        { group: 'Read',  label: 'Filter: contains',               sql: `SELECT * FROM ${q(t)}\nWHERE contains("attribute", 'text')` },
        { group: 'Read',  label: 'Filter: attribute exists / missing', sql: `SELECT * FROM ${q(t)}\nWHERE attribute_exists("attribute")\n  AND "other" IS MISSING` },
        { group: 'Read',  label: 'Filter: value in list',          sql: `SELECT * FROM ${q(t)}\nWHERE "status" IN ['active', 'pending']` },
        { group: 'Read',  label: 'Pick columns',                   sql: `SELECT ${q(pk)}${sk ? `, ${q(sk)}` : ''}, "attribute" FROM ${q(t)}` },
    ];

    (state.tableInfo?.GlobalSecondaryIndexes || []).forEach((g) => {
        const gpk = g.KeySchema?.find((k) => k.KeyType === 'HASH')?.AttributeName;
        const gsk = g.KeySchema?.find((k) => k.KeyType === 'RANGE')?.AttributeName;
        if (!gpk) return;
        items.push({
            group: 'Index',
            label: `Query index ${g.IndexName}`,
            sql: `SELECT * FROM ${q(t)}.${q(g.IndexName)}\nWHERE ${q(gpk)} = 'value'` + (gsk ? `\n  AND ${q(gsk)} = 'value'` : ''),
        });
    });

    items.push(
        { group: 'Write', label: 'Insert item',      sql: `INSERT INTO ${q(t)}\nVALUE {'${pk}': 'value'${sk ? `, '${sk}': 'value'` : ''}, 'attribute': 'data'}` },
        { group: 'Write', label: 'Update attribute', sql: `UPDATE ${q(t)}\nSET "attribute" = 'new value'\nWHERE ${keyCond}` },
        { group: 'Write', label: 'Remove attribute', sql: `UPDATE ${q(t)}\nREMOVE "attribute"\nWHERE ${keyCond}` },
        { group: 'Write', label: 'Delete item',      sql: `DELETE FROM ${q(t)}\nWHERE ${keyCond}` },
    );
    return items.filter(Boolean);
}

// ─── Editor wiring ───────────────────────────────────────────────────────────
const ui = {
    ta: null, code: null, pre: null, pill: null, error: null,
    templatesBtn: null, templatesMenu: null, formatBtn: null, clearBtn: null,
};

function autosize(ta) {
    ta.style.height = 'auto';
    ta.style.height = ta.scrollHeight + 'px';
}

/** Re-renders the highlight layer from the textarea content (call after programmatic changes). */
export function refreshSqlHighlight() {
    const { ta, code, pre } = ui;
    if (!ta || !code) return;
    autosize(ta);
    // A trailing newline needs an extra character so the last empty line keeps its height
    code.innerHTML = highlightPartiQL(ta.value) + (ta.value.endsWith('\n') ? ' ' : '');
    if (pre) pre.scrollTop = ta.scrollTop;
    updateKindPill();
}

function updateKindPill() {
    const { ta, pill } = ui;
    if (!ta || !pill) return;
    const { kind, verb } = sqlStatementKind(ta.value);
    if (kind === 'unknown') { pill.classList.add('hidden'); return; }
    pill.classList.remove('hidden');
    pill.className = `sql-kind-pill sql-kind-${kind}`;
    pill.textContent = kind === 'write' ? `${verb} · writes data` : `${verb} · read`;
    pill.title = kind === 'write'
        ? 'This statement modifies the table (Pro plan). You will be asked to confirm before it runs.'
        : 'Read-only statement';
}

export function showSqlError(message) {
    if (!ui.error) return;
    ui.error.textContent = message;
    ui.error.classList.remove('hidden');
}

export function clearSqlError() {
    ui.error?.classList.add('hidden');
}

function selectPlaceholder(ta) {
    // Put the caret on the first value placeholder so the user can type right away
    const m = ta.value.match(/'(value|prefix|from|to|text|new value|data)'/);
    if (m) {
        ta.setSelectionRange(m.index + 1, m.index + 1 + m[1].length);
    } else {
        ta.setSelectionRange(ta.value.length, ta.value.length);
    }
}

function renderTemplatesMenu() {
    const menu = ui.templatesMenu;
    if (!menu) return;
    const items = buildSqlTemplates();
    let lastGroup = null;
    menu.innerHTML = '';
    items.forEach((it) => {
        if (it.group !== lastGroup) {
            const h = document.createElement('li');
            h.className = 'sql-tpl-group';
            h.textContent = it.group;
            menu.appendChild(h);
            lastGroup = it.group;
        }
        const li = document.createElement('li');
        li.className = `sql-tpl-item${it.group === 'Write' ? ' sql-tpl-write' : ''}`;
        li.innerHTML = `<span class="sql-tpl-label">${esc(it.label)}</span><code class="sql-tpl-preview">${esc(it.sql.split('\n')[0])}${it.sql.includes('\n') ? ' …' : ''}</code>`;
        li.addEventListener('mousedown', (e) => {
            e.preventDefault();
            ui.ta.value = it.sql;
            refreshSqlHighlight();
            clearSqlError();
            closeTemplates();
            ui.ta.focus();
            selectPlaceholder(ui.ta);
        });
        menu.appendChild(li);
    });
}

function openTemplates() {
    renderTemplatesMenu();
    ui.templatesMenu.classList.remove('hidden');
    ui.templatesBtn.classList.add('active');
}
function closeTemplates() {
    ui.templatesMenu?.classList.add('hidden');
    ui.templatesBtn?.classList.remove('active');
}

export function initSqlEditor({ textarea } = {}) {
    ui.ta           = textarea || $('#sql-statement');
    ui.code         = $('#sql-highlight-code');
    ui.pre          = $('#sql-highlight');
    ui.pill         = $('#sql-kind-pill');
    ui.error        = $('#sql-error');
    ui.templatesBtn = $('#sql-templates-btn');
    ui.templatesMenu = $('#sql-templates-menu');
    ui.formatBtn    = $('#sql-format-btn');
    ui.clearBtn     = $('#sql-clear-btn');
    if (!ui.ta) return;

    const modKey = $('#sql-mod-key');
    if (modKey) modKey.textContent = /Mac/i.test(navigator.platform || '') ? '⌘' : 'Ctrl';

    ui.ta.addEventListener('input', () => { refreshSqlHighlight(); clearSqlError(); });
    ui.ta.addEventListener('scroll', () => { if (ui.pre) ui.pre.scrollTop = ui.ta.scrollTop; });

    // Tab inserts two spaces (when the autocomplete dropdown is not open)
    ui.ta.addEventListener('keydown', (e) => {
        if (e.key !== 'Tab') return;
        const ac = $('#sql-autocomplete');
        if (ac && !ac.classList.contains('hidden')) return;
        e.preventDefault();
        const { selectionStart: s, selectionEnd: en, value } = ui.ta;
        ui.ta.value = value.slice(0, s) + '  ' + value.slice(en);
        ui.ta.setSelectionRange(s + 2, s + 2);
        refreshSqlHighlight();
    });

    ui.templatesBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (ui.templatesMenu.classList.contains('hidden')) openTemplates(); else closeTemplates();
    });
    document.addEventListener('click', (e) => {
        if (ui.templatesMenu && !ui.templatesMenu.contains(e.target) && e.target !== ui.templatesBtn) closeTemplates();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeTemplates(); });

    ui.formatBtn?.addEventListener('click', () => {
        ui.ta.value = formatPartiQL(ui.ta.value);
        refreshSqlHighlight();
        ui.ta.focus();
    });
    ui.clearBtn?.addEventListener('click', () => {
        ui.ta.value = '';
        refreshSqlHighlight();
        clearSqlError();
        ui.ta.focus();
    });

    refreshSqlHighlight();
}
