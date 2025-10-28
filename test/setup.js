/**
 * Licensed Materials - Property of IBM
 * (c) Copyright IBM Corporation 2025. All Rights Reserved.
 *
 * Note to U.S. Government Users Restricted Rights:
 * Use, duplication or disclosure restricted by GSA ADP Schedule
 * Contract with IBM Corp.
 */

import fs from 'node:fs';
import { resolve } from 'node:path'
import nconf from 'nconf';

import { logger } from '../cmd/utils/logger.js';

nconf.env('__');
nconf.file('local', 'test/config/local.json');
process.env.IBMCLOUD_API_KEY = nconf.get('IBMCLOUD_API_KEY');
process.env.DISABLE_SPINNER = nconf.get('DISABLE_SPINNER');
process.env.LOG_DUMP = nconf.get('LOG_DUMP') || false;      // Disable each individual test case's process's log file generation by default

const TEMP_DIR = resolve(nconf.get('TEST_TEMP_DIR'));
const LOG_DIR = resolve(nconf.get('TEST_LOG_DIR'));
const DEBUG_MODE = nconf.get('TEST_DEBUG_MODE');

export const mochaHooks = {
    beforeAll() {
        if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });
        if (fs.existsSync(LOG_DIR)) fs.rmSync(LOG_DIR, { recursive: true });
    },
    beforeEach() {
        if (DEBUG_MODE === true && LOG_DIR) {
            const logFile = this.currentTest.parent.command ? 
                resolve(LOG_DIR, this.currentTest.parent.command, this.currentTest.title + '.log') :
                resolve(LOG_DIR, this.currentTest.title + '.log');
            logger.createLogStream(logFile);
        }
    },
    afterEach() {
        logger.close();
    },
    afterAll() {
        if (fs.existsSync(TEMP_DIR) && DEBUG_MODE === false) fs.rmSync(TEMP_DIR, { recursive: true });
    },
};
