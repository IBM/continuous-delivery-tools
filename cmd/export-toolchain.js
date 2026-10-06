/**
 * Licensed Materials - Property of IBM
 * (c) Copyright IBM Corporation 2025, 2026. All Rights Reserved.
 *
 * Note to U.S. Government Users Restricted Rights:
 * Use, duplication or disclosure restricted by GSA ADP Schedule
 * Contract with IBM Corp.
 */

import { exit } from 'node:process';

import { resolve } from 'node:path';

import fs from 'node:fs';

import { Command } from 'commander';

import { parseEnvVar } from './utils/utils.js';
import { logger, LOG_STAGES } from './utils/logger.js';
import { initProviderFile, setupTerraformFiles, runTerraformInit, runTerraformImport, setTerraformEnv } from './utils/terraform.js';
import { getBearerToken, getToolchain } from './utils/requests.js';
import { validatePrereqsVersions, validateToolchainId, validateTools } from './utils/validate.js';
import { importTerraform } from './utils/import-terraform.js';

import { EXPORT_TOOLCHAIN_DESC, SOURCE_REGIONS } from '../config.js';

import packageJson from '../package.json' with { type: 'json' };

const TIME_SUFFIX = new Date().getTime();
const LOGS_DIR = '.logs';
const TEMP_DIR = '.migration-temp-' + TIME_SUFFIX;
const LOG_DUMP = process.env['LOG_DUMP'] === 'false' ? false : true;
const DEBUG_MODE = process.env['DEBUG_MODE'] === 'true';

const command = new Command('export-toolchain')
	.summary('Exports a toolchain, including tool integrations and Tekton pipelines, into Terraform (.tf) files.')
	.description(EXPORT_TOOLCHAIN_DESC)
	.optionsGroup('Basic options:')
	.requiredOption('-c, --toolchain-crn <crn>', 'The CRN of the source toolchain to copy')
	.option('-a, --apikey <api_key>', 'API key used to authenticate. API key used to authenticate. Must have IAM permission to read the toolchain')
	.helpOption('-h, --help', 'Display help for command')
	.optionsGroup('Advanced options:')
	.option('-d, --terraform-dir <path>', '(Optional) The target local directory to store the generated Terraform (.tf) files')
	.option('-f, --force', '(Optional) Force the copy toolchain command to run without user confirmation')
	.option('-C, --compact', '(Optional) Generate all resources in a single resources.tf file')
	.option('-v, --verbose', '(Optional) Increase log output')
	.option('-q, --quiet', '(Optional) Suppress non-essential output, only errors and critical warnings are displayed')
	.showHelpAfterError()
	.hook('preAction', cmd => cmd.showHelpAfterError(false))
	.action(main);

async function main(options) {
	const sourceToolchainCrn = options.toolchainCrn;
	const skipUserConfirmation = options.force || false;
	const isCompact = options.compact || false;
	const verbosity = options.quiet ? 0 : options.verbose ? 2 : 1;

	logger.setVerbosity(verbosity);
	if (LOG_DUMP) logger.createLogStream(`${LOGS_DIR}/export-toolchain-${TIME_SUFFIX}.log`);

	// redact apikey option in logs
	const printOptions = { ...options };
	printOptions.apikey ? printOptions.apikey = '<API KEY>' : delete printOptions.apikey;
	logger.dump(`Options: ${JSON.stringify(printOptions)}\n`);

	let bearer;
	let sourceToolchainId;
	let sourceRegion;
	let sourceToolchainData;
	let outputDir;
	let apiKey = options.apikey;
	let moreTfResources = {};

	// Validate arguments and check prerequisites
	try {
		validatePrereqsVersions();
		logger.info(`\x1b[32m✔\x1b[0m cd-tools Version:  ${packageJson.version}`, LOG_STAGES.setup);

		if (!apiKey) apiKey = parseEnvVar('IBMCLOUD_API_KEY');
		bearer = await getBearerToken(apiKey);

		[sourceToolchainId, sourceRegion] = parseToolchainCrn(sourceToolchainCrn);

		sourceToolchainData = await logger.withSpinner(getToolchain,
			'Validating toolchain...',
			'Toolchain validated',
			LOG_STAGES.setup,
			bearer,
			sourceToolchainId,
			sourceRegion
		);

		if (sourceToolchainCrn != sourceToolchainData['crn']) {
			logger.error('Provided toolchain CRN is invalid', LOG_STAGES.setup);
			exit(1);
		}

		// check output dir option, or default to the toolchain name
		if (options.terraformDir) {
			outputDir = resolve(options.terraformDir);
		} else {
			// replace unsafe dir name chars with hyphens
			const defaultDirName = sourceToolchainData['name']
				.replace(/[^a-zA-Z0-9._-]/g, '-');
			outputDir = resolve(defaultDirName);
		}

		// check for existing .tf files in output directory
		if (fs.existsSync(outputDir)) {
			let files = fs.readdirSync(outputDir, { recursive: true });
			files = files.filter((f) => f.endsWith('.tf'));
			if (files.length > 0) throw Error(`Output directory already has ${files.length} '.tf' files, please specify a different output directory`);
		}

		const allTools = await logger.withSpinner(validateTools,
			'Validating Toolchain Tool(s)...',
			'Toolchain tool(s) validated',
			LOG_STAGES.setup,
			bearer,
			sourceToolchainId,
			sourceRegion,
			skipUserConfirmation
		);

		// collect instances of legacy GHE tool integrations
		moreTfResources['github_integrated'] = [];
		allTools.forEach((t) => {
			if (t.tool_type_id === 'github_integrated') {
				moreTfResources['github_integrated'].push(t);
			}
		});

		if (moreTfResources['github_integrated'].length > 0) {
			logger.warn(`Warning! The following legacy GHE integration(s) will automatically be converted to equivalent GitHub integrations in the exported Terraform files.`, LOG_STAGES.setup, true);
		}

		logger.info('Arguments and required packages verified, proceeding with exporting toolchain...', LOG_STAGES.setup);

		// Set up temp folder
		if (!fs.existsSync(TEMP_DIR)) {
			fs.mkdirSync(TEMP_DIR);
		}
	}
	catch (err) {
		if (err.message && err.stack) {
			const errMsg = verbosity > 1 ? err.stack : err.message;
			logger.error(errMsg, LOG_STAGES.setup);
		}
		await handleCleanup();
		exit(1);
	}

	// Import toolchain into Terraform state
	let nonSecretRefs;
	let importBlocks;

	try {
		const importTerraformWrapper = async () => {
			setTimeout(() => {
				logger.updateSpinnerMsg('Still importing toolchain...');
			}, 5000);

			await initProviderFile(sourceRegion, TEMP_DIR);
			await runTerraformInit(TEMP_DIR, verbosity);

			[, nonSecretRefs, , importBlocks] = await importTerraform(bearer, apiKey, sourceRegion, sourceToolchainId, sourceToolchainData['name'], TEMP_DIR, isCompact, verbosity);
		};

		await logger.withSpinner(
			importTerraformWrapper,
			'Importing toolchain...',
			'Toolchain successfully imported',
			LOG_STAGES.import
		);

		if (nonSecretRefs.length > 0) {
			logger.warn(`Warning! The following generated terraform resource contains hashed secret(s) that cannot be re-applied without providing the secret values:`, LOG_STAGES.setup, true);
			logger.table(nonSecretRefs);
		}

	} catch (err) {
		if (err.message && err.stack) {
			const errMsg = verbosity > 1 ? err.stack : err.message;
			logger.error(errMsg, LOG_STAGES.import);
		}
		await handleCleanup();
		exit(1);
	}

	// Write Terraform files to output directory
	try {
		if (!fs.existsSync(outputDir)) {
			logger.info(`Creating output directory "${outputDir}"...`, LOG_STAGES.import);
			fs.mkdirSync(outputDir);
		} else {
			logger.info(`Output directory "${outputDir}" already exists`, LOG_STAGES.import);
		}

		await setupTerraformFiles({
			auth: {
				token: bearer
			},
			source: {
				srcRegion: sourceRegion,
				srcToolchainId: sourceToolchainId
			},
			target: {
				targetRegion: sourceRegion,
				targetRgId: sourceToolchainData['resource_group_id'],
				targetToolchainName: sourceToolchainData['name'],
				targetTag: null
			},
			options: {
				disableTriggers: false,
				includeS2S: false,
				isCompact: isCompact,
				skipUserConfirmation: skipUserConfirmation,
				preserveDescription: true
			},
			paths: {
				tempDir: TEMP_DIR,
				outputDir: outputDir
			},
			additional: {
				gritMapping: {},
				moreTfResources: moreTfResources,
				timeSuffix: TIME_SUFFIX
			}
		});

		setTerraformEnv(apiKey, verbosity);

		await logger.withSpinner(runTerraformInit,
			'Running terraform init...',
			'Terraform successfully initialized',
			LOG_STAGES.tf,
			outputDir,
			verbosity
		);

		await logger.withSpinner(runTerraformImport,
			'Importing resources into Terraform state...',
			'Resources successfully imported into Terraform state',
			LOG_STAGES.tf,
			importBlocks,
			outputDir,
			verbosity
		);

		logger.info(`Toolchain "${sourceToolchainData['name']}" successfully exported.`, LOG_STAGES.info, true);
		logger.info(`Output directory: ${outputDir}`, LOG_STAGES.info, true);
		logger.info(`Use terraform plan / apply in ${outputDir} to manage changes.`, LOG_STAGES.info, true);
	} catch (err) {
		if (err.message && err.stack) {
			const errMsg = verbosity > 1 ? err.stack : err.message;
			logger.error(errMsg, LOG_STAGES.import);
		}
		await handleCleanup();
		exit(1);
	}

	await handleCleanup();
	exit(0);
}

async function handleCleanup() {
	if (!DEBUG_MODE) {
		if (fs.existsSync(TEMP_DIR)) fs.rmSync(TEMP_DIR, { recursive: true });
	}
	await logger.close();
}

// parses crn arg into toolchain ID and region
function parseToolchainCrn(crn) {
	const pattern = /^crn:.*:.*:.*:toolchain:.*:.*:.*::$/;
	if (typeof crn === 'string' && pattern.test(crn)) {
		const crnParts = crn.toLowerCase().split(':');
		if (crnParts.length === 10 && SOURCE_REGIONS.includes(crnParts[5])) {
			try {
				validateToolchainId(crnParts[7]);
			} catch {
				throw Error('Provided toolchain CRN is invalid');
			}
			return [crnParts[7], crnParts[5]];
		}
	}
	throw Error('Provided toolchain CRN is invalid');
}

export default command;
