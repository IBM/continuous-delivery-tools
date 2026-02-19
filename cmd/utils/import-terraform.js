/**
 * Licensed Materials - Property of IBM
 * (c) Copyright IBM Corporation 2025. All Rights Reserved.
 *
 * Note to U.S. Government Users Restricted Rights:
 * Use, duplication or disclosure restricted by GSA ADP Schedule
 * Contract with IBM Corp.
 */

import fs from 'node:fs';

import { parse as tfToJson } from '@cdktf/hcl2json'
import { jsonToTf } from 'json-to-tf';

import { getPipelineData, getToolchainTools } from './requests.js';
import { runTerraformPlanGenerate, setTerraformEnv } from './terraform.js';
import { getRandChars, isSecretReference, normalizeName } from './utils.js';
import { LOG_STAGES, logger } from './logger.js';

import { SECRET_KEYS_MAP, SUPPORTED_TOOLS_MAP } from '../../config.js';

const DEBUG_MODE = process.env['DEBUG_MODE'] === 'true'; // when true, log extra errors for debugging

export async function importTerraform(token, apiKey, region, toolchainId, toolchainName, dir, isCompact, verbosity) {
    // STEP 1/2: set up terraform file with import blocks
    const importBlocks = []; // an array of objects representing import blocks, used in importBlocksToTf
    const additionalProps = {}; // maps resource name to array of { property/param, value }, used to override terraform import

    const toolIdMap = {}; // maps tool ids to { type, name }, used to add references

    const repoUrlMap = {}; // maps repo urls to { type, name }, used to add references
    const repoResources = [
        'ibm_cd_toolchain_tool_bitbucketgit',
        'ibm_cd_toolchain_tool_hostedgit',
        'ibm_cd_toolchain_tool_gitlab',
        'ibm_cd_toolchain_tool_githubconsolidated'
    ];

    const nonSecretRefs = [];

    let block = importBlock(toolchainId, toolchainName, 'ibm_cd_toolchain');
    importBlocks.push(block);

    const toolchainResName = block.name;
    let pipelineResName;

    const requiresS2S = [
        'ibm_cd_toolchain_tool_appconfig',
        'ibm_cd_toolchain_tool_eventnotifications',
        'ibm_cd_toolchain_tool_keyprotect',
        'ibm_cd_toolchain_tool_secretsmanager'
    ];
    let s2sAuthTools = [];

    // get list of tools
    const allTools = await getToolchainTools(token, toolchainId, region);
    for (const tool of allTools.tools) {
        const toolName = tool.parameters?.name ?? tool.tool_type_id;

        if (tool.tool_type_id in SUPPORTED_TOOLS_MAP) {
            block = importBlock(`${toolchainId}/${tool.id}`, toolName, SUPPORTED_TOOLS_MAP[tool.tool_type_id]);
            importBlocks.push(block);

            const toolResName = block.name;
            pipelineResName = block.name; // used below

            toolIdMap[tool.id] = { type: SUPPORTED_TOOLS_MAP[tool.tool_type_id], name: toolResName };

            if (requiresS2S.includes(SUPPORTED_TOOLS_MAP[tool.tool_type_id])) {
                s2sAuthTools.push(tool);
            }

            // overwrite hard-coded id with reference
            additionalProps[block.name] = [
                { property: 'toolchain_id', value: `\${ibm_cd_toolchain.${toolchainResName}.id}` },
            ];

            // check and add secret refs
            if (tool.tool_type_id in SECRET_KEYS_MAP) {
                SECRET_KEYS_MAP[tool.tool_type_id].forEach(({ key, tfKey, prereq, required }) => {
                    if (prereq && !prereq.values.includes(tool.parameters[prereq.key])) return; // missing prereq

                    if (isSecretReference(tool.parameters[key])) {
                        additionalProps[block.name].push({ param: tfKey, value: tool.parameters[key] });
                    } else {
                        const newFileName = SUPPORTED_TOOLS_MAP[tool.tool_type_id].split('ibm_')[1];
                        if (required || prereq) {
                            nonSecretRefs.push({
                                resource_name: block.name,
                                property_name: tfKey,
                                file_name: isCompact ? 'resources.tf' : `${newFileName}.tf`
                            });
                            additionalProps[block.name].push({ param: tfKey, value: `<${tfKey}>` });
                        }
                    }
                });
            }
        }

        if (tool.tool_type_id === 'pipeline' && tool.parameters?.type === 'tekton') {
            const pipelineData = await getPipelineData(token, tool.id, region);

            block = importBlock(pipelineData.id, toolName, 'ibm_cd_tekton_pipeline');
            importBlocks.push(block);

            // overwrite hard-coded id with reference
            additionalProps[block.name] = [
                { property: 'pipeline_id', value: `\${ibm_cd_toolchain_tool_pipeline.${pipelineResName}.tool_id}` },
            ];


            pipelineData.definitions.forEach((def) => {
                block = importBlock(`${pipelineData.id}/${def.id}`, 'definition', 'ibm_cd_tekton_pipeline_definition');
                importBlocks.push(block);

                // overwrite hard-coded id with reference
                additionalProps[block.name] = [
                    { property: 'pipeline_id', value: `\${ibm_cd_toolchain_tool_pipeline.${pipelineResName}.tool_id}` },
                ];
            });

            pipelineData.properties.forEach((prop) => {
                block = importBlock(`${pipelineData.id}/${prop.name}`, prop.name, 'ibm_cd_tekton_pipeline_property');
                importBlocks.push(block);

                // overwrite hard-coded id with reference
                additionalProps[block.name] = [
                    { property: 'pipeline_id', value: `\${ibm_cd_toolchain_tool_pipeline.${pipelineResName}.tool_id}` },
                ];
            });

            pipelineData.triggers.forEach((trig) => {
                block = importBlock(`${pipelineData.id}/${trig.id}`, trig.name, 'ibm_cd_tekton_pipeline_trigger');
                importBlocks.push(block);

                // overwrite hard-coded id with reference
                additionalProps[block.name] = [
                    { property: 'pipeline_id', value: `\${ibm_cd_toolchain_tool_pipeline.${pipelineResName}.tool_id}` },
                ];

                const triggerResName = block.name;

                trig.properties.forEach((trigProp) => {
                    block = importBlock(`${pipelineData.id}/${trig.id}/${trigProp.name}`, trigProp.name, 'ibm_cd_tekton_pipeline_trigger_property');
                    importBlocks.push(block);

                    // overwrite hard-coded id with reference
                    additionalProps[block.name] = [
                        { property: 'pipeline_id', value: `\${ibm_cd_toolchain_tool_pipeline.${pipelineResName}.tool_id}` },
                        { property: 'trigger_id', value: `\${ibm_cd_tekton_pipeline_trigger.${triggerResName}.trigger_id}` }
                    ];
                });
            });
        }
    }

    importBlocksToTf(importBlocks, dir);

    if (!fs.existsSync(`${dir}/generated`)) fs.mkdirSync(`${dir}/generated`);

    // STEP 2/2: run terraform import and post-processing
    setTerraformEnv(apiKey, verbosity);

    let draftErrors = '';
    await runTerraformPlanGenerate(dir, 'generated/draft.tf').catch((err) => {
        if (DEBUG_MODE) logger.dump(`\n[DEBUG_MODE=true] Draft errors: ${err}`);
        draftErrors = err;
    });
    // above is a temp fix for errors before post-processing
    // empty pipeline_id and trigger_id are expected and is a known provider bug

    let generatedFile = '';
    try {
        generatedFile = fs.readFileSync(`${dir}/generated/draft.tf`);
    } catch (err) {
        // if draft file is missing, then something went wrong
        // also, no need to log draft errors twice
        throw new Error(err + (!DEBUG_MODE ? ('\nDraft errors: ' + draftErrors) : '\nDraft errors already logged'));
    }

    const generatedFileJson = await tfToJson('draft.tf', generatedFile.toString());

    const newTfFileObj = { 'resource': {} }

    for (const [key, value] of Object.entries(generatedFileJson['resource'])) {
        for (const [k, v] of Object.entries(value)) {
            newTfFileObj['resource'][key] = { ...(newTfFileObj['resource'][key] ?? []), [k]: v[0] };

            // remove empty tool, which breaks jsonToTf
            try {
                if (Object.keys(newTfFileObj['resource'][key][k]['source'][0]['properties'][0]['tool'][0]).length < 1) {
                    delete newTfFileObj['resource'][key][k]['source'][0]['properties'][0]['tool'];
                }
            } catch {
                // do nothing
            }

            // handle missing worker, which breaks terraform
            try {
                if (newTfFileObj['resource'][key][k]['worker'][0]['id'] === null) {
                    delete newTfFileObj['resource'][key][k]['worker'];
                }
            } catch {
                // do nothing
            }

            // ignore null values
            for (const [k2, v2] of Object.entries(v[0])) {
                if (v2 === null) delete newTfFileObj['resource'][key][k][k2];
            }

            // ignore null values in parameters
            try {
                if (Object.keys(v[0]['parameters'][0]).length > 0) {
                    for (const [k2, v2] of Object.entries(v[0]['parameters'][0])) {
                        if (v2 === null) delete newTfFileObj['resource'][key][k]['parameters'][0][k2];
                    }
                }
            } catch {
                // do nothing
            }

            // ignore null values in source properties
            try {
                if (Object.keys(v[0]['source'][0]['properties'][0]).length > 0) {
                    for (const [k2, v2] of Object.entries(v[0]['source'][0]['properties'][0])) {
                        if (v2 === null) delete newTfFileObj['resource'][key][k]['source'][0]['properties'][0][k2];
                    }
                }
            } catch {
                // do nothing
            }

            // add/overwrite additional props
            if (k in additionalProps) {
                additionalProps[k].forEach(({ param, property, value }) => {
                    if (property) newTfFileObj['resource'][key][k][property] = value;
                    if (param) {
                        newTfFileObj['resource'][key][k]['parameters'][0][param] = value;
                    }
                })
            }

            // add relevent references and depends_on
            if (key === 'ibm_cd_tekton_pipeline' && newTfFileObj['resource'][key][k]['worker']) {
                const workerId = newTfFileObj['resource'][key][k]['worker'][0]['id'];
                if (workerId != null && workerId != 'public' && workerId in toolIdMap) {
                    newTfFileObj['resource'][key][k]['worker'][0]['id'] = `\${${toolIdMap[workerId].type}.${toolIdMap[workerId].name}.tool_id}`;
                }
            } else if (key === 'ibm_cd_tekton_pipeline_property' || key === 'ibm_cd_tekton_pipeline_trigger_property') {
                const propValue = newTfFileObj['resource'][key][k]['value'];
                if (newTfFileObj['resource'][key][k]['type'] === 'integration' && propValue in toolIdMap) {
                    newTfFileObj['resource'][key][k]['value'] = `\${${toolIdMap[propValue].type}.${toolIdMap[propValue].name}.tool_id}`;
                } else if (propValue) {
                    let newValue = propValue;

                    if (propValue.includes('\n')) logger.warn(`Warning! Multi-line values for pipeline and trigger properties are not yet supported in the provider, newlines will be replaced with '\\\\n': "${k}"`, LOG_STAGES.import, true);

                    // escape newlines, double quotes and backslashes
                    newValue = newValue.replace(/\\/g, '\\\\').replace(/\n\s*/g, '').replace(/\r\s*/g, '').replace(/"/g, '\\"');
                    newTfFileObj['resource'][key][k]['value'] = newValue;
                }
            }

            // clean up unused/misplaced params
            if (key === 'ibm_iam_authorization_policy') {
                const deleteKeys = [
                    'subject_attributes',
                    'resource_attributes',
                    'source_service_account',
                    'transaction_id'
                ];

                for (const toDelete of deleteKeys) {
                    delete newTfFileObj['resource'][key][k][toDelete];
                }
            }

            if (repoResources.includes(key)) {
                const paramsMap = newTfFileObj['resource'][key][k]['parameters'][0];

                // collect repo url references to be added on second pass
                const repoUrl = paramsMap['repo_url'];
                repoUrlMap[repoUrl] = { type: key, name: k };

                // set up initialization
                const initializationMap = {
                    git_id: paramsMap['git_id'],
                    type: paramsMap['type'],
                    repo_url: paramsMap['repo_url'],
                    private_repo: paramsMap['private_repo'],
                };
                newTfFileObj['resource'][key][k]['initialization'] = [initializationMap];

                // clean up parameters
                const newParamsMap = {};
                const paramsToInclude = ['api_token', 'auth_type', 'enable_traceability', 'toolchain_issues_enabled'];
                for (const param of paramsToInclude) {
                    newParamsMap[param] = paramsMap[param];
                }
                newTfFileObj['resource'][key][k]['parameters'][0] = newParamsMap;
            }
        }
    }

    // add repo url depends_on on second pass
    for (const [key, value] of Object.entries(generatedFileJson['resource'])) {
        for (const [k, _] of Object.entries(value)) {
            if (key === 'ibm_cd_tekton_pipeline_definition' || key === 'ibm_cd_tekton_pipeline_trigger') {
                try {
                    const thisUrl = newTfFileObj['resource'][key][k]['source'][0]['properties'][0]['url'];

                    if (thisUrl in repoUrlMap) {
                        newTfFileObj['resource'][key][k]['depends_on'] = [`\${${repoUrlMap[thisUrl].type}.${repoUrlMap[thisUrl].name}}`];
                    }
                } catch {
                    // do nothing
                }
            }
        }
    }

    if (!isCompact) {
        for (const [key, value] of Object.entries(newTfFileObj['resource'])) {
            if (!key.startsWith('ibm_')) continue;
            const newFileName = key.split('ibm_')[1];

            const newFileContents = { 'resource': { [key]: value } };
            const newFileContentsJson = jsonToTf(JSON.stringify(newFileContents));

            fs.writeFileSync(`${dir}/generated/${newFileName}.tf`, newFileContentsJson);
        }
    } else {
        const generatedFileNew = jsonToTf(JSON.stringify(newTfFileObj));
        fs.writeFileSync(`${dir}/generated/resources.tf`, generatedFileNew);
    }

    // remove draft
    if (fs.existsSync(`${dir}/generated/draft.tf`)) fs.rmSync(`${dir}/generated/draft.tf`, { recursive: true });

    return [toolchainResName, nonSecretRefs, s2sAuthTools];
}

// objects have two keys, "id" and "to"
// e.g. { id: 'bc3d05f1-e6f7-4b5e-8647-8119d8037039', to: 'ibm_cd_toolchain.my_everything_toolchain_e22c' }
function importBlock(id, name, resourceType) {
    const newName = `${normalizeName(name)}_${getRandChars(4)}`;

    return {
        id: id,
        to: `${resourceType}.${newName}`,
        name: newName
    }
}

// importBlocks array to tf file
function importBlocksToTf(blocks, dir) {
    let fileContent = '';

    blocks.forEach((block) => {
        const template = `import {
  id = "${block.id}"
  to = ${block.to}
}\n\n`;
        fileContent += template;
    });

    return fs.writeFileSync(`${dir}/import.tf`, fileContent);
}
