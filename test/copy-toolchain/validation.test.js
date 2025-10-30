/**
 * Licensed Materials - Property of IBM
 * (c) Copyright IBM Corporation 2025. All Rights Reserved.
 *
 * Note to U.S. Government Users Restricted Rights:
 * Use, duplication or disclosure restricted by GSA ADP Schedule
 * Contract with IBM Corp.
 */

import path from 'node:path';
import nconf from 'nconf';

import * as chai from 'chai';
chai.config.truncateThreshold = 0;

import mocks from '../data/mocks.js';
import { testSuiteCleanup, expectExecError, expectPtyOutputToMatch } from '../utils/testUtils.js';
import { TEST_TOOLCHAINS } from '../data/test-toolchains.js';
import { TARGET_REGIONS } from '../../config.js';

nconf.env('__');
nconf.file('local', 'test/config/local.json');

const CLI_PATH = path.resolve('index.js');
const COMMAND = 'copy-toolchain';

const toolchainsToDelete = new Map();

after(async () => await testSuiteCleanup(toolchainsToDelete));

describe('copy-toolchain: Test user input handling', function () {
    this.timeout('60s');
    this.command = 'copy-toolchain';

    const validCrn = TEST_TOOLCHAINS['empty'].crn;

    const invalidArgsCases = [
        {
            name: 'Toolchain CRN not specified',
            cmd: [CLI_PATH, COMMAND],
            expected: /required option '-c, --toolchain-crn <crn>' not specified/,
        },
        {
            name: 'Region is not specified',
            cmd: [CLI_PATH, COMMAND, '-c', validCrn],
            expected: /required option '-r, --region <region>' not specified/,
        },
        {
            name: 'API Key is not specified',
            cmd: [CLI_PATH, COMMAND, '-c', validCrn, '-r', TARGET_REGIONS[0]],
            expected: /Environment variable 'IBMCLOUD_API_KEY' is required but not set/,
            options: { env: { ...process.env, IBMCLOUD_API_KEY: '' } }
        },
        {
            name: 'Invalid API Key provided',
            cmd: [CLI_PATH, COMMAND, '-c', validCrn, '-r', TARGET_REGIONS[0]],
            expected: /There was a problem getting a bearer token using IBMCLOUD_API_KEY/,
            options: { env: { ...process.env, IBMCLOUD_API_KEY: 'not-a-valid-apikey' } }
        },
        {
            name: 'Invalid region is provided',
            cmd: [CLI_PATH, COMMAND, '-c', validCrn, '-r', mocks.invalidRegion],
            expected: new RegExp(`option '-r, --region <region>' argument '${mocks.invalidRegion}' is invalid`)
        },
        {
            name: 'Invalid CRN is provided',
            cmd: [CLI_PATH, COMMAND, '-c', mocks.invalidCrn, '-r', TARGET_REGIONS[0]],
            expected: /Provided toolchain CRN is invalid/,
        },
        {
            name: 'Invalid Toolchain tag is provided',
            cmd: [CLI_PATH, COMMAND, '-c', validCrn, '-r', TARGET_REGIONS[0], '-t', mocks.invalidTag],
            expected: /Provided tag is invalid/,
        },
        {
            name: 'Invalid Toolchain name is provided',
            cmd: [CLI_PATH, COMMAND, '-c', validCrn, '-r', TARGET_REGIONS[0], '-n', mocks.invalidTcName],
            expected: /Provided toolchain name is invalid/,
        },
        {
            name: 'Invalid Resource Group name is provided',
            cmd: [CLI_PATH, COMMAND, '-c', validCrn, '-r', TARGET_REGIONS[0], '-g', mocks.invalidRgName],
            expected: /The resource group with provided ID or name was not found or is not accessible/,
        },
        {
            name: 'Invalid Resource Group ID is provided',
            cmd: [CLI_PATH, COMMAND, '-c', validCrn, '-r', TARGET_REGIONS[0], '-g', mocks.invalidRgId],
            expected: /The resource group with provided ID or name was not found or is not accessible/,
        },
    ];

    for (const { name, cmd, expected, options } of invalidArgsCases) {
        it(`Invalid args: ${name}`, async () => {
            await expectExecError(cmd, expected, options);
        });
    }

    const invalidUserInputCases = [
        {
            name: 'Invalid Toolchain tag is provided',
            cmd: [CLI_PATH, COMMAND, '-c', TEST_TOOLCHAINS['empty'].crn, '-r', TARGET_REGIONS[0]],
            expected: /Provided tag is invalid/,
            options: {
                questionAnswerMap: { '(Recommended) Add a tag to the cloned toolchain (Ctrl-C to abort):' : mocks.invalidTag },
                exitCondition: 'Validation failed',
                timeout: 5000
            }
        },
        {
            name: 'Invalid Toolchain name is provided',
            cmd: [CLI_PATH, COMMAND, '-c', TEST_TOOLCHAINS['empty'].crn, '-r', TEST_TOOLCHAINS['empty'].region],
            expected: /Provided toolchain name is invalid/,
            options: {
                questionAnswerMap: { [`(Recommended) Edit the cloned toolchain's name [default: ${TEST_TOOLCHAINS['empty'].name}] (Ctrl-C to abort):`] : mocks.invalidTcName },
                exitCondition: 'Validation failed',
                timeout: 5000
            }
        },
    ];

    for (const { name, cmd, expected, options } of invalidUserInputCases) {
        it(`Invalid user input in prompts: ${name}`, async () => {
            await expectPtyOutputToMatch(cmd, expected, options);
        });
    }
});
