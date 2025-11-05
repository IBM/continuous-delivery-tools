/**
 * Licensed Materials - Property of IBM
 * (c) Copyright IBM Corporation 2025. All Rights Reserved.
 *
 * Note to U.S. Government Users Restricted Rights:
 * Use, duplication or disclosure restricted by GSA ADP Schedule
 * Contract with IBM Corp.
 */

const invalidCrn = 'crn:v1:bluemix:public:not-a-toolchain:ca-tor:a/955ce52f7b4f4aad8020fbee3e7a8sje:dacff581-8a40sdsdf3kfsd-12n3s::';

const invalidRegion = 'not-br-sao';

const invalidTcName = 'invalidToolchainName@';

const invalidTag = 'invalid@Tag';

const invalidRgId = 'invalid#RgId';

const invalidRgName = 'invalid#Rg@Name';

const invalidGritMapping = {
    "ca-tor.git.cloud.ibm.com/fake-user/fake-repo": "eu-gb.git.cloud.ibm.com/fake-user/fake-repo",
    "ibm.com/fake-user/fake-repo": "ibm.com/fake-user/fake-repo"
};

const invalidGritFileName = "invalid-mapping.json";

export default {
    invalidCrn,
    invalidRegion,
    invalidTcName,
    invalidTag,
    invalidRgId,
    invalidRgName,
    invalidGritMapping,
    invalidGritFileName
};
