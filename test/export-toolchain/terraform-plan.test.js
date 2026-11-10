/**
 * Licensed Materials - Property of IBM
 * (c) Copyright IBM Corporation 2025, 2026. All Rights Reserved.
 *
 * Note to U.S. Government Users Restricted Rights:
 * Use, duplication or disclosure restricted by GSA ADP Schedule
 * Contract with IBM Corp.
 */

import path from 'node:path';
import fs from 'node:fs';
import child_process from 'node:child_process';
import { promisify } from 'node:util';
import nconf from 'nconf';

import { expect, assert } from 'chai';

import { assertPtyOutput } from '../utils/testUtils.js';
import { TEST_TOOLCHAINS } from '../data/test-toolchains.js';

nconf.env('__');
nconf.file('local', 'test/config/local.json');

const TEMP_DIR = nconf.get('TEST_TEMP_DIR');
const VERBOSE_MODE = nconf.get('VERBOSE_MODE');
const IBMCLOUD_API_KEY = nconf.get('IBMCLOUD_API_KEY');

const CLI_PATH = path.resolve('index.js');
const COMMAND = 'export-toolchain';

const execPromise = promisify(child_process.exec);

// Returns a description of each planned change that is not expected after an export. The only expected
// change is creating a converted GitHub Enterprise integration (legacy integrations have no Terraform
// equivalent). Secrets that cannot be exported are covered by lifecycle ignore_changes, so an update to
// any resource, including a secret, would overwrite existing values on terraform apply and is a failure.
function findUnexpectedChanges(plan) {
    const unexpected = [];

    for (const rc of plan.resource_changes ?? []) {
        const { actions } = rc.change;
        if (actions.length === 1 && actions[0] === 'no-op') continue;

        const isConvertedGhe = rc.type === 'ibm_cd_toolchain_tool_githubconsolidated'
            && rc.name.startsWith('converted--githubconsolidated_');
        if (actions.length === 1 && actions[0] === 'create' && isConvertedGhe) continue;

        unexpected.push(`${rc.address}: unexpected ${actions.join(', ')}`);
    }

    return unexpected;
}

describe('export-toolchain: Test terraform plan of exported toolchains', function () {
    this.timeout('600s');
    this.command = COMMAND;

    for (const [key, toolchain] of Object.entries(TEST_TOOLCHAINS)) {
        it(`Exported Terraform only plans expected changes: ${key}`, async () => {
            // each test exports into its own directory, since tests run in parallel
            const dir = path.resolve(TEMP_DIR, `export-plan-${key}`);
            // -f: skip the GRIT URL mapping prompt, which cannot be answered here
            const cmd = [CLI_PATH, COMMAND, '-c', toolchain.crn, '-d', dir, '-f'];
            if (VERBOSE_MODE) cmd.push('-v');
            await assertPtyOutput(cmd, /successfully exported/, { timeout: 400000 });
            expect(fs.existsSync(path.resolve(dir, 'terraform.tfstate'))).to.equal(true);

            const opts = {
                cwd: dir,
                env: { ...process.env, TF_VAR_ibmcloud_api_key: IBMCLOUD_API_KEY },
                maxBuffer: 50 * 1024 * 1024
            };
            await execPromise('terraform plan -input=false -no-color -out=check.tfplan', opts);
            const { stdout } = await execPromise('terraform show -json check.tfplan', opts);
            fs.rmSync(path.resolve(dir, 'check.tfplan'), { force: true });

            const unexpected = findUnexpectedChanges(JSON.parse(stdout));
            assert.deepEqual(unexpected, [], `terraform plan shows unexpected changes:\n${unexpected.join('\n')}`);
        });
    }
});
