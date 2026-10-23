'use strict';

/**
 * Classifies a PartiQL statement by its leading verb (comments and whitespace
 * skipped). Used to apply plan gating: SELECT is free, INSERT/UPDATE/DELETE
 * modify data and require the Pro plan — same rule as the item CRUD routes.
 */
function statementVerb(statement) {
    const s = String(statement || '').replace(/^(?:\s+|--[^\n]*\n?)+/, '');
    const m = s.match(/^([A-Za-z]+)/);
    return (m ? m[1] : '').toUpperCase();
}

function isWriteStatement(statement) {
    const verb = statementVerb(statement);
    return verb === 'INSERT' || verb === 'UPDATE' || verb === 'DELETE';
}

module.exports = { statementVerb, isWriteStatement };
