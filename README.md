# Continuous Delivery tools

Provides tools to work with IBM Cloud Continuous Delivery resources, including **Toolchains**, **Delivery Pipelines**, and **Git Repos and Issue Tracking** projects.

#### Supported resources
| Resource | Supported  |
| :- | :- |
| Toolchains | Yes <sup>1</sup> |
| Git Repos and Issue Tracking projects | Yes <sup>2</sup> |
| Delivery Pipelines (Tekton) | Yes <sup>1</sup> <sup>3</sup> |
| Delivery Pipelines (Classic) | No |
| DevOps Insights | No |
| Other Tool Integrations | Yes |

#### Limitations  
1. Secrets stored directly in Toolchains or Delivery Pipelines (environment properties or trigger properties) will not be copied. A `check-secrets` tool is provided to export secrets into a Secrets Manager instance, replacing the stored secrets with secret references. Secret references are supported in the migration.
2. Personal Access Tokens will not be copied.
3. Pipeline run history, logs, and assets will not be copied to the new region. You can keep the original pipelines for some time to retain history.
4. Classic pipelines are not supported.
5. DevOps Insights is not supported.

## Prerequisites
- Node.js v20 (or later)
- Terraform v1.13.3 (or later)
- An **IBM Cloud API key** with the following IAM access permissions:
  - **Viewer** for the source Toolchain(s) being copied
  - **Editor** for create new Toolchains in the target region
  - **Administrator** for other IBM Cloud service instances that have a tool integration with IAM service-to-service authorizations, such as Secrets Manager, Event Notifications, etc.
- For Git Repos and Issue Tracking projects, Personal Access Tokens (PAT) for the source and destination regions are required, with the `api` scope.

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

The tools are provided as an [npx](https://docs.npmjs.com/cli/commands/npx) command which automatically downloads and runs the module. To see the available commands, run `npx @ibm-cloud/cd-tools` on your command line.

```shell-session
$ npx @ibm-cloud/cd-tools
Usage: npx @ibm-cloud/cd-tools [options] [command]

Tools for migrating Toolchains, Delivery Pipelines, and Git Repos and Issue Tracking projects.

Options:
  -V, --version                 output the version number
  -h, --help                    display help for command

Commands:
  copy-project-group [options]  Bulk migrate GitLab group projects
  check-secrets [options]       Checks if you have any stored secrets in your toolchain or pipelines
  copy-toolchain [options]      Copies a toolchain, including tool integrations and Tekton pipelines, to another region or resource group.
  help [command]                display help for command
```

## Test
All test setup and usage instructions are documented in [test/README.md](./test/README.md).
