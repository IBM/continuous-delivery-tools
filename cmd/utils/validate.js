/**
 * Licensed Materials - Property of IBM
 * (c) Copyright IBM Corporation 2025. All Rights Reserved.
 *
 * Note to U.S. Government Users Restricted Rights:
 * Use, duplication or disclosure restricted by GSA ADP Schedule
 * Contract with IBM Corp.
 */

import { execSync } from 'child_process';
import { logger, LOG_STAGES } from './logger.js'
import { RESERVED_GRIT_PROJECT_NAMES, RESERVED_GRIT_GROUP_NAMES, RESERVED_GRIT_SUBGROUP_NAME, TERRAFORM_REQUIRED_VERSION, SECRET_KEYS_MAP } from '../../config.js';
import { getToolchainsByName, getToolchainTools, getPipelineData, getAppConfigHealthcheck, getSecretsHealthcheck, getGitOAuth, getGritUserProject, getGritGroup, getGritGroupProject } from './requests.js';
import { promptUserConfirmation, promptUserInput, isSecretReference } from './utils.js';


function validatePrereqsVersions() {
    const compareVersions = (verInstalled, verRequired) => {
        const installedSplit = verInstalled.split('.').map(Number);
        const requiredSplit = verRequired.split('.').map(Number);
        for (let j = 0; j < Math.max(installedSplit.length, requiredSplit.length); j++) {
            const i = installedSplit[j] || 0;
            const r = requiredSplit[j] || 0;
            if (i > r) return true;
            if (i < r) return false;
        }
        return true;
    };

    let stdout;
    let version;

    try {
        stdout = execSync('terraform version').toString();
    } catch {
        throw Error('Terraform is not installed or not in PATH');
    }
    version = stdout.match(/\d+(\.\d+)+/)[0];
    if (!compareVersions(version, TERRAFORM_REQUIRED_VERSION)) {
        throw Error(`Terraform does not meet minimum version requirement: ${TERRAFORM_REQUIRED_VERSION}`);
    }
    logger.info(`\x1b[32m✔\x1b[0m Terraform Version: ${version}`, LOG_STAGES.setup);
}

function validateToolchainId(tcId) {
    if (typeof tcId != 'string') throw Error('Provided toolchain ID is not a string');
    const trimmed = tcId.trim();

    // pattern from api docs
    const pattern = /^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-4[a-fA-F0-9]{3}-[89abAB][a-fA-F0-9]{3}-[a-fA-F0-9]{12}$/;
    if (pattern.test(trimmed)) {
        return trimmed;
    }
    throw Error('Provided toolchain ID is invalid');
}

function validateToolchainName(tcName) {
    if (typeof tcName != 'string') throw Error('Provided toolchain name is not a string');
    const trimmed = tcName.trim();

    // pattern from api docs
    const pattern = /^([^\x00-\x7F]|[a-zA-Z0-9-._ ])+$/;
    if (trimmed.length <= 128 && pattern.test(trimmed.trim())) {
        return trimmed;
    }
    throw Error('Provided toolchain name is invalid');
}

function validateTag(tag) {
    if (typeof tag != 'string') throw Error('Provided resource group ID is not a string');
    const trimmed = tag.trim();

    // only contains alphanumeric characters, spaces, underscores, dashes, periods and colons not at start or end
    const pattern = /^[a-zA-Z0-9-._ ]{1,126}[a-zA-Z0-9-._ :]{1,126}[a-zA-Z0-9-._ ]{1,126}$|^([a-zA-Z0-9-._ ]{1,128})$/;
    if (trimmed.length <= 128 && pattern.test(trimmed.trim())) {
        return trimmed;
    }
    throw Error('Provided tag is invalid');
}


async function warnDuplicateName(token, accountId, tcName, srcRegion, targetRegion, targetResourceGroupId, targetResourceGroupName, targetTag, skipPrompt) {
    const toolchains = await getToolchainsByName(token, accountId, tcName);

    let hasSameRegion = false;
    let hasSameResourceGroup = false;
    let hasBoth = false;

    if (toolchains.length > 0) {
        let newTcName = tcName;
        let newTag = targetTag;

        toolchains.forEach((tc) => {
            if (tc.region_id === targetRegion) {
                if (tc.resource_group_id === targetResourceGroupId) {
                    hasBoth = true;
                } else {
                    hasSameRegion = true;
                }
            } else if (tc.resource_group_id === targetResourceGroupId) {
                hasSameResourceGroup = true;
            }
        });

        if (hasBoth) {
            // warning! prompt user to cancel, rename (e.g. add a suffix) or continue
            logger.warn(`\nWarning! A toolchain named '${tcName}' already exists in:\n - Region: ${targetRegion}\n - Resource Group: ${targetResourceGroupName} (${targetResourceGroupId})`, '', true);

            if (!skipPrompt) {
                newTcName = await promptUserInput(`\n(Recommended) Edit the cloned toolchain's name [default: ${tcName}] (Ctrl-C to abort):\n`, tcName, validateToolchainName);
            }
        } else {
            if (hasSameRegion) {
                // soft warning of confusion
                logger.warn(`\nWarning! A toolchain named '${tcName}' already exists in:\n - Region: ${targetRegion}`, '', true);
            }
            if (hasSameResourceGroup) {
                // soft warning of confusion
                logger.warn(`\nWarning! A toolchain named '${tcName}' already exists in:\n - Resource Group: ${targetResourceGroupName} (${targetResourceGroupId})`, '', true);
            }
        }

        if (hasBoth || hasSameRegion || hasSameResourceGroup) {
            // suggest a tag, if one not provided
            if (!targetTag) {
                if (!skipPrompt) {
                    const validateTagOrEmpty = (str) => {
                        if (str.trim() === '') return null;
                        return validateTag(str);
                    }
                    newTag = await promptUserInput('\n(Recommended) Add a tag to the cloned toolchain (Ctrl-C to abort):\n', `cloned-from-${srcRegion}`, validateTagOrEmpty);
                }
            }
            return [newTcName, newTag];
        } else {
            return [tcName, targetTag];
        }
    } else {
        return [tcName, targetTag];
    }
}

async function validateTools(token, tcId, region, skipPrompt) {
    const allTools = await getToolchainTools(token, tcId, region);
    const nonConfiguredTools = [];
    const toolsWithHashedParams = [];
    const patTools = [];
    const gheTools = [];
    const classicPipelines = [];

    for (const tool of allTools.tools) {
        const toolName = (tool.name || tool.parameters?.name || tool.parameters?.label || '').replace(/\s+/g, '+');
        logger.updateSpinnerMsg(`Validating tool \'${toolName}\'`);
        const toolUrl = `https://cloud.ibm.com/devops/toolchains/${tool.toolchain_id}/configure/${tool.id}?env_id=ibm:yp:${region}`;

        if (tool.state !== 'configured') {  // Check for tools in misconfigured/unconfigured/configuring state
            nonConfiguredTools.push({
                tool_name: toolName,
                type: tool.tool_type_id,
                state: tool.state,
                url: toolUrl
            });
        } else {
            // handle health check failures, which forces an "error" state in the UI
            if (tool.tool_type_id === 'appconfig') {
                try {
                    await getAppConfigHealthcheck(token, tcId, tool.id, region);
                } catch {
                    nonConfiguredTools.push({
                        tool_name: toolName,
                        type: tool.tool_type_id,
                        state: 'error',
                        url: toolUrl
                    });
                }
            } else if (['hashicorpvault', 'secretsmanager', 'keyprotect'].includes(tool.tool_type_id)) {
                try {
                    // secrets healthcheck uses parameter name
                    const paramName = tool.parameters?.name || '';
                    await getSecretsHealthcheck(token, tcId, paramName, region);
                } catch {
                    nonConfiguredTools.push({
                        tool_name: toolName,
                        type: tool.tool_type_id,
                        state: 'error',
                        url: toolUrl
                    });
                }
            }
        }

        if (tool.tool_type_id === 'hostedgit' && tool.parameters?.auth_type === 'pat') {   // Check for GRIT using PAT
            patTools.push({
                tool_name: toolName,
                type: tool.tool_type_id,
                url: toolUrl
            });
        }

        if (tool.tool_type_id === 'github_integrated') {
            gheTools.push({
                tool_name: toolName,
                type: tool.tool_type_id,
                url: toolUrl
            });
        }

        if (tool.tool_type_id === 'pipeline' && tool.parameters?.type === 'classic') { // Check for Classic pipelines
            classicPipelines.push({
                tool_name: toolName,
                type: 'classic pipeline',
                url: toolUrl
            });
        }

        if (['githubconsolidated', 'github_integrated', 'gitlab', 'hostedgit'].includes(tool.tool_type_id) && (tool.parameters?.auth_type === '' || tool.parameters?.auth_type === 'oauth')) { // Skip secret check iff it's GitHub/GitLab/GRIT integration with OAuth
            continue;
        }
        else {
            const secrets = [];
            if (tool.tool_type_id === 'pipeline' && tool.parameters?.type === 'tekton') {   // Check for secrets in Tekton pipeline
                const pipelineData = await getPipelineData(token, tool.id, region);

                pipelineData.properties.forEach((prop) => {
                    if (prop.type === 'secure' && !isSecretReference(prop.value) && prop.value.length > 0)
                        secrets.push(['properties', prop.name].join('.').replace(/\s+/g, '+'));
                });

                pipelineData.triggers.forEach((trigger) => {
                    if ((trigger?.secret?.type === 'token_matches' || trigger?.secret?.type === 'digest_matches') && !isSecretReference(trigger.secret.value) && trigger.secret.value.length > 0)
                        secrets.push([trigger.name, trigger.secret.key_name].join('.').replace(/\s+/g, '+'));
                    trigger.properties.forEach((prop) => {
                        if (prop.type === 'secure' && !isSecretReference(prop.value) && prop.value.length > 0)
                            secrets.push([trigger.name, 'properties', prop.name].join('.').replace(/\s+/g, '+'));
                    });
                });
            }
            else {
                const secretsToCheck = (SECRET_KEYS_MAP[tool.tool_type_id] || []).map((entry) => entry.key);    // Check for secrets in the rest of the tools
                Object.entries(tool.parameters).forEach(([key, value]) => {
                    if (!isSecretReference(value) && value.length > 0 && secretsToCheck.includes(key)) secrets.push(key);
                });
            }
            if (secrets.length > 0) {
                toolsWithHashedParams.push({
                    tool_name: toolName,
                    type: tool.tool_type_id,
                    secret_params: secrets,
                    url: toolUrl
                });
            }
        }
    }
    const hasInvalidConfig = nonConfiguredTools.length > 0 || toolsWithHashedParams.length > 0;

    if (classicPipelines.length > 0) {
        logger.failSpinner('Unsupported tools found!');
        logger.warn('Warning! Classic pipelines are currently not supported in migration:\n', LOG_STAGES.setup, true);
        logger.table(classicPipelines);
    }

    if (hasInvalidConfig) logger.failSpinner('Configuration problems found!');
    if (classicPipelines.length > 0 || hasInvalidConfig) logger.resetSpinner();    // Manually reset spinner to prevent duplicate spinners

    if (nonConfiguredTools.length > 0) {
        logger.warn('Warning! The following tool(s) are not in configured state in toolchain, please reconfigure them before proceeding: \n', LOG_STAGES.setup, true);
        logger.table(nonConfiguredTools);
    }

    if (patTools.length > 0) {
        logger.warn('Warning! The following GRIT integration(s) with auth_type "pat" are unsupported during migration and will automatically be converted to auth_type "oauth": \n', LOG_STAGES.setup, true);
        logger.table(patTools);
    }

    if (gheTools.length > 0) {
        logger.warn('Warning! The following legacy GHE integration(s) are unsupported during migration will automatically be converted to equivalent GitHub integrations: \n', LOG_STAGES.setup, true);
        logger.table(gheTools);
    }

    if (toolsWithHashedParams.length > 0) {
        logger.warn('Warning! The following tools contain secrets that cannot be migrated, please use the \'check-secrets\' command to export the secrets: \n', LOG_STAGES.setup, true);
        logger.table(toolsWithHashedParams);
    }

    if (!skipPrompt && (classicPipelines.length > 0 || hasInvalidConfig))
        await promptUserConfirmation('Caution: The above tool(s) will not be properly configured post migration. Do you want to proceed?', 'yes', 'Toolchain migration cancelled.');

    return allTools.tools;
}

async function validateOAuth(token, tools, targetRegion, skipPrompt) {
    let gitTools = [];

    for (const tool of tools) {
        const toolName = tool.parameters?.label || tool.parameters?.name || tool.name;

        let gitId = tool.parameters?.git_id;

        // the following gets the authorize_url for each source, uniquely identifying GHE and non-GHE repos
        if (tool.tool_type_id === 'githubconsolidated' || tool.tool_type_id === 'github_integrated') {
            // GHE gets converted anyway, so include in GH case
            if (tool.parameters?.auth_type != 'oauth' || !tool.parameters?.git_id) continue;
            tool._sortId = gitId;
            tool._label = toolName;
            gitTools.push(tool);
        } else if (tool.tool_type_id === 'gitlab') {
            if (tool.parameters?.auth_type != 'oauth' || !tool.parameters?.git_id) continue;
            tool._sortId = gitId;
            tool._label = toolName;
            gitTools.push(tool);
        } else if (tool.tool_type_id === 'bitbucketgit') {
            // has no auth_type
            if (!tool.parameters?.git_id) continue;
            tool._sortId = gitId;
            tool._label = toolName;
            gitTools.push(tool);
        } else if (tool.tool_type_id === 'hostedgit') {
            // in GRIT case, getGitOAuth will actually authorize automatically
            if (tool.parameters?.auth_type != 'oauth' || !tool.parameters?.git_id) continue;
            tool._sortId = gitId;
            tool._label = toolName;
            gitTools.push(tool);
        }
    }

    // sort gitTools by _sortId = git_id (asc), then name (asc)
    gitTools = gitTools.sort((a, b) => {
        if (a._sortId < b._sortId) {
            return -1;
        } else if (a._sortId > b._sortId) {
            return 1;
        } else {
            if (a._label < b._label) {
                return -1;
            } else if (a._label > b._label) {
                return 1;
            } else {
                return 0
            }
        };
    });

    const failedOAuth = new Set();
    const successfulOAuth = new Set();
    const failedTools = [];
    const oauthLinks = [];

    for (const tool of gitTools) {
        const isGHE = tool._sortId === 'integrated';

        if (failedOAuth.has(tool._sortId)) {
            // don't retry failed attempts
            failedTools.push({
                tool_name: tool._label,
                type: tool.tool_type_id + (isGHE ? ' (GHE)' : ''),
                link: '',
            })
        } else if (successfulOAuth.has(tool._sortId)) {
            // don't retry successful attempts
        } else {
            try {
                // attempt to get access token, meaning oauth was set up correctly
                await getGitOAuth(token, targetRegion, tool.parameters?.git_id);
                successfulOAuth.add(tool._sortId);
            } catch (authorizeUrl) {
                failedOAuth.add(tool._sortId);
                failedTools.push({
                    tool_name: tool._label,
                    type: tool.tool_type_id + (isGHE ? ' (GHE)' : ''),
                    link: authorizeUrl?.message != 'Get git OAuth failed' ? 'See link below' : 'Get git OAuth failed',
                })
                if (isGHE) {
                    oauthLinks.push({ type: 'githubconsolidated (GHE)', link: authorizeUrl?.message });
                } else {
                    oauthLinks.push({ type: tool.tool_type_id, link: authorizeUrl?.message });
                }
            }
        }
    }

    // Manually fail and reset spinner to prevent duplicate spinners
    if (failedOAuth.size > 0) {
        logger.failSpinner();
        logger.resetSpinner();

        logger.warn('Warning! The following git tool integration(s) are not authorized in the target region: \n', LOG_STAGES.setup, true);
        logger.table(failedTools);

        let hasFailedLink = false;

        if (oauthLinks.length > 0) logger.print('Authorize using the following links:\n');
        oauthLinks.forEach((o) => {
            if (o.link === 'Get git OAuth failed') hasFailedLink = true;
            logger.print(`${o.type}: \x1b[36m${o.link}\x1b[0m\n`);
        });

        if (hasFailedLink) logger.print(`Please manually verify failed authorization(s): https://cloud.ibm.com/devops/git?env_id=ibm:yp:${targetRegion}\n`);

        if (!skipPrompt) await promptUserConfirmation('Caution: The above git tool integration(s) will not be properly configured post migration. Do you want to proceed?', 'yes', 'Toolchain migration cancelled.');
    }
}

async function validateGritUrl(token, region, url, validateFull) {
    if (typeof url != 'string') throw Error('Provided GRIT url is not a string');
    let trimmed;

    if (validateFull) {
        if (!url.startsWith(`https://${region}.git.cloud.ibm.com/`) || !url.endsWith('.git')) throw Error('Provided full GRIT url is not valid');
        trimmed = url.slice(`https://${region}.git.cloud.ibm.com/`.length, url.length - '.git'.length);
    } else {
        trimmed = url.trim();
    }

    // split into two parts, user/group/subgroup and project
    const urlSplit = trimmed.split('/');
    if (urlSplit.length < 2) throw Error('Provided GRIT url is invalid (missing forward-slash)');

    const projectName = urlSplit[urlSplit.length - 1];
    const urlStart = trimmed.slice(0, trimmed.length - projectName.length - 1);

    // check reserved names, see https://docs.gitlab.com/user/reserved_names/
    if (RESERVED_GRIT_PROJECT_NAMES.includes(projectName)) throw Error('Provided GRIT url invalid (contains reserved name)');
    if (RESERVED_GRIT_GROUP_NAMES.includes(urlStart)) throw Error('Provided GRIT url invalid (contains reserved name)');
    if (urlStart.includes(RESERVED_GRIT_SUBGROUP_NAME)) throw Error('Provided GRIT url invalid (contains reserved name)');

    // valid characters only, max length 255
    const pattern1 = /^[a-zA-Z0-9-._]{0,255}$/;
    const pattern1alt = /^[a-zA-Z0-9-._\/]{0,255}$/;

    // starts and ends with alphanumeric
    const pattern2 = /^[a-zA-Z0-9].*$/;
    const pattern3 = /^.*[a-zA-Z0-9]$/;

    // no consecutive special characters
    const pattern4 = /^.*[-._\/]{2,}.*$/; // want false

    if (!pattern1.test(projectName)) throw Error('Provided project contains illegal character(s)');
    if (!pattern2.test(projectName)) throw Error('Provided project does not start with an alphanumeric character');
    if (!pattern3.test(projectName)) throw Error('Provided project does not end with an alphanumeric character');
    if (pattern4.test(projectName)) throw Error('Provided project contains consecutive special characters');
    if (!pattern1alt.test(urlStart)) throw Error('Provided user/group contains illegal character(s)');
    if (!pattern2.test(urlStart)) throw Error('Provided user/group does not start with an alphanumeric character');
    if (!pattern3.test(urlStart)) throw Error('Provided user/group does not end with an alphanumeric character');
    if (pattern4.test(urlStart)) throw Error('Provided user/group contains consecutive special characters');

    // cannot end with .git or .atom
    if (projectName.endsWith('.git') && !projectName.endsWith('.atom')) throw Error('Provided GRIT url contains .git or .atom suffix');
    const accessToken = await getGitOAuth(token, region, 'hostedgit');

    // validate using API
    let hasFailed = false;

    // try user
    try {
        await getGritUserProject(accessToken, region, urlStart, projectName);
    } catch {
        hasFailed = true;
    }

    if (!hasFailed) return trimmed;

    // try group
    try {
        await getGritGroupProject(accessToken, region, urlStart, projectName);
        return trimmed;
    } catch {
        throw Error('Provided GRIT url not found');
    }
}

export {
    validatePrereqsVersions,
    validateToolchainId,
    validateToolchainName,
    validateTag,
    validateTools,
    validateOAuth,
    validateGritUrl,
    warnDuplicateName
}
