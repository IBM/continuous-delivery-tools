/**
 * Licensed Materials - Property of IBM
 * (c) Copyright IBM Corporation 2025, 2026. All Rights Reserved.
 *
 * Note to U.S. Government Users Restricted Rights:
 * Use, duplication or disclosure restricted by GSA ADP Schedule
 * Contract with IBM Corp.
 */

export const TEST_TOOLCHAINS = {
    'empty': {
        name: 'KEEP-EMPTY-TOOLCHAIN',
        crn: 'crn:v1:bluemix:public:toolchain:ca-tor:a/9e8559fac61ee9fc74d3e595fa75d147:0100aa9f-1e57-41d8-b4c7-5d84178d59bb::',
        region: 'ca-tor',
    },
    'misconfigured': {
        name: 'KEEP-MISCONFIGURED-TOOLCHAIN',
        crn: 'crn:v1:bluemix:public:toolchain:eu-gb:a/9e8559fac61ee9fc74d3e595fa75d147:128b55a7-56c3-4cc0-87f7-abb24ff0fc6a::',
        region: 'eu-gb'
    },
    '1pl-ghe-cc': {
        name: 'KEEP-1PL-GHE-CC',
        crn: 'crn:v1:bluemix:public:toolchain:eu-de:a/9e8559fac61ee9fc74d3e595fa75d147:6d75fa57-4eb0-4654-a664-58233ee2aad2::',
        region: 'eu-de'
    },
    '1pl-ghe-cd': {
        name: 'KEEP-1PL-GHE-CD',
        crn: 'crn:v1:bluemix:public:toolchain:eu-de:a/9e8559fac61ee9fc74d3e595fa75d147:34df7ab1-bb87-4c34-bf72-1e83d04b0999::',
        region: 'eu-de'
    },
    '1pl-ghe-ci': {
        name: 'KEEP-1PL-GHE-CI',
        crn: 'crn:v1:bluemix:public:toolchain:eu-de:a/9e8559fac61ee9fc74d3e595fa75d147:7769bb82-0ef5-4b5d-92c1-5089ac7ff385::',
        region: 'eu-de'
    },
    'devsecops-grit-ci': {
        name: 'KEEP-DevSecOps-GRIT-CI',
        crn: 'crn:v1:bluemix:public:toolchain:eu-de:a/9e8559fac61ee9fc74d3e595fa75d147:1befe39f-e278-439b-a59a-fb16f14119c3::',
        region: 'eu-de'
    },
    'single-pl': {
        name: 'KEEP-SINGLE-PIPELINE-TOOLCHAIN',
        crn: 'crn:v1:bluemix:public:toolchain:us-east:a/9e8559fac61ee9fc74d3e595fa75d147:5ef88780-1e0f-4cda-94c7-f78909cc1140::',
        region: 'us-east'
    },
    'special-chars': {
        name: 'KEEP-SPECIAL-CHARS-_ .TOOLCHAIN',
        crn: 'crn:v1:bluemix:public:toolchain:ca-tor:a/9e8559fac61ee9fc74d3e595fa75d147:bda05ed4-7092-4c7c-970a-7be53f1c1796::',
        region: 'ca-tor'
    }
};

export const DEFAULT_RG_ID = '63b47433992f4295bc490852cbf1cb55';
export const R2R_CLI_RG_ID = 'f64e5eb8cfee406a983803bd79aa6c93';
