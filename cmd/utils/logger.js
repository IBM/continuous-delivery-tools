/**
 * Licensed Materials - Property of IBM
 * (c) Copyright IBM Corporation 2025. All Rights Reserved.
 *
 * Note to U.S. Government Users Restricted Rights:
 * Use, duplication or disclosure restricted by GSA ADP Schedule
 * Contract with IBM Corp.
 */

import ora from 'ora';
import path from 'path';
import Table from 'cli-table3';
import stripAnsi from 'strip-ansi';

import fs from 'node:fs';

const DISABLE_SPINNER = process.env.DISABLE_SPINNER === 'true';

const COLORS = {
    reset: '\x1b[0m',
    gray: '\x1b[90m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    blue: '\x1b[34m',
    white: '\x1b[37m'
};

const LEVELS = {
    log: { color: COLORS.gray, method: 'log' },
    info: { color: COLORS.white, method: 'info' },
    success: { color: COLORS.green, method: 'info' },
    warn: { color: COLORS.yellow, method: 'warn' },
    error: { color: COLORS.red, method: 'error' },
    debug: { color: COLORS.blue, method: 'debug' }
};

class Logger {
    constructor() {
        this.spinner = null;
        this.verbosity = 1;
    }

    setVerbosity(level) {
        this.verbosity = level;
    }

    createLogStream(logPath) {
        const logsDir = path.dirname(logPath);
        if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
        this.logStream = fs.createWriteStream(logPath, { flags: 'a' });
    }

    #getFullPrefix(prefix) {
        if (!prefix) return '';
        const timestamp = new Date().toLocaleTimeString();
        const upperPrefix = prefix.toUpperCase();
        return `${COLORS.gray}${timestamp} [${upperPrefix}]${COLORS.reset}`
    }

    #baseLog(type, msg, prefix) {
        const level = LEVELS[type] || LEVELS.log;
        const formatted = (prefix ? this.#getFullPrefix(prefix) + ' ' : '') + `${level.color}${msg}${COLORS.reset}`;
        console[level.method](formatted);
        this.logStream?.write(stripAnsi((prefix ? this.#getFullPrefix(prefix) + ' ' : '') + `[${type.toUpperCase()}] ` + msg) + '\n');
    }

    info(msg, prefix = '', force = false) { if (this.verbosity >= 1 || force) this.#baseLog('info', msg, prefix); }
    success(msg, prefix = '') { this.#baseLog('success', msg, prefix); }
    warn(msg, prefix = '', force = false) { if (this.verbosity >= 1 || force) this.#baseLog('warn', msg, prefix); }
    error(msg, prefix = '') { this.#baseLog('error', msg, prefix); }

    // Only writes to console and log file in verbose mode or force === true
    log(msg, prefix = '', force = false) { if (this.verbosity >= 2 || force) this.#baseLog('log', msg, prefix); }
    debug(msg, prefix = '', force = false) { if (this.verbosity >= 2 || force) this.#baseLog('debug', msg, prefix); }

    print(...msg) {
        const message = msg.join(' ');
        console.log(message);
        this.logStream?.write(stripAnsi(message));
    }

    dump(msg) {
        this.logStream?.write(stripAnsi(msg));
    }

    close() {
        return new Promise((resolve, reject) => {
            if (!this.logStream) resolve();
            this.logStream.on('finish', resolve);
            this.logStream.on('error', reject);
            this.logStream.end();
        });
    }

    startSpinner(msg, prefix = '') {
        if (this.verbosity < 1 || DISABLE_SPINNER) return;
        this.spinner = ora({
            prefixText: this.#getFullPrefix(prefix),
            text: msg
        }).start();
    }
    updateSpinnerMsg(msg) { if (this.verbosity >= 1 && this.spinner) this.spinner.text = msg; }
    succeedSpinner(msg) { if (this.verbosity >= 1) this.spinner?.succeed(msg); }
    failSpinner(msg) { if (this.verbosity >= 1) this.spinner?.fail(msg); }
    resetSpinner() { if (this.verbosity >= 1) this.spinner = null; }

    async withSpinner(asyncFn, loadingMsg, successMsg, prefix, ...args) {
        if (this.verbosity < 1 || DISABLE_SPINNER) {
            try {
                return await asyncFn(...args);
            }
            catch (err) {
                throw (err);
            }
        }

        this.spinner = ora({
            prefixText: this.#getFullPrefix(prefix),
            text: loadingMsg
        });
        this.spinner.start();
        let res;
        try {
            res = await asyncFn(...args);
        }
        catch (err) {
            this.spinner?.clear();  // allows the outer try-catch block to handle error and log it out, avoiding duplicate error messages
            throw (err);
        }
        this.spinner?.succeed(successMsg);
        return res;
    }

    table(data, rowSpanField = 'url', colsToSkip = []) {
        if (!Array.isArray(data) || data.length < 1) return;
        const tableData = structuredClone(data);
        const headers = Object.keys(tableData[0]).filter(key => key !== rowSpanField && !colsToSkip.includes(key));
        const t = new Table({
            head: headers,
            style: { head: ['cyan'] }
        });
        for (const row of tableData) {
            const tableRow = [];
            let rowSpanFieldVal = '';
            if (rowSpanField in row) {
                const rowKey = Object.keys(row)[0];
                tableRow.push({ content: row[rowKey], rowSpan: 2 });
                rowSpanFieldVal = row[rowSpanField];
                delete row[rowSpanField];
                delete row[rowKey];
            }
            tableRow.push(
                ...Object.entries(row)
                    .filter(([key]) => !colsToSkip.includes(key))
                    .map(([_, val]) => {
                        if (Array.isArray(val))
                            return val
                                .map((item, idx) => `${idx + 1}: ${item ?? '-'}`).join('\n');
                        else if (val === '')
                            return '-';
                        else if (typeof val === 'string')
                            return val;
                        return JSON.stringify(val);
                    })
            );
            t.push(tableRow);
            if (rowSpanFieldVal !== '') t.push([{ content: rowSpanFieldVal, colSpan: headers.length - 1 }]);
        }
        this.print(t.toString(), '\n');
    }
}

export const logger = new Logger();

export const LOG_STAGES = {
    setup: 'setup',
    import: 'import',
    tf: 'terraform',
    info: 'info',
    request: 'request'
};
