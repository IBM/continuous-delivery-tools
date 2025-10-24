import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import nconf from 'nconf';

import * as chai from 'chai';
import chaiAsPromised from 'chai-as-promised';

chai.use(chaiAsPromised);
chai.config.truncateThreshold = 0;
const { expect, assert } = chai;

import mocks from '../data/mocks.js';
import { execCommand, runPtyProcess, testSetup, testCleanup } from '../utils/testUtils.js';
import { TEST_TOOLCHAINS } from '../data/test-toolchains.js';
import { TARGET_REGIONS } from '../../config.js';
import { logger } from '../../cmd/utils/logger.js';

nconf.env('__');
nconf.file('local', 'test/config/local.json');
process.env.IBMCLOUD_API_KEY = nconf.get('IBMCLOUD_API_KEY');
process.env.LOG_DUMP = nconf.get('LOG_DUMP');

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CLI_PATH = join(__dirname, '../../index.js');
const COMMAND = 'copy-toolchain';

const toolchainsToDelete = new Map();

before(() => testSetup());
after(async () => await testCleanup(toolchainsToDelete));

describe('Test copy-toolchain command user input handling', function () {
    this.timeout('60s');

    it('Invalid arguments handling', async () => {

        const validCrn = TEST_TOOLCHAINS['empty'].crn;
        const invalidRegionPattern = new RegExp(`option '-r, --region <region>' argument '${mocks.invalidRegion}' is invalid`);

        const tests = [
            // Toolchain CRN not specified
            expect(execCommand([CLI_PATH, COMMAND])).to.be.rejectedWith(/required option \'-c, --toolchain-crn <crn>\' not specified/),

            // Region is not specified
            expect(execCommand([CLI_PATH, COMMAND, '-c', validCrn])).to.be.rejectedWith(/required option \'-r, --region <region>\' not specified/),

            // API Key is not specified
            expect(execCommand([CLI_PATH, COMMAND, '-c', validCrn, '-r', TARGET_REGIONS[0]], { env: { ...process.env, IBMCLOUD_API_KEY: '' } }))
                .to.be.rejectedWith(/Environment variable 'IBMCLOUD_API_KEY' is required but not set/),

            // Invalid API Key provided
            expect(execCommand([CLI_PATH, COMMAND, '-c', validCrn, '-r', TARGET_REGIONS[0]], { env: { ...process.env, IBMCLOUD_API_KEY: 'not-a-valid-apikey' } }))
                .to.be.rejectedWith(/There was a problem getting a bearer token using IBMCLOUD_API_KEY/),

            // Invalid region is provided
            expect(execCommand([CLI_PATH, COMMAND, '-c', validCrn, '-r', mocks.invalidRegion])).to.be.rejectedWith(invalidRegionPattern),

            // Invalid CRN is provided
            expect(execCommand([CLI_PATH, COMMAND, '-c', mocks.invalidCrn, '-r', TARGET_REGIONS[0]])).to.be.rejectedWith(/Provided toolchain CRN is invalid/),

            // Invalid Toolchain tag is provided
            expect(execCommand([CLI_PATH, COMMAND, '-c', validCrn, '-r', TARGET_REGIONS[0], '-t', mocks.invalidTag])).to.be.rejectedWith(/Provided tag is invalid/),

            // Invalid Toolchain name is provided
            expect(execCommand([CLI_PATH, COMMAND, '-c', validCrn, '-r', TARGET_REGIONS[0], '-n', mocks.invalidTcName])).to.be.rejectedWith(/Provided toolchain name is invalid/),

            // Invalid Resource Group ID or name is provided
            expect(execCommand([CLI_PATH, COMMAND, '-c', validCrn, '-r', TARGET_REGIONS[0], '-g', mocks.invalidRgName])).to.be.rejectedWith(/The resource group with provided ID or name was not found or is not accessible/),
            expect(execCommand([CLI_PATH, COMMAND, '-c', validCrn, '-r', TARGET_REGIONS[0], '-g', mocks.invalidRgId])).to.be.rejectedWith(/The resource group with provided ID or name was not found or is not accessible/),
        ];
        await Promise.all(tests).catch((e) => {
            logger.dump(e.message);
            assert.fail(e.message);
        });
    });

    it('Invalid user input handling in prompts', async () => {
        const tests = [
            // Invalid Toolchain tag is provided
            expect(runPtyProcess(
                [CLI_PATH, COMMAND, '-c', TEST_TOOLCHAINS['empty'].crn, '-r', TARGET_REGIONS[0]], {
                questionAnswerMap: { '(Recommended) Add a tag to the cloned toolchain:': mocks.invalidTag },
                exitCondition: 'Validation failed',
                timeout: 5000
            })
            ).to.eventually.include('Provided tag is invalid'),

            // Invalid Toolchain name is provided
            expect(runPtyProcess(
                [CLI_PATH, COMMAND, '-c', TEST_TOOLCHAINS['empty'].crn, '-r', TEST_TOOLCHAINS['empty'].region], {
                questionAnswerMap: { '(Recommended) Change the cloned toolchain\'s name:': mocks.invalidTcName },
                exitCondition: 'Validation failed',
                timeout: 5000
            })
            ).to.eventually.include('Provided toolchain name is invalid'),
        ];
        await Promise.all(tests).catch((e) => {
            logger.dump(e.message);
            assert.fail(e.message);
        });
    });
});
