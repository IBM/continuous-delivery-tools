/**
 * Licensed Materials - Property of IBM
 * (c) Copyright IBM Corporation 2025. All Rights Reserved.
 *
 * Note to U.S. Government Users Restricted Rights:
 * Use, duplication or disclosure restricted by GSA ADP Schedule
 * Contract with IBM Corp.
 */

import axios from 'axios';
import axiosRetry from 'axios-retry';

import mocks from '../../test/data/mocks.js'
import { logger, LOG_STAGES } from './logger.js';

const CLOUD_PLATFORM = process.env['IBMCLOUD_PLATFORM_DOMAIN'] || 'cloud.ibm.com';
const DEV_MODE = CLOUD_PLATFORM !== 'cloud.ibm.com';
const IAM_BASE_URL = DEV_MODE ? process.env['IBMCLOUD_IAM_API_ENDPOINT'] : 'https://iam.cloud.ibm.com';
const GHOST_BASE_URL = DEV_MODE ? process.env['IBMCLOUD_GS_API_ENDPOINT'] : 'https://api.global-search-tagging.cloud.ibm.com';
const DEVOPS_BASE_URL = DEV_MODE ? process.env['IBMCLOUD_DEVOPS_URL'] : 'https://cloud.ibm.com/devops';
const TOOLCHAIN_BASE_ENDPOINT = DEV_MODE ? process.env['IBMCLOUD_TOOLCHAIN_ENDPOINT'] : '';
const PIPELINE_BASE_ENDPOINT = DEV_MODE ? process.env['IBMCLOUD_TEKTON_PIPELINE_ENDPOINT'] : '';
const GIT_BASE_ENDPOINT = DEV_MODE ? process.env['IBMCLOUD_GIT_ENDPOINT'] : '';
const OTC_BASE_ENDPOINT = DEV_MODE ? process.env['IBMCLOUD_OTC_ENDPOINT'] : '';

const MOCK_ALL_REQUESTS = process.env.MOCK_ALL_REQUESTS === 'true' || 'false';

axiosRetry(axios, {
    retries: 3,
    retryDelay: axiosRetry.exponentialDelay,
    retryCondition: (error) => {
        return axiosRetry.isNetworkOrIdempotentRequestError(error) || error.response?.status === 500;
    },
});

axios.defaults.timeout = 10000;     // 10 seconds

axios.interceptors.request.use(request => {
    logger.debug(`${request.method.toUpperCase()} ${request.url}`, LOG_STAGES.request);
    if (request.data) {
        const body = typeof request.data === 'string'
            ? request.data
            : JSON.stringify(request.data);
        logger.log(`Https Request body: ${body}`, LOG_STAGES.request);
    }
    return request;
});

axios.interceptors.response.use(response => {
    if (response.data) {
        let body = typeof response.data === 'string'
            ? response.data
            : JSON.stringify(response.data);
        if (response.data.access_token)   // Redact user access token in logs
            body = body.replaceAll(response.data.access_token, '<USER ACCESS TOKEN>');
        logger.log(`Https Response body: ${body}`, LOG_STAGES.request);
    }
    return response;
}, error => {
    if (error.response) {
        logger.log(`Error response status: ${error.response.status} ${error.response.statusText}`, LOG_STAGES.request);
        logger.log(`Error response body: ${JSON.stringify(error.response.data)}`, LOG_STAGES.request);
    } else {
        logger.log(`Error message: ${error.message}`, LOG_STAGES.request);
    }
    return Promise.reject(error);
});

async function getBearerToken(apiKey) {
    const iamUrl = IAM_BASE_URL + '/identity/token';
    const params = new URLSearchParams();
    params.append('grant_type', 'urn:ibm:params:oauth:grant-type:apikey');
    params.append('apikey', apiKey);
    params.append('response_type', 'cloud_iam');
    const options = {
        method: 'POST',
        url: iamUrl,
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        data: params,
        validateStatus: () => true
    };
    const response = await axios(options);
    if (response.status !== 200) {
        throw Error('There was a problem getting a bearer token using IBMCLOUD_API_KEY');
    }
    return response.data.access_token;
}

async function getAccountId(bearer, apiKey) {
    const iamUrl = IAM_BASE_URL + '/v1/apikeys/details';
    const options = {
        method: 'GET',
        url: iamUrl,
        headers: {
            'Authorization': `Bearer ${bearer}`,
            'Content-Type': 'application/json',
            'IAM-ApiKey': apiKey
        },
        validateStatus: () => true
    };
    const response = await axios(options);
    if (response.status !== 200) {
        throw Error('There was a problem getting account_id using IBMCLOUD_API_KEY');
    }
    return response.data.account_id;
}

async function getToolchain(bearer, toolchainId, region) {
    const apiBaseUrl = TOOLCHAIN_BASE_ENDPOINT || `https://api.${region}.devops.cloud.ibm.com/toolchain/v2`;
    const options = {
        method: 'GET',
        url: `${apiBaseUrl}/toolchains/${toolchainId}`,
        headers: {
            'Accept': 'application/json',
            'Authorization': `Bearer ${bearer}`,
            'Content-Type': 'application/json',
        },
        validateStatus: () => true
    };
    const response = await axios(options);
    switch (response.status) {
        case 200:
            return response.data;
        case 404:
            throw Error('The toolchain with provided CRN was not found or is not accessible');
        default:
            throw Error(response.statusText);
    }
}

async function getToolchainsByName(bearer, accountId, toolchainName) {
    const options = {
        url: GHOST_BASE_URL + '/v3/resources/search',
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${bearer}`,
            'Content-Type': 'application/json',
        },
        data: {
            'query': `service_name:toolchain AND name:"${toolchainName}" AND doc.state:ACTIVE`,
            'fields': ['doc.resource_group_id', 'doc.region_id']
        },
        params: { account_id: accountId },
        validateStatus: () => true
    };
    const response = await axios(options);
    switch (response.status) {
        case 200:
            return response.data.items.map(item => { return { resource_group_id: item.doc.resource_group_id, region_id: item.doc.region_id } });
        default:
            throw Error('Get toolchains failed');
    }
}

async function getCdInstanceByRegion(bearer, accountId, region) {
    if (MOCK_ALL_REQUESTS && process.env.MOCK_GET_CD_INSTANCE_BY_REGION_SCENARIO) {
        return mocks.getCdInstanceByRegionResponses[process.env.MOCK_GET_CD_INSTANCE_BY_REGION_SCENARIO].data.items.length > 0;
    }

    const options = {
        url: GHOST_BASE_URL + '/v3/resources/search',
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${bearer}`,
            'Content-Type': 'application/json',
        },
        data: {
            'query': `service_name:continuous-delivery AND region:"${region}" AND doc.state:ACTIVE`,
            'fields': ['doc.resource_group_id', 'doc.region_id']
        },
        params: { account_id: accountId },
        validateStatus: () => true
    };
    const response = await axios(options);
    switch (response.status) {
        case 200:
            return response.data.items.length > 0;
        default:
            throw Error('Get CD instance failed');
    }
}

async function getToolchainTools(bearer, toolchainId, region) {
    const apiBaseUrl = TOOLCHAIN_BASE_ENDPOINT || `https://api.${region}.devops.cloud.ibm.com/toolchain/v2`;
    const options = {
        method: 'GET',
        url: `${apiBaseUrl}/toolchains/${toolchainId}/tools`,
        headers: {
            'Accept': 'application/json',
            'Authorization': `Bearer ${bearer}`,
            'Content-Type': 'application/json',
        },
        params: { limit: 150 },
        validateStatus: () => true
    };
    const response = await axios(options);
    switch (response.status) {
        case 200:
            return response.data;
        default:
            throw Error(response.statusText);
    }
}

async function getPipelineData(bearer, pipelineId, region) {
    const apiBaseUrl = PIPELINE_BASE_ENDPOINT || `https://api.${region}.devops.cloud.ibm.com/pipeline/v2`;
    const options = {
        method: 'GET',
        url: `${apiBaseUrl}/tekton_pipelines/${pipelineId}`,
        headers: {
            'Accept': 'application/json',
            'Authorization': `Bearer ${bearer}`,
            'Content-Type': 'application/json',
        },
        validateStatus: () => true
    };
    const response = await axios(options);
    switch (response.status) {
        case 200:
            return response.data;
        default:
            throw Error(response.statusText);
    }
}

// takes in list of resource group IDs or names
async function getResourceGroups(bearer, accountId, resourceGroups) {
    const options = {
        url: GHOST_BASE_URL + '/v3/resources/search',
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${bearer}`,
            'Content-Type': 'application/json',
        },
        data: {
            'query': `type:resource-group AND doc.state:ACTIVE AND (${resourceGroups.map(rg => `name:${rg} OR doc.id:${rg}`).join(' OR ')})`,
            'fields': ['doc.id', 'doc.name']
        },
        params: { account_id: accountId },
        validateStatus: () => true
    };
    const response = await axios(options);
    switch (response.status) {
        case 200:
            if (response.data.items.length === 0) throw Error('No matching resource groups were found for the provided id(s) or name(s)');
            return response.data.items.map(item => { return { id: item.doc.id, name: item.doc.name } });
        default:
            throw Error('No matching resource groups were found for the provided id(s) or name(s)');
    }
}

async function getAppConfigHealthcheck(bearer, tcId, toolId, region) {
    const options = {
        url: DEVOPS_BASE_URL + '/api/v1/appconfig/healthcheck',
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${bearer}`,
            'Content-Type': 'application/json',
        },
        params: { toolchainId: tcId, serviceId: toolId, env_id: `ibm:yp:${region}` },
        validateStatus: () => true
    };
    const response = await axios(options);
    switch (response.status) {
        case 200:
            return
        default:
            throw Error('Healthcheck failed');
    }
}

async function getSecretsHealthcheck(bearer, tcId, toolName, region) {
    const options = {
        url: DEVOPS_BASE_URL + '/api/v1/secrets/healthcheck',
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${bearer}`,
            'Content-Type': 'application/json',
        },
        params: { toolchainId: tcId, integrationName: toolName, env_id: `ibm:yp:${region}` },
        validateStatus: () => true
    };
    const response = await axios(options);
    switch (response.status) {
        case 200:
            return
        default:
            throw Error('Healthcheck failed');
    }
}

async function getGitOAuth(bearer, targetRegion, gitId) {
    const options = {
        url: DEVOPS_BASE_URL + '/git/api/v1/tokens',
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${bearer}`,
            'Content-Type': 'application/json',
        },
        params: { env_id: `ibm:yp:${targetRegion}`, git_id: gitId, console_url: `https://${CLOUD_PLATFORM}`, return_uri: `https://${CLOUD_PLATFORM}/devops/git/static/github_return.html` },
        validateStatus: () => true
    };
    const response = await axios(options);
    switch (response.status) {
        case 200:
            return response.data?.access_token;
        case 401:
            throw Error(response.data?.authorizationURI ?? 'Get git OAuth failed');
        default:
            throw Error('Get git OAuth failed');
    }
}

async function getGritUserProject(privToken, region, user, projectName) {
    const apiBaseUrl = GIT_BASE_ENDPOINT || `https://${region}.git.cloud.ibm.com/api/v4`;
    const options = {
        url: apiBaseUrl + `/users/${user}/projects`,
        method: 'GET',
        headers: {
            'PRIVATE-TOKEN': privToken
        },
        params: { simple: true, search: projectName },
        validateStatus: () => true
    };
    const response = await axios(options);
    switch (response.status) {
        case 200:
            const found = response.data?.find((entry) => entry['path'] === projectName);
            if (!found) throw Error('GRIT user project not found');
            return;
        default:
            throw Error('Get GRIT user project failed');
    }
}

async function getGritGroup(privToken, region, groupName) {
    const apiBaseUrl = GIT_BASE_ENDPOINT || `https://${region}.git.cloud.ibm.com/api/v4`;
    const options = {
        url: apiBaseUrl + `/groups/${groupName}`,
        method: 'GET',
        headers: {
            'PRIVATE-TOKEN': privToken
        },
        validateStatus: () => true
    };
    const response = await axios(options);
    switch (response.status) {
        case 200:
            const found = response.data?.find((entry) => entry['full_path'] === groupName);
            if (!found) throw Error('GRIT group not found');
            return found['id'];
        default:
            throw Error('Get GRIT group failed');
    }
}

async function getGritGroupProject(privToken, region, groupId, projectName) {
    const apiBaseUrl = GIT_BASE_ENDPOINT || `https://${region}.git.cloud.ibm.com/api/v4`;
    const options = {
        url: apiBaseUrl + `/groups/${groupId}/projects`,
        method: 'GET',
        headers: {
            'PRIVATE-TOKEN': privToken
        },
        params: { simple: true, search: projectName },
        validateStatus: () => true
    };
    const response = await axios(options);
    switch (response.status) {
        case 200:
            const found = response.data?.find((entry) => entry['path'] === projectName);
            if (!found) throw Error('GRIT group project not found');
            return;
        default:
            throw Error('Get GRIT group project failed');
    }
}

async function deleteToolchain(bearer, toolchainId, region) {
    const apiBaseUrl = TOOLCHAIN_BASE_ENDPOINT || `https://api.${region}.devops.cloud.ibm.com/toolchain/v2`;
    const options = {
        method: 'DELETE',
        url: `${apiBaseUrl}/toolchains/${toolchainId}`,
        headers: {
            'Accept': 'application/json',
            'Authorization': `Bearer ${bearer}`,
            'Content-Type': 'application/json',
        },
        validateStatus: () => true
    };
    const response = await axios(options);
    switch (response.status) {
        case 204:
            return toolchainId;
        default:
            throw Error(response.statusText);
    }
}

async function getSmInstances(bearer, accountId) {
    const options = {
        url: GHOST_BASE_URL + '/v3/resources/search',
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${bearer}`,
            'Content-Type': 'application/json',
        },
        data: {
            'query': `service_name:secrets-manager AND doc.state:ACTIVE`,
            'fields': ['doc.resource_group_id', 'doc.region_id', 'doc.dashboard_url', 'doc.name', 'doc.guid']
        },
        params: { account_id: accountId },
        validateStatus: () => true
    };
    const response = await axios(options);
    switch (response.status) {
        case 200:
            return response.data.items.map(item => {
                return {
                    id: item.doc.guid,
                    crn: item.crn,
                    name: item.doc.name,
                    resource_group_id: item.doc.resource_group_id,
                    region_id: item.doc.region_id,
                    dashboard_url: item.doc.dashboard_url
                }
            });
        default:
            throw Error('Get Secrets Manager instances failed');
    }
}

async function createTool(bearer, toolchainId, region, params) {
    const apiBaseUrl = TOOLCHAIN_BASE_ENDPOINT || `https://api.${region}.devops.cloud.ibm.com/toolchain/v2`;
    const options = {
        method: 'POST',
        url: `${apiBaseUrl}/toolchains/${toolchainId}/tools`,
        headers: {
            'Accept': 'application/json',
            'Authorization': `Bearer ${bearer}`,
            'Content-Type': 'application/json',
        },
        data: params,
        validateStatus: () => true
    };
    const response = await axios(options);
    switch (response.status) {
        case 201:
            return response.data;
        default:
            throw Error(response.statusText);
    }
}

async function migrateToolchainSecrets(bearer, data, region) {
    const apiBaseUrl = DEV_MODE ? OTC_BASE_ENDPOINT : `https://otc-api.${region}.devops.cloud.ibm.com/api/v1`;
    const options = {
        method: 'POST',
        url: `${apiBaseUrl}/export_secret`,
        headers: {
            'Accept': 'application/json',
            'Authorization': `Bearer ${bearer}`,
            'Content-Type': 'application/json',
        },
        data: data,
        validateStatus: () => true
    };
    const response = await axios(options);
    switch (response.status) {
        case 201:
            return response.headers.location;
        default:
            throw Error(response.data?.errors.length > 0 ? response.data.errors[0]?.message : response.statusText);
    }
}

export {
    getBearerToken,
    getAccountId,
    getCdInstanceByRegion,
    getToolchain,
    getToolchainsByName,
    getToolchainTools,
    getPipelineData,
    getResourceGroups,
    getAppConfigHealthcheck,
    getSecretsHealthcheck,
    getGitOAuth,
    getGritUserProject,
    getGritGroup,
    getGritGroupProject,
    deleteToolchain,
    createTool,
    getSmInstances,
    migrateToolchainSecrets
}
