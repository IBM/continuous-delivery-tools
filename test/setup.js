/**
 * Licensed Materials - Property of IBM
 * (c) Copyright IBM Corporation 2025, 2026. All Rights Reserved.
 *
 * Note to U.S. Government Users Restricted Rights:
 * Use, duplication or disclosure restricted by GSA ADP Schedule
 * Contract with IBM Corp.
 */

import fs from 'node:fs';
import { resolve } from 'node:path'
import nconf from 'nconf';

import { logger } from '../cmd/utils/logger.js';
import { cleanupToolchains } from './utils/testUtils.js';

nconf.env('__');
nconf.file('local', 'test/config/local.json');
process.env.IBMCLOUD_API_KEY = nconf.get('IBMCLOUD_API_KEY');
process.env.DISABLE_SPINNER = nconf.get('DISABLE_SPINNER');
process.env.LOG_DUMP = nconf.get('LOG_DUMP') || false;      // Disable each individual test case's process's log file generation by default

const TEMP_DIR = resolve(nconf.get('TEST_TEMP_DIR'));
const LOG_DIR = resolve(nconf.get('TEST_LOG_DIR'));
const DEBUG_MODE = nconf.get('TEST_DEBUG_MODE');

function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

export const mochaHooks = {
    async beforeAll() {
        for (let i = 0; i < 3; i++) {
            try {
                fs.rmSync(TEMP_DIR, { recursive: true, force: true });
                fs.rmSync(LOG_DIR, { recursive: true, force: true });
            } catch {}
            if (!fs.existsSync(TEMP_DIR) && !fs.existsSync(LOG_DIR)) break;
            await sleep(1000);
        }
        fs.mkdirSync(TEMP_DIR, { recursive: true });
    },
    beforeEach() {
        if (DEBUG_MODE === true && LOG_DIR) {
            const testTitle = this.currentTest.title.toLowerCase().replaceAll(':', '').replaceAll(' ', '-');
            const logFile = this.currentTest.parent.command ?
                resolve(LOG_DIR, this.currentTest.parent.command, testTitle + '.log') :
                resolve(LOG_DIR, testTitle + '.log');
            logger.createLogStream(logFile);
            // Adding logging for log stream creation and closing, because there's cases of missing test log files when running tests in parallel, most likely because of the singleton logger, 
            // causing some sort of race condition happening
            // console.info(`Created test log stream for test case '${this.currentTest.title}'`);
        }
    },
    async afterEach() {
        await logger.close();
        // console.info(`Closed test log stream for test case '${this.currentTest.title}'`);
    },
    afterAll() {
        if (fs.existsSync(TEMP_DIR) && DEBUG_MODE === false) fs.rmSync(TEMP_DIR, { recursive: true });
    },
};

// Global root hook that runs once after all tests complete
export const mochaGlobalTeardown = async function() {
    // Clean up test toolchains created during test runs
    await cleanupToolchains();
};

// Global root hook that runs once before all tests start
export const mochaGlobalSetup = async function() {
    // Clean up any orphaned toolchains from previous test runs before starting tests
    await cleanupToolchains();
};
