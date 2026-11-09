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

import mocks from '../data/mocks.js';
import { assertExecError } from '../utils/testUtils.js';
import { TEST_TOOLCHAINS } from '../data/test-toolchains.js';

nconf.env('__');
nconf.file('local', 'test/config/local.json');

const VERBOSE_MODE = nconf.get('VERBOSE_MODE');
const TEMP_DIR = nconf.get('TEST_TEMP_DIR');

const CLI_PATH = path.resolve('index.js');
const COMMAND = 'export-toolchain';

describe('export-toolchain: Test user input handling', function () {
    this.timeout('120s');
    this.command = COMMAND;

    const validCrn = TEST_TOOLCHAINS['empty'].crn;
    const invalidArgsCases = [
        {
            name: 'Toolchain CRN not specified',
            cmd: [CLI_PATH, COMMAND],
            expected: /required option '-c, --toolchain-crn <crn>' not specified/,
        },
        {
            name: 'API Key is not specified',
            cmd: [CLI_PATH, COMMAND, '-c', validCrn],
            expected: /Environment variable 'IBMCLOUD_API_KEY' is required but not set/,
            options: { env: { ...process.env, IBMCLOUD_API_KEY: '' } }
        },
        {
            name: 'Invalid API Key provided',
            cmd: [CLI_PATH, COMMAND, '-c', validCrn],
            expected: /There was a problem getting a bearer token using IBMCLOUD_API_KEY/,
            options: { env: { ...process.env, IBMCLOUD_API_KEY: 'not-a-valid-apikey' } }
        },
        {
            name: 'Invalid CRN is provided',
            cmd: [CLI_PATH, COMMAND, '-c', mocks.invalidCrn],
            expected: /Provided toolchain CRN is invalid/,
        },
    ];

    for (const { name, cmd, expected, options, assertionFn } of invalidArgsCases) {
        if (VERBOSE_MODE) cmd.push('-v');
        it(`Invalid args: ${name}`, async () => {
            await assertExecError(cmd, expected, options, assertionFn);
        });
    }

    it('Check for existing .tf files in output directory', async () => {
        const testDir = path.resolve(TEMP_DIR, 'export-check-for-existing-tf-files-in-out-dir');
        const tfFilePath = path.resolve(testDir, 'empty.tf');
        if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });
        fs.writeFileSync(tfFilePath, '');

        const cmd = [CLI_PATH, COMMAND, '-c', validCrn, '-d', testDir];
        if (VERBOSE_MODE) cmd.push('-v');

        await assertExecError(
            cmd,
            /Output directory already has 1 '.tf' files, please specify a different output directory/,
            { cwd: testDir }
        );
    });
});
