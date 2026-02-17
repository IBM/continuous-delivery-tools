/**
 * Licensed Materials - Property of IBM
 * (c) Copyright IBM Corporation 2025. All Rights Reserved.
 *
 * Note to U.S. Government Users Restricted Rights:
 * Use, duplication or disclosure restricted by GSA ADP Schedule
 * Contract with IBM Corp.
 */

import * as readline from 'node:readline/promises';
import { randomInt } from 'node:crypto';

import { logger } from './logger.js';
import { VAULT_REGEX } from '../../config.js';

export function parseEnvVar(name) {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Environment variable '${name}' is required but not set`);
    }
    return value;
};

export async function promptUserYesNo(question) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    const fullPrompt = `${question} [Ctrl-C to abort] (y)es (n)o: `;

    const answer = await rl.question(fullPrompt);

    logger.dump(fullPrompt + '\n' + answer + '\n');
    rl.close();

    const normalized = answer.toLowerCase().trim();
    if (normalized === 'y' || normalized === 'yes') {
        logger.print();
        return true;
    }
    if (normalized === 'n' || normalized === 'no') {
        logger.print();
        return false;
    }
    logger.warn('\nInvalid input. Please enter \'y\' or \'n\'.');
    return await promptUserYesNo(question);
}

export async function promptUserConfirmation(question, expectedAns, exitMsg) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    const fullPrompt = question + `\n\nOnly '${expectedAns}' will be accepted to proceed. (Ctrl-C to abort)\n\nEnter a value: `;
    const answer = await rl.question(fullPrompt);

    logger.dump(fullPrompt + '\n' + answer + '\n');

    if (answer.toLowerCase().trim() !== expectedAns) {
        if (exitMsg) logger.print('\n' + exitMsg);
        rl.close();
        await logger.close();
        process.exit(1);
    }

    rl.close();
    logger.print();
}

export async function promptUserInput(question, initialInput, validationFn) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: question
    });

    let answer;

    rl.on('SIGINT', async () => {
        logger.print('\n' + 'Received SIGINT signal');
        await logger.close();
        process.exit(1);
    });

    rl.prompt(true);
    if (initialInput) rl.write(initialInput);

    for await (const ans of rl) {
        try {
            logger.dump(question + ans + '\n\n');
            await validationFn(ans.trim());
            answer = ans;
            break;
        } catch (e) {
            // loop
            logger.warn(`Validation failed... ${e.message}`, '', true);

            rl.prompt(true);
            if (initialInput) rl.write(initialInput);
        }
    }

    rl.close();
    logger.print();
    return answer.trim();
}

export async function promptUserSelection(question, choices) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    rl.on('SIGINT', async () => {
        logger.print('\n' + 'Received SIGINT signal');
        await logger.close();
        process.exit(1);
    });

    const list = choices
        .map((choice, i) => `[${i + 1}] ${choice}`)
        .join('\n');

    const promptText = `${question}\n\n${list}\n\nEnter the number of your choice (Ctrl-C to abort): `;

    let index;

    while (true) {
        const answer = await rl.question(promptText);
        logger.dump(promptText + '\n' + answer + '\n');

        index = parseInt(answer.trim(), 10) - 1;

        if (!Number.isNaN(index) && index >= 0 && index < choices.length) {
            break;
        }

        logger.warn('\nInvalid choice. Please enter a valid number.\n', '', true);
    }

    rl.close();
    logger.print();
    return index;
}

export function replaceUrlRegion(inputUrl, srcRegion, targetRegion) {
    if (!inputUrl) return '';

    try {
        const url = new URL(inputUrl);

        url.host = url.host.split('.').map(i => i === srcRegion ? targetRegion : i).join('.');
        return url.toString();
    } catch {
        return '';
    }
}

/**
* Decomposes a CRN into its parts from the defined structure:
* crn:v1:{cname}:{ctype}:{service-name}:{location}:a/{IBM-account}:{service-instance}:{resource-type}:{resource}
*
* @param {String} crn - The crn to decompose.
**/
export function decomposeCrn(crn) {
    const crnParts = crn.split(':');

    // Remove the 'a/' segment.
    let accountId = crnParts[6];
    if (accountId) {
        accountId = accountId.split('/')[1];
    }

    return {
        cname: crnParts[2],
        ctype: crnParts[3],
        serviceName: crnParts[4],
        location: crnParts[5],
        accountId: accountId,
        serviceInstance: crnParts[7],
        resourceType: crnParts[8],
        resource: crnParts[9]
    };
};

/**
* Verifies that a value is a secret reference.
*
* @param {String} value - The value to verify.
**/
export function isSecretReference(value) {
    return !!(VAULT_REGEX.find(r => r.test(value)));
};

export function getRandChars(size) {
    const charSet = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let res = '';

    for (let i = 0; i < size; i++) {
        const pos = randomInt(charSet.length);
        res += charSet[pos];
    }
    return res;
};

export function normalizeName(str) {
    const specialChars = `-–—<>()*#{}[]|@_ .%'",&`; // turn these special chars into underscores
    const whitelistRegex = /[^_\-\p{L}0-9]+/ug // this regex matches non-unicode letters, numbers, underscores, and hyphens

    let newStr = str;

    for (const char of specialChars) {
        newStr = newStr.replaceAll(char, '_');
    }

    newStr = newStr.replaceAll(whitelistRegex, '');

    return newStr.toLowerCase();
};