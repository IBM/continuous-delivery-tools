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
  IBMCLOUD_API_KEY                       API Key used to perform the copy. Must have IAM permission to read and create toolchains and S2S authorizations in source and target region / resource group`

const MIGRATION_DOC_URL = 'https://github.com/IBM/continuous-delivery-tools'; // TODO: replace with docs link

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

const TERRAFORMER_REQUIRED_VERSION = '0.8.30';

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

const UPDATEABLE_SECRET_PROPERTIES_BY_TOOL_TYPE = {
	"artifactory": [
		"token"
	],
	"cloudobjectstorage": [
		"cos_api_key",
		"hmac_access_key_id",
		"hmac_secret_access_key"
	],
	"github_integrated": [
		"api_token"
	],
	"githubconsolidated": [
		"api_token"
	],
	"gitlab": [
		"api_token"
	],
	"hashicorpvault": [
		"token",
		"role_id",
		"secret_id",
		"password"
	],
	"hostedgit": [
		"api_token"
	],
	"jenkins": [
		"api_token"
	],
	"jira": [
		"password",
		"api_token"
	],
	"nexus": [
		"token"
	],
	"pagerduty": [
		"service_key"
	],
	"private_worker": [
		"workerQueueCredentials",
		"worker_queue_credentials"
	],
	"saucelabs": [
		"key",
		"access_key"
	],
	"security_compliance": [
		"scc_api_key"
	],
	"slack": [
		"api_token",
		"webhook"
	],
	"sonarqube": [
		"user_password"
	]
};

const VAULT_REGEX = [
	new RegExp('[\\{]{1}(?<reference>\\b(?<provider>vault)\\b[:]{2}(?<integration>[ a-zA-Z0-9_-]*)[.]{0,1}(?<secret>.*))[\\}]{1}', 'iu'),
	new RegExp('^(?<reference>crn:v1:(?:bluemix|staging):public:(?<type>secrets-manager):(?<region>[a-zA-Z0-9-]*)\\b:a\/(?<account_id>[0-9a-fA-F]*)\\b:(?<instance_id>[0-9a-fA-F]{8}\\b-[0-9a-fA-F]{4}\\b-[0-9a-fA-F]{4}\\b-[0-9a-fA-F]{4}\\b-[0-9a-fA-F]{12})\\b:secret:(?<secret_id>[0-9a-fA-F]{8}\\b-[0-9a-fA-F]{4}\\b-[0-9a-fA-F]{4}\\b-[0-9a-fA-F]{4}\\b-[0-9a-fA-F]{12}))$', 'iu'),
	new RegExp('(?<reference>(?<type>ref:[\\/]{2}secrets-manager)[.]{1}(?<instance_path>.*))', 'iu')
];

export {
	COPY_TOOLCHAIN_DESC,
	UPDATEABLE_SECRET_PROPERTIES_BY_TOOL_TYPE,
	MIGRATION_DOC_URL,
	SOURCE_REGIONS,
	TARGET_REGIONS,
	TERRAFORM_REQUIRED_VERSION,
	TERRAFORMER_REQUIRED_VERSION,
	RESERVED_GRIT_PROJECT_NAMES,
	RESERVED_GRIT_GROUP_NAMES,
	RESERVED_GRIT_SUBGROUP_NAME,
	VAULT_REGEX
};
