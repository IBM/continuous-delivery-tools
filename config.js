/**
 * Licensed Materials - Property of IBM
 * (c) Copyright IBM Corporation 2025. All Rights Reserved.
 *
 * Note to U.S. Government Users Restricted Rights:
 * Use, duplication or disclosure restricted by GSA ADP Schedule
 * Contract with IBM Corp.
 */

const COPY_TOOLCHAIN_DESC = `Copies a toolchain, including tool integrations and Tekton pipelines, to another region or resource group.

Examples:
  export IBMCLOUD_API_KEY='...'
  npx @ibm-cloud/cd-migration-tools copy-toolchain -c \${TOOLCHAIN_CRN} -r us-south
      Copy a toolchain to the Dallas region with the same name, in the same resource group.
  npx @ibm-cloud/cd-migration-tools copy-toolchain -c \${TOOLCHAIN_CRN} -r eu-de -n new-toolchain-name -g new-resource-group --apikey \${APIKEY}
      Copy a toolchain to the Frankfurt region with the specified name and target resource group, using the given API key

Environment Variables:
  IBMCLOUD_API_KEY                       API key used to authenticate. Must have IAM permission to read and create toolchains and service-to-service authorizations in source and target region / resource group`

const DOCS_URL = 'https://github.com/IBM/continuous-delivery-tools';

const SOURCE_REGIONS = [
	'au-syd',
	'br-sao',
	'ca-mon',
	'ca-tor',
	'eu-de',
	'eu-es',
	'eu-gb',
	'jp-osa',
	'jp-tok',
	'us-east',
	'us-south'
];

const TARGET_REGIONS = [
	'au-syd',
	'br-sao',
	'ca-mon',
	'ca-tor',
	'eu-de',
	'eu-es',
	'eu-gb',
	'jp-osa',
	'jp-tok',
	'us-east',
	'us-south'
];

const TERRAFORM_REQUIRED_VERSION = '1.13.3';

// see https://docs.gitlab.com/user/reserved_names/
const RESERVED_GRIT_PROJECT_NAMES = [
	'\\-',
	'badges',
	'blame',
	'blob',
	'builds',
	'commits',
	'create',
	'create_dir',
	'edit',
	'environments/folders',
	'files',
	'find_file',
	'gitlab-lfs/objects',
	'info/lfs/objects',
	'new',
	'preview',
	'raw',
	'refs',
	'tree',
	'update',
	'wikis'
];

const RESERVED_GRIT_GROUP_NAMES = [
	'\\-',
	'.well-known',
	'404.html',
	'422.html',
	'500.html',
	'502.html',
	'503.html',
	'admin',
	'api',
	'apple-touch-icon.png',
	'assets',
	'dashboard',
	'deploy.html',
	'explore',
	'favicon.ico',
	'favicon.png',
	'files',
	'groups',
	'health_check',
	'help',
	'import',
	'jwt',
	'login',
	'oauth',
	'profile',
	'projects',
	'public',
	'robots.txt',
	's',
	'search',
	'sitemap',
	'sitemap.xml',
	'sitemap.xml.gz',
	'slash-command-logo.png',
	'snippets',
	'unsubscribes',
	'uploads',
	'users',
	'v2'
];

const RESERVED_GRIT_SUBGROUP_NAME = '\\-';

/* 
Format:
	Maps tool_type_id to a list of the following ...
	{ 
		key: str, // tool parameter key
		tfKey?: str, // terraform-equivalent key
		prereq?: { key: string, values: [string] }, // proceed only if tool parameter 'prereq.key' is one of 'values'
		required?: bool // is this key required for terraform?
	}
	... which represents a secret/sensitive value
*/
const SECRET_KEYS_MAP = {
	'artifactory': [
		{ key: 'token', tfKey: 'token' }
	],
	'cloudobjectstorage': [
		{ key: 'cos_api_key', tfKey: 'cos_api_key', prereq: { key: 'auth_type', values: ['apikey'] } },
		{ key: 'hmac_access_key_id', tfKey: 'hmac_access_key_id', prereq: { key: 'auth_type', values: ['hmac'] } },
		{ key: 'hmac_secret_access_key', tfKey: 'hmac_secret_access_key', prereq: { key: 'auth_type', values: ['hmac'] } },
	],
	'github_integrated': [
		{ key: 'api_token' } // no terraform equivalent
	],
	'githubconsolidated': [
		{ key: 'api_token', tfKey: 'api_token', prereq: { key: 'auth_type', values: ['pat'] } },
	],
	'gitlab': [
		{ key: 'api_token', tfKey: 'api_token', prereq: { key: 'auth_type', values: ['pat'] } },
	],
	'hashicorpvault': [
		{ key: 'token', tfKey: 'token', prereq: { key: 'authentication_method', values: ['github', 'token'] } },
		{ key: 'role_id', tfKey: 'role_id', prereq: { key: 'authentication_method', values: ['approle'] } },
		{ key: 'secret_id', tfKey: 'secret_id', prereq: { key: 'authentication_method', values: ['approle'] } },
		{ key: 'password', tfKey: 'password', prereq: { key: 'authentication_method', values: ['userpass'] } },
	],
	'hostedgit': [
		{ key: 'api_token', tfKey: 'api_token', prereq: { key: 'auth_type', values: ['pat'] } },
	],
	'jenkins': [
		{ key: 'api_token', tfKey: 'api_token' },
	],
	'jira': [
		{ key: 'password', tfKey: 'api_token' },
	],
	'nexus': [
		{ key: 'token', tfKey: 'token' },
	],
	'pagerduty': [
		{ key: 'api_key', tfKey: 'api_key', prereq: { key: 'key_type', values: ['api'] } },
		{ key: 'service_key', tfKey: 'service_key', prereq: { key: 'key_type', values: ['service'] } },
	],
	'private_worker': [
		{ key: 'workerQueueCredentials', tfKey: 'worker_queue_credentials', required: true },
	],
	'saucelabs': [
		{ key: 'key', tfKey: 'access_key', required: true },
	],
	'security_compliance': [
		{ key: 'scc_api_key', tfKey: 'scc_api_key', prereq: { key: 'use_profile_attachment', values: ['enabled'] } },
	],
	'slack': [
		{ key: 'api_token', tfKey: 'webhook', required: true },
	],
	'sonarqube': [
		{ key: 'user_password', tfKey: 'user_password' },
	]
};

// maps tool parameter tool_type_id to terraform resource type
const SUPPORTED_TOOLS_MAP = {
	'appconfig': 'ibm_cd_toolchain_tool_appconfig',
	'artifactory': 'ibm_cd_toolchain_tool_artifactory',
	'bitbucketgit': 'ibm_cd_toolchain_tool_bitbucketgit',
	'private_worker': 'ibm_cd_toolchain_tool_privateworker',
	'draservicebroker': 'ibm_cd_toolchain_tool_devopsinsights',
	'eventnotifications': 'ibm_cd_toolchain_tool_eventnotifications',
	'hostedgit': 'ibm_cd_toolchain_tool_hostedgit',
	'githubconsolidated': 'ibm_cd_toolchain_tool_githubconsolidated',
	'cloudobjectstorage': 'ibm_cd_toolchain_tool_cos',
	'gitlab': 'ibm_cd_toolchain_tool_gitlab',
	'hashicorpvault': 'ibm_cd_toolchain_tool_hashicorpvault',
	'jenkins': 'ibm_cd_toolchain_tool_jenkins',
	'jira': 'ibm_cd_toolchain_tool_jira',
	'keyprotect': 'ibm_cd_toolchain_tool_keyprotect',
	'nexus': 'ibm_cd_toolchain_tool_nexus',
	'customtool': 'ibm_cd_toolchain_tool_custom',
	'pagerduty': 'ibm_cd_toolchain_tool_pagerduty',
	'saucelabs': 'ibm_cd_toolchain_tool_saucelabs',
	'secretsmanager': 'ibm_cd_toolchain_tool_secretsmanager',
	'security_compliance': 'ibm_cd_toolchain_tool_securitycompliance',
	'slack': 'ibm_cd_toolchain_tool_slack',
	'sonarqube': 'ibm_cd_toolchain_tool_sonarqube',
	'pipeline': 'ibm_cd_toolchain_tool_pipeline'
};

const VAULT_REGEX = [
	new RegExp('[\\{]{1}(?<reference>\\b(?<provider>vault)\\b[:]{2}(?<integration>[ a-zA-Z0-9_-]*)[.]{0,1}(?<secret>.*))[\\}]{1}', 'iu'),
	new RegExp('^(?<reference>crn:v1:(?:bluemix|staging):public:(?<type>secrets-manager):(?<region>[a-zA-Z0-9-]*)\\b:a\/(?<account_id>[0-9a-fA-F]*)\\b:(?<instance_id>[0-9a-fA-F]{8}\\b-[0-9a-fA-F]{4}\\b-[0-9a-fA-F]{4}\\b-[0-9a-fA-F]{4}\\b-[0-9a-fA-F]{12})\\b:secret:(?<secret_id>[0-9a-fA-F]{8}\\b-[0-9a-fA-F]{4}\\b-[0-9a-fA-F]{4}\\b-[0-9a-fA-F]{4}\\b-[0-9a-fA-F]{12}))$', 'iu'),
	new RegExp('(?<reference>(?<type>ref:[\\/]{2}secrets-manager)[.]{1}(?<instance_path>.*))', 'iu')
];

export {
	COPY_TOOLCHAIN_DESC,
	DOCS_URL,
	SOURCE_REGIONS,
	TARGET_REGIONS,
	TERRAFORM_REQUIRED_VERSION,
	RESERVED_GRIT_PROJECT_NAMES,
	RESERVED_GRIT_GROUP_NAMES,
	RESERVED_GRIT_SUBGROUP_NAME,
	SECRET_KEYS_MAP,
	SUPPORTED_TOOLS_MAP,
	VAULT_REGEX
};
