/**
 * Licensed Materials - Property of IBM
 * (c) Copyright IBM Corporation 2025. All Rights Reserved.
 *
 * Note to U.S. Government Users Restricted Rights:
 * Use, duplication or disclosure restricted by GSA ADP Schedule
 * Contract with IBM Corp.
 */
'use strict';

import { exit } from 'node:process';
import { Command } from 'commander';
import { parseEnvVar, decomposeCrn, isSecretReference, promptUserSelection, promptUserYesNo, promptUserInput } from './utils/utils.js';
import { logger, LOG_STAGES } from './utils/logger.js';
import { getBearerToken, getToolchain, getToolchainTools, getPipelineData, getSmInstances, createTool, getAccountId, getResourceGroups, migrateToolchainSecrets } from './utils/requests.js';
import { SECRET_KEYS_MAP } from '../config.js';

const CLOUD_PLATFORM = process.env['IBMCLOUD_PLATFORM_DOMAIN'] || 'cloud.ibm.com';

const command = new Command('export-secrets')
    .description('Exports Toolchain stored secrets to a Secrets Manager instance')
    .requiredOption('-c, --toolchain-crn <crn>', 'The CRN of the toolchain to check')
    .option('-a, --apikey <api_key>', 'API key used to authenticate. Must have IAM permission to read toolchains and create secrets in Secrets Manager')
    .option('--check', '(Optional) Checks and lists any stored secrets in your toolchain')
    .option('-v, --verbose', '(Optional) Increase log output')
    .showHelpAfterError()
    .hook('preAction', cmd => cmd.showHelpAfterError(false)) // only show help during validation
    .action(main);

async function main(options) {
    const toolchainCrn = options.toolchainCrn;
    const verbosity = options.verbose ? 2 : 1;
    const runMigration = !options.check;

    logger.setVerbosity(verbosity);

    let apiKey;
    let bearer;
    let accountId;
    let toolchainId;
    let region;
    let toolchainData;
    let tools;

    try {
        const toolResults = [];
        const pipelineResults = [];

        apiKey = options.apikey || parseEnvVar('IBMCLOUD_API_KEY');
        if (!apiKey) {
            logger.error('Missing IBM Cloud IAM API key', LOG_STAGES.setup);
            exit(1);
        };

        try {
            const decomposedCrn = decomposeCrn(toolchainCrn);
            toolchainId = decomposedCrn.serviceInstance;
            region = decomposedCrn.location;
        } catch (e) {
            throw Error('Provided toolchain CRN is invalid');
        }

        // Display toolchain data to user
        const getToolchainData = async () => {
            bearer = await getBearerToken(apiKey);
            toolchainData = await getToolchain(bearer, toolchainId, region);
        }
        await logger.withSpinner(getToolchainData, `Reading Toolchain`, 'Valid Toolchain found!');
        logger.print(`Name: ${toolchainData.name}\nRegion: ${region}\nResource Group ID: ${toolchainData.resource_group_id}\nURL:https://${CLOUD_PLATFORM}/devops/toolchains/${toolchainId}?env_id=ibm:yp:${region}\n`);

        // Check for plain-text secrets in all tools
        const exportSecrets = async () => {
            const getToolsRes = await getToolchainTools(bearer, toolchainId, region);
            tools = getToolsRes.tools;

            if (tools.length > 0) {
                for (let i = 0; i < tools.length; i++) {
                    const tool = tools[i];
                    const toolUrl = `https://${CLOUD_PLATFORM}/devops/toolchains/${tool.toolchain_id}/configure/${tool.id}?env_id=ibm:yp:${region}`;
                    const toolName = (tool.name || tool.parameters?.name || tool.parameters?.label || '').replace(/\s+/g, '+');

                    // Skip iff it's GitHub/GitLab/GRIT integration with OAuth
                    if (['githubconsolidated', 'github_integrated', 'gitlab', 'hostedgit'].includes(tool.tool_type_id) && (tool.parameters?.auth_type === '' || tool.parameters?.auth_type === 'oauth'))
                        continue;

                    // Check tool integrations for any plain text secret values
                    if (SECRET_KEYS_MAP[tool.tool_type_id]) {
                        SECRET_KEYS_MAP[tool.tool_type_id].forEach((entry) => {
                            const updateableSecretParam = entry.key;
                            if (tool.parameters[updateableSecretParam] && !isSecretReference(tool.parameters[updateableSecretParam]) && tool.parameters[updateableSecretParam].length > 0) {
                                toolResults.push({
                                    'Tool ID': tool.id,
                                    'Tool Name': toolName,
                                    'Tool Type': tool.tool_type_id,
                                    'Property Name': updateableSecretParam,
                                    'Url': toolUrl
                                });
                            };
                        });
                    };

                    // For tekton pipelines, check for any plain text secret properties
                    if (tool.tool_type_id === 'pipeline' && tool.parameters?.type === 'tekton') {
                        const pipelineBaseUrl = `https://${CLOUD_PLATFORM}/devops/pipelines/tekton/${tool.id}`
                        const pipelineData = await getPipelineData(bearer, tool.id, region);

                        pipelineData?.properties.forEach((prop) => {
                            if (prop.type === 'secure' && !isSecretReference(prop.value) && prop.value.length > 0) {
                                pipelineResults.push({
                                    'Pipeline ID': pipelineData.id,
                                    'Pipeline Name': toolName,
                                    'Trigger Name': '',
                                    'Property Name': prop.name,
                                    'Url': pipelineBaseUrl + `/config/envProperties?env_id=ibm:yp:${region}`,
                                });
                            };
                        });

                        pipelineData?.triggers.forEach((trigger) => {
                            trigger.properties?.forEach((prop) => {
                                if (prop.type === 'secure' && !isSecretReference(prop.value) && prop.value.length > 0) {
                                    pipelineResults.push({
                                        'Pipeline ID': pipelineData.id,
                                        'Pipeline Name': toolName,
                                        'Trigger Name': trigger.name,
                                        'Trigger ID': trigger.id,
                                        'Property Name': prop.name,
                                        'Url': pipelineBaseUrl + `?env_id=ibm:yp:${region}`
                                    });
                                };
                            });
                        });
                    }
                };
            };
        };

        await logger.withSpinner(exportSecrets, `Checking secrets for toolchain ${toolchainCrn}`, 'Secret check complete!');

        const numTotalSecrets = toolResults.length + pipelineResults.length;
        if (numTotalSecrets > 0) {
            logger.warn(`\nNote: ${numTotalSecrets} locally stored secret(s) found!`)
        } else {
            logger.success('\nNo locally stored secrets found!');
        }
        if (toolResults.length > 0) {
            logger.print();
            logger.print('The following plain text properties were found in tool integrations bound to the toolchain:');
            logger.table(toolResults, 'Url');
        }
        if (pipelineResults.length > 0) {
            logger.print();
            logger.print('The following plain text properties were found in Tekton pipeline(s) bound to the toolchain:');
            logger.table(pipelineResults, 'Url', ['Trigger ID']);
        }
        if (numTotalSecrets > 0 && !runMigration) {
            logger.warn(`\nNote: ${numTotalSecrets} locally stored secret(s) found!\nSecrets stored locally in Toolchains and Pipelines will not be exported when copying a toolchain. It is recommended that secrets be moved to a Secrets Manager instance and converted to secret references if these secrets are required.`);
            logger.warn(`\nTo migrate secrets to Secrets Manager, ensure that you have provisioned an instance of Secrets Manager which you have write access to and rerun the command without the additional param '--check' to move the secrets into Secrets Manager.`)
        }

        // Facilitate Secrets Migration
        const migrateSecrets = async () => {
            accountId = await getAccountId(bearer, apiKey);

            let allSmInstances = await getSmInstances(bearer, accountId);
            if (allSmInstances.length === 0) {
                logger.warn('No Secrets Manager instances found. Please create a Secrets Manager instance and try again.');
                return;
            }

            const resourceGroups = await getResourceGroups(bearer, accountId, allSmInstances.map(inst => inst.resource_group_id));
            const groupNameById = Object.fromEntries(
                resourceGroups.map(g => [g.id, g.name])
            );
            allSmInstances = allSmInstances.map(inst => ({
                ...inst,
                resource_group_name: groupNameById[inst.resource_group_id] || 'Unknown'
            }));

            const instanceChoice = await promptUserSelection(
                'Select a Secrets Manager Instance to migrate secret(s) to:',
                allSmInstances.map(inst => (`\n    Name: ${inst.name} (${inst.id})\n    Region: ${inst.region_id}\n    Resource Group: ${inst.resource_group_name}`))
            );
            const smInstance = allSmInstances[instanceChoice];

            // Check if there's an existing Secrets Manager tool integration
            let hasSmIntegration = false;
            for (const tool of tools) {
                if (tool.state === 'configured' && tool.tool_type_id === 'secretsmanager') {
                    if (
                        (tool.parameters?.['instance-id-type'] === 'instance-name' && tool.parameters?.['instance-name'] === smInstance.name &&
                            tool.parameters?.region === smInstance.region_id && tool.parameters?.['resource-group'] === smInstance.resource_group_name) ||
                        (tool.parameters?.['instance-id-type'] === 'instance-crn' && tool.parameters?.['instance-crn'] === smInstance.crn)
                    ) {
                        hasSmIntegration = true;
                        break;
                    }
                }
            }

            // Prompt user to create a Secrets Manager tool integration if it doesn't already exist
            if (!hasSmIntegration) {
                logger.warn('No valid Secrets Manager tool integration found.');
                const toCreateSmTool = await promptUserYesNo(`Create a Secrets Manager tool integration?`);
                if (!toCreateSmTool) {
                    logger.warn('Toolchain secrets will not be migrated to Secrets Manager. Please create a Secrets Manager tool integration and try again.');
                    return;
                }
                const smToolName = await promptUserInput(`Enter the name of the Secrets Manager tool integration to create [Press 'enter' to skip]: `, '', async (input) => {
                    if (input.length > 128) {
                        throw new Error('The tool integration name must be between 0 and 128 characters long.');
                    }
                    // from https://cloud.ibm.com/apidocs/toolchain#create-tool
                    else if (input !== '' && !/^([^\x00-\x7F]|[a-zA-Z0-9-._ ])+$/.test(input)) {
                        throw new Error('Provided tool integration name contains invalid characters.');
                    }
                });

                const smToolParams = {
                    'tool_type_id': 'secretsmanager',
                    'parameters': {
                        'name': smToolName || 'Secrets Manager',
                        'instance-id-type': 'instance-crn',
                        'instance-crn': smInstance.crn,
                    }
                };
                try {
                    const smTool = await createTool(bearer, toolchainId, region, smToolParams);
                    logger.success(`Secrets Manager tool integration created: ${smTool.parameters.name} (${smTool.id})`);
                    const smToolUrl = `https://${CLOUD_PLATFORM}/devops/toolchains/${toolchainId}/configure/${smTool.id}?env_id=ibm:yp:${region}`;
                    logger.warn(`Create necessary IAM service authorization for toolchain to access Secrets Manager service instance:\n${smToolUrl}`);
                } catch (e) {
                    logger.error(`Failed to create Secrets Manager tool integration: ${e.message}`);
                    throw e;
                }
            }

            let numSecretsMigrated = 0;
            const allSecrets = toolResults.concat(pipelineResults);
            for (let i = 0; i < allSecrets.length; i++) {
                logger.print('-------');
                const secret = allSecrets[i];
                const toolName = secret['Tool Name'] || secret['Pipeline Name'];
                const toolType = secret['Tool Type'] || 'pipeline';
                const toolId = secret['Tool ID'] || secret['Pipeline ID'];
                const triggerId = secret['Trigger ID'];
                const triggerName = secret['Trigger Name'];
                const toolSecretKey = secret['Property Name'];
                const toolSecretUrl = secret['Url'];
                const secretPath = `${toolName || toolType}.${triggerName ? triggerName + '.' : ''}${toolSecretKey}`;

                logger.print(`[${i + 1}]\n    Tool integration: ${toolName ? `'${toolName}' (${toolType})` : toolType}\n    Property: '${triggerName ? triggerName + '.' : ''}${toolSecretKey}'\n    URL: ${toolSecretUrl}\n`);

                const shouldMigrateSecret = await promptUserYesNo(`Migrate this secret to Secrets Manager instance '${smInstance.name}'?`);
                if (!shouldMigrateSecret) {
                    continue;
                }

                const smSecretName = await promptUserInput(`Enter the name of the secret to create [${secretPath}]: `, '', async (input) => {
                    if (input.length < 2 || input.length > 256) {
                        throw new Error('The secret name must be between 2 and 256 characters long.');
                    }
                    // from https://cloud.ibm.com/apidocs/secrets-manager/secrets-manager-v2#create-secret
                    else if (!/^[A-Za-z0-9_][A-Za-z0-9_]*(?:_*-*\.*[A-Za-z0-9]*)*[A-Za-z0-9]+$/.test(input)) {
                        throw new Error('Provided secret name contains invalid characters.');
                    }
                });

                const smSecretGroupId = await promptUserInput(`Enter the ID of the secret group to create secret '${smSecretName}' in: `, 'default', async (input) => {
                    if (input.length < 7 || input.length > 36) {
                        throw new Error('The secret group name must be between 7 and 36 characters long.');
                    }
                    // from https://cloud.ibm.com/apidocs/secrets-manager/secrets-manager-v2#create-secret
                    else if (!/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|default)$/.test(input)) {
                        throw new Error('Provided secret group name is invalid. It should be a UUID or the word \'default\'');
                    }
                });

                try {
                    const commonProps = {
                        toolchain_id: toolchainId,
                        destination: {
                            is_private: false, // TODO: set this back to 'true' once 'otc-api' has the 'export_secret' endpoint, should always use SM private endpoint
                            is_production: CLOUD_PLATFORM === 'cloud.ibm.com',
                            secrets_manager_crn: smInstance.crn,
                            secret_name: smSecretName,
                            secret_group_id: smSecretGroupId
                        }
                    };
                    const payload = {
                        source: {
                            type: toolType === 'pipeline' ? toolType : 'tool',
                            id: toolType === 'pipeline' ? (triggerId || toolId) : toolId,
                            secret_key: toolSecretKey,
                            kind: toolType === 'pipeline' ? (triggerId ? 'trigger' : 'env') : undefined,
                            parent_id: toolType === 'pipeline' ? (triggerId ? toolId : undefined) : undefined
                        },
                        ...commonProps
                    };

                    const smSecretUrl = await migrateToolchainSecrets(bearer, payload, region);
                    logger.success(`Secret successfully migrated!\nSecret URL: ${smSecretUrl}`);
                    numSecretsMigrated += 1;
                }
                catch (e) {
                    logger.error(`Failed to migrate secret '${secretPath}'. Error message: ${e.message}`, '', true);
                }
            }
            logger.success(`Toolchain secrets migration complete, ${numSecretsMigrated} secret(s) successfully migrated.`);
        };

        if (numTotalSecrets > 0 && runMigration) await migrateSecrets();
    }
    catch (err) {
        if (err.message && err.stack) {
            const errMsg = verbosity > 1 ? err.stack : err.message;
            logger.error(errMsg);
        }
        exit(1);
    }
};

export default command;
