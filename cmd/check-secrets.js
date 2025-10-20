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
import { parseEnvVar, decomposeCrn, isSecretReference } from './utils/utils.js';
import { logger, LOG_STAGES } from './utils/logger.js';
import { getBearerToken, getToolchainTools, getPipelineData } from './utils/requests.js';
import { UPDATEABLE_SECRET_PROPERTIES_BY_TOOL_TYPE } from '../config.js';

const command = new Command('check-secrets')
  .description('Checks if you have any stored secrets in your toolchain or pipelines')
  .requiredOption('-c, --toolchain-crn <crn>', 'The CRN of the source toolchain to check')
  .option('-a --apikey <api key>', 'IBM Cloud IAM API key with permissions to read the toolchain.')
  .showHelpAfterError()
  .hook('preAction', cmd => cmd.showHelpAfterError(false)) // only show help during validation
  .action(main);

async function main(options) {
    const toolchainCrn = options.toolchainCrn;
    const apiKey = options.apikey || parseEnvVar('IBMCLOUD_API_KEY');

    if (!apiKey) {
        logger.error('Missing IBM Cloud IAM API key', LOG_STAGES.setup);
        exit(1);
    };

    logger.print(`Checking secrets for toolchain ${toolchainCrn}...`);

    const decomposedCrn = decomposeCrn(toolchainCrn);

    const token = await getBearerToken(apiKey);
    const toolchainId = decomposedCrn.serviceInstance;
    const region = decomposedCrn.location;

    const getToolsRes = await getToolchainTools(token, toolchainId, region);

    const toolResults = [];
    const pipelineResults = [];

    if (getToolsRes?.tools?.length > 0) {
        for (let i = 0; i < getToolsRes.tools.length; i++) {
            const tool = getToolsRes.tools[i];

            // Check tool integrations for any plain text secret values
            if (UPDATEABLE_SECRET_PROPERTIES_BY_TOOL_TYPE[tool.tool_type_id]) {
                UPDATEABLE_SECRET_PROPERTIES_BY_TOOL_TYPE[tool.tool_type_id].forEach((updateableSecretParam) => {
                    if (tool.parameters[updateableSecretParam] && !isSecretReference(tool.parameters[updateableSecretParam])) {
                        toolResults.push({
                            'Tool ID': tool.id,
                            'Tool Type': tool.tool_type_id,
                            'Property Name': updateableSecretParam
                        });
                    };
                });
            };

            // For tekton pipelines, check for any plain text secret properties
            if (tool.tool_type_id === 'pipeline' && tool.parameters?.type === 'tekton') {
                const pipelineData = await getPipelineData (token, tool.id, region);

                pipelineData?.properties.forEach((prop) => {
                    if (prop.type === 'secure' && !isSecretReference(prop.value)) {
                        pipelineResults.push({
                            'Pipeline ID': pipelineData.id,
                            'Trigger Name': '-', 
                            'Property Name': prop.name
                        });
                    };
                });

                pipelineData?.triggers.forEach((trigger) => {
                    trigger.properties?.forEach((prop) => {
                        if (prop.type === 'secure' && !isSecretReference(prop.value)) {
                            pipelineResults.push({
                                'Pipeline ID': pipelineData.id,
                                'Trigger Name': trigger.name, 
                                'Property Name': prop.name
                            });
                        };
                    });
                });
            }
        };
    };

    if (toolResults.length > 0) {
        logger.print();
        logger.print('The following plain text properties were found in tool integrations bound to the toolchain:');
        logger.table(toolResults);
    };
    if (pipelineResults.length > 0) {
        logger.print();
        logger.print('The following plain text properties were found in Tekton pipeline(s) bound to the toolchain:');
        logger.table(pipelineResults);
    };
};

export default command;
