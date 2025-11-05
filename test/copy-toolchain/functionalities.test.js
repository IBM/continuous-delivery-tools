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

describe('copy-toolchain: Test functionalities', function () {
    this.timeout('240s');
    this.command = 'copy-toolchain';
    const testCases = [
        {
            name: 'Terraform Version Verification',
            cmd: [CLI_PATH, COMMAND, '-c', TEST_TOOLCHAINS['empty'].crn, '-r', TARGET_REGIONS[0]],
            expected: /✔ Terraform Version:/,
            options: {
                exitCondition: '(Recommended) Add a tag to the cloned toolchain (Ctrl-C to abort):',
                timeout: 5000
            }
        },
        {
            name: 'Log file is created successfully',
            cmd: [CLI_PATH, COMMAND, '-c', TEST_TOOLCHAINS['empty'].crn, '-r', TARGET_REGIONS[0]],
            expected: null,
            options: {
                exitCondition: '(Recommended) Add a tag to the cloned toolchain (Ctrl-C to abort):',
                timeout: 5000,
                cwd: TEMP_DIR + '/' + 'log-file-is-created-successfully'
            },
            assertionFunc: () => areFilesInDir(TEMP_DIR + '/' + 'log-file-is-created-successfully', ['.log'])
        },
        {
            name: 'Force Flag bypasses all user prompts',
            cmd: [CLI_PATH, COMMAND, '-c', TEST_TOOLCHAINS['empty'].crn, '-r', TEST_TOOLCHAINS['empty'].region, '-f'],
            expected: /See cloned toolchain:/,      // Should bypass everything and clone the toolchain
            options: {
                timeout: 60000,
                cwd: TEMP_DIR + '/' + 'force-flag-bypasses-all-user-prompts'
            }
        },
        {
            name: 'Prompt User when toolchain name already exists in resource group',
            cmd: [CLI_PATH, COMMAND, '-c', TEST_TOOLCHAINS['empty'].crn, '-r', TARGET_REGIONS[0]],
            expected: new RegExp(`Warning! A toolchain named \'${TEST_TOOLCHAINS['empty'].name}\' already exists in:[\\s\\S]*?Resource Group:[\\s\\S]*?${R2R_CLI_RG_ID}`),
            options: {
                exitCondition: '(Recommended) Add a tag to the cloned toolchain (Ctrl-C to abort):',
                timeout: 5000
            }
        },
        {
            name: 'Prompt User when toolchain name already exists in region',
            cmd: [CLI_PATH, COMMAND, '-c', TEST_TOOLCHAINS['empty'].crn, '-r', TEST_TOOLCHAINS['empty'].region, '-g', DEFAULT_RG_ID],
            expected: new RegExp(`Warning! A toolchain named \'${TEST_TOOLCHAINS['empty'].name}\' already exists in:[\\s\\S]*?Region: ${TEST_TOOLCHAINS['empty'].region}`),
            options: {
                exitCondition: '(Recommended) Add a tag to the cloned toolchain (Ctrl-C to abort):',
                timeout: 5000
            }
        },
        {
            name: 'Dry Run Flag does not clone a toolchain',
            cmd: [CLI_PATH, COMMAND, '-c', TEST_TOOLCHAINS['empty'].crn, '-r', TEST_TOOLCHAINS['empty'].region, '-D'],
            expected: null,
            options: {
                timeout: 60000,
                questionAnswerMap: {
                    '(Recommended) Add a tag to the cloned toolchain (Ctrl-C to abort):': '',
                    [`(Recommended) Edit the cloned toolchain's name [default: ${TEST_TOOLCHAINS['empty'].name}] (Ctrl-C to abort):`]: '',
                },
                cwd: TEMP_DIR + '/' + 'dry-run-flag-does-not-clone-a-toolchain'
            },
            assertionFunc: (output) => {
                expect(output).to.match(/DRY_RUN: true, skipping terraform apply/);
                assert.isTrue(areFilesInDir(TEMP_DIR + '/' + 'dry-run-flag-does-not-clone-a-toolchain', ['cd_toolchain.tf', 'output.tf']));
            }
        },
        {
            name: 'Silent flag suppresses info, debug and log messages',
            cmd: [CLI_PATH, COMMAND, '-c', TEST_TOOLCHAINS['empty'].crn, '-r', TEST_TOOLCHAINS['empty'].region, '-s'],
            expected: null,
            options: {
                timeout: 120000,
                questionAnswerMap: {
                    '(Recommended) Add a tag to the cloned toolchain (Ctrl-C to abort):': '',
                    [`(Recommended) Edit the cloned toolchain's name [default: ${TEST_TOOLCHAINS['empty'].name}] (Ctrl-C to abort):`]: '',
                }
            },
            assertionFunc: (output) => {
                // finds any [INFO] level logs that matches '[INFO] ...' but not '[INFO] See cloned toolchain...' 
                expect(output).to.not.match(/^(?!.*\[INFO\]\s+See cloned toolchain).*\[INFO\].*$/m);

                expect(output).to.not.match(/\[DEBUG\]/);
                expect(output).to.not.match(/\[LOG\]/);
            }
        }
    ];

    for (const { name, cmd, expected, options, assertionFunc } of testCases) {
        if (VERBOSE_MODE) cmd.push('-v');
        it(`${name}`, async () => {
            const res = await assertPtyOutput(cmd, expected, options, assertionFunc);
            if (res) toolchainsToDelete.set(res.toolchainId, res.region);
        });
    }
});
