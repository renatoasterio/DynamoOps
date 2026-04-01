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

module.exports = { requirePlan };
