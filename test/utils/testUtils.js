import { promisify } from 'util';
import child_process from 'child_process';
import stripAnsi from 'strip-ansi';
import pty from 'node-pty';
import fs from 'node:fs';
import nconf from 'nconf';

import { getBearerToken, deleteToolchain } from '../../cmd/utils/requests.js';
import { logger } from '../../cmd/utils/logger.js';

nconf.env('__');
nconf.file('local', 'test/config/local.json');

const TEMP_DIR = nconf.get('TEST_TEMP_DIR');
const DEBUG_MODE = nconf.get('TEST_DEBUG_MODE');
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
                    reject(new Error(`ERROR: Process timed out after ${timeout}ms\n\nCommand: ${fullCommand}\n\nOutput:\n${cleanOutput(output)}`));
                }
                if (exitCode !== 0) {
                    reject(new Error(`ERROR: Process exited with code ${exitCode}\n\nCommand: ${fullCommand}\n\nOutput:\n${cleanOutput(output)}`));
                } else {
                    resolve(cleanOutput(output));
                }
            });

        } catch (err) {
            reject(err);
        }
    });
}

export function testSetup() {
    if (DEBUG_MODE === true && nconf.get('TEST_LOG_DIR')) {
        logger.createLogStream(`${nconf.get('TEST_LOG_DIR')}/copy-toolchain-test-${new Date().getTime()}.log`);
    }
    if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });
}

export async function testCleanup(toolchainsToDelete) {
    if (fs.existsSync(TEMP_DIR) && DEBUG_MODE === false) fs.rmSync(TEMP_DIR, { recursive: true });
    if (typeof toolchainsToDelete === 'object' && toolchainsToDelete.size) {
        const token = await getBearerToken(IBMCLOUD_API_KEY);
        const deletePromises = [...toolchainsToDelete.entries()].map(([id, region]) => deleteToolchain(token, id, region));
        await Promise.all(deletePromises);
    }
    await logger.close();
}
