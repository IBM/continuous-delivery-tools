/**
 * Licensed Materials - Property of IBM
 * (c) Copyright IBM Corporation 2025. All Rights Reserved.
 *
 * Note to U.S. Government Users Restricted Rights:
 * Use, duplication or disclosure restricted by GSA ADP Schedule
 * Contract with IBM Corp.
 */

import { exit } from 'node:process';
import { resolve } from 'node:path'
import fs from 'node:fs';

import { Command, Option } from 'commander';

import { parseEnvVar } from './utils/utils.js';
import { logger, LOG_STAGES } from './utils/logger.js';
import { setTerraformerEnv, setTerraformEnv, initProviderFile, runTerraformerImport, setupTerraformFiles, runTerraformInit, getNumResourcesPlanned, runTerraformApply, getNumResourcesCreated, getNewToolchainId } from './utils/terraform.js';
import { getAccountId, getBearerToken, getResourceGroupIdAndName, getToolchain } from './utils/requests.js';
import { validatePrereqsVersions, validateTag, validateToolchainId, validateToolchainName, validateTools, validateOAuth, warnDuplicateName, validateGritUrl } from './utils/validate.js';

import { COPY_TOOLCHAIN_DESC, MIGRATION_DOC_URL, TARGET_REGIONS, SOURCE_REGIONS } from '../config.js';

process.on('exit', (code) => {
	if (code !== 0) logger.print(`Need help? Visit ${MIGRATION_DOC_URL} for more troubleshooting information.`);
});

const LOGS_DIR = '.logs';
const TEMP_DIR = '.migration-temp'
const LOG_DUMP = process.env['LOG_DUMP'] === 'false' ? false : true;	// when true or not specified, logs are also written to a log file in LOGS_DIR
const DEBUG_MODE = process.env['DEBUG_MODE'] === 'true' ? true : false; // when true, temp folder is preserved
const OUTPUT_DIR = 'output-' + new Date().getTime();
const DRY_RUN = false; // when true, terraform apply does not run


const command = new Command('copy-toolchain')
	.summary('Copies a toolchain, including tool integrations and Tekton pipelines, to another region or resource group.')
	.description(COPY_TOOLCHAIN_DESC)
	.optionsGroup('Basic options:')
	.requiredOption('-c, --toolchain-crn <crn>', 'The CRN of the source toolchain to copy')
	.addOption(
		new Option('-r, --region <region>', 'The destination region of the copied toolchain')
			.choices(TARGET_REGIONS)
			.makeOptionMandatory()
	)
	.option('-a --apikey <api key>', 'API Key used to perform the copy. Must have IAM permission to read and create toolchains and S2S authorizations in source and target region / resource group')
	.option('-n, --name <name>', '(Optional) The name of the copied toolchain (default: same name as original)')
	.option('-g, --resource-group <resource group>', '(Optional) The name or ID of destination resource group of the copied toolchain (default: same resource group as original)')
	.option('-t, --tag <tag>', '(Optional) The tag to add to the copied toolchain')
	.helpOption('-h, --help', 'Display help for command')
	.optionsGroup('Advanced options:')
	.option('-d, --terraform-dir <directory path>', '(Optional) The target local directory to store the generated Terraform (.tf) files')
	.option('-D, --dry-run', '(Optional) Skip running terraform apply')
	.option('-f, --force', '(Optional) Force the copy toolchain command to run without user confirmation')
	.option('-S, --skip-s2s', '(Optional) Skip importing toolchain-generated S2S authorizations')
	.option('-T, --skip-disable-triggers', '(Optional) Skip disabling triggers')
	.option('-C, --compact', '(Optional) Generate all resources in resources.tf')
	.option('-v --verbose', '(Optional) Increase log output')
	.option('-s --silent', '(Optional) Suppress non-essential output, only errors and critical warnings are displayed')
	.option('-G --grit-mapping-file <path>', '(Optional) JSON file mapping GRIT project urls to project urls in the target region')
	.showHelpAfterError()
	.hook('preAction', cmd => cmd.showHelpAfterError(false)) // only show help during validation
	.action(main);

async function main(options) {
	const sourceToolchainCrn = options.toolchainCrn;
	const targetRegion = options.region;
	const targetRg = options.resourceGroup;
	const outputDir = resolve(options.terraformDir || OUTPUT_DIR);
	const dryRun = options.dryRun || DRY_RUN;
	const skipUserConfirmation = options.force || false;
	const includeS2S = !options.skipS2s;
	const disableTriggers = !options.skipDisableTriggers;
	const isCompact = options.compact || false;
	const verbosity = options.silent ? 0 : options.verbose ? 2 : 1;

	logger.setVerbosity(verbosity);
	if (LOG_DUMP) logger.createLogStream(`${LOGS_DIR}/copy-toolchain-${new Date().getTime()}.log`);
	logger.dump(`Options: ${JSON.stringify(options)}\n`);

	let bearer;
	let sourceToolchainId;
	let sourceRegion;
	let sourceToolchainData;
	let targetToolchainName = options.name;
	let targetTag = options.tag;
	let targetRgId;
	let targetRgName;
	let apiKey = options.apikey;
	let moreTfResources = {};
	let gritMapping = {};

	// Validate arguments are valid and check if Terraformer and Terraform are installed appropriately
	try {
		validatePrereqsVersions();

		if (!apiKey) apiKey = parseEnvVar('IBMCLOUD_API_KEY');
		bearer = await getBearerToken(apiKey);
		const accountId = await getAccountId(bearer, apiKey);

		if (options.gritMappingFile) {
			gritMapping = JSON.parse(fs.readFileSync(resolve(options.gritMappingFile)));
			const gritPromises = [];
			let errorCount = 0;

			// check validity of mapped values
			Object.entries(gritMapping)
				.forEach(([k, v]) => {
					gritPromises.push(validateGritUrl(bearer, targetRegion, v, true).catch((e) => {
						if (errorCount < 5) {
							logger.error(`Value of key '${k}' from GRIT mapping file is invalid`, LOG_STAGES.setup);
							logger.error(e, LOG_STAGES.setup);
						} else if (errorCount === 5) {
							logger.error(`( ...additional GRIT mapping file error messages truncated )`, LOG_STAGES.setup);
						}
						errorCount += 1;
					}));
				});
			await Promise.all(gritPromises);
			if (errorCount > 0) throw Error(`One or more invalid entries in GRIT mapping file, error count: ${errorCount}`);
		}

		[sourceToolchainId, sourceRegion] = parseToolchainCrn(sourceToolchainCrn);

		if (targetToolchainName) validateToolchainName(targetToolchainName);
		if (targetTag) validateTag(targetTag);

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

		({ id: targetRgId, name: targetRgName } = await getResourceGroupIdAndName(bearer, accountId, targetRg || sourceToolchainData['resource_group_id']));

		// reuse name if not provided
		if (!targetToolchainName) targetToolchainName = sourceToolchainData['name'];
		[targetToolchainName, targetTag] = await warnDuplicateName(bearer, accountId, targetToolchainName, sourceRegion, targetRegion, targetRgId, targetRgName, targetTag, skipUserConfirmation);

		const allTools = await logger.withSpinner(validateTools,
			'Validating Toolchain Tool(s)...',
			'Toolchain tool(s) validated',
			LOG_STAGES.setup,
			bearer,
			sourceToolchainId,
			sourceRegion,
			skipUserConfirmation
		);

		// validate git tools OAuth
		await logger.withSpinner(validateOAuth,
			'Validating Git OAuth in target region...',
			'OAuth validated',
			LOG_STAGES.setup,
			bearer,
			allTools,
			targetRegion,
			skipUserConfirmation
		)

		// collect instances of legacy GHE tool integrations
		const collectGHE = () => {
			moreTfResources['github_integrated'] = [];
			allTools.forEach((t) => {
				if (t.tool_type_id === 'github_integrated') {
					moreTfResources['github_integrated'].push(t);
				}
			});
		};

		collectGHE();

		logger.info('Arguments and required packages verified, proceeding with copying toolchain...', LOG_STAGES.setup);

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

	try {
		const runTerraformer = async () => {
			setTimeout(() => {
				logger.updateSpinnerMsg('Still importing toolchain...');
			}, 5000);

			setTerraformerEnv(apiKey, sourceToolchainId, includeS2S);

			await initProviderFile(sourceRegion, TEMP_DIR);
			await runTerraformInit(TEMP_DIR, verbosity);

			await runTerraformerImport(sourceRegion, TEMP_DIR, isCompact, verbosity);
		};
		await logger.withSpinner(
			runTerraformer,
			'Importing toolchain...',
			'Toolchain successfully imported using Terraformer',
			LOG_STAGES.terraformer
		);
	} catch (err) {
		if (err.message && err.stack) {
			const errMsg = verbosity > 1 ? err.stack : err.message;
			logger.error(errMsg, LOG_STAGES.terraformer);
		}
		await handleCleanup();
		exit(1);
	}

	// Prepare for Terraform
	try {
		if (!fs.existsSync(outputDir)) {
			logger.info(`Creating output directory "${outputDir}"...`, LOG_STAGES.terraformer);
			fs.mkdirSync(outputDir);
		} else {
			logger.info(`Output directory "${outputDir}" already exists`, LOG_STAGES.terraformer);
		}

		await setupTerraformFiles({
			token: bearer,
			srcRegion: sourceRegion,
			targetRegion: targetRegion,
			targetTag: targetTag,
			targetToolchainName: targetToolchainName,
			targetRgId: targetRgId,
			disableTriggers: disableTriggers,
			isCompact: isCompact,
			outputDir: outputDir,
			tempDir: TEMP_DIR,
			moreTfResources: moreTfResources,
			gritMapping: gritMapping,
			skipUserConfirmation: skipUserConfirmation
		});
	} catch (err) {
		if (err.message && err.stack) {
			const errMsg = verbosity > 1 ? err.stack : err.message;
			logger.error(errMsg, LOG_STAGES.terraformer);
		}
		await handleCleanup();
		exit(1);
	}

	// Run Terraform
	try {
		if (!dryRun) {
			setTerraformEnv(verbosity);

			await logger.withSpinner(runTerraformInit,
				'Running terraform init...',
				'Terraform successfully initialized',
				LOG_STAGES.tf,
				outputDir,
				verbosity
			);

			logger.info(`DRY_RUN: ${dryRun}, running terraform apply...`, LOG_STAGES.tf);

			// get total planned resources before applying
			const numResourcesPlanned = await getNumResourcesPlanned(outputDir);

			let applyErrors = false;

			await runTerraformApply(skipUserConfirmation, outputDir, verbosity).catch((err) => {
				logger.error(err, LOG_STAGES.tf);
				applyErrors = true;
			});

			const newTcId = await getNewToolchainId(outputDir);
			const numResourcesCreated = await getNumResourcesCreated(outputDir);

			logger.print('\n');
			logger.info(`Toolchain "${sourceToolchainData['name']}" from ${sourceRegion} was cloned to "${targetToolchainName ?? sourceToolchainData['name']}" in ${targetRegion} ${applyErrors ? 'with some errors' : 'successfully'}, with ${numResourcesCreated} / ${numResourcesPlanned} resources created!`, LOG_STAGES.info);
			if (newTcId) logger.info(`See cloned toolchain: https://cloud.ibm.com/devops/toolchains/${newTcId}?env_id=ibm:yp:${targetRegion}`, LOG_STAGES.info, true);
		} else {
			logger.info(`DRY_RUN: ${dryRun}, skipping terraform apply...`, LOG_STAGES.tf);
		}
	} catch (err) {
		if (err.message && err.stack) {
			const errMsg = verbosity > 1 ? err.stack : err.message;
			logger.error(errMsg, LOG_STAGES.tf);
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
	// doesn't strictly check crn format
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
