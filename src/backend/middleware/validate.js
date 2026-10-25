'use strict';

const { badRequest } = require('./errors');

// DynamoDB naming rules for tables and indexes: 3–255 chars of [a-zA-Z0-9_.-]
const RESOURCE_NAME = /^[A-Za-z0-9_.-]{3,255}$/;

// Hard cap per batch request — the UI never sends more than a page of items
const MAX_BATCH_SIZE = 10_000;

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** router.param handler for :name / :gsiName */
function resourceNameParam(_req, _res, next, value, paramName) {
    if (!RESOURCE_NAME.test(value)) return next(badRequest(`Invalid ${paramName}`));
    next();
}

function requireString(value, field) {
    if (typeof value !== 'string' || value.trim() === '') throw badRequest(`${field} is required`);
    return value;
}

function requireObject(value, field) {
    if (!isPlainObject(value) || Object.keys(value).length === 0) throw badRequest(`${field} must be a non-empty object`);
    return value;
}

function requireArray(value, field, { max = MAX_BATCH_SIZE, of } = {}) {
    if (!Array.isArray(value) || value.length === 0) throw badRequest(`${field} must be a non-empty array`);
    if (value.length > max) throw badRequest(`${field} accepts at most ${max} entries`);
    if (of) value.forEach((entry, i) => of(entry, `${field}[${i}]`));
    return value;
}

module.exports = {
    RESOURCE_NAME,
    MAX_BATCH_SIZE,
    isPlainObject,
    resourceNameParam,
    requireString,
    requireObject,
    requireArray,
};
