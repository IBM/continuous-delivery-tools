/**
 * Licensed Materials - Property of IBM
 * (c) Copyright IBM Corporation 2025, 2026. All Rights Reserved.
 *
 * Note to U.S. Government Users Restricted Rights:
 * Use, duplication or disclosure restricted by GSA ADP Schedule
 * Contract with IBM Corp.
 */

import path from 'node:path';
import nconf from 'nconf';
import fs from 'node:fs';

import { expect, assert } from 'chai';

import { assertPtyOutput, assertExecError, areFilesInDir, parseTcIdAndRegion } from '../utils/testUtils.js';
import { getBearerToken, getToolchain } from '../../cmd/utils/requests.js';
import { TEST_TOOLCHAINS, DEFAULT_RG_ID } from '../data/test-toolchains.js';
import { TARGET_REGIONS } from '../../config.js';

nconf.env('__');
nconf.file('local', 'test/config/local.json');

const TEMP_DIR = nconf.get('TEST_TEMP_DIR');
const VERBOSE_MODE = nconf.get('VERBOSE_MODE');
const IBMCLOUD_API_KEY = nconf.get('IBMCLOUD_API_KEY');

const CLI_PATH = path.resolve('index.js');
const COMMAND = 'copy-toolchain';

describe('copy-toolchain: Test functionalities', function () {
    this.timeout('300s');
    this.command = COMMAND;
    const testCases = [
        {
            name: 'Terraform Version Verification',
            cmd: [CLI_PATH, COMMAND, '-c', TEST_TOOLCHAINS['empty'].crn, '-r', TEST_TOOLCHAINS['empty'].region],
            expected: /✔ Terraform Version:/,
            options: {
                exitCondition: `(Recommended) Edit the cloned toolchain's name [default: ${TEST_TOOLCHAINS['empty'].name}] (Ctrl-C to abort):`,
                timeout: 10000
            }
        },
        {
            name: 'CLI Version Verification',
            cmd: [CLI_PATH, COMMAND, '-c', TEST_TOOLCHAINS['empty'].crn, '-r', TEST_TOOLCHAINS['empty'].region],
            expected: /✔ cd-tools Version:/,
            options: {
                exitCondition: `(Recommended) Edit the cloned toolchain's name [default: ${TEST_TOOLCHAINS['empty'].name}] (Ctrl-C to abort):`,
                timeout: 10000
            }
        },
        // TODO: update outdated test from when missing cd instance would fail the command
        // {
        //     name: 'Check if CD instance exists in target region',
        //     cmd: [CLI_PATH, COMMAND, '-c', TEST_TOOLCHAINS['empty'].crn, '-r', TARGET_REGIONS[0]],
        //     expected: new RegExp(`Could not find a Continuous Delivery instance in the target region '${TARGET_REGIONS[0]}', please create one before proceeding.`),
        //     options: {
        //         exitCondition: `Could not find a Continuous Delivery instance in the target region '${TARGET_REGIONS[0]}', please create one before proceeding.`,
        //         timeout: 10000,
        //         env: { ...process.env, MOCK_ALL_REQUESTS: 'true', MOCK_GET_CD_INSTANCE_BY_REGION_SCENARIO: 'NOT_FOUND' }
        //     }
        // },
        {
            name: 'Log file is created successfully',
            cmd: [CLI_PATH, COMMAND, '-c', TEST_TOOLCHAINS['empty'].crn, '-r', TEST_TOOLCHAINS['empty'].region],
            expected: null,
            options: {
                exitCondition: `(Recommended) Edit the cloned toolchain's name [default: ${TEST_TOOLCHAINS['empty'].name}] (Ctrl-C to abort):`,
                timeout: 10000,
                cwd: TEMP_DIR + '/' + 'log-file-is-created-successfully'
            },
            assertionFunc: () => areFilesInDir(TEMP_DIR + '/' + 'log-file-is-created-successfully', ['.log'])
        },
        {
            name: 'Force Flag bypasses all user prompts',
            cmd: [CLI_PATH, COMMAND, '-c', TEST_TOOLCHAINS['empty'].crn, '-r', TEST_TOOLCHAINS['empty'].region, '-f'],
            expected: null,
            options: {
                timeout: 120000,
            },
            assertionFunc: async (output) => {
                // Should bypass everything and clone the toolchain
                output.match(/Cloned toolchain:/);
                const { toolchainId, region } = parseTcIdAndRegion(output);
                const token = await getBearerToken(IBMCLOUD_API_KEY);
                const toolchainData = await getToolchain(token, toolchainId, region);
                assert.isTrue(toolchainData.id === toolchainId, 'Was toolchain created successfully without any confirmations?');
            }
        },
        {
            name: 'Prompt User when toolchain name already exists in region',
            cmd: [CLI_PATH, COMMAND, '-c', TEST_TOOLCHAINS['empty'].crn, '-r', TEST_TOOLCHAINS['empty'].region, '-g', DEFAULT_RG_ID],
            expected: new RegExp(`Warning! A toolchain named \"${TEST_TOOLCHAINS['empty'].name}\" already exists in:[\\s\\S]*?Region: ${TEST_TOOLCHAINS['empty'].region}`),
            options: {
                exitCondition: '(Recommended) Add a tag to the cloned toolchain (Ctrl-C to abort):',
                timeout: 10000
            }
        },
        {
            name: 'Dry Run Flag does not clone a toolchain',
            cmd: [CLI_PATH, COMMAND, '-c', TEST_TOOLCHAINS['empty'].crn, '-r', TEST_TOOLCHAINS['empty'].region, '-D'],
            expected: null,
            options: {
                timeout: 100000,
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
            name: 'Quiet flag suppresses info, debug and log messages',
            cmd: [CLI_PATH, COMMAND, '-c', TEST_TOOLCHAINS['empty'].crn, '-r', TEST_TOOLCHAINS['empty'].region, '-q'],
            expected: null,
            options: {
                timeout: 100000,
                questionAnswerMap: {
                    '(Recommended) Add a tag to the cloned toolchain (Ctrl-C to abort):': '',
                    [`(Recommended) Edit the cloned toolchain's name [default: ${TEST_TOOLCHAINS['empty'].name}] (Ctrl-C to abort):`]: '',
                },
            },
            assertionFunc: (output) => {
                // (CURRENTLY DISABLED) finds any [INFO] level logs that matches '[INFO] ...' but not '[INFO] See cloned toolchain...' 
                // expect(output).to.not.match(/^(?!.*\[INFO\]\s+Cloned toolchain).*\[INFO\].*$/m); // TODO: fix test

                expect(output).to.not.match(/\[DEBUG\]/);
                expect(output).to.not.match(/\[LOG\]/);
            }
        },
        {
            name: 'Compact flag only generates one terraform file',
            cmd: [CLI_PATH, COMMAND, '-c', TEST_TOOLCHAINS['single-pl'].crn, '-r', TEST_TOOLCHAINS['single-pl'].region, '-D', '-f', '-C'],
            expected: null,
            options: {
                timeout: 100000,
                cwd: TEMP_DIR + '/' + 'compact-flag-only-generates-one-tf-file'
            },
            assertionFunc: () => {
                // check only resources.tf is created
                assert.isFalse(
                    areFilesInDir(TEMP_DIR + '/' + 'compact-flag-only-generates-one-tf-file', [
                        'cd_toolchain.tf',
                        'cd_toolchain_tool_pipeline.tf',
                        'cd_tekton_pipeline.tf',
                    ])
                );
                assert.isTrue(areFilesInDir(TEMP_DIR + '/' + 'compact-flag-only-generates-one-tf-file', ['resources.tf']));
            }
        },
        {
            name: 'Prompt user when OAuth does not exist for Git tool in target region',
            cmd: [CLI_PATH, COMMAND, '-c', TEST_TOOLCHAINS['single-pl'].crn, '-r', TEST_TOOLCHAINS['single-pl'].region, '-D'],
            expected: /Warning! The following git tool integration\(s\) are not authorized in the target region/,
            options: {
                timeout: 60000,
                questionAnswerMap: {
                    '(Recommended) Add a tag to the cloned toolchain (Ctrl-C to abort):': '',
                    [`(Recommended) Edit the cloned toolchain's name [default: ${TEST_TOOLCHAINS['single-pl'].name}] (Ctrl-C to abort):`]: '',
                    'Only \'yes\' will be accepted to proceed. (Ctrl-C to abort)': 'yes'
                },
            }
        },
        {
            name: 'Handles special characters in names',
            cmd: [CLI_PATH, COMMAND, '-c', TEST_TOOLCHAINS['special-chars'].crn, '-r', TEST_TOOLCHAINS['special-chars'].region, '-D', '-f'],
            expected: null,
            options: {
                timeout: 100000,
                cwd: TEMP_DIR + '/' + 'special-chars'
            },
            assertionFunc: () => {
                assert.isTrue(
                    areFilesInDir(TEMP_DIR + '/' + 'special-chars', [
                        'cd_tekton_pipeline.tf',
                        'cd_tekton_pipeline_definition.tf',
                        'cd_tekton_pipeline_property.tf',
                        'cd_tekton_pipeline_trigger.tf',
                        'cd_tekton_pipeline_trigger_property.tf',
                        'cd_toolchain.tf',
                        'cd_toolchain_tool_hostedgit.tf',
                        'cd_toolchain_tool_pipeline.tf',
                    ])
                );
            }
        },
    ];

    for (const { name, cmd, expected, options, assertionFunc } of testCases) {
        if (VERBOSE_MODE) cmd.push('-v');
        it(`${name}`, async () => {
            await assertPtyOutput(cmd, expected, options, assertionFunc);
        });
    }

    it('Check for existing .tf files in output directory', async () => {
        const testDir = path.resolve(TEMP_DIR, 'check-for-existing-tf-files-in-out-dir');
        const tfFilePath = path.resolve(testDir, 'empty.tf');
        if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });
        fs.writeFileSync(tfFilePath, '');

        const cmd = [CLI_PATH, COMMAND, '-c', TEST_TOOLCHAINS['empty'].crn, '-r', TARGET_REGIONS[0], '-d', testDir];
        if (VERBOSE_MODE) cmd.push('-v');

        await assertExecError(
            cmd,
            /Output directory already has 1 '.tf' files, please specify a different output directory/,
            { cwd: testDir }
        );
    });
});
