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

import { assertTfResourcesInDir, assertPtyOutput } from '../utils/testUtils.js';
import { TEST_TOOLCHAINS } from '../data/test-toolchains.js';
import { TARGET_REGIONS } from '../../config.js';

nconf.env('__');
nconf.file('local', 'test/config/local.json');

const TEMP_DIR = nconf.get('TEST_TEMP_DIR');
const VERBOSE_MODE = nconf.get('VERBOSE_MODE');

const CLI_PATH = path.resolve('index.js');
const COMMAND = 'copy-toolchain';

describe('copy-toolchain: Test import-terraform output', function () {
    this.timeout('240s');
    this.command = COMMAND;

    const testCases = [
        {
            name: 'Import 1PL-GHE-CC Toolchain',
            cmd: [CLI_PATH, COMMAND, '-c', TEST_TOOLCHAINS['1pl-ghe-cc'].crn, '-r', TEST_TOOLCHAINS['1pl-ghe-cc'].region, '-D', '-f'],
            expected: null,
            options: {
                timeout: 60000,
                cwd: TEMP_DIR + '/' + 'import-1pl-ghe-cc-toolchain'
            },
            assertionFunc: async () => {
                await assertTfResourcesInDir(TEMP_DIR + '/' + 'import-1pl-ghe-cc-toolchain', {
                    ibm_cd_tekton_pipeline: 1,
                    ibm_cd_tekton_pipeline_definition: 1,
                    ibm_cd_tekton_pipeline_property: 1,
                    ibm_cd_tekton_pipeline_trigger: 1,
                    ibm_cd_tekton_pipeline_trigger_property: 1,
                    ibm_cd_toolchain: 1,
                    ibm_cd_toolchain_tool_custom: 1,
                    ibm_cd_toolchain_tool_githubconsolidated: 1,
                    ibm_cd_toolchain_tool_pipeline: 1,
                    ibm_cd_toolchain_tool_secretsmanager: 1,
                    ibm_cd_toolchain_tool_slack: 1,
                    ibm_iam_authorization_policy: 1
                });
            }
        },
        {
            name: 'Import 1PL-GHE-CD Toolchain',
            cmd: [CLI_PATH, COMMAND, '-c', TEST_TOOLCHAINS['1pl-ghe-cd'].crn, '-r', TEST_TOOLCHAINS['1pl-ghe-cd'].region, '-D', '-f'],
            expected: null,
            options: {
                timeout: 60000,
                cwd: TEMP_DIR + '/' + 'import-1pl-ghe-cd-toolchain'
            },
            assertionFunc: async () => {
                await assertTfResourcesInDir(TEMP_DIR + '/' + 'import-1pl-ghe-cd-toolchain', {
                    ibm_cd_tekton_pipeline: 1,
                    ibm_cd_tekton_pipeline_definition: 1,
                    ibm_cd_tekton_pipeline_property: 1,
                    ibm_cd_tekton_pipeline_trigger: 1,
                    ibm_cd_tekton_pipeline_trigger_property: 1,
                    ibm_cd_toolchain: 1,
                    ibm_cd_toolchain_tool_custom: 1,
                    ibm_cd_toolchain_tool_githubconsolidated: 1,
                    ibm_cd_toolchain_tool_pipeline: 1,
                    ibm_cd_toolchain_tool_secretsmanager: 1,
                    ibm_cd_toolchain_tool_slack: 1,
                    ibm_iam_authorization_policy: 1
                });
            }
        },
        {
            name: 'Import DevSecOps-GRIT-CI Toolchain',
            cmd: [CLI_PATH, COMMAND, '-c', TEST_TOOLCHAINS['devsecops-grit-ci'].crn, '-r', TEST_TOOLCHAINS['devsecops-grit-ci'].region, '-D', '-f'],
            expected: null,
            options: {
                timeout: 60000,
                cwd: TEMP_DIR + '/' + 'import-devsecops-grit-ci-toolchain'
            },
            assertionFunc: async () => {
                await assertTfResourcesInDir(TEMP_DIR + '/' + 'import-devsecops-grit-ci-toolchain', {
                    ibm_cd_tekton_pipeline: 1,
                    ibm_cd_tekton_pipeline_definition: 1,
                    ibm_cd_tekton_pipeline_property: 1,
                    ibm_cd_tekton_pipeline_trigger: 1,
                    ibm_cd_tekton_pipeline_trigger_property: 1,
                    ibm_cd_toolchain: 1,
                    ibm_cd_toolchain_tool_custom: 1,
                    ibm_cd_toolchain_tool_devopsinsights: 1,
                    ibm_cd_toolchain_tool_hostedgit: 1,
                    ibm_cd_toolchain_tool_pipeline: 1,
                    ibm_cd_toolchain_tool_secretsmanager: 1,
                    ibm_cd_toolchain_tool_slack: 1,
                    ibm_iam_authorization_policy: 1
                })
            }
        },
    ];

    for (const { name, cmd, expected, options, assertionFunc } of testCases) {
        if (VERBOSE_MODE) cmd.push('-v');
        it(`${name}`, async () => {
            await assertPtyOutput(cmd, expected, options, assertionFunc);
        });
    }
});
