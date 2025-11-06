/**
 * Licensed Materials - Property of IBM
 * (c) Copyright IBM Corporation 2025. All Rights Reserved.
 *
 * Note to U.S. Government Users Restricted Rights:
 * Use, duplication or disclosure restricted by GSA ADP Schedule
 * Contract with IBM Corp.
 */

import { promisify } from 'util';
import fs from "fs";
import path from "path";
import child_process from 'child_process';
import stripAnsi from 'strip-ansi';
import pty from 'node-pty';
import { parse as tfToJson } from '@cdktf/hcl2json'
import nconf from 'nconf';
import { expect, assert } from 'chai';

import { getBearerToken, deleteToolchain } from '../../cmd/utils/requests.js';
import { logger } from '../../cmd/utils/logger.js';

nconf.env('__');
nconf.file('local', 'test/config/local.json');

const TEMP_DIR = nconf.get('TEST_TEMP_DIR');
const IBMCLOUD_API_KEY = nconf.get('IBMCLOUD_API_KEY');

function cleanOutput(data) {
    if (typeof data === 'string') return stripAnsi(data).replace(/\r/g, '').trim();
}

function parseTcIdAndRegion(output) {
    const pattern = /See cloned toolchain: https:\/\/cloud\.ibm\.com\/devops\/toolchains\/([a-zA-Z0-9-]+)\?env_id=ibm\:yp\:([a-zA-Z0-9-]+)/;
    const match = output.match(pattern);

    if (match) {
        const toolchainId = match[1];
        const region = match[2];
        return { toolchainId, region };
    } else {
        return null;
    }
}

function searchDirectory(currentPath) {
    const foundFiles = [];
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name);
        if (entry.isDirectory()) {
            foundFiles.push(...searchDirectory(fullPath));
        } else {
            foundFiles.push(path.join(currentPath, entry.name));
        }
    }
    return foundFiles;
}

export async function execCommand(fullCommand, options) {
    const commandStr = `node ${fullCommand.join(' ')}`;
    const execPromise = promisify(child_process.exec);

    if (!options) {
        options = { cwd: TEMP_DIR }
    } else {
        options.cwd ??= TEMP_DIR;
        if (!fs.existsSync(options.cwd)) {
            fs.mkdirSync(options.cwd, { recursive: true });
        }
    }

    try {
        const { stdout, stderr } = await execPromise(commandStr, options);
        if (stderr) {
            const err = new Error(cleanOutput(stderr));
            err.stdout = cleanOutput(stdout);
            err.stderr = cleanOutput(stderr);
            throw err;
        }
        return cleanOutput(stdout);
    } catch (e) {
        const err = new Error(cleanOutput(e.message));
        err.stdout = cleanOutput(e.stdout);
        err.stderr = cleanOutput(e.stderr);
        err.code = e.code;
        err.signal = e.signal;
        throw err;
    }
}

export function runPtyProcess(fullCommand, options) {
    const {
        timeout = 0,
        cwd = TEMP_DIR,
        env = process.env,
        questionAnswerMap = {},
        exitCondition = '',
    } = options;

    if (!fs.existsSync(cwd)) fs.mkdirSync(cwd, { recursive: true });

    return new Promise((resolve, reject) => {
        try {
            const ptyProcess = pty.spawn('node', fullCommand, {
                name: 'xterm-color',
                cols: 80,
                rows: 30,
                cwd: cwd,
                env: env
            });

            let output = '';
            let timedOut = false;

            const timer = timeout > 0 ? setTimeout(() => {
                timedOut = true;
                ptyProcess.kill();
            }, timeout) : null;

            ptyProcess.onData((data) => {
                output += data;
                for (const [question, answer] of Object.entries(questionAnswerMap)) {
                    if (data.includes(question)) {
                        ptyProcess.write(answer + '\r');
                    }
                }
                if (exitCondition.length > 0 && data.includes(exitCondition)) {
                    ptyProcess.kill();
                    resolve(cleanOutput(output));
                }
            });

            ptyProcess.onExit(({ exitCode }) => {
                if (timer) clearTimeout(timer);
                if (timedOut) {
                    reject(new Error(`ERROR: Process timed out after ${timeout}ms\n\nCommand: ${'node ' + fullCommand.join(' ')}\n\nOutput:\n${cleanOutput(output)}`));
                }
                if (exitCode !== 0) {
                    reject(new Error(`ERROR: Process exited with code ${exitCode}\n\nCommand: ${'node ' + fullCommand.join(' ')}\n\nOutput:\n${cleanOutput(output)}`));
                } else {
                    resolve(cleanOutput(output));
                }
            });

        } catch (err) {
            reject(err);
        }
    });
}

export async function deleteCreatedToolchains(toolchainsToDelete) {
    if (toolchainsToDelete && typeof toolchainsToDelete === 'object' && toolchainsToDelete.size > 0) {
        const token = await getBearerToken(IBMCLOUD_API_KEY);
        const deletePromises = [...toolchainsToDelete.entries()].map(([id, region]) => deleteToolchain(token, id, region));
        await Promise.all(deletePromises);
    }
}

export async function assertExecError(fullCommand, expectedMessage, options, assertionFn) {
    try {
        const output = await execCommand(fullCommand, options);
        logger.dump(output);
        throw new Error('Expected command to fail but it succeeded');
    } catch (e) {
        logger.dump(e.message);
        if (assertionFn) {
            const res = assertionFn(e.message);
            if (res instanceof Promise) await res;
        } else if (expectedMessage) {
            expect(e.message).to.match(expectedMessage);
        } else {
            assert.fail('No assertion function or expected message provided.');
        }
    }
}

export async function assertPtyOutput(fullCommand, expectedMessage, options, assertionFn) {
    try {
        const output = await runPtyProcess(fullCommand, options);
        logger.dump(output);
        if (assertionFn) {
            const res = assertionFn(output);
            if (res instanceof Promise) await res;
        } else if (expectedMessage) {
            expect(output).to.match(expectedMessage);
        } else {
            assert.fail('No assertion function or expected message provided.');
        }
        return parseTcIdAndRegion(output);
    } catch (e) {
        logger.dump(e.message);
        throw (e);
    }
}

export function areFilesInDir(dirPath, filePatterns) {
    const foundFiles = searchDirectory(dirPath);
    for (const pattern of filePatterns) {
        const regex = new RegExp(pattern);
        if (!foundFiles.some(file => regex.test(file))) {
            return false;
        }
    }
    return true;
}

export async function assertTfResourcesInDir(dirPath, expectedResourcesMap) {
    const resourceCounter = {};

    const foundFiles = searchDirectory(dirPath);
    const allResources = [];
    for (const file of foundFiles) {
        if (!file.endsWith('.tf')) continue;
        const fileName = path.basename(file);
        const tfFile = fs.readFileSync(file, 'utf8');
        const tfFileObject = await tfToJson(fileName, tfFile);
        if (tfFileObject.resource) allResources.push(tfFileObject.resource);
    }

    for (const resourceMap of allResources) {
        for (const resourceType of Object.keys(resourceMap)) {
            resourceCounter[resourceType] = (resourceCounter[resourceType] || 0) + 1;
        }
    }
    // Check if all expected resources are present
    for (const [resourceType, expectedCount] of Object.entries(expectedResourcesMap)) {
        if (resourceCounter[resourceType] !== expectedCount) {
            assert.fail(`Expected ${expectedCount} ${resourceType} resource(s) but found ${resourceCounter[resourceType] || 0}`);
        }
    }
    // Check if there are unexpected resources
    for (const [resourceType, count] of Object.entries(resourceCounter)) {
        if (!(resourceType in expectedResourcesMap)) {
            assert.fail(`Unexpected ${resourceType} resource found. (Count: ${count})`);
        }
    }
    assert.ok(true, 'Directory contains all expected resources');
}
