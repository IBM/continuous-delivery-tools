/**
 * Licensed Materials - Property of IBM
 * (c) Copyright IBM Corporation 2025. All Rights Reserved.
 *
 * Note to U.S. Government Users Restricted Rights:
 * Use, duplication or disclosure restricted by GSA ADP Schedule
 * Contract with IBM Corp.
 */

import child_process from 'node:child_process';
import fs from 'node:fs';
import { promisify } from 'node:util';

import { parse as tfToJson } from '@cdktf/hcl2json'
import { jsonToTf } from 'json-to-tf';

import { validateToolchainId, validateGritUrl } from './validate.js';
import { logger, LOG_STAGES } from './logger.js';
import { getRandChars, promptUserInput, replaceUrlRegion } from './utils.js';

const CLOUD_PLATFORM = process.env['IBMCLOUD_PLATFORM_DOMAIN'] || 'cloud.ibm.com';
const DEV_MODE = CLOUD_PLATFORM !== 'cloud.ibm.com';
const GIT_BASE_URL = DEV_MODE ? process.env['IBMCLOUD_GIT_URL'] : '';

// promisify
const readFilePromise = promisify(fs.readFile);
const readDirPromise = promisify(fs.readdir);
const writeFilePromise = promisify(fs.writeFile)

async function execPromise(command, options) {
    try {
        const exec = promisify(child_process.exec);
        const { stdout, stderr } = await exec(command, options);
        return stdout.trim();
    } catch (err) {
        throw new Error(`Command failed: ${command} \n${err.stderr || err.stdout}`);
    }
}

function setTerraformEnv(apiKey, verbosity) {
    if (verbosity >= 2) process.env['TF_LOG'] = 'DEBUG';
    process.env['TF_VAR_ibmcloud_api_key'] = apiKey;
    // reset all Terraform environment variables if pointing to prod domain
    if (!DEV_MODE) {
        delete process.env['IBMCLOUD_TOOLCHAIN_ENDPOINT'];
        delete process.env['IBMCLOUD_TEKTON_PIPELINE_ENDPOINT'];
        delete process.env['IBMCLOUD_IAM_API_ENDPOINT'];
        delete process.env['IBMCLOUD_USER_MANAGEMENT_ENDPOINT'];
        delete process.env['IBMCLOUD_RESOURCE_MANAGEMENT_API_ENDPOINT'];
        delete process.env['IBMCLOUD_RESOURCE_CONTROLLER_API_ENDPOINT'];
        delete process.env['IBMCLOUD_IS_NG_API_ENDPOINT'];
        delete process.env['IBMCLOUD_GT_API_ENDPOINT'];
        delete process.env['IBMCLOUD_GS_API_ENDPOINT'];
        delete process.env['IBMCLOUD_USER_MANAGEMENT_ENDPOINT'];
    }
}

async function initProviderFile(targetRegion, dir) {
    const newProviderTf = { 'provider': {}, 'terraform': { 'required_providers': {} }, 'variable': {} };

    newProviderTf['provider']['ibm'] = [{ 'ibmcloud_api_key': '${var.ibmcloud_api_key}', 'region': targetRegion }];
    newProviderTf['terraform']['required_providers']['ibm'] = { 'source': 'IBM-Cloud/ibm' };
    newProviderTf['variable']['ibmcloud_api_key'] = {};

    const newProviderTfStr = JSON.stringify(newProviderTf)

    return writeFilePromise(`${dir}/provider.tf`, jsonToTf(newProviderTfStr));
}

async function setupTerraformFiles({ token, srcRegion, targetRegion, targetTag, targetToolchainName, targetRgId, disableTriggers, isCompact, outputDir, tempDir, moreTfResources, gritMapping, skipUserConfirmation, includeS2S }) {
    const promises = [];

    const writeProviderPromise = await initProviderFile(targetRegion, outputDir);
    promises.push(writeProviderPromise);

    // Get toolchain resource
    const toolchainLocation = isCompact ? 'resources.tf' : 'cd_toolchain.tf'
    const resources = await readFilePromise(`${tempDir}/generated/${toolchainLocation}`, 'utf8');
    const resourcesObj = await tfToJson('output.tf', resources);
    const newTcId = Object.keys(resourcesObj['resource']['ibm_cd_toolchain'])[0];

    // output newly created toolchain ID
    const newOutputTf =
        `output "ibm_cd_toolchain_${newTcId}_id" {
  value = "$\{ibm_cd_toolchain.${newTcId}.id}"
}`;
    const writeOutputPromise = writeFilePromise(`${outputDir}/output.tf`, newOutputTf);
    promises.push(writeOutputPromise);

    // Copy over cd_*.tf
    let files = await readDirPromise(`${tempDir}/generated`);

    if (isCompact) {
        files = files.filter((f) => f === 'resources.tf');
        if (files.length != 1) throw new Error('Something went wrong, resources.tf was not generated...');
    } else {
        const prefix = 'cd_';
        files = files.filter((f) => f.slice(0, prefix.length) === prefix || f === 'iam_authorization_policy.tf');

        // should be processing GRIT first in non-compact case
        if (files.find((f) => f === 'cd_toolchain_tool_hostedgit.tf')) {
            files = [
                'cd_toolchain_tool_hostedgit.tf',
                ...files.filter((f) => f != 'cd_toolchain_tool_hostedgit.tf')
            ];
        }
    }

    // for converting legacy GHE tool integrations
    const hasGHE = moreTfResources['github_integrated'].length > 0;
    const repoToTfName = {};
    const toolIdToTfName = {};
    const newConvertedTf = {};

    if (hasGHE) {
        moreTfResources['github_integrated'].forEach(t => {
            const gitUrl = t['parameters']['repo_url'];
            const tfName = `converted--githubconsolidated_${getRandChars(4)}`;

            repoToTfName[gitUrl] = tfName;
            toolIdToTfName[t['id']] = tfName;
            newConvertedTf[tfName] = {
                toolchain_id: `\${ibm_cd_toolchain.${newTcId}.id}`,
                name: t['name'],
                initialization: [{
                    auto_init: 'false',
                    blind_connection: 'false',
                    git_id: 'integrated',
                    private_repo: 'false',
                    repo_url: gitUrl,
                    type: 'link',
                }],
                parameters: [{
                    ...(t['parameters']['auth_type'] === 'pat' ? { api_token: t['parameters']['api_token'] } : {}),
                    auth_type: t['parameters']['auth_type'],
                    enable_traceability: t['parameters']['enable_traceability'],
                    integration_owner: t['parameters']['integration_owner'],
                    toolchain_issues_enabled: t['parameters']['has_issues'],
                }]
            };
        });
    }

    for (const fileName of files) {
        const tfFile = await readFilePromise(`${tempDir}/generated/${fileName}`, 'utf8');
        const tfFileObj = await tfToJson(fileName, tfFile);

        const newTfFileObj = { 'resource': {} }
        for (const [key, value] of Object.entries(tfFileObj['resource'])) {
            for (const [k, v] of Object.entries(value)) {
                newTfFileObj['resource'][key] = { ...(newTfFileObj['resource'][key] ?? []), [k]: v[0] };
            }
        }

        const resourceName = `ibm_${fileName.split('.tf')[0]}`;

        const usedGritUrls = new Set(Object.values(gritMapping));
        const attemptAddUsedGritUrl = (url) => {
            if (usedGritUrls.has(url)) throw Error(`"${url}" has already been used in another mapping entry`);
            usedGritUrls.add(url);
        };

        let firstGritPrompt = false;

        // should be processed first in non-compact case
        if (isCompact || resourceName === 'ibm_cd_toolchain_tool_hostedgit') {
            if (newTfFileObj['resource']['ibm_cd_toolchain_tool_hostedgit']) {
                for (const [k, v] of Object.entries(newTfFileObj['resource']['ibm_cd_toolchain_tool_hostedgit'])) {
                    try {
                        newTfFileObj['resource']['ibm_cd_toolchain_tool_hostedgit'][k]['parameters'][0]['auth_type'] = 'oauth';
                        delete newTfFileObj['resource']['ibm_cd_toolchain_tool_hostedgit'][k]['parameters'][0]['api_token'];
                    } catch {
                        // do nothing
                    }

                    try {
                        const thisUrl = v['initialization'][0]['repo_url'];
                        if (thisUrl in gritMapping) {
                            newTfFileObj['resource']['ibm_cd_toolchain_tool_hostedgit'][k]['initialization'][0]['repo_url'] = gritMapping[thisUrl];
                            continue;
                        }

                        let newUrl = replaceUrlRegion(thisUrl, srcRegion, targetRegion);

                        // check if same group/project exists, if yes, don't prompt user
                        if (skipUserConfirmation || (newUrl && !usedGritUrls.has(newUrl) && await validateGritUrl(token, targetRegion, newUrl, true).catch(() => { return false }))) {
                            newTfFileObj['resource']['ibm_cd_toolchain_tool_hostedgit'][k]['initialization'][0]['repo_url'] = newUrl;
                            attemptAddUsedGritUrl(newUrl);
                            gritMapping[thisUrl] = newUrl;
                        } else {
                            // prompt user
                            const validateGritUrlPrompt = async (str) => {
                                if (!str) {
                                    logger.print('Skipping... (URL will remain unchanged in the generatedTerraform configuration)');
                                    return '';
                                }
                                const newUrl = (GIT_BASE_URL || `https://${targetRegion}.git.cloud.ibm.com`) + `/${str}.git`;
                                if (usedGritUrls.has(newUrl)) throw Error(`"${newUrl}" has already been used in another mapping entry`);
                                return validateGritUrl(token, targetRegion, str, false);
                            }

                            if (!firstGritPrompt) {
                                firstGritPrompt = true;
                                logger.print('Please enter the new URLs for the following GRIT tool(s) (or submit empty input to skip):\n');
                            }

                            const newRepoSlug = await promptUserInput(`Old URL: ${thisUrl.slice(0, thisUrl.length - 4)}\nNew URL: ${GIT_BASE_URL || 'https://' + targetRegion + '.git.cloud.ibm.com'}`, '', validateGritUrlPrompt);

                            if (newRepoSlug) {
                                newUrl = (GIT_BASE_URL || `https://${targetRegion}.git.cloud.ibm.com`) + `/${newRepoSlug}.git`;
                                newTfFileObj['resource']['ibm_cd_toolchain_tool_hostedgit'][k]['initialization'][0]['repo_url'] = newUrl;
                                attemptAddUsedGritUrl(newUrl);
                                gritMapping[thisUrl] = newUrl;
                            }
                        }
                    }
                    catch (e) {
                        logger.error(`Could not verify/replace URL for the following GRIT tool resource: "${k}", ${e}`);
                    }
                }
            }
        }

        if (isCompact || resourceName === 'ibm_cd_toolchain') {
            if (targetTag) newTfFileObj['resource']['ibm_cd_toolchain'][newTcId]['tags'] = [
                Array.from(new Set( // uniqueness
                    (newTfFileObj['resource']['ibm_cd_toolchain'][newTcId]['tags'] ?? []).concat([targetTag])
                ))
            ];
            if (targetToolchainName) newTfFileObj['resource']['ibm_cd_toolchain'][newTcId]['name'] = targetToolchainName;
            if (targetRgId) newTfFileObj['resource']['ibm_cd_toolchain'][newTcId]['resource_group_id'] = targetRgId;
        }

        if (isCompact || resourceName === 'ibm_cd_tekton_pipeline_trigger') {
            // by default, disable triggers
            if (disableTriggers && newTfFileObj['resource']['ibm_cd_tekton_pipeline_trigger']) {
                for (const key of Object.keys(newTfFileObj['resource']['ibm_cd_tekton_pipeline_trigger'])) {
                    if (newTfFileObj['resource']['ibm_cd_tekton_pipeline_trigger'][key]['type'] === 'manual') continue; // skip manual triggers
                    newTfFileObj['resource']['ibm_cd_tekton_pipeline_trigger'][key]['enabled'] = false;
                }
            }

            // set depends_on for references to legacy GHE integrations
            if (hasGHE && newTfFileObj['resource']['ibm_cd_tekton_pipeline_trigger']) {
                for (const [k, v] of Object.entries(newTfFileObj['resource']['ibm_cd_tekton_pipeline_trigger'])) {
                    try {
                        const thisUrl = v['source'][0]['properties'][0]['url'];
                        if (!v['depends_on'] && thisUrl) {
                            newTfFileObj['resource']['ibm_cd_tekton_pipeline_trigger'][k]['depends_on'] = [`ibm_cd_toolchain_tool_githubconsolidated.${repoToTfName[thisUrl]}`]
                        }
                    }
                    catch {
                        // do nothing
                    }
                }
            }

            // update GRIT urls
            if (newTfFileObj['resource']['ibm_cd_tekton_pipeline_trigger']) {
                for (const [k, v] of Object.entries(newTfFileObj['resource']['ibm_cd_tekton_pipeline_trigger'])) {
                    try {
                        const thisUrl = v['source'][0]['properties'][0]['url'];
                        const newUrl = gritMapping[thisUrl];

                        if (newUrl) {
                            newTfFileObj['resource']['ibm_cd_tekton_pipeline_trigger'][k]['source'][0]['properties'][0]['url'] = newUrl;
                        }
                    }
                    catch {
                        // do nothing
                    }
                }
            }
        }

        if (isCompact || resourceName === 'ibm_cd_tekton_pipeline_definition') {
            // set depends_on for references to legacy GHE integrations
            if (hasGHE && newTfFileObj['resource']['ibm_cd_tekton_pipeline_definition']) {
                for (const [k, v] of Object.entries(newTfFileObj['resource']['ibm_cd_tekton_pipeline_definition'])) {
                    try {
                        const thisUrl = v['source'][0]['properties'][0]['url'];
                        if (!v['depends_on'] && thisUrl) {
                            newTfFileObj['resource']['ibm_cd_tekton_pipeline_definition'][k]['depends_on'] = [`ibm_cd_toolchain_tool_githubconsolidated.${repoToTfName[thisUrl]}`]
                        }
                    }
                    catch {
                        // do nothing
                    }
                }
            }

            // update GRIT urls
            if (newTfFileObj['resource']['ibm_cd_tekton_pipeline_definition']) {
                for (const [k, v] of Object.entries(newTfFileObj['resource']['ibm_cd_tekton_pipeline_definition'])) {
                    try {
                        const thisUrl = v['source'][0]['properties'][0]['url'];
                        const newUrl = gritMapping[thisUrl];

                        if (newUrl) {
                            newTfFileObj['resource']['ibm_cd_tekton_pipeline_definition'][k]['source'][0]['properties'][0]['url'] = newUrl;
                        }
                    }
                    catch {
                        // do nothing
                    }
                }
            }
        }

        // add references to converted GHE integrations
        if (isCompact || resourceName === 'ibm_cd_tekton_pipeline_property') {
            for (const [k, v] of Object.entries(newTfFileObj['resource']['ibm_cd_tekton_pipeline_property'])) {
                try {
                    if (v['type'] === 'integration') {
                        const thisValue = v['value'];

                        if (thisValue in toolIdToTfName) {
                            const thisTfName = toolIdToTfName[thisValue];
                            newTfFileObj['resource']['ibm_cd_tekton_pipeline_property'][k]['value'] = `\${ibm_cd_toolchain_tool_githubconsolidated.${thisTfName}.tool_id}`;
                        }
                    }
                }
                catch {
                    // do nothing
                }

            }
        }

        // add references to converted GHE integrations
        if (isCompact || resourceName === 'ibm_cd_tekton_pipeline_trigger_property') {
            for (const [k, v] of Object.entries(newTfFileObj['resource']['ibm_cd_tekton_pipeline_trigger_property'])) {
                try {
                    if (v['type'] === 'integration') {
                        const thisValue = v['value'];

                        if (thisValue in toolIdToTfName) {
                            const thisTfName = toolIdToTfName[thisValue];
                            newTfFileObj['resource']['ibm_cd_tekton_pipeline_trigger_property'][k]['value'] = `\${ibm_cd_toolchain_tool_githubconsolidated.${thisTfName}.tool_id}`;
                        }
                    }
                }
                catch {
                    // do nothing
                }

            }
        }

        if (isCompact || resourceName === 'ibm_cd_toolchain_tool_githubconsolidated') {
            if (hasGHE) {
                newTfFileObj['resource']['ibm_cd_toolchain_tool_githubconsolidated'] = {
                    ...(newTfFileObj['resource']['ibm_cd_toolchain_tool_githubconsolidated'] ?? {}),
                    ...newConvertedTf
                };
            }
        }

        const newTfFileObjStr = JSON.stringify(newTfFileObj);
        let newTfFile = replaceDependsOn(jsonToTf(newTfFileObjStr));
        if (includeS2S && (isCompact || resourceName === 'ibm_cd_toolchain')) newTfFile = addS2sScriptToToolchainTf(newTfFile);
        const copyResourcesPromise = writeFilePromise(`${outputDir}/${fileName}`, newTfFile);
        promises.push(copyResourcesPromise);
    }

    // handle case where there is no GH tool integrations, and not compact
    if (hasGHE && !isCompact && !files.includes('cd_toolchain_tool_githubconsolidated.tf')) {
        const newTfFileObj = { 'resource': { ['ibm_cd_toolchain_tool_githubconsolidated']: newConvertedTf } };
        const newTfFileObjStr = JSON.stringify(newTfFileObj);
        const newTfFile = jsonToTf(newTfFileObjStr);
        const copyResourcesPromise = writeFilePromise(`${outputDir}/cd_toolchain_tool_githubconsolidated.tf`, newTfFile);
        promises.push(copyResourcesPromise);
    }

    return Promise.all(promises);
}

async function runTerraformInit(dir, verbosity) {
    logger.log('Running command \'terraform init\'', LOG_STAGES.tf);
    const out = await execPromise('terraform init', { cwd: dir });
    if (verbosity >= 2) logger.print(out, '\n');
    logger.log('Command \'terraform init\' completed', LOG_STAGES.tf);
    return out;
}

async function runTerraformPlanGenerate(dir, fileName) {
    return await execPromise(`terraform plan -generate-config-out="${fileName}"`, { cwd: dir });
}

// primarily used to get number of resources to be used
async function getNumResourcesPlanned(dir) {
    const planOutput = await execPromise('terraform plan -json', { cwd: dir });
    const planLines = planOutput.split('\n');

    for (const p of planLines) {
        const jsonLine = JSON.parse(p);

        if (jsonLine.type === 'change_summary') {
            return jsonLine.changes.add;
        }
    };
}

async function runTerraformApply(skipTfConfirmation, outputDir, verbosity, target) {
    let command = 'terraform apply';
    if (skipTfConfirmation || verbosity === 0) {
        command = 'terraform apply -auto-approve';
    }
    if (target) {
        command += ` -target="${target}"`
    }

    const child = child_process.spawn(command, {
        cwd: `${outputDir}`,
        stdio: ['inherit', 'pipe', 'pipe'], // to pass stdin from the parent process, and pipe the stdout and stderr
        shell: true,
        env: process.env,
    });

    let stdoutData = '';
    let stderrData = '';

    child.stdout.on('data', (chunk) => {
        const text = chunk.toString();
        stdoutData += text;
        if (verbosity >= 1) {
            process.stdout.write(text);
            logger.dump(text);
        }
    });

    child.stderr.on('data', (chunk) => {
        const text = chunk.toString();
        stderrData += text;
        if (verbosity >= 1) {
            process.stderr.write(text);
            logger.dump(text);
        }
    });

    return await new Promise((resolve, reject) => {
        child.on('close', (code) => {
            if (code === 0) {
                resolve(stdoutData.trim());
            } else {
                reject(new Error(`Terraform apply failed with code ${code}`));
            }
        });
    });
}

async function getNumResourcesCreated(dir) {
    try {
        // prints a line for every resource in the state file
        const resourcesListStr = await execPromise('terraform state list', { cwd: dir });
        return resourcesListStr.split('\n').length;
    } catch {
        return 0;
    }
}

// get new toolchain link from terraform output
async function getNewToolchainId(dir) {
    try {
        const output = await execPromise('terraform output', { cwd: dir });

        // should look something like: ibm_cd_toolchain_tfer--<toolchain_resource>_id = "<new_toolchain_id>"
        const lineSplit = output.split('"');
        const newTcId = lineSplit[lineSplit.length - 2];

        return validateToolchainId(newTcId);
    } catch {
        return '';
    }
}

// fix quoted references warning for depends_on
function replaceDependsOn(str) {
    try {
        if (typeof str === 'string') {
            const pattern = /^  depends_on = \[\n    ("[a-z0-9_\-.]*")\n  ]$/gm;

            // get rid of the quotes
            return str.replaceAll(pattern, (match, s) => `  depends_on = \[\n    ${s.slice(1, s.length - 1)}\n  ]`);
        }
    } catch {
        return str;
    }
}

function addS2sScriptToToolchainTf(str) {
    const provisionerStr = (tfName) => `\n\n  provisioner "local-exec" {
    command = "node create-s2s-script.js"
    environment = {
      IBMCLOUD_API_KEY = var.ibmcloud_api_key
      TARGET_TOOLCHAIN_ID = ibm_cd_toolchain.${tfName}.id
    }\n  }`
    try {
        if (typeof str === 'string') {
            const pattern = /^resource "ibm_cd_toolchain" "([a-z0-9_-]*)" \{$\n((.|\n)*)\n^\}$/gm;

            // get rid of the quotes
            return str.replace(pattern, (match, s1, s2) => `resource "ibm_cd_toolchain" "${s1}" {\n${s2}${provisionerStr(s1)}\n}`);
        }
    } catch {
        return str;
    }
}

export {
    setTerraformEnv,
    initProviderFile,
    setupTerraformFiles,
    runTerraformInit,
    runTerraformPlanGenerate,
    getNumResourcesPlanned,
    runTerraformApply,
    getNewToolchainId,
    getNumResourcesCreated
}
