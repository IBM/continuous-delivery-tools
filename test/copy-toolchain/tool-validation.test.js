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
import { expect, assert } from 'chai';

import { assertPtyOutput, areFilesInDir, deleteCreatedToolchains } from '../utils/testUtils.js';
import { TEST_TOOLCHAINS, DEFAULT_RG_ID, R2R_CLI_RG_ID } from '../data/test-toolchains.js';
import { TARGET_REGIONS } from '../../config.js';

nconf.env('__');
nconf.file('local', 'test/config/local.json');

const TEMP_DIR = nconf.get('TEST_TEMP_DIR');
const VERBOSE_MODE = nconf.get('VERBOSE_MODE');

const CLI_PATH = path.resolve('index.js');
const COMMAND = 'copy-toolchain';

const toolchainsToDelete = new Map();
after(async () => await deleteCreatedToolchains(toolchainsToDelete));

describe('copy-toolchain: Test tool validation', function () {
    this.timeout('120s');
    this.command = 'copy-toolchain';
    const testCases = [
        {
            name: 'Misconfigured tool identified',
            cmd: [CLI_PATH, COMMAND, '-c', TEST_TOOLCHAINS['1pl-ghe-cd'].crn, '-r', TARGET_REGIONS[10]],
            expected: /slack[\s\S]*?misconfigured/,
            options: {
                exitCondition: 'Caution: The above tool(s) will not be properly configured post migration. Do you want to proceed?',
                questionAnswerMap: {
                    '(Recommended) Add a tag to the cloned toolchain (Ctrl-C to abort):': '',
                },
                timeout: 15000
            }
        },
        {
            name: 'Tools with plain text secrets identified',
            cmd: [CLI_PATH, COMMAND, '-c', TEST_TOOLCHAINS['1pl-ghe-cd'].crn, '-r', TARGET_REGIONS[10]],
            expected: null,
            options: {
                exitCondition: 'Caution: The above tool(s) will not be properly configured post migration. Do you want to proceed?',
                questionAnswerMap: {
                    '(Recommended) Add a tag to the cloned toolchain (Ctrl-C to abort):': '',
                },
                timeout: 15000
            },
            assertionFunc: (output) => {
                expect(output).to.match(/Warning! The following tools contain secrets that cannot be migrated/);
                expect(output).to.match(/cloudobjectstorage[\s\S]*?cos_api_key/);
                expect(output).to.match(/slack[\s\S]*?api_token/);
                expect(output).to.match(/pipeline[\s\S]*?properties.doi-ibmcloud-api-key/);
            }
        },
        {
            name: 'Classic pipelines are identified',
            cmd: [CLI_PATH, COMMAND, '-c', TEST_TOOLCHAINS['misconfigured'].crn, '-r', TARGET_REGIONS[10]],
            expected: /Warning! Classic pipelines are currently not supported in migration/,
            options: {
                exitCondition: 'Caution: The above tool(s) will not be properly configured post migration. Do you want to proceed?',
                questionAnswerMap: {
                    '(Recommended) Add a tag to the cloned toolchain (Ctrl-C to abort):': '',
                },
                timeout: 15000
            }
        },
        {
            name: 'Git tools using PAT are identified',
            cmd: [CLI_PATH, COMMAND, '-c', TEST_TOOLCHAINS['misconfigured'].crn, '-r', TARGET_REGIONS[10]],
            expected: null,
            options: {
                exitCondition: 'Caution: The above tool(s) will not be properly configured post migration. Do you want to proceed?',
                questionAnswerMap: {
                    '(Recommended) Add a tag to the cloned toolchain (Ctrl-C to abort):': '',
                },
                timeout: 15000
            },
            assertionFunc: (output) => {
                expect(output).to.match(/Warning! The following GRIT integration\(s\) are using auth_type "pat", please switch to auth_type "oauth" before proceeding/);
                expect(output).to.match(/hostedgit/);
                expect(output).to.match(/Warning! The following tools contain secrets that cannot be migrated/);
                expect(output).to.match(/githubconsolidated[\s\S]*?api_token/);
                expect(output).to.match(/github_integrated[\s\S]*?api_token/);
                expect(output).to.match(/gitlab[\s\S]*?api_token/);
            }
        },
    ];

    for (const { name, cmd, expected, options, assertionFunc } of testCases) {
        if (VERBOSE_MODE) cmd.push('-v');
        it(`${name}`, async () => {
            const res = await assertPtyOutput(cmd, expected, options, assertionFunc);
            if (res) toolchainsToDelete.set(res.toolchainId, res.region);
        });
    }
});
