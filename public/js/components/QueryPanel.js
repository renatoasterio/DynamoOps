import { $, $$ } from '../utils/dom.js';
import { state } from '../state/store.js';
import { api } from '../api/apiClient.js';
import { showToast } from '../utils/toast.js';
import { addToHistory } from './HistoryManager.js';
import { getActiveTabConnection } from './TabManager.js';
import { trackRead, fmtCost, fmtCU } from './CostTracker.js';

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
        dom.filterPanel.classList.toggle('hidden', !state.filterOpen);
    });

    dom.runBtn.addEventListener('click', () => executeQuery(false));

    // Pagination controls
    dom.pageFirstBtn?.addEventListener('click', () => goToPage(1));
    dom.pagePrevBtn ?.addEventListener('click', () => goToPage(currentPage - 1));
    dom.pageNextBtn ?.addEventListener('click', () => goToPage(currentPage + 1));

    initModeToggles();
    initSqlAutocomplete();

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

export function populateQueryFields(table) {
    const keySchema = table.KeySchema || [];
    const pk = keySchema.find((k) => k.KeyType === 'HASH');
    const sk = keySchema.find((k) => k.KeyType === 'RANGE');

    dom.queryPkName.value = pk ? pk.AttributeName : '';
    dom.querySkName.value = sk ? sk.AttributeName : '';
    dom.querySkRow.style.display = sk ? 'flex' : 'none';

    dom.queryIndex.innerHTML = '<option value="">Primary Key</option>';
    const gsis = table.GlobalSecondaryIndexes || [];
    gsis.forEach((gsi) => {
        dom.queryIndex.innerHTML += `<option value="${gsi.IndexName}">${gsi.IndexName}</option>`;
    });
    const lsis = table.LocalSecondaryIndexes || [];
    lsis.forEach((lsi) => {
        dom.queryIndex.innerHTML += `<option value="${lsi.IndexName}">${lsi.IndexName} (LSI)</option>`;
    });

    dom.queryIndex.addEventListener('change', () => {
        const indexName = dom.queryIndex.value;
        if (!indexName) {
            dom.queryPkName.value = pk ? pk.AttributeName : '';
            dom.querySkName.value = sk ? sk.AttributeName : '';
            dom.querySkRow.style.display = sk ? 'flex' : 'none';
        } else {
            const allIndexes = [...gsis, ...lsis];
            const idx = allIndexes.find((i) => i.IndexName === indexName);
            if (idx) {
                const idxPk = idx.KeySchema.find((k) => k.KeyType === 'HASH');
                const idxSk = idx.KeySchema.find((k) => k.KeyType === 'RANGE');
                dom.queryPkName.value = idxPk ? idxPk.AttributeName : '';
                dom.querySkName.value = idxSk ? idxSk.AttributeName : '';
                dom.querySkRow.style.display = idxSk ? 'flex' : 'none';
            }
        }
    });

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
        if (last === ',' && /\bSELECT\b/i.test(cleaned) && !/\bFROM\b/i.test(cleaned)) return 'column';
        if (['WHERE', 'AND', 'OR', 'NOT'].includes(last))    return 'column_fn';
        if (last === 'BY')                                    return 'column'; // ORDER BY
        if (last === 'SET')                                   return 'column';
        if (last === ',' && /\bSET\b/i.test(cleaned))        return 'column';
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

        // Tables
        if (context === 'table' || isQuoted) {
            state.tables
                .filter(t => !clean || t.toUpperCase().includes(clean))
                .forEach(t => push(`"${t}"`, 'table'));
        }

        // Columns (PK/SK first, with type hint)
        if (['column', 'column_fn', 'operator'].includes(context) || isQuoted) {
            const keySchema = state.tableInfo?.KeySchema || [];
            const keyNames  = new Set(keySchema.map(k => k.AttributeName));
            const attrDefs  = state.tableInfo?.AttributeDefinitions || [];
            const typeMap   = Object.fromEntries(attrDefs.map(a => [a.AttributeName, a.AttributeType]));

            // Keys first
            state.allColumns
                .filter(c => keyNames.has(c) && (!clean || c.toUpperCase().includes(clean)))
                .forEach(c => push(`"${c}"`, 'key', typeMap[c] || ''));
            // Then regular columns
            state.allColumns
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
            const keySchema = state.tableInfo?.KeySchema || [];
            const keyNames  = new Set(keySchema.map(k => k.AttributeName));
            const attrDefs  = state.tableInfo?.AttributeDefinitions || [];
            const typeMap   = Object.fromEntries(attrDefs.map(a => [a.AttributeName, a.AttributeType]));
            const cols = state.allColumns.map(c => ({
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
    function esc(s) {
        const d = document.createElement('span');
        d.textContent = s;
        return d.innerHTML;
    }
    function highlight(text, query) {
        if (!query) return esc(text);
        const idx = text.toUpperCase().indexOf(query.toUpperCase());
        if (idx < 0) return esc(text);
        return esc(text.slice(0, idx))
             + `<mark class="ac-match">${esc(text.slice(idx, idx + query.length))}</mark>`
             + esc(text.slice(idx + query.length));
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
                ${s.hint ? `<span class="ac-hint">${esc(s.hint)}</span>` : ''}
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
        const quotedM  = before.match(/"[^"]*$|'[^']*$/);
        const plainM   = before.match(/[\w.]+$/);
        const wordStart = quotedM
            ? cursor - quotedM[0].length
            : plainM ? cursor - plainM[0].length : cursor;

        const after          = val.substring(cursor);
        const trailingSpace  = text.endsWith('(') ? '' : ' ';

        ta.value = val.substring(0, wordStart) + text + trailingSpace + after;
        const newCursor = wordStart + text.length + trailingSpace.length;
        ta.setSelectionRange(newCursor, newCursor);

        ta.style.height = 'auto';
        ta.style.height = ta.scrollHeight + 'px';

        hideDropdown();
        ta.focus();
    }

    // ── Main input handler ──────────────────────────────────────────
    function handleInput() {
        if (state.queryMode !== 'sql') return;

        const ta = dom.sqlStatement;
        ta.style.height = 'auto';
        ta.style.height = ta.scrollHeight + 'px';

        const val    = ta.value;
        const cursor = ta.selectionStart;
        const before = val.substring(0, cursor);

        const quotedM    = before.match(/"[^"]*$|'[^']*$/);
        const plainM     = before.match(/[\w.]+$/);
        const word       = quotedM ? quotedM[0] : (plainM ? plainM[0] : '');
        const beforeWord = before.substring(0, before.length - word.length);
        const context    = detectContext(beforeWord);
        const cleanQuery = word.replace(/^["']/, '');

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
    currentPage = n;
    // Ensure cache has entry for this page
    const startKey = pageKeyCache[n - 1] ?? null;
    state.lastEvaluatedKey = startKey;
    await executeQuery(false, startKey);
}

function renderPagination(hasNextPage) {
    const knownPages = pageKeyCache.length; // pages we have keys for
    const totalKnown = hasNextPage ? knownPages + 1 : knownPages;

    if (!dom.paginationControls) return;

    if (totalKnown <= 1 && !hasNextPage) {
        dom.paginationControls.classList.add('hidden');
        return;
    }
    dom.paginationControls.classList.remove('hidden');

    // First / Prev
    if (dom.pageFirstBtn) dom.pageFirstBtn.disabled = currentPage <= 1;
    if (dom.pagePrevBtn)  dom.pagePrevBtn.disabled  = currentPage <= 1;
    if (dom.pageNextBtn)  dom.pageNextBtn.disabled  = !hasNextPage;

    // Page number buttons — show up to 7, with ellipsis
    const lastKnown = hasNextPage ? knownPages : knownPages; // last page we know
    const pages = buildPageRange(currentPage, lastKnown, hasNextPage);

    if (!dom.pageNumbers) return;
    dom.pageNumbers.innerHTML = pages.map(p => {
        if (p === '…') return `<span class="page-ellipsis">…</span>`;
        const isCurrent = p === currentPage;
        const isDisabled = p > knownPages && hasNextPage && p !== currentPage + 1;
        return `<button class="page-num-btn${isCurrent ? ' active' : ''}"
                    data-page="${p}"
                    ${isDisabled ? 'disabled' : ''}
                    >${p}</button>`;
    }).join('');

    dom.pageNumbers.querySelectorAll('.page-num-btn:not(.active):not(:disabled)').forEach(btn => {
        btn.addEventListener('click', () => goToPage(parseInt(btn.dataset.page)));
    });
}

function buildPageRange(current, lastKnown, hasMore) {
    // Always show: 1, ..., current-1, current, current+1, ..., last
    const total = hasMore ? lastKnown + 1 : lastKnown;
    if (total <= 7) {
        return Array.from({ length: total }, (_, i) => i + 1);
    }
    const pages = new Set([1, current - 1, current, current + 1, total].filter(p => p >= 1 && p <= total));
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

            result = await api('POST', `/tables/${state.currentTable}/query`, params, { connection });
            if (!append) addToHistory('query', params);
        } else if (state.queryMode === 'sql') {
            const statement = dom.sqlStatement.value.trim();
            if (!statement) {
                showToast('SQL Statement is required', 'error');
                dom.loadingState.classList.add('hidden');
                dom.dataViewer.classList.remove('hidden');
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

            result = await api('POST', `/tables/${state.currentTable}/scan`, params, { connection });
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
        queryMode: state.queryMode
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

    // Trigger updates
    dom.queryIndex.dispatchEvent(new Event('change'));
    dom.querySkOp.dispatchEvent(new Event('change'));
}
