/**
 * Licensed Materials - Property of IBM
 * (c) Copyright IBM Corporation 2025. All Rights Reserved.
 *
 * Note to U.S. Government Users Restricted Rights:
 * Use, duplication or disclosure restricted by GSA ADP Schedule
 * Contract with IBM Corp.
 */

const fs = require('node:fs');
const { resolve } = require('node:path');

const API_KEY = process.env['IBMCLOUD_API_KEY'];
if (!API_KEY) throw Error(`Missing 'IBMCLOUD_API_KEY'`);

const TC_ID = process.env['TARGET_TOOLCHAIN_ID'];
if (!TC_ID) throw Error(`Missing 'TARGET_TOOLCHAIN_ID'`);

const CLOUD_PLATFORM = process.env['IBMCLOUD_PLATFORM'] || 'cloud.ibm.com';
if (!CLOUD_PLATFORM) throw Error(`Missing 'IBMCLOUD_PLATFORM'`);

const IAM_BASE_URL = process.env['IAM_BASE_URL'] || 'https://iam.cloud.ibm.com';
if (!IAM_BASE_URL) throw Error(`Missing 'IAM_BASE_URL'`);

const INPUT_PATH = 'create-s2s.json';

async function getBearer() {
    const url = `${IAM_BASE_URL}/identity/token`;

    const params = new URLSearchParams();
    params.append('grant_type', 'urn:ibm:params:oauth:grant-type:apikey');
    params.append('apikey', API_KEY);
    params.append('response_type', 'cloud_iam');

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: params
        });

        if (!response.ok) {
            throw new Error(`Response status: ${response.status}, ${response.statusText}`);
        }

        console.log(`GETTING BEARER TOKEN... ${response.status}, ${response.statusText}`);

        return (await response.json()).access_token;
    } catch (error) {
        console.error(error.message);
    }
}

/* expecting item as an object with the format of:
{
    "parameters": {
        "name": "",
        "integration-status": "",
        "instance-id-type": "",
        "region": "",
        "resource-group": "",
        "instance-name": "",
        "instance-crn": "",
        "setup-authorization-type": ""
    },
    "toolchainId": "",
    "serviceId": "",
    "env_id": ""
}
*/

async function createS2sAuthPolicy(bearer, item) {
    const url = `https://${CLOUD_PLATFORM}/devops/setup/api/v2/s2s_authorization?${new URLSearchParams({
        toolchainId: TC_ID,
        serviceId: item['serviceId'],
        env_id: item['env_id']
    }).toString()}`;

    const data = JSON.stringify({
        'parameters': {
            'name': item['parameters']['name'],
            'integration-status': '',
            'instance-id-type': item['parameters']['instance-id-type'],
            'region': item['parameters']['region'],
            'resource-group': item['parameters']['resource-group'],
            'instance-name': item['parameters']['instance-name'],
            'instance-crn': item['parameters']['instance-crn'],
            'setup-authorization-type': 'select'
        }
    });

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                'Authorization': `Bearer ${bearer}`,
                'Content-Type': 'application/json',
            },
            body: data,
        });

        if (!response.ok) {
            throw new Error(`Response status: ${response.status}, ${response.statusText}`);
        }

        console.log(`CREATING AUTH POLICY... ${response.status}, ${response.statusText}`);
    } catch (error) {
        console.error(error.message);
    }
}

// main

getBearer().then((bearer) => {
    const inputArr = JSON.parse(fs.readFileSync(resolve(INPUT_PATH)));

    inputArr.forEach(async (item) => {
        await createS2sAuthPolicy(bearer, item);
    });
});
