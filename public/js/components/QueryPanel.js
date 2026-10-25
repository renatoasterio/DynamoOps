import { $ } from '../utils/dom.js';
import { state, getActiveTabConnection } from '../state/store.js';
import { api, tableApi } from '../api/apiClient.js';
import { showToast } from '../utils/toast.js';
import { addToHistory } from './HistoryManager.js';
import { trackRead, trackWrite, fmtCost, fmtCU } from './CostTracker.js';
import { initSqlEditor, refreshSqlHighlight, sqlStatementKind, showSqlError, clearSqlError } from './SqlEditor.js';
import { escapeHtml } from '../utils/html.js';
import { getPkSk } from '../utils/keySchema.js';

const dom = {
    modeScanBtn: $('#mode-scan-btn'),
    modeQueryBtn: $('#mode-query-btn'),
    modeSqlBtn: $('#mode-sql-btn'),
    filterToggleBtn: $('#filter-toggle-btn'),
    filterPanel: $('#filter-panel'),
    queryFields: $('#query-fields'),
    scanFields: $('#scan-fields'),
    sqlFields: $('#sql-fields'),
    sqlStatement: $('#sql-statement'),
    sqlAutocomplete: $('#sql-autocomplete'),
    queryIndex: $('#query-index'),
    queryPkName: $('#query-pk-name'),
    queryPkValue: $('#query-pk-value'),
    querySkName: $('#query-sk-name'),
    querySkOp: $('#query-sk-op'),
    querySkValue: $('#query-sk-value'),
    querySkValue2: $('#query-sk-value2'),
    querySkValue2Field: $('#query-sk-value2-field'),
    querySkRow: $('#query-sk-row'),
    scanFilterExpr: $('#scan-filter-expr'),
    scanExprNames: $('#scan-expr-names'),
    scanExprValues: $('#scan-expr-values'),
    pageSize: $('#page-size'),
    runBtn: $('#run-btn'),
    loadingState: $('#loading-state'),
    emptyState: $('#empty-data-state'),
    dataViewer: $('#data-viewer'),
    resultInfo: $('#result-info'),
    paginationControls: $('#pagination-controls'),
    pageNumbers: $('#page-numbers'),
    pageFirstBtn: $('#page-first-btn'),
    pagePrevBtn: $('#page-prev-btn'),
    pageNextBtn: $('#page-next-btn')
};

export function initQueryPanel() {
    dom.filterToggleBtn.addEventListener('click', () => {
        state.filterOpen = !state.filterOpen;
        syncFilterPanel();
    });

    // Each tab remembers whether its filters were open. TabManager restores
    // state.filterOpen on switch; the panel itself must follow, otherwise the
    // previous tab's panel stays on screen and the toggle button gets out of
    // step with it. With no tab left, the panel always closes.
    document.addEventListener('tabChanged', (e) => {
        if (!e.detail?.table) state.filterOpen = false;
        syncFilterPanel();
    });

    dom.runBtn.addEventListener('click', () => executeQuery(false));

    // Pagination controls
    dom.pageFirstBtn?.addEventListener('click', () => goToPage(1));
    dom.pagePrevBtn ?.addEventListener('click', () => goToPage(currentPage - 1));
    dom.pageNextBtn ?.addEventListener('click', () => goToPage(currentPage + 1));

    initModeToggles();
    initSqlAutocomplete();
    initSqlEditor({ textarea: dom.sqlStatement });

    dom.querySkOp.addEventListener('change', () => {
        dom.querySkValue2Field.style.display = dom.querySkOp.value === 'between' ? 'flex' : 'none';
    });

    document.addEventListener('loadHistoryEntry', (e) => {
        loadQueryFromHistory(e.detail.entry);
    });

    document.addEventListener('executeQueryRequest', (e) => {
        executeQuery(e.detail ? e.detail.isNextPage : false);
    });

    document.addEventListener('populateQueryFieldsRequest', (e) => {
        populateQueryFields(e.detail.table);
    });

    document.addEventListener('setQueryStateRequest', (e) => {
        setQueryState(e.detail.queryState);
    });

    document.addEventListener('saveTabStateRequest', (e) => {
        if (e.detail.tab) {
            e.detail.tab.queryState = getQueryState();
        }
    });
}

/** Shows/hides the filter panel and marks the toggle button according to state.filterOpen. */
export function syncFilterPanel() {
    dom.filterPanel.classList.toggle('hidden', !state.filterOpen);
    dom.filterToggleBtn.classList.toggle('active', !!state.filterOpen);
    dom.filterToggleBtn.setAttribute('aria-expanded', state.filterOpen ? 'true' : 'false');
}

function showKeyFields(keySchema) {
    const { pk, sk } = getPkSk(keySchema);
    dom.queryPkName.value = pk || '';
    dom.querySkName.value = sk || '';
    dom.querySkRow.style.display = sk ? 'flex' : 'none';
}

export function populateQueryFields(table) {
    const keySchema = table.KeySchema || [];
    showKeyFields(keySchema);

    dom.queryIndex.innerHTML = '<option value="">Primary Key</option>';
    const gsis = table.GlobalSecondaryIndexes || [];
    gsis.forEach((gsi) => {
        dom.queryIndex.innerHTML += `<option value="${escapeHtml(gsi.IndexName)}">${escapeHtml(gsi.IndexName)}</option>`;
    });
    const lsis = table.LocalSecondaryIndexes || [];
    lsis.forEach((lsi) => {
        dom.queryIndex.innerHTML += `<option value="${escapeHtml(lsi.IndexName)}">${escapeHtml(lsi.IndexName)} (LSI)</option>`;
    });

    // onchange (not addEventListener): this runs on every table switch and
    // must replace the previous table's handler instead of stacking another one
    dom.queryIndex.onchange = () => {
        const idx = [...gsis, ...lsis].find((i) => i.IndexName === dom.queryIndex.value);
        showKeyFields(idx ? idx.KeySchema : keySchema);
    };

    // Only seed allColumns from schema when the tab has no data yet.
    // On tab switch the columns are already restored from the tab state — don't overwrite them.
    if (!state.allColumns || state.allColumns.length === 0) {
        state.allColumns = keySchema.map(k => k.AttributeName);
    }
}

function initModeToggles() {
    dom.modeScanBtn.addEventListener('click', () => {
        state.queryMode = 'scan';
        dom.modeScanBtn.classList.add('active');
        dom.modeQueryBtn.classList.remove('active');
        dom.modeSqlBtn.classList.remove('active');
        dom.queryFields.classList.add('hidden');
        dom.scanFields.classList.remove('hidden');
        dom.sqlFields.classList.add('hidden');
    });

    dom.modeQueryBtn.addEventListener('click', () => {
        state.queryMode = 'query';
        dom.modeQueryBtn.classList.add('active');
        dom.modeScanBtn.classList.remove('active');
        dom.modeSqlBtn.classList.remove('active');
        dom.queryFields.classList.remove('hidden');
        dom.scanFields.classList.add('hidden');
        dom.sqlFields.classList.add('hidden');
    });

    dom.modeSqlBtn.addEventListener('click', () => {
        state.queryMode = 'sql';
        dom.modeSqlBtn.classList.add('active');
        dom.modeScanBtn.classList.remove('active');
        dom.modeQueryBtn.classList.remove('active');
        dom.queryFields.classList.add('hidden');
        dom.scanFields.classList.add('hidden');
        dom.sqlFields.classList.remove('hidden');

        if (!dom.sqlStatement.value.trim() && state.currentTable) {
            dom.sqlStatement.value = `SELECT * FROM "${state.currentTable}"`;
        }
        refreshSqlHighlight();
    });
}

function initSqlAutocomplete() {

    // ── PartiQL / DynamoDB vocabulary ──────────────────────────────────
    const VOCAB = {
        dml:      ['SELECT', 'INSERT INTO', 'UPDATE', 'DELETE FROM'],
        clause:   ['FROM', 'WHERE', 'SET', 'VALUE', 'RETURNING'],
        ordering: ['ORDER BY', 'LIMIT', 'ASC', 'DESC'],
        logical:  ['AND', 'OR', 'NOT', 'IN', 'BETWEEN', 'LIKE'],
        null_chk: ['IS NULL', 'IS NOT NULL', 'IS MISSING', 'IS NOT MISSING'],
        fn:       ['attribute_exists', 'attribute_not_exists', 'attribute_type',
                   'begins_with', 'contains', 'size'],
        special:  ['*'],
    };
    const ALL_KEYWORDS = Object.values(VOCAB).flat();
    const COND_OPS = ['=', '<>', '!=', '>', '<', '>=', '<=',
                      'BETWEEN', 'IN', 'LIKE', 'CONTAINS',
                      'IS NULL', 'IS NOT NULL', 'IS MISSING', 'IS NOT MISSING'];

    const ICONS = {
        keyword:  '⌨',
        table:    '🗂',
        key:      '🔑',
        column:   '≡',
        function: 'ƒ',
        operator: '◈',
    };
    const TYPE_LABELS = {
        keyword:  'keyword',
        table:    'table',
        key:      'pk / sk',
        column:   'attr',
        function: 'fn',
        operator: 'op',
    };

    let activeSuggestions = [];
    let selectedIdx = -1;
    let columnInfo = null; // attributes of the statement's target table (set per input)

    // ── Column catalog of the table referenced by FROM / UPDATE / INTO ──
    // Cached per connection + table: { columns, keyNames, typeMap } once loaded,
    // a Promise while describe + sample scan are in flight.
    const columnCache = new Map();

    function targetTable(sql) {
        const m = sql.match(/\b(?:FROM|UPDATE|INTO)\s+"([^"]+)"/i)
               || sql.match(/\b(?:FROM|UPDATE|INTO)\s+([\w.-]+)/i);
        return m ? m[1].split('.')[0] : state.currentTable;
    }

    function buildColumnInfo(tableInfo, attrNames) {
        const keyNames = new Set((tableInfo?.KeySchema || []).map(k => k.AttributeName));
        const typeMap  = Object.fromEntries((tableInfo?.AttributeDefinitions || []).map(a => [a.AttributeName, a.AttributeType]));
        const columns  = [...new Set([...keyNames, ...Object.keys(typeMap), ...attrNames])];
        return { columns, keyNames, typeMap };
    }

    function getColumnInfo(table) {
        if (!table) return null;
        const connection = getActiveTabConnection();
        const cacheKey = `${JSON.stringify(connection || {})}|${table}`;
        const cached = columnCache.get(cacheKey);
        const loaded = cached && !(cached instanceof Promise) ? cached : null;

        // Current table: data already on screen is the freshest source
        if (table === state.currentTable && state.tableInfo) {
            const keyCount = (state.tableInfo.KeySchema || []).length;
            if (state.allColumns.length > keyCount || loaded) {
                return buildColumnInfo(state.tableInfo, [...state.allColumns, ...(loaded?.columns || [])]);
            }
        } else if (loaded) {
            return loaded;
        }

        if (!cached) {
            const load = Promise.all([
                tableApi('GET', '', null, { table, connection }),
                tableApi('POST', '/scan', { limit: 50 }, { table, connection }),
            ]).then(([desc, sample]) => {
                const attrs = (sample.items || []).flatMap(Object.keys);
                columnCache.set(cacheKey, buildColumnInfo(desc.table, attrs));
                if (document.activeElement === dom.sqlStatement) handleInput();
            }).catch(() => columnCache.delete(cacheKey));
            columnCache.set(cacheKey, load);
        }
        // While loading, fall back to whatever is known about the current table
        return table === state.currentTable && state.tableInfo
            ? buildColumnInfo(state.tableInfo, state.allColumns)
            : null;
    }

    // Token under the cursor. A quote only opens a token when it is unbalanced —
    // text after a closing quote (FROM "t" WHERE …) is not inside quotes.
    function currentWord(before) {
        const openQuote = ['"', "'"].find(q => before.split(q).length % 2 === 0);
        if (openQuote) return before.slice(before.lastIndexOf(openQuote));
        const plainM = before.match(/[\w.]+$/);
        return plainM ? plainM[0] : '';
    }

    // ── Context detection ───────────────────────────────────────────
    function detectContext(textBeforeWord) {
        // Strip quoted literals so they don't pollute token analysis
        const cleaned = textBeforeWord.replace(/"[^"]*"|'[^']*'/g, 'TOKEN');
        const tokens  = cleaned.trim().split(/\s+/).filter(Boolean);
        const N       = tokens.length;
        const last    = (tokens[N - 1] || '').toUpperCase();
        const upperTokens = tokens.map(s => s.toUpperCase());

        if (['FROM', 'UPDATE', 'INTO'].includes(last))       return 'table';
        if (last === 'SELECT')                                return 'column';
        if (last.endsWith('('))                               return 'column'; // begins_with( / contains( …
        if (['WHERE', 'AND', 'OR', 'NOT'].includes(last))    return 'column_fn';
        if (last === 'BY')                                    return 'column'; // ORDER BY
        if (last === 'SET')                                   return 'column';
        // Column lists: SELECT a, b … / SET a = 1, … / ORDER BY a, …
        if (last.endsWith(',')) {
            if (/\bSELECT\b/i.test(cleaned) && !/\bFROM\b/i.test(cleaned)) return 'column';
            if (/\b(SET|BY)\b/i.test(cleaned))                             return 'column';
        }
        if (['=', '<>', '!=', '>', '<', '>=', '<=', 'IN', 'BETWEEN'].includes(last)) return 'value';

        // Column name immediately after WHERE / AND / OR → suggest operator
        const condIdx = Math.max(
            upperTokens.lastIndexOf('WHERE'),
            upperTokens.lastIndexOf('AND'),
            upperTokens.lastIndexOf('OR'),
        );
        if (condIdx >= 0 && condIdx === N - 2) return 'operator';

        return 'keyword';
    }

    // ── Build suggestions list ──────────────────────────────────────
    function buildSuggestions(word, context) {
        const isQuoted = word.startsWith('"') || word.startsWith("'");
        const clean    = word.replace(/^["']/, '').toUpperCase();
        const results  = [];
        const seen     = new Set();

        function push(text, type, hint = '') {
            if (!seen.has(text)) { seen.add(text); results.push({ text, type, hint }); }
        }

        function score(text) {
            const t = text.replace(/^"/, '').toUpperCase();
            if (t === clean) return 0;               // exact
            if (t.startsWith(clean)) return 1;       // prefix
            return 2;                                // contains
        }

        // Tables — a quoted token only means a table where a table is expected
        if (context === 'table' || (isQuoted && context === 'keyword')) {
            state.tables
                .filter(t => !clean || t.toUpperCase().includes(clean))
                .forEach(t => push(`"${t}"`, 'table'));
        }

        // Columns (PK/SK first, with type hint)
        if (columnInfo && (['column', 'column_fn', 'operator'].includes(context) || isQuoted)) {
            const { columns, keyNames, typeMap } = columnInfo;

            // Keys first
            columns
                .filter(c => keyNames.has(c) && (!clean || c.toUpperCase().includes(clean)))
                .forEach(c => push(`"${c}"`, 'key', typeMap[c] || ''));
            // Then regular columns
            columns
                .filter(c => !keyNames.has(c) && (!clean || c.toUpperCase().includes(clean)))
                .forEach(c => push(`"${c}"`, 'column', typeMap[c] || ''));
        }

        // Functions
        if (['column_fn', 'keyword'].includes(context) || (!isQuoted && clean)) {
            VOCAB.fn
                .filter(f => !clean || f.toUpperCase().includes(clean))
                .forEach(f => push(`${f}(`, 'function'));
        }

        // Operators
        if (context === 'operator') {
            COND_OPS
                .filter(o => !clean || o.toUpperCase().startsWith(clean))
                .forEach(o => push(o, 'operator'));
        }

        // Keywords (never for quoted tokens)
        if (!isQuoted) {
            ALL_KEYWORDS
                .filter(k => !clean || k.toUpperCase().includes(clean))
                .forEach(k => push(k, 'keyword'));
        }

        results.sort((a, b) => score(a.text) - score(b.text));
        return results.slice(0, 14);
    }

    // ── Contextual defaults (shown when word is empty after trigger) ─
    function getDefaults(context) {
        if (context === 'table') {
            return state.tables.slice(0, 10).map(t => ({ text: `"${t}"`, type: 'table', hint: '' }));
        }
        if (context === 'column' || context === 'column_fn') {
            const { columns = [], keyNames = new Set(), typeMap = {} } = columnInfo || {};
            // Keys first
            const ordered = [...columns.filter(c => keyNames.has(c)), ...columns.filter(c => !keyNames.has(c))];
            const cols = ordered.map(c => ({
                text: `"${c}"`,
                type: keyNames.has(c) ? 'key' : 'column',
                hint: typeMap[c] || '',
            }));
            if (context === 'column_fn') {
                return [...cols, ...VOCAB.fn.map(f => ({ text: `${f}(`, type: 'function', hint: '' }))].slice(0, 14);
            }
            return cols.slice(0, 14);
        }
        if (context === 'operator') {
            return COND_OPS.map(o => ({ text: o, type: 'operator', hint: '' }));
        }
        return [];
    }

    // ── Highlight matched portion ───────────────────────────────────
    function highlight(text, query) {
        if (!query) return escapeHtml(text);
        const idx = text.toUpperCase().indexOf(query.toUpperCase());
        if (idx < 0) return escapeHtml(text);
        return escapeHtml(text.slice(0, idx))
             + `<mark class="ac-match">${escapeHtml(text.slice(idx, idx + query.length))}</mark>`
             + escapeHtml(text.slice(idx + query.length));
    }

    // ── Render dropdown ─────────────────────────────────────────────
    function renderDropdown(suggestions, query) {
        dom.sqlAutocomplete.innerHTML = '';
        activeSuggestions = suggestions;
        selectedIdx = 0;

        suggestions.forEach((s, i) => {
            const li = document.createElement('li');
            li.className = `ac-item${i === 0 ? ' selected' : ''}`;
            li.dataset.idx = i;
            li.innerHTML = `
                <span class="ac-icon ac-icon-${s.type}">${ICONS[s.type] || '•'}</span>
                <span class="ac-text">${highlight(s.text, query)}</span>
                ${s.hint ? `<span class="ac-hint">${escapeHtml(s.hint)}</span>` : ''}
                <span class="ac-badge ac-badge-${s.type}">${TYPE_LABELS[s.type] || s.type}</span>
            `;
            li.addEventListener('mousedown', e => {
                e.preventDefault(); // keep focus on textarea
                insertSuggestion(s.text);
            });
            dom.sqlAutocomplete.appendChild(li);
        });

        dom.sqlAutocomplete.classList.remove('hidden');
    }

    function hideDropdown() {
        dom.sqlAutocomplete.classList.add('hidden');
        selectedIdx = -1;
        activeSuggestions = [];
    }

    // ── Insertion ───────────────────────────────────────────────────
    function insertSuggestion(text) {
        const ta     = dom.sqlStatement;
        const val    = ta.value;
        const cursor = ta.selectionStart;
        const before = val.substring(0, cursor);

        // Find start of current token (quoted or plain)
        const wordStart = cursor - currentWord(before).length;

        const after          = val.substring(cursor);
        const trailingSpace  = text.endsWith('(') ? '' : ' ';

        ta.value = val.substring(0, wordStart) + text + trailingSpace + after;
        const newCursor = wordStart + text.length + trailingSpace.length;
        ta.setSelectionRange(newCursor, newCursor);

        refreshSqlHighlight();

        hideDropdown();
        ta.focus();
    }

    // ── Main input handler ──────────────────────────────────────────
    function handleInput() {
        if (state.queryMode !== 'sql') return;

        const ta = dom.sqlStatement;
        const val    = ta.value;
        const cursor = ta.selectionStart;
        const before = val.substring(0, cursor);

        const word       = currentWord(before);
        // Inside a 'string literal' there is nothing useful to suggest
        if (word.startsWith("'")) { hideDropdown(); return; }
        const beforeWord = before.substring(0, before.length - word.length);
        const context    = detectContext(beforeWord);
        const cleanQuery = word.replace(/^["']/, '');
        columnInfo = context === 'table' ? null : getColumnInfo(targetTable(val));

        const suggestions = word.length === 0
            ? getDefaults(context)
            : buildSuggestions(word, context);

        if (suggestions.length === 0) { hideDropdown(); return; }
        renderDropdown(suggestions, cleanQuery);
    }

    // Space after trigger words → show contextual defaults
    dom.sqlStatement.addEventListener('keyup', e => {
        if (state.queryMode !== 'sql') return;
        if (['ArrowUp', 'ArrowDown', 'Enter', 'Tab', 'Escape'].includes(e.key)) return;
        if (e.key === ' ') handleInput();
    });

    dom.sqlStatement.addEventListener('input', handleInput);

    // ── Keyboard navigation ─────────────────────────────────────────
    dom.sqlStatement.addEventListener('keydown', e => {
        if (dom.sqlAutocomplete.classList.contains('hidden')) return;
        const items = dom.sqlAutocomplete.querySelectorAll('.ac-item');
        if (!items.length) return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            items[selectedIdx]?.classList.remove('selected');
            selectedIdx = (selectedIdx + 1) % items.length;
            items[selectedIdx].classList.add('selected');
            items[selectedIdx].scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            items[selectedIdx]?.classList.remove('selected');
            selectedIdx = (selectedIdx - 1 + items.length) % items.length;
            items[selectedIdx].classList.add('selected');
            items[selectedIdx].scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'Tab' || (e.key === 'Enter' && !dom.sqlAutocomplete.classList.contains('hidden'))) {
            if (selectedIdx >= 0 && activeSuggestions[selectedIdx]) {
                e.preventDefault();
                insertSuggestion(activeSuggestions[selectedIdx].text);
            }
        } else if (e.key === 'Escape') {
            e.stopPropagation();
            hideDropdown();
        }
    });

    dom.sqlStatement.addEventListener('blur', () => setTimeout(hideDropdown, 120));

    document.addEventListener('click', e => {
        if (!dom.sqlStatement.contains(e.target) && !dom.sqlAutocomplete.contains(e.target)) {
            hideDropdown();
        }
    });
}

// ─── SQL mode state ───────────────────────────────────────────────────────────
// Last SELECT that ran in the active tab (saved per tab). After a successful
// INSERT / UPDATE / DELETE it is re-run so the grid shows the effect.
let lastSqlReadStatement = '';
// When set, executeQuery runs this statement instead of the editor content.
let sqlOverrideStatement = null;

function restoreViewAfterAbort() {
    dom.loadingState.classList.add('hidden');
    dom.dataViewer.classList.remove('hidden');
}

// ─── Pagination state ─────────────────────────────────────────────────────────
let currentPage   = 1;
let pageKeyCache  = [null]; // pageKeyCache[0] = null (page 1 has no startKey)
                             // pageKeyCache[n-1] = startKey for page n

function resetPagination() {
    currentPage  = 1;
    pageKeyCache = [null];
}

async function goToPage(n) {
    if (n < 1) return;

    // If we already have the key for page n, go directly
    if (pageKeyCache[n - 1] !== undefined) {
        currentPage = n;
        const startKey = pageKeyCache[n - 1];
        state.lastEvaluatedKey = startKey;
        await executeQuery(false, startKey);
        return;
    }

    // Otherwise, fetch intermediate pages sequentially to build the key chain
    // Start from the last known page key
    const lastKnownIdx = pageKeyCache.length - 1; // index of last cached key
    let startPage = lastKnownIdx + 1;             // the page that key leads to

    if (dom.resultInfo) dom.resultInfo.textContent = `Loading page ${n}…`;

    const limit = parseInt(dom.pageSize?.value) || 50;
    const connection = getActiveTabConnection();
    const endpoint = state.lastQueryEndpoint;
    const baseParams = state.lastQueryParams ? { ...state.lastQueryParams } : {};
    const isSql = endpoint === '/execute-statement';
    const pageKey = isSql ? 'nextToken' : 'exclusiveStartKey';
    const resultKey = isSql ? 'nextToken' : 'lastEvaluatedKey';

    let curKey = pageKeyCache[lastKnownIdx];

    for (let p = startPage; p <= n; p++) {
        const params = { ...baseParams, limit };
        if (curKey) params[pageKey] = curKey;

        try {
            const result = await api('POST', endpoint, params, { connection });
            const nextKey = result[resultKey] || null;

            // Cache this page's next key
            if (nextKey && pageKeyCache[p] === undefined) {
                pageKeyCache[p] = nextKey;
            }

            // If this is the target page, update state and render
            if (p === n) {
                currentPage = n;
                state.items = result.items || [];
                state.allColumns = [...new Set(state.items.flatMap(Object.keys))];
                state.lastEvaluatedKey = nextKey;
                document.dispatchEvent(new CustomEvent('renderDataRequest'));
                renderPagination(!!nextKey);
                if (dom.resultInfo) {
                    dom.resultInfo.textContent = `Page ${currentPage} · ${state.items.length} items`;
                }
                return;
            }

            // Not target yet — cache the key and continue
            curKey = nextKey;
            if (!nextKey) {
                // No more pages — target page doesn't exist
                currentPage = p;
                state.items = result.items || [];
                state.allColumns = [...new Set(state.items.flatMap(Object.keys))];
                state.lastEvaluatedKey = null;
                document.dispatchEvent(new CustomEvent('renderDataRequest'));
                renderPagination(false);
                if (dom.resultInfo) {
                    dom.resultInfo.textContent = `Page ${currentPage} · ${state.items.length} items (last page)`;
                }
                return;
            }
        } catch (err) {
            showToast(`Failed to load page ${p}: ${err.message}`, 'error');
            return;
        }
    }
}

function renderPagination(hasNextPage) {
    const knownPages = pageKeyCache.length; // pages we have keys for

    if (!dom.paginationControls) return;

    if (knownPages <= 1 && !hasNextPage) {
        dom.paginationControls.classList.add('hidden');
        return;
    }
    dom.paginationControls.classList.remove('hidden');

    // First / Prev / Next
    if (dom.pageFirstBtn) dom.pageFirstBtn.disabled = currentPage <= 1;
    if (dom.pagePrevBtn)  dom.pagePrevBtn.disabled  = currentPage <= 1;
    if (dom.pageNextBtn)  dom.pageNextBtn.disabled  = !hasNextPage;

    // Show known pages + a few extra ahead when there are more pages
    const extraAhead = hasNextPage ? 3 : 0;
    const totalVisible = knownPages + extraAhead;
    const pages = buildPageRange(currentPage, totalVisible);

    if (!dom.pageNumbers) return;
    dom.pageNumbers.innerHTML = pages.map(p => {
        if (p === '…') return `<span class="page-ellipsis">…</span>`;
        const isCurrent = p === currentPage;
        return `<button class="page-num-btn${isCurrent ? ' active' : ''}"
                    data-page="${p}">${p}</button>`;
    }).join('');

    dom.pageNumbers.querySelectorAll('.page-num-btn:not(.active)').forEach(btn => {
        btn.addEventListener('click', () => goToPage(parseInt(btn.dataset.page)));
    });
}

function buildPageRange(current, total) {
    if (total <= 7) {
        return Array.from({ length: total }, (_, i) => i + 1);
    }
    const pages = new Set([1, current - 1, current, current + 1, current + 2, total].filter(p => p >= 1 && p <= total));
    const sorted = [...pages].sort((a, b) => a - b);
    const result = [];
    for (let i = 0; i < sorted.length; i++) {
        if (i > 0 && sorted[i] - sorted[i - 1] > 1) result.push('…');
        result.push(sorted[i]);
    }
    return result;
}

// ─────────────────────────────────────────────────────────────────────────────
export async function executeQuery(append = false, forcedStartKey) {
    if (!state.currentTable) return;

    // Capture the tab ID that initiated this query
    const initiatingTabId = state.activeTabId;

    // Reset pagination on fresh query (not a page navigation)
    if (!append && forcedStartKey === undefined) {
        resetPagination();
    }

    dom.loadingState.classList.remove('hidden');
    dom.emptyState.classList.add('hidden');
    dom.dataViewer.classList.add('hidden');

    const limit = parseInt(dom.pageSize.value) || 50;
    const connection = getActiveTabConnection();

    const _t0 = Date.now();
    try {
        let result;

        if (state.queryMode === 'query') {
            const pkName = dom.queryPkName.value;
            const pkVal = dom.queryPkValue.value;
            const skName = dom.querySkName.value;
            const skOp = dom.querySkOp.value;
            const skVal = dom.querySkValue.value;
            const skVal2 = dom.querySkValue2.value;
            const indexName = dom.queryIndex.value;

            if (!pkName || !pkVal) {
                showToast('Partition key value is required for Query', 'error');
                dom.loadingState.classList.add('hidden');
                dom.dataViewer.classList.remove('hidden');
                return;
            }

            const pkParsed = isNaN(pkVal) ? pkVal : Number(pkVal);
            let keyConditionExpression = `#pk = :pkval`;
            const expressionAttributeNames = { '#pk': pkName };
            const expressionAttributeValues = { ':pkval': pkParsed };

            if (skName && skVal) {
                const skParsed = isNaN(skVal) ? skVal : Number(skVal);
                expressionAttributeNames['#sk'] = skName;

                if (skOp === 'begins_with') {
                    keyConditionExpression += ` AND begins_with(#sk, :skval)`;
                    expressionAttributeValues[':skval'] = skParsed;
                } else if (skOp === 'between') {
                    const skParsed2 = isNaN(skVal2) ? skVal2 : Number(skVal2);
                    keyConditionExpression += ` AND #sk BETWEEN :skval AND :skval2`;
                    expressionAttributeValues[':skval'] = skParsed;
                    expressionAttributeValues[':skval2'] = skParsed2;
                } else {
                    keyConditionExpression += ` AND #sk ${skOp} :skval`;
                    expressionAttributeValues[':skval'] = skParsed;
                }
            }

            const params = { keyConditionExpression, expressionAttributeNames, expressionAttributeValues, limit };
            if (indexName) params.indexName = indexName;
            // Save base params for full-table export (no pagination key)
            state.lastQueryEndpoint = `/tables/${state.currentTable}/query`;
            state.lastQueryParams = { ...params };
            const qStartKey = forcedStartKey !== undefined ? forcedStartKey : (append ? state.lastEvaluatedKey : null);
            if (qStartKey) params.exclusiveStartKey = qStartKey;

            result = await tableApi('POST', '/query', params, { connection });
            if (!append) addToHistory('query', params);
        } else if (state.queryMode === 'sql') {
            const statement = (sqlOverrideStatement || dom.sqlStatement.value).trim();
            clearSqlError();
            if (!statement) {
                showToast('SQL Statement is required', 'error');
                restoreViewAfterAbort();
                return;
            }

            const { kind, verb } = sqlStatementKind(statement);
            if (kind === 'write') {
                // INSERT / UPDATE / DELETE modify data: confirm, run, then refresh the grid
                // by re-running the last SELECT of this tab (if any).
                const ok = confirm(`${verb} modifies data in "${state.currentTable}".\n\nRun this statement?`);
                if (!ok) { restoreViewAfterAbort(); return; }

                const writeResult = await api('POST', `/execute-statement`, { statement }, { connection });
                addToHistory('sql', { statement });
                const { wcu, cost } = trackWrite(state.currentTable, writeResult.consumedCapacity, 'partiql', Date.now() - _t0, 1);
                showToast(`${verb} executed${wcu > 0 ? ` · ${fmtCU(wcu)} WCU · ${fmtCost(cost)}` : ''}`, 'success');

                if (state.activeTabId !== initiatingTabId) return;
                if (lastSqlReadStatement) {
                    sqlOverrideStatement = lastSqlReadStatement;
                    try { await executeQuery(false); } finally { sqlOverrideStatement = null; }
                } else {
                    restoreViewAfterAbort();
                    dom.resultInfo.textContent = `${verb} executed · run a SELECT to see the data`;
                }
                return;
            }

            const params = { statement };
            // Save base params for full-table export (no pagination token)
            state.lastQueryEndpoint = `/execute-statement`;
            state.lastQueryParams = { statement };
            if (append && state.nextToken) {
                params.nextToken = state.nextToken;
            }

            result = await api('POST', `/execute-statement`, params, { connection });
            if (!append) addToHistory('sql', params);
            // Only update pagination state if still on the same tab
            if (state.activeTabId === initiatingTabId) {
                lastSqlReadStatement = statement;
                state.nextToken = result.nextToken || null;
                state.lastEvaluatedKey = state.nextToken; 
            }
        } else {
            const params = { limit };

            const filterExpr = dom.scanFilterExpr.value.trim();
            if (filterExpr) {
                params.filterExpression = filterExpr;
                const names = dom.scanExprNames.value.trim();
                const values = dom.scanExprValues.value.trim();
                if (names) {
                    try { params.expressionAttributeNames = JSON.parse(names); }
                    catch { showToast('Invalid JSON in Expression Attribute Names', 'error'); }
                }
                if (values) {
                    try { params.expressionAttributeValues = JSON.parse(values); }
                    catch { showToast('Invalid JSON in Expression Attribute Values', 'error'); }
                }
            }

            // Save base params for full-table export (no pagination key)
            state.lastQueryEndpoint = `/tables/${state.currentTable}/scan`;
            state.lastQueryParams = { ...params };
            const startKey = forcedStartKey !== undefined ? forcedStartKey : (append ? state.lastEvaluatedKey : null);
            if (startKey) params.exclusiveStartKey = startKey;

            result = await tableApi('POST', '/scan', params, { connection });
            if (!append) addToHistory('scan', params);
        }

        // --- CRITICAL: Check if tab is still active before updating records ---
        if (state.activeTabId !== initiatingTabId) {
            console.warn(`Query finished for tab ${initiatingTabId}, but tab ${state.activeTabId} is now active. Discarding results.`);
            // Note: We still might want to save these results to the background tab's items list
            const backgroundTab = state.tabs.find(t => t.id === initiatingTabId);
            if (backgroundTab) {
                if (append) backgroundTab.items = backgroundTab.items.concat(result.items);
                else backgroundTab.items = result.items;
                backgroundTab.lastKey = result.lastEvaluatedKey;
            }
            return;
        }

        if (append) {
            state.items = state.items.concat(result.items);
        } else {
            state.items = result.items;
        }
        
        if (state.queryMode !== 'sql') {
            state.lastEvaluatedKey = result.lastEvaluatedKey;
        }

        // Robust column discovery
        const currentCols = new Set(state.allColumns);
        state.items.forEach(item => {
            Object.keys(item).forEach(key => currentCols.add(key));
        });
        
        // Update state.allColumns
        state.allColumns = Array.from(currentCols);
        
        sortColumns();

        // Sync back to TabManager's internal tab state if active
        document.dispatchEvent(new CustomEvent('updateTabColumns', { 
            detail: { table: state.currentTable, columns: state.allColumns } 
        }));

        dom.loadingState.classList.add('hidden');

        if (state.items.length === 0) {
            dom.emptyState.classList.remove('hidden');
            dom.dataViewer.classList.add('hidden');
        } else {
            dom.emptyState.classList.add('hidden');
            dom.dataViewer.classList.remove('hidden');
            document.dispatchEvent(new CustomEvent('renderDataRequest'));
        }

        const hasNextPage = !!state.lastEvaluatedKey;

        // Cache the next page's start key so we can navigate to it
        if (hasNextPage && pageKeyCache.length < currentPage) {
            pageKeyCache.push(state.lastEvaluatedKey);
        } else if (hasNextPage && pageKeyCache[currentPage] === undefined) {
            pageKeyCache[currentPage] = state.lastEvaluatedKey;
        }

        const _durationMs = Date.now() - _t0;
        const _opType = state.queryMode === 'sql' ? 'partiql' : state.queryMode;
        const { rcu, cost } = trackRead(state.currentTable, result.consumedCapacity, _opType, _durationMs, result.items?.length ?? 0);

        const _costStr = rcu > 0 ? ` · ⚡ ${fmtCU(rcu)} RCU · 💰 ${fmtCost(cost)} · ⏱ ${_durationMs}ms` : ` · ⏱ ${_durationMs}ms`;
        dom.resultInfo.textContent = `Page ${currentPage} · ${state.items.length} items` +
            (result.scannedCount ? ` (${result.scannedCount} scanned)` : '') + _costStr;

        renderPagination(hasNextPage);
    } catch (err) {
        if (state.activeTabId === initiatingTabId) {
            dom.loadingState.classList.add('hidden');
            dom.dataViewer.classList.remove('hidden');
            if (state.queryMode === 'sql') showSqlError(err.message);
            showToast(`Query error: ${err.message}`, 'error');
        }
    }
}

function sortColumns() {
    if (!state.tableInfo) return;
    const keySchema = state.tableInfo.KeySchema || [];
    const keyNames = keySchema.map((k) => k.AttributeName);
    state.allColumns.sort((a, b) => {
        const aKey = keyNames.indexOf(a);
        const bKey = keyNames.indexOf(b);
        if (aKey !== -1 && bKey !== -1) return aKey - bKey;
        if (aKey !== -1) return -1;
        if (bKey !== -1) return 1;
        return a.localeCompare(b);
    });
}

export function loadQueryFromHistory(entry) {
    const { type, params } = entry;
    
    // Switch to correct tab
    if (type === 'scan') dom.modeScanBtn.click();
    else if (type === 'query') dom.modeQueryBtn.click();
    else if (type === 'sql') dom.modeSqlBtn.click();

    if (type === 'sql') {
        dom.sqlStatement.value = params.statement;
        refreshSqlHighlight();
    } else if (type === 'query') {
        dom.queryPkValue.value = params.expressionAttributeValues[':pkval'];
        
        if (params.indexName) dom.queryIndex.value = params.indexName;
        else dom.queryIndex.value = '';
        
        // Trigger index change manually
        dom.queryIndex.dispatchEvent(new Event('change'));

        // Map sk operations
        if (params.keyConditionExpression.includes('BETWEEN')) {
            dom.querySkOp.value = 'between';
            dom.querySkValue.value = params.expressionAttributeValues[':skval'];
            dom.querySkValue2.value = params.expressionAttributeValues[':skval2'];
        } else if (params.keyConditionExpression.includes('begins_with')) {
            dom.querySkOp.value = 'begins_with';
            dom.querySkValue.value = params.expressionAttributeValues[':skval'];
        } else if (params.keyConditionExpression.includes('=')) {
            dom.querySkOp.value = '=';
            dom.querySkValue.value = params.expressionAttributeValues[':skval'];
        } else if (params.keyConditionExpression.includes('>=')) {
            dom.querySkOp.value = '>=';
            dom.querySkValue.value = params.expressionAttributeValues[':skval'];
        } else if (params.keyConditionExpression.includes('<=')) {
            dom.querySkOp.value = '<=';
            dom.querySkValue.value = params.expressionAttributeValues[':skval'];
        } else if (params.keyConditionExpression.includes('>')) {
            dom.querySkOp.value = '>';
            dom.querySkValue.value = params.expressionAttributeValues[':skval'];
        } else if (params.keyConditionExpression.includes('<')) {
            dom.querySkOp.value = '<';
            dom.querySkValue.value = params.expressionAttributeValues[':skval'];
        }

        dom.querySkOp.dispatchEvent(new Event('change'));
    } else if (type === 'scan') {
        dom.scanFilterExpr.value = params.filterExpression || '';
        dom.scanExprNames.value = params.expressionAttributeNames ? JSON.stringify(params.expressionAttributeNames) : '';
        dom.scanExprValues.value = params.expressionAttributeValues ? JSON.stringify(params.expressionAttributeValues) : '';
    }

    showToast(`Loaded query for ${entry.table}`, 'success');
}

export function getQueryState() {
    return {
        pkValue: dom.queryPkValue.value,
        skOp: dom.querySkOp.value,
        skValue: dom.querySkValue.value,
        skValue2: dom.querySkValue2.value,
        index: dom.queryIndex.value,
        scanFilterExpr: dom.scanFilterExpr.value,
        scanExprNames: dom.scanExprNames.value,
        scanExprValues: dom.scanExprValues.value,
        sqlStatement: dom.sqlStatement.value,
        lastSqlReadStatement,
        queryMode: state.queryMode,
        // Pagination state — saved per tab
        currentPage,
        pageKeyCache: [...pageKeyCache],
    };
}

export function setQueryState(q) {
    // When q is falsy, clear all fields to avoid leaking filters between tabs
    const s = q || {};

    // Switch mode first to ensure fields are visible for events
    if (s.queryMode === 'scan') dom.modeScanBtn.click();
    else if (s.queryMode === 'query') dom.modeQueryBtn.click();
    else if (s.queryMode === 'sql') dom.modeSqlBtn.click();

    dom.queryPkValue.value = s.pkValue || '';
    dom.querySkOp.value = s.skOp || '=';
    dom.querySkValue.value = s.skValue || '';
    dom.querySkValue2.value = s.skValue2 || '';
    dom.queryIndex.value = s.index || '';

    dom.scanFilterExpr.value = s.scanFilterExpr || '';
    dom.scanExprNames.value = s.scanExprNames || '';
    dom.scanExprValues.value = s.scanExprValues || '';

    dom.sqlStatement.value = s.sqlStatement || '';
    lastSqlReadStatement = s.lastSqlReadStatement || '';
    refreshSqlHighlight();

    // Restore pagination state per tab
    currentPage  = s.currentPage || 1;
    pageKeyCache = Array.isArray(s.pageKeyCache) ? [...s.pageKeyCache] : [null];

    // Re-render pagination UI
    const hasNextPage = !!state.lastEvaluatedKey;
    renderPagination(hasNextPage);

    // Update result info
    if (state.items?.length && dom.resultInfo) {
        dom.resultInfo.textContent = `Page ${currentPage} · ${state.items.length} items`;
    } else if (dom.resultInfo) {
        dom.resultInfo.textContent = '';
    }

    // Trigger updates
    dom.queryIndex.dispatchEvent(new Event('change'));
    dom.querySkOp.dispatchEvent(new Event('change'));
}
