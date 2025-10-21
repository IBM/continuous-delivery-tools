import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import nconf from 'nconf';

import * as chai from 'chai';
import chaiAsPromised from 'chai-as-promised';

chai.use(chaiAsPromised);
chai.config.truncateThreshold = 0;
const { expect } = chai;

import { mockValidCrn, mockInvalidCrn, mockValidRegion, mockInvalidRegion } from './mocks/data.js';
import { exec, runPtyProcess, testSetup, testCleanup } from './utils/testUtils.js';

nconf.env('__');
nconf.file('local', 'test/config/local.json');
process.env.IBMCLOUD_API_KEY = nconf.get('IBMCLOUD_API_KEY');

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CLI_PATH = join(__dirname, '../index.js');
const COMMAND = 'copy-toolchain';

before(() => testSetup());
after(() => testCleanup());

describe('Test copy-toolchain command user input handling', function () {
    this.timeout(10000);

    it('Invalid arguments handling', async () => {

        const invalidRegionPattern = new RegExp(`option '-r, --region <region>' argument '${mockInvalidRegion}' is invalid`);

        const tests = [
            // Toolchain CRN not specified
            expect(exec([CLI_PATH, COMMAND])).to.be.rejectedWith(/required option \'-c, --toolchain-crn <crn>\' not specified/),

            // Region is not specified
            expect(exec([CLI_PATH, COMMAND, '-c', mockValidCrn])).to.be.rejectedWith(/required option \'-r, --region <region>\' not specified/),

            // API Key is not specified
            expect(exec([CLI_PATH, COMMAND, '-c', mockValidCrn, '-r', mockValidRegion], { env: { ...process.env, IBMCLOUD_API_KEY: '' } }))
                .to.be.rejectedWith(/Environment variable 'IBMCLOUD_API_KEY' is required but not set/),

            // Invalid API Key provided
            expect(exec([CLI_PATH, COMMAND, '-c', mockValidCrn, '-r', mockValidRegion], { env: { ...process.env, IBMCLOUD_API_KEY: 'not-a-valid-apikey' } }))
                .to.be.rejectedWith(/There was a problem getting a bearer token using IBMCLOUD_API_KEY/),

            // Invalid region is provided
            expect(exec([CLI_PATH, COMMAND, '-c', mockValidCrn, '-r', mockInvalidRegion])).to.be.rejectedWith(invalidRegionPattern),

            // Invalid CRN is provided
            expect(exec([CLI_PATH, COMMAND, '-c', mockInvalidCrn, '-r', mockValidRegion])).to.be.rejectedWith(/Provided toolchain CRN is invalid/),

            // Invalid Toolchain tag is provided
            expect(exec([CLI_PATH, COMMAND, '-c', mockValidCrn, '-r', mockValidRegion, '-t', 'asdf3234d@34'])).to.be.rejectedWith(/Provided tag is invalid/),

            // Invalid Toolchain name is provided
            expect(exec([CLI_PATH, COMMAND, '-c', mockValidCrn, '-r', mockValidRegion, '-n', 'notValidToolChainName%^$*'])).to.be.rejectedWith(/Provided toolchain name is invalid/),

            // Invalid Resource Group ID or name is provided
            expect(exec([CLI_PATH, COMMAND, '-c', mockValidCrn, '-r', mockValidRegion, '-g', 'fasdlfkjk343423fk359tsdf58k4'])).to.be.rejectedWith(/The resource group with provided ID or name was not found or is not accessible/),
        ];
        await Promise.all(tests);
    });

    it('Invalid user input handling in prompts', async () => {
        const tests = [
            // Invalid Toolchain tag is provided
            expect(runPtyProcess(
                [CLI_PATH, COMMAND, '-c', mockValidCrn, '-r', mockValidRegion], 
                {'(Recommended) Add a tag to the cloned toolchain:': 'invalidTag@'}, 'Validation failed')
            ).to.eventually.include('Provided tag is invalid'),
        ];

        await Promise.all(tests);
    });
});

describe('Test copy-toolchain command functionalities', function () {
});

describe('Test copy-toolchain command toolchain validation', function () {
});

describe('Test Terraform and Terraformer output', function () {
});
