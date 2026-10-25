'use strict';

const { getLicenseStatus, planMeetsRequirement } = require('../services/licenseService');

function requirePlan(requiredPlan) {
    return async (req, res, next) => {
        const status = await getLicenseStatus();
        if (planMeetsRequirement(status.plan, requiredPlan)) {
            req.license = status;
            return next();
        }
        return res.status(402).json({
            error:       'Plan upgrade required',
            requiredPlan,
            currentPlan: status.plan,
            upgradeUrl:  'https://dynamoops.io/#pricing',
        });
    };
}

/**
 * Applies requirePlan(requiredPlan) only when predicate(req) is true.
 * Used for routes that are free for some payloads and paid for others
 * (e.g. PartiQL: SELECT is free, INSERT/UPDATE/DELETE need Pro).
 */
function requirePlanWhen(predicate, requiredPlan) {
    const gate = requirePlan(requiredPlan);
    return (req, res, next) => {
        let applies = false;
        try { applies = Boolean(predicate(req)); } catch { applies = false; }
        return applies ? gate(req, res, next) : next();
    };
}

module.exports = { requirePlan, requirePlanWhen };
