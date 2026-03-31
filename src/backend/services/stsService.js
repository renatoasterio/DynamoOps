const { STSClient, AssumeRoleCommand } = require('@aws-sdk/client-sts');
const { fromIni } = require('@aws-sdk/credential-providers');
const awsConfig = require('../config/aws');

async function assumeRole({ roleArn, sessionName, region, profile, endpoint }) {
    if (!roleArn) {
        throw new Error('Role ARN is required');
    }

    const stsRegion = region || awsConfig.currentConfig.region || 'us-east-1';
    const stsOpts = { region: stsRegion };

    const stsProfile = profile || awsConfig.currentConfig.profile;
    // Only use fromIni for an explicitly named profile (not 'default').
    // An empty profile or 'default' means: use the SDK's default credential
    // provider chain (env vars → ~/.aws/credentials [default] → IAM metadata),
    // which matches what `aws sts assume-role` does without --profile.
    if (stsProfile && stsProfile !== 'default') {
        try {
            stsOpts.credentials = fromIni({ profile: stsProfile });
        } catch (e) { }
    }

    const stsClient = new STSClient(stsOpts);
    const assumeRoleResult = await stsClient.send(
        new AssumeRoleCommand({
            RoleArn: roleArn,
            RoleSessionName: sessionName || 'dynamo-gui-session',
            DurationSeconds: 3600,
        })
    );

    const creds = assumeRoleResult.Credentials;

    const newConfig = {
        region: stsRegion,
        profile: stsProfile || 'default',
        endpoint: endpoint || awsConfig.currentConfig.endpoint || '',
    };

    awsConfig.setCurrentConfig(newConfig);
    awsConfig.createClients(newConfig, creds);

    awsConfig.setAssumedRoleInfo({
        roleArn,
        sessionName: sessionName || 'dynamo-gui-session',
        expiration: creds.Expiration,
        assumedAt: new Date().toISOString(),
    });

    return { config: newConfig, role: awsConfig.assumedRoleInfo };
}

module.exports = { assumeRole };
