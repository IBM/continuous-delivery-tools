/**
 * Licensed Materials - Property of IBM
 * (c) Copyright IBM Corporation 2025. All Rights Reserved.
 *
 * Note to U.S. Government Users Restricted Rights:
 * Use, duplication or disclosure restricted by GSA ADP Schedule
 * Contract with IBM Corp.
 */

import { promisify } from 'util';
import child_process from 'child_process';
import stripAnsi from 'strip-ansi';
import pty from 'node-pty';
import nconf from 'nconf';
import { expect } from 'chai';

import { getBearerToken, deleteToolchain } from '../../cmd/utils/requests.js';
import { logger } from '../../cmd/utils/logger.js';

nconf.env('__');
nconf.file('local', 'test/config/local.json');

const IBMCLOUD_API_KEY = nconf.get('IBMCLOUD_API_KEY');

function cleanOutput(data) {
    if (typeof data === 'string') return stripAnsi(data).replace(/\r/g, '').trim();
}

export async function execCommand(fullCommand, options) {
    const commandStr = `node ${fullCommand.join(' ')}`;
    const execPromise = promisify(child_process.exec);
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
        cwd = process.cwd(),
        env = process.env,
        questionAnswerMap = {},
        exitCondition = '',
    } = options;

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

export async function testSuiteCleanup(toolchainsToDelete) {
    if (toolchainsToDelete && typeof toolchainsToDelete === 'object' && toolchainsToDelete.size > 0) {
        const token = await getBearerToken(IBMCLOUD_API_KEY);
        const deletePromises = [...toolchainsToDelete.entries()].map(([id, region]) => deleteToolchain(token, id, region));
        await Promise.all(deletePromises);
    }
}

export async function expectExecError(fullCommand, expectedMessage, options) {
    try {
        const output = await execCommand(fullCommand, options);
        logger.dump(output);
        throw new Error('Expected command to fail but it succeeded');
    } catch (e) {
        logger.dump(e.message);
        expect(e.message).to.match(expectedMessage);
    }
}

export async function expectPtyOutputToMatch(fullCommand, expectedMessage, options) {
    try {
        const output = await runPtyProcess(fullCommand, options);
        logger.dump(output);
        expect(output).to.match(expectedMessage);
    } catch (e) {
        logger.dump(e.message);
        throw (e);
    }
}
