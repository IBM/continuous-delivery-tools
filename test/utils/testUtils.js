import { promisify } from 'util';
import child_process from 'child_process';
import stripAnsi from 'strip-ansi';
import pty from 'node-pty';
import fs from 'node:fs';
import nconf from 'nconf';

nconf.env('__');
nconf.file('local', 'test/config/local.json');

const TEMP_DIR = nconf.get('TEMP_DIR');
const DEBUG_MODE = nconf.get('DEBUG_MODE');

export async function exec(fullCommand, options) {
    const commandStr = `node ${fullCommand.join(' ')}`;
    const execPromise = promisify(child_process.exec);
    try {
        const { stdout, stderr } = await execPromise(commandStr, options);
        return [stripAnsi(stdout.trim()), stripAnsi(stderr.trim())];
    } catch (e) {
        const stdout = stripAnsi(e.stdout.trim());
        const stderr = stripAnsi(e.stderr.trim());
        const message = stripAnsi(e.message.trim());

        const err = new Error(message);
        err.stdout = stdout;
        err.stderr = stderr;
        err.code = e.code;
        err.signal = e.signal;
        throw err;
    }
}

export function runPtyProcess(fullCommand, questionAnswerMap = {}, exitCondition = '') {
    return new Promise((resolve, reject) => {
        try {
            const ptyProcess = pty.spawn('node', fullCommand, {
                name: 'xterm-color',
                cols: 80,
                rows: 30,
                cwd: process.cwd(),
                env: process.env,
            });

            let output = '';

            ptyProcess.onData((data) => {
                output += data;
                for (const [question, answer] of Object.entries(questionAnswerMap)) {
                    if (data.includes(question)) {
                        ptyProcess.write(answer + '\r');
                    }
                }
                if (exitCondition.length > 0 && data.includes(exitCondition)) {
                    ptyProcess.kill();
                    resolve(stripAnsi(output).trim());
                }
            });

            ptyProcess.onExit(({ exitCode }) => {
                if (exitCode !== 0) {
                    reject(new Error(`Process exited with code ${exitCode}\n\nOutput:\n${stripAnsi(output).trim()}`));
                } else {
                    resolve(stripAnsi(output).trim());
                }
            });

        } catch (err) {
            reject(err);
        }
    });
}

export function testSetup() {
    if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });
}

export function testCleanup() {
    if (fs.existsSync(TEMP_DIR) && DEBUG_MODE === false) fs.rmSync(TEMP_DIR, { recursive: true });
}
