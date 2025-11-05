/**
 * Licensed Materials - Property of IBM
 * (c) Copyright IBM Corporation 2025. All Rights Reserved.
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
        crn: 'crn:v1:bluemix:public:toolchain:eu-es:a/9e8559fac61ee9fc74d3e595fa75d147:0ccfaa70-ca90-47db-8246-f4ecfc6ad8f3::',
        region: 'eu-es'
    },
    '1pl-ghe-cc': {
        name: 'KEEP-1PL-GHE-CC',
        crn: 'crn:v1:bluemix:public:toolchain:eu-es:a/9e8559fac61ee9fc74d3e595fa75d147:9d51bb6b-f659-4ab7-9bc4-2eae1d61f4e7::',
        region: 'eu-es'
    },
    '1pl-ghe-cd': {
        name: 'KEEP-1PL-GHE-CD',
        crn: 'crn:v1:bluemix:public:toolchain:eu-es:a/9e8559fac61ee9fc74d3e595fa75d147:6a70313f-a927-4b0e-8471-70f17330998d::',
        region: 'eu-es'
    },
    '1pl-ghe-ci': {
        name: 'KEEP-1PL-GHE-CI',
        crn: 'crn:v1:bluemix:public:toolchain:eu-es:a/9e8559fac61ee9fc74d3e595fa75d147:6b8e27ae-5924-4a38-8819-f405366cb900::',
        region: 'eu-es'
    },
    'devsecops-grit-cc': {
        name: 'KEEP-DevSecOps-GRIT-CC',
        crn: 'crn:v1:bluemix:public:toolchain:eu-es:a/9e8559fac61ee9fc74d3e595fa75d147:920f6a94-4c1b-412b-b95c-baf823958744::',
        region: 'eu-es'
    },
    'devsecops-grit-cd': {
        name: 'KEEP-DevSecOps-GRIT-CD',
        crn: 'crn:v1:bluemix:public:toolchain:eu-es:a/9e8559fac61ee9fc74d3e595fa75d147:8618565f-08fa-4cac-9250-029cac7b41ba::',
        region: 'eu-es'
    },
    'devsecops-grit-ci': {
        name: 'KEEP-DevSecOps-GRIT-CI',
        crn: 'crn:v1:bluemix:public:toolchain:eu-es:a/9e8559fac61ee9fc74d3e595fa75d147:cdc271bc-cc07-4a85-beb2-895e033319b0::',
        region: 'eu-es'
    },
    'single-pl': {
        name: 'KEEP-SINGLE-PIPELINE-TOOLCHAIN',
        crn: 'crn:v1:bluemix:public:toolchain:us-east:a/9e8559fac61ee9fc74d3e595fa75d147:5ef88780-1e0f-4cda-94c7-f78909cc1140::',
        region: 'us-east'
    }
};

export const DEFAULT_RG_ID = '63b47433992f4295bc490852cbf1cb55';
export const R2R_CLI_RG_ID = 'f64e5eb8cfee406a983803bd79aa6c93';
