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

import { expect, assert } from 'chai';

import { assertPtyOutput, areFilesInDir } from '../utils/testUtils.js';
import { TEST_TOOLCHAINS } from '../data/test-toolchains.js';

nconf.env('__');
nconf.file('local', 'test/config/local.json');

const TEMP_DIR = nconf.get('TEST_TEMP_DIR');
const VERBOSE_MODE = nconf.get('VERBOSE_MODE');

const CLI_PATH = path.resolve('index.js');
const COMMAND = 'export-toolchain';

// each test exports into its own directory, since tests run in parallel
const testDir = (name) => path.resolve(TEMP_DIR, 'export-' + name);

describe('export-toolchain: Test functionalities', function () {
    this.timeout('300s');
    this.command = COMMAND;

    const emptyToolchain = TEST_TOOLCHAINS['empty'];

    const testCases = [
        {
            name: 'Terraform Version Verification',
            cmd: [CLI_PATH, COMMAND, '-c', emptyToolchain.crn, '-d', testDir('terraform-version')],
            expected: /✔ Terraform Version:/,
            options: { timeout: 120000 }
        },
        {
            name: 'CLI Version Verification',
            cmd: [CLI_PATH, COMMAND, '-c', emptyToolchain.crn, '-d', testDir('cli-version')],
            expected: /✔ cd-tools Version:/,
            options: { timeout: 120000 }
        },
        {
            name: 'Exports toolchain into the output directory',
            cmd: [CLI_PATH, COMMAND, '-c', emptyToolchain.crn, '-d', testDir('output-dir')],
            expected: null,
            options: { timeout: 120000 },
            assertionFunc: (output) => {
                expect(output).to.match(new RegExp(`Toolchain "${emptyToolchain.name}" successfully exported`));
                assert.isTrue(areFilesInDir(testDir('output-dir'), [
                    'cd_toolchain.tf',
                    'output.tf',
                    'provider.tf',
                    'terraform.tfstate'
                ]));
            }
        },
        {
            name: 'Output directory defaults to the toolchain name in the working directory',
            cmd: [CLI_PATH, COMMAND, '-c', emptyToolchain.crn],
            expected: null,
            options: { timeout: 120000, cwd: testDir('default-output-dir') },
            assertionFunc: () => {
                assert.isTrue(areFilesInDir(path.resolve(testDir('default-output-dir'), emptyToolchain.name), [
                    'cd_toolchain.tf',
                    'output.tf'
                ]));
            }
        },
        {
            name: 'Quiet flag suppresses info, debug and log messages',
            cmd: [CLI_PATH, COMMAND, '-c', emptyToolchain.crn, '-d', testDir('quiet'), '-q'],
            expected: null,
            options: { timeout: 120000 },
            assertionFunc: (output) => {
                expect(output).to.not.match(/\[DEBUG\]/);
                expect(output).to.not.match(/\[LOG\]/);
            }
        },
        {
            name: 'Compact flag only generates one terraform file',
            cmd: [CLI_PATH, COMMAND, '-c', TEST_TOOLCHAINS['single-pl'].crn, '-d', testDir('compact'), '-C'],
            expected: null,
            options: { timeout: 120000 },
            assertionFunc: () => {
                assert.isFalse(areFilesInDir(testDir('compact'), [
                    'cd_toolchain.tf',
                    'cd_toolchain_tool_pipeline.tf',
                    'cd_tekton_pipeline.tf',
                ]));
                assert.isTrue(areFilesInDir(testDir('compact'), ['resources.tf']));
            }
        },
        {
            name: 'Handles special characters in names',
            cmd: [CLI_PATH, COMMAND, '-c', TEST_TOOLCHAINS['special-chars'].crn, '-d', testDir('special-chars')],
            expected: null,
            options: { timeout: 280000 },
            assertionFunc: () => {
                assert.isTrue(areFilesInDir(testDir('special-chars'), [
                    'cd_tekton_pipeline.tf',
                    'cd_tekton_pipeline_definition.tf',
                    'cd_tekton_pipeline_property.tf',
                    'cd_tekton_pipeline_trigger.tf',
                    'cd_tekton_pipeline_trigger_property.tf',
                    'cd_toolchain.tf',
                    'cd_toolchain_tool_hostedgit.tf',
                    'cd_toolchain_tool_pipeline.tf',
                ]));
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
