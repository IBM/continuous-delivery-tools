# Continuous Delivery tools

Provides tools to work with IBM Cloud [Continuous Delivery](https://cloud.ibm.com/docs/ContinuousDelivery?topic=ContinuousDelivery-getting-started) resources, including [Toolchains](https://cloud.ibm.com/docs/ContinuousDelivery?topic=ContinuousDelivery-toolchains-using), [Delivery Pipelines](https://cloud.ibm.com/docs/ContinuousDelivery?topic=ContinuousDelivery-tekton-pipelines), and [Git Repos and Issue Tracking](https://cloud.ibm.com/docs/ContinuousDelivery?topic=ContinuousDelivery-git_working) projects.

#### Supported resources
| Resource | Supported  |
| :- | :- |
| [Toolchains](https://cloud.ibm.com/docs/ContinuousDelivery?topic=ContinuousDelivery-toolchains-using) | Yes <sup>[1](#limitations-1)</sup> |
| [Git Repos and Issue Tracking](https://cloud.ibm.com/docs/ContinuousDelivery?topic=ContinuousDelivery-git_working) | Yes <sup>[2](#limitations)</sup> |
| [Delivery Pipelines (Tekton)](https://cloud.ibm.com/docs/ContinuousDelivery?topic=ContinuousDelivery-tekton-pipelines) | Yes <sup>[3](#limitations-1)</sup> |
| [Delivery Pipelines (Classic)](https://cloud.ibm.com/docs/ContinuousDelivery?topic=ContinuousDelivery-deliverypipeline_about) | No |
| [DevOps Insights](https://cloud.ibm.com/docs/ContinuousDelivery?topic=ContinuousDelivery-di_working) | No |
| [Other Tool Integrations](https://cloud.ibm.com/docs/ContinuousDelivery?topic=ContinuousDelivery-integrations) | Yes |

## Prerequisites
- Node.js v20 (or later)
- Terraform v1.13.3 (or later)

## Install
### Install Node.js, Terraform

#### MacOS
```sh
brew install node
brew tap hashicorp/tap
brew install hashicorp/tap/terraform
```

#### Other platfoms
- Node.js [install instructions](https://nodejs.org/en/download)
- Terraform [install instructions](https://developer.hashicorp.com/terraform/install)

## Usage

The tools are provided as an [npx](https://docs.npmjs.com/cli/commands/npx) command. [npx](https://docs.npmjs.com/cli/commands/npx) (Node Package Execute) is a utility provided with [Node.js](https://nodejs.org/) which automatically downloads a module and its dependencies, and runs it. To see the available commands, run `npx @ibm-cloud/cd-tools` on your command line.

```shell-session
$ npx @ibm-cloud/cd-tools
Usage: @ibm-cloud/cd-tools [options] [command]

Tools for migrating Toolchains, Delivery Pipelines, and Git Repos and Issue Tracking projects.

Options:
  -V, --version                 output the version number
  -h, --help                    display help for command

Commands:
  copy-project-group [options]  Bulk migrate GitLab group projects
  copy-toolchain [options]      Copies a toolchain, including tool integrations and Tekton pipelines, to another region or resource group
  export-secrets [options]      Checks if you have any stored secrets in your toolchain or pipelines, and exports them to Secrets Manager
  help [command]                display help for command
```

## copy-project-group

### Overview
The `copy-project-group` command copies a [group](https://docs.gitlab.com/user/group/) of projects in IBM Cloud Continuous Delivery's [Git Repos and Issue Tracking](https://cloud.ibm.com/docs/ContinuousDelivery?topic=ContinuousDelivery-git_working) from one region to another. This includes the project group, projects, Git repositories, issues, merge requests, wiki, and most other resources. See the [full list](https://docs.gitlab.com/user/group/import/migrated_items/) of items included in the copy. In addition to copying the project group, the command will also ensure that project members exist in the destination region and are added to the newly copied project group, preserving existing permissions.

### Limitations
1. Personal projects are not supported. If you created a project under a [personal namespace](https://docs.gitlab.com/user/namespace/), you can either [move your personal project to a group](https://docs.gitlab.com/tutorials/move_personal_project_to_group/), or [convert your personal namespace into a group](https://docs.gitlab.com/tutorials/convert_personal_namespace_to_group/). It is recommended that you store projects in groups, as they allow multiple administrators and allow better continuity of a project over time.
2. This command requests a GitLab direct transfer and is subject to the [limitations of using direct transfer](https://docs.gitlab.com/user/group/import/#known-issues).
3. Copying large projects, or projects with large files or many resources, can take time.
4. As each region of Git Repos and Issue Tracking is independent, your projects' users may not yet exist in the destination region. The `copy-project-group` will ensure that the users exist in the new region, however there may be user name conflicts with other users in the destination region. In the event of a user name conflict, the user name in the destination region may be changed slightly by adding a suffix.

### Prerequisites
- Personal Access Tokens (PAT) for the source and destination regions are required
- Both PATs must have the `api` scope.

### Recommendations
- Be patient. Copying large projects may take some time. Allow the command to run to completion.

### Usage
```shell-session
$ npx @ibm-cloud/cd-tools copy-project-group -h
Usage: @ibm-cloud/cd-tools copy-project-group [options]

Copies all Git Repos and Issue Tracking projects in a group to another region.

Examples:
  npx @ibm-cloud/cd-tools copy-project-group -g "1796019" -s ca-tor -d us-south --st ${PAT_CA_TOR} --dt ${PAT_US_SOUTH}
      Copy all the Git Repos and Issue Tracking projects in the group "mygroup" from the Toronto region to the Dallas, with the same group name.

Options:
  -s, --source-region <region>  The source region from which to copy the project group (choices: "au-syd", "br-sao", "ca-mon", "ca-tor", "eu-de", "eu-es", "eu-gb", "jp-osa", "jp-tok", "us-east", "us-south")
  -d, --dest-region <region>    The destination region to copy the projects to (choices: "au-syd", "br-sao", "ca-mon", "ca-tor", "eu-de", "eu-es", "eu-gb", "jp-osa", "jp-tok", "us-east", "us-south")
  --st, --source-token <token>  A Git Repos and Issue Tracking personal access token from the source region. The api scope is required on the token.
  --dt, --dest-token <token>    A Git Repos and Issue Tracking personal access token from the target region. The api scope is required on the token.
  -g, --group-id <id>           The id of the group to copy from the source region (e.g. "1796019"), or the group name (e.g. "mygroup") for top-level groups. For sub-groups, a path
                                is also allowed, e.g. "mygroup/subgroup"
  -n, --new-group-slug <slug>   (Optional) Destination group URL slug (single path segment, e.g. "mygroup-copy"). Must be unique. Group display name remains the same as source.
  -h, --help                    display help for command
```

## copy-toolchain

### Overview
The `copy-toolchain` command copies a [toolchain](https://cloud.ibm.com/docs/ContinuousDelivery?topic=ContinuousDelivery-toolchains-using), including tool integrations and Tekton pipelines, to another region or resource group, in the same account. The copy works by first serializing the existing toolchain into Terraform (.tf) files, then applying the Terraform on the destination.

### Limitations
1. [Classic pipelines](https://cloud.ibm.com/docs/ContinuousDelivery?topic=ContinuousDelivery-deliverypipeline_about) are not supported.
2. [DevOps Insights](https://cloud.ibm.com/docs/ContinuousDelivery?topic=ContinuousDelivery-di_working) is not supported.
3. Secrets stored directly in Toolchains or Delivery Pipelines (environment properties or trigger properties) will not be copied. An `export-secrets` command is provided to export secrets into a [Secrets Manager](https://cloud.ibm.com/docs/secrets-manager?topic=secrets-manager-getting-started) instance, replacing the stored secrets with secret references. Secret references are supported. It is recommended to store secrets in [Secrets Manager](https://cloud.ibm.com/docs/secrets-manager?topic=secrets-manager-getting-started).
4. Tekton pipeline webhook trigger secrets will not be copied, as references are not supported for webhook trigger secrets. You will need to add the secret after copying the toolchain.
5. Tekton pipeline run history, logs, and assets will not be copied. You can keep the original pipelines for some time to retain history.
6. GitHub and Git Repos and Issue Tracking tool integrations configured with OAuth type authentication will automatically be converted to use the OAuth identity of the user performing the copy (the owner of the API key) rather than the original user. This is to simplify the copy operation. You can re-configure the tool integrations after copying to use a different user.
7. Git Repos and Issue Tracking tool integrations that use Personal Access Tokens (PATs) for authentication will automatically be converted to use OAuth. You can re-configure the tool integrations after copying to use a PAT again.

### Prerequisites
- An [IBM Cloud API key](https://cloud.ibm.com/docs/account?topic=account-manapikey) with the IAM access listed below.
- **Viewer** access for the source Toolchain(s) being copied
- **Editor** access for creating new Toolchains in the target region
- **Administrator** access for other IBM Cloud service instances that have a tool integration with IAM service-to-service authorizations, such as [Secrets Manager](https://cloud.ibm.com/docs/secrets-manager?topic=secrets-manager-getting-started), [Event Notifications](https://cloud.ibm.com/docs/event-notifications?topic=event-notifications-getting-started), etc.
- Access to any GitHub or Git Repos and Issue Tracking **repositories** referenced by tool integrations in the toolchain, with permission to **read the repository** and **create webhooks**. This is required in order to create pipeline Git type triggers, which require a webhook to be added on the repository to trigger the pipeline, and for the pipeline to be able to clone the repositories during execution.
- A [Continuous Delivery](https://cloud.ibm.com/catalog/services/continuous-delivery) service instance is required in the target region and resource group in order to properly create the toolchain copy. Note that Continuous Delivery capabilities (Delivery Pipelines, Git Repos and Issue Tracking, etc) are subject to the plan of the Continuous Delivery instance in the same region and resource group as the toolchain. [Learn more](https://cloud.ibm.com/docs/ContinuousDelivery?topic=ContinuousDelivery-limitations_usage)

### Recommendations
- Ensure that all tool integrations in the toolchains are correctly configured and showing no errors in the toolchain page before proceeding. If there are misconfigured tool integrations, the tool will prompt you before proceeding.

### CRN

IBM Cloud resources are uniquely identified by a [Cloud Resource Name (CRN)](https://cloud.ibm.com/docs/account?topic=account-crn). You will need the CRN of the toolchain you want to copy. You can get the CRN of a toolchain a few ways:

1. Locate the toolchain in the [Platform Automation](https://cloud.ibm.com/automation) > [Toolchains](https://cloud.ibm.com/automation/toolchains) page, open the toolchain, and click **Details** to see the toolchain details, which shows the CRN.
2. Locate the toolchain in the [Resource list](https://cloud.ibm.com/resources) page, click on the toolchain row to expand the details panel, which shows the CRN.
3. Using the [ibmcloud cli](https://cloud.ibm.com/docs/cli?topic=cli-getting-started), you can list toolchains and their CRNs via
```shell-session
$ ibmcloud resource service-instances --service-name toolchain --long
```
4. Using the [CD Toolchain API](https://cloud.ibm.com/apidocs/toolchain).

### Usage
```shell-session
$ npx @ibm-cloud/cd-tools copy-toolchain -h
Usage: @ibm-cloud/cd-tools copy-toolchain [options]

Copies a toolchain, including tool integrations and Tekton pipelines, to another region or resource group.

Examples:
  export IBMCLOUD_API_KEY='...'
  npx @ibm-cloud/cd-tools copy-toolchain -c ${TOOLCHAIN_CRN} -r us-south
      Copy a toolchain to the Dallas region with the same name, in the same resource group.
  npx @ibm-cloud/cd-tools copy-toolchain -c ${TOOLCHAIN_CRN} -r eu-de -n new-toolchain-name -g new-resource-group --apikey ${APIKEY}
      Copy a toolchain to the Frankfurt region with the specified name and target resource group, using the given API key

Environment Variables:
  IBMCLOUD_API_KEY                       API key used to authenticate. Must have IAM permission to read and create toolchains and service-to-service authorizations in source and target region / resource group

Basic options:
  -c, --toolchain-crn <crn>              The CRN of the source toolchain to copy
  -r, --region <region>                  The destination region of the copied toolchain (choices: "au-syd", "br-sao", "ca-mon", "ca-tor", "eu-de", "eu-es", "eu-gb", "jp-osa", "jp-tok", "us-east", "us-south")
  -a, --apikey <api_key>                 API key used to authenticate. Must have IAM permission to read and create toolchains and service-to-service authorizations in source and target region / resource group
  -n, --name <name>                      (Optional) The name of the copied toolchain (default: same name as original)
  -g, --resource-group <resource_group>  (Optional) The name or ID of destination resource group of the copied toolchain (default: same resource group as original)
  -t, --tag <tag>                        (Optional) The tag to add to the copied toolchain
  -h, --help                             Display help for command

Advanced options:
  -d, --terraform-dir <path>             (Optional) The target local directory to store the generated Terraform (.tf) files
  -D, --dry-run                          (Optional) Skip running terraform apply; only generate the Terraform (.tf) files
  -f, --force                            (Optional) Force the copy toolchain command to run without user confirmation
  -S, --skip-s2s                         (Optional) Skip creating toolchain-generated service-to-service authorizations
  -T, --skip-disable-triggers            (Optional) Skip disabling Tekton pipeline Git or timed triggers. Note: This may result in duplicate pipeline runs
  -C, --compact                          (Optional) Generate all resources in a single resources.tf file
  -v, --verbose                          (Optional) Increase log output
  -q, --quiet                            (Optional) Suppress non-essential output, only errors and critical warnings are displayed
```

### Retrying after errors

If an error occurs while copying the toolchain, the copied toolchain may be incomplete. You may need to try the command again. To try again, you can either:
1. Delete the partially created toolchain and run the `copy-toolchain` command again.
2. Re-run the `terraform apply` command.<br/><br/>The `copy-toolchain` first serializes the source toolchain into Terraform (.tf) files. If you don't specify the `-d, --terraform-dir <path>`, the Terraform files will be placed in a folder in the current working directory named `output-{id}`, e.g. `output-1764100766410`. You can locate the most recent output folder and re-run `terraform apply`. This will continue where the previous command left off. When prompted for an API key, specify the same API key you used to run the `copy-toolchain` command.
```shell-session
$ cd output-1764102115772
$ terraform apply
var.ibmcloud_api_key
  Enter a value: {api_key}
...
```

### Getting the Terraform code for a toolchain

You can get the Terraform (.tf) files for a toolchain by running the `copy-toolchain` command with the `-D, --dry-run` option, and specifying the directory to store the Terraform files with the `-d, --terraform-dir <path>` option.

```shell-session
$ npx @ibm-cloud/cd-tools copy-toolchain -c ${CRN} -r us-south --dry-run --terraform-dir ./terraform
```

The command will output a collection of `.tf` files in the `terraform` directory. If you prefer to have a single file containing all the Terraform source, you can also specify the `-C, --compact` option.

### Copying toolchains to a different account

The `copy-toolchain` command copies a toolchain within an IBM Cloud account. However it is possible to copy a toolchain to a different account with a few extra steps. Note that any tool integrations that access services in the source account, such as [Secrets Manager](https://cloud.ibm.com/docs/secrets-manager?topic=secrets-manager-getting-started), [Event Notifications](https://cloud.ibm.com/docs/event-notifications?topic=event-notifications-getting-started), etc. are not supported for cross-account copying.
1. Run the `copy-toolchain` command with the `-D, --dry-run` option to first generate the Terraform (.tf) files to a directory (See [Getting the Terraform code for a toolchain](#getting-the-terraform-code-for-a-toolchain)).
2. Edit the `cd_toolchain.tf` file, replacing the `resource_group_id` with a valid resource group id in the target account. You can find the resource group id in the IBM Cloud console under [Manage > Account > Resource groups](https://cloud.ibm.com/account/resource-groups).
3. Switch to the directory containing the Terraform files, and run `terraform init`, then `terraform apply`.
4. When prompted for the API key, provide an API key for the target account you wish to copy the toolchain to.

## Test
All test setup and usage instructions are documented in [test/README.md](./test/README.md).