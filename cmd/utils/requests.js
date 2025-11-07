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

import { logger, LOG_STAGES } from './logger.js';

axiosRetry(axios, {
    retries: 3,
    retryDelay: axiosRetry.exponentialDelay,
    retryCondition: (error) => {
        return axiosRetry.isNetworkOrIdempotentRequestError(error) || error.response?.status === 500;
    },
});

axios.interceptors.request.use(request => {
    logger.debug(`${request.method.toUpperCase()} ${request.url}`, LOG_STAGES.setup);
    if (request.data) {
        const body = typeof request.data === 'string'
            ? request.data
            : JSON.stringify(request.data);
        logger.log(`Https Request body: ${body}`, LOG_STAGES.setup);
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
        logger.log(`Https Response body: ${body}`, LOG_STAGES.setup);
    }
    return response;
}, error => {
    if (error.response) {
        logger.log(`Error response status: ${error.response.status} ${error.response.statusText}`);
        logger.log(`Error response body: ${JSON.stringify(error.response.data)}`);
    } else {
        logger.log(`Error message: ${error.message}`);
    }
    return Promise.reject(error);
});

async function getBearerToken(apiKey) {
    const iamUrl = 'https://iam.cloud.ibm.com/identity/token';
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
    const iamUrl = 'https://iam.cloud.ibm.com/v1/apikeys/details';
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
    const apiBaseUrl = `https://api.${region}.devops.cloud.ibm.com/toolchain/v2`;
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
    const apiBaseUrl = 'https://api.global-search-tagging.cloud.ibm.com/v3';
    const options = {
        url: apiBaseUrl + '/resources/search',
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
    const apiBaseUrl = 'https://api.global-search-tagging.cloud.ibm.com/v3';
    const options = {
        url: apiBaseUrl + '/resources/search',
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
    const apiBaseUrl = `https://api.${region}.devops.cloud.ibm.com/toolchain/v2`;
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
    const apiBaseUrl = `https://api.${region}.devops.cloud.ibm.com/pipeline/v2`;
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

// takes in resource group ID or name
async function getResourceGroupIdAndName(bearer, accountId, resourceGroup) {
    const apiBaseUrl = 'https://api.global-search-tagging.cloud.ibm.com/v3';
    const options = {
        url: apiBaseUrl + '/resources/search',
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${bearer}`,
            'Content-Type': 'application/json',
        },
        data: {
            'query': `type:resource-group AND (name:${resourceGroup} OR doc.id:${resourceGroup}) AND doc.state:ACTIVE`,
            'fields': ['doc.id', 'doc.name']
        },
        params: { account_id: accountId },
        validateStatus: () => true
    };
    const response = await axios(options);
    switch (response.status) {
        case 200:
            if (response.data.items.length != 1) throw Error('The resource group with provided ID or name was not found or is not accessible');
            return { id: response.data.items[0].doc.id, name: response.data.items[0].doc.name };
        default:
            throw Error('The resource group with provided ID or name was not found or is not accessible');
    }
}

async function getAppConfigHealthcheck(bearer, tcId, toolId, region) {
    const apiBaseUrl = 'https://cloud.ibm.com/devops/api/v1';
    const options = {
        url: apiBaseUrl + '/appconfig/healthcheck',
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
    const apiBaseUrl = 'https://cloud.ibm.com/devops/api/v1';
    const options = {
        url: apiBaseUrl + '/secrets/healthcheck',
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
    const url = 'https://cloud.ibm.com/devops/git/api/v1/tokens';
    const options = {
        url: url,
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${bearer}`,
            'Content-Type': 'application/json',
        },
        // TODO: replace return_uri with "official" endpoint
        params: { env_id: `ibm:yp:${targetRegion}`, git_id: gitId, console_url: 'https://cloud.ibm.com', return_uri: `https://cloud.ibm.com/devops/git?env_id=ibm:yp:${targetRegion}` },
        validateStatus: () => true
    };
    const response = await axios(options);
    switch (response.status) {
        case 200:
            return response.data?.access_token;
        case 500:
            throw Error(response.data?.authorizationURI);
        default:
            throw Error('Get git OAuth failed');
    }
}

async function getGritUserProject(privToken, region, user, projectName) {
    const url = `https://${region}.git.cloud.ibm.com/api/v4/users/${user}/projects`
    const options = {
        url: url,
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
    const url = `https://${region}.git.cloud.ibm.com/api/v4/groups`
    const options = {
        url: url,
        method: 'GET',
        headers: {
            'PRIVATE-TOKEN': privToken
        },
        params: { simple: true, search: groupName },
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
    const url = `https://${region}.git.cloud.ibm.com/api/v4/groups/${groupId}/projects`
    const options = {
        url: url,
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

async function getIamAuthPolicies(bearer, accountId) {
    const apiBaseUrl = 'https://iam.cloud.ibm.com/v1';
    const options = {
        url: apiBaseUrl + '/policies',
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${bearer}`,
            'Content-Type': 'application/json',
        },
        params: { account_id: accountId, type: 'authorization' },
        validateStatus: () => true
    };
    const response = await axios(options);
    switch (response.status) {
        case 200:
            return response.data;
        default:
            throw Error('Get auth policies failed');
    }
}

async function deleteToolchain(bearer, toolchainId, region) {
    const apiBaseUrl = `https://api.${region}.devops.cloud.ibm.com/toolchain/v2`;
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
        case 200:
            return toolchainId;
        default:
            throw Error(response.statusText);
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
    getResourceGroupIdAndName,
    getAppConfigHealthcheck,
    getSecretsHealthcheck,
    getGitOAuth,
    getGritUserProject,
    getGritGroup,
    getGritGroupProject,
    getIamAuthPolicies,
    deleteToolchain
}
