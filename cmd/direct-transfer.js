/**
 * Licensed Materials - Property of IBM
 * (c) Copyright IBM Corporation 2025. All Rights Reserved.
 *
 * Note to U.S. Government Users Restricted Rights:
 * Use, duplication or disclosure restricted by GSA ADP Schedule
 * Contract with IBM Corp.
 */

import { Command } from 'commander';
import axios from 'axios';
import readline from 'readline/promises';
import { writeFile } from 'fs/promises';
import { TARGET_REGIONS, SOURCE_REGIONS } from '../config.js';
import { getWithRetry } from './utils/requests.js';

const HTTP_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes default

class GitLabClient {
  constructor(baseURL, token) {
    this.client = axios.create({
      baseURL: baseURL.endsWith('/') ? `${baseURL}api/v4` : `${baseURL}/api/v4`,
      timeout: HTTP_TIMEOUT_MS,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
  }

  // List all projects in a group + all its subgroups using BFS.
  async getGroupProjects(groupId, { maxProjects = 1000, maxRequests = 2000 } = {}) {
    let requestCount = 0;
    const projects = [];
    const toVisit = [groupId];
    const visited = new Set();

    console.log(
      `[DEBUG] Starting BFS project listing from group ${groupId} (maxProjects=${maxProjects}, maxRequests=${maxRequests})`
    );

    while (toVisit.length > 0) {
      const currentGroupId = toVisit.shift();
      if (visited.has(currentGroupId)) continue;
      visited.add(currentGroupId);

      console.log(`[DEBUG] Visiting group ${currentGroupId}. Remaining groups in queue: ${toVisit.length}`);

      // List projects for THIS group (no include_subgroups!)
      let projPage = 1;
      let hasMoreProjects = true;

      while (hasMoreProjects) {
        if (requestCount >= maxRequests || projects.length >= maxProjects) {
          console.warn(`[WARN] Stopping project traversal: requestCount=${requestCount}, projects=${projects.length}`);
          return projects;
        }

        const projRes = await getWithRetry(
          this.client,
          `/groups/${currentGroupId}/projects`,
          { page: projPage, per_page: 100 }
        );

        requestCount++;
        const pageProjects = projRes.data || [];
        if (pageProjects.length > 0) {
          projects.push(...pageProjects);
        }

        hasMoreProjects = pageProjects.length === 100;
        projPage++;
      }

      // List DIRECT subgroups and enqueue them
      let subgroupPage = 1;
      let hasMoreSubgroups = true;

      while (hasMoreSubgroups) {
        if (requestCount >= maxRequests) {
          console.warn(
            `[WARN] Stopping subgroup traversal: requestCount=${requestCount}`
          );
          return projects;
        }

        const subgroupRes = await getWithRetry(
          this.client,
          `/groups/${currentGroupId}/subgroups`,
          { page: subgroupPage, per_page: 100 }
        );

        requestCount++;
        const subgroups = subgroupRes.data || [];

        if (subgroups.length > 0) {
          for (const sg of subgroups) {
            if (!visited.has(sg.id)) {
              toVisit.push(sg.id);
            }
          }
        }

        hasMoreSubgroups = subgroups.length === 100;
        subgroupPage++;
      }
    }

    console.log(`[DEBUG] Finished BFS project listing. Total projects=${projects.length}, total requests=${requestCount}`);
    return projects;
  }

  async getGroup(groupId) {
    const response = await this.client.get(`/groups/${groupId}`);
    return response.data;
  }

  async createBulkImport(importData) {
    const response = await this.client.post('/bulk_imports', importData);
    return response.data;
  }

  async getBulkImport(importId) {
    const response = await this.client.get(`/bulk_imports/${importId}`);
    return response.data;
  }

  async getBulkImportEntities(importId) {
    const response = await this.client.get(`/bulk_imports/${importId}/entities`);
    return response.data;
  }

  async getBulkImportEntity(importId, entityId) {
    const response = await this.client.get(`/bulk_imports/${importId}/entities/${entityId}`);
    return response.data;
  }

  async getCustomAttributes(projectId) {
    try {
      const response = await this.client.get(`/projects/${projectId}/custom_attributes`);
      return response.data;
    } catch (error) {
      if (error.response?.status === 404) {
        return []; // No custom attributes
      }
      throw error;
    }
  }

  async deleteCustomAttribute(projectId, key) {
    try {
      await this.client.delete(`/projects/${projectId}/custom_attributes/${key}`);
      return true;
    } catch (error) {
      if (error.response?.status === 404) {
        return false; // custom attribute doesn't exist
      }
      throw error;
    }
  }

  async deleteAllCustomAttributes(projectId) {
    const attributes = await this.getCustomAttributes(projectId);
    const results = [];
    for (const attr of attributes) {
      try {
        await this.deleteCustomAttribute(projectId, attr.key);
        results.push({ key: attr.key, deleted: true });
      } catch (error) {
        results.push({ key: attr.key, deleted: false, error: error.message });
      }
    }
    return results;
  }

  async bulkImport(importData) {
    try {
      const response = await this.client.post('/bulk_imports', importData);
      return { success: true, data: response.data };
    } catch (error) {
      // name/path already exists
      if (error.response?.status === 409 || error.response?.data?.message?.includes("already exists")) {
        return { success: false, conflict: true, error: error.response?.data?.message };
      }
      throw new Error(`Bulk import API call failed: ${error.response?.status} ${error.response?.statusText} - ${JSON.stringify(error.response?.data)}`);
    }
  }
}

async function promptUser(name) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const answer = await rl.question(`Your new group name is ${name}. Are you sure? (Yes/No)`);

  rl.close();

  if (answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y') {
    console.log("Proceeding...");
  } else {
    process.exit(0);
  }
}

function validateAndConvertRegion(region) {
  if (!SOURCE_REGIONS.includes(region)) {
    throw new Error(
      `Invalid region: ${region}. Must be one of: ${SOURCE_REGIONS.join(', ')}`
    );
  }
  return `https://${region}.git.cloud.ibm.com/`;
}

//  Build a mapping of: old http_url_to_repo -> new http_url_to_repo
async function generateUrlMappingFile({sourceUrl, destUrl, sourceGroup, destinationGroupPath, sourceProjects}) {
  const destBase = destUrl.endsWith('/') ? destUrl.slice(0, -1) : destUrl;
  const urlMapping = {};

  const groupPrefix = `${sourceGroup.full_path}/`;

  for (const project of sourceProjects) {
    const oldRepoUrl = project.http_url_to_repo; // ends with .git

    // path_with_namespace is like "group/subgroup/project-1"
    let relativePath;
    if (project.path_with_namespace.startsWith(groupPrefix)) {
      relativePath = project.path_with_namespace.slice(groupPrefix.length);
    } else {
      // Fallback if for some reason full_path is not a prefix
      relativePath = project.path_with_namespace;
    }

    const newRepoUrl = `${destBase}/${destinationGroupPath}/${relativePath}.git`;
    urlMapping[oldRepoUrl] = newRepoUrl;
  }

  const mappingFile = 'grit-url-map.json';

  await writeFile(mappingFile, JSON.stringify(urlMapping, null, 2), {
    encoding: 'utf8',
  });

  console.log(`\nURL mapping JSON generated at: ${mappingFile}`);
  console.log(`Total mapped projects: ${sourceProjects.length}`);
}

async function directTransfer(options) {
  const sourceUrl = validateAndConvertRegion(options.sourceRegion);
  const destUrl = validateAndConvertRegion(options.destRegion);
  const source = new GitLabClient(sourceUrl, options.sourceToken);
  const destination = new GitLabClient(destUrl, options.destToken);

  try {
    console.log(`Fetching source group from ID: ${options.groupId}...`);
    const sourceGroup = await source.getGroup(options.groupId);

    let destinationGroupName = options.newName || sourceGroup.name;
    let destinationGroupPath = options.newName || sourceGroup.path;

    const sourceProjects = await source.getGroupProjects(sourceGroup.id);
    console.log(`Found ${sourceProjects.length} projects in source group`);
    if (sourceProjects.length > 0) {
      console.log('Projects to be migrated:');
      sourceProjects.forEach(p => console.log(`${p.name_with_namespace}`));
    }

    if (options.newName) {
      await promptUser(options.newName);
    }

    // Generate URL mapping JSON before starting the migration
    await generateUrlMappingFile({
      sourceUrl,
      destUrl,
      sourceGroup,
      destinationGroupPath,
      sourceProjects,
    });

    let bulkImport = null;

    const requestPayload = {
      configuration: {
        url: sourceUrl,
        access_token: options.sourceToken
      },
      entities: [{
        source_full_path: sourceGroup.full_path,
        source_type: 'group_entity',
        destination_slug: destinationGroupPath,
        destination_namespace: ""
      }]
    };

    let importRes = null;

    try {
      importRes = await destination.bulkImport(requestPayload);
      if (importRes.success) {
        bulkImport = importRes.data;
        console.log(`Bulk import request succeeded!`);
        console.log(`Bulk import initiated successfully (ID: ${importRes.data?.id})`);
      } else if (importRes.conflict) {
        console.log(`Conflict detected: ${importRes.error}`);
        console.log(`Please specify a new group name using -n, --new-name <n> when trying again`);
        process.exit(0);
      }
    } catch (error) {
      console.log(`Bulk import request failed - ${error.message}`);
      process.exit(0);
    }

    console.log('\nPolling bulk import status (checking every 5 minute)...');
    let importStatus = 'created';
    let attempts = 0;

    while (!['finished', 'failed', 'timeout'].includes(importStatus) && attempts < 60) {
      if (attempts > 0) {
        console.log(`Waiting 5 minute before next status check...`);
        await new Promise(resolve => setTimeout(resolve, 5 * 60000));
      }
      try {
        const importDetails = await destination.getBulkImport(bulkImport.id);
        importStatus = importDetails.status;
        console.log(`[${new Date().toLocaleTimeString()}] Import status: ${importStatus}`);

        if (importStatus === 'finished') {
          console.log('Bulk import completed successfully!');
          break;
        } else if (importStatus === 'failed') {
          console.log('Bulk import failed!');
          break;
        }
      } catch (e) {
        console.error(`Error checking import status: ${e.message}`);
        if (e.response?.status === 404) {
          throw new Error('Bulk import not found - it may have been deleted');
        }
      }
      attempts++;
    }

    if (attempts >= 60) {
      console.error(`Bulk import either timed out or is still running in the background`);
      process.exit(0);
    }

    const entities = await destination.getBulkImportEntities(bulkImport.id);
    const finishedEntities = entities.filter(e => e.status === 'finished');
    const failedEntities = entities.filter(e => e.status === 'failed');

    if (importStatus === 'finished' && finishedEntities.length > 0) {
      console.log(`\nGroup migration completed successfully!`);
      console.log(`Migration Results:`);
      console.log(`Successfully migrated: ${finishedEntities.length} entities`);
      console.log(`Failed: ${failedEntities.length} entities`);

      if (failedEntities.length > 0) {
        console.log(`\nFailed entities:\n`);
        failedEntities.forEach(e => {
          console.log(`${e.source_type}: ${e.source_full_path} (${e.status})`);
        });
      }

      return 0;
    } else {
      console.error('\nBulk import failed!');
      if (failedEntities.length > 0) {
        console.error('Failed entities:');
        failedEntities.forEach(e => {
          console.error(`${e.source_type}: ${e.source_full_path} (${e.status})`);
        });
      }
      throw new Error('GitLab bulk import failed');
    }

  } catch (error) {
    console.error(`Group migration failed: ${error.message}`);
    throw error;
  }
}

const command = new Command('copy-project-group')
  .description('Bulk migrate GitLab group projects')
  .requiredOption('-s, --source-region <region>', 'Source GitLab instance region')
  .requiredOption('-d, --dest-region <region>', 'Destination GitLab instance region')
  .requiredOption('--st, --source-token <token>', 'Source GitLab access token')
  .requiredOption('--dt, --dest-token <token>', 'Destination GitLab access token')
  .requiredOption('-g, --group-id <id>', 'Source group ID to migrate')
  .option('-n, --new-name <n>', 'New group path (optional)')
  .showHelpAfterError()
  .hook('preAction', cmd => cmd.showHelpAfterError(false)) // only show help during validation
  .action(async (options) => {
    await directTransfer(options);
  });

export default command;