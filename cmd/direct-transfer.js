/**
 * Licensed Materials - Property of IBM
 * (c) Copyright IBM Corporation 2025. All Rights Reserved.
 *
 * Note to U.S. Government Users Restricted Rights:
 * Use, duplication or disclosure restricted by GSA ADP Schedule
 * Contract with IBM Corp.
 */

import { Command, Option } from 'commander';
import axios from 'axios';
import readline from 'readline/promises';
import { TARGET_REGIONS, SOURCE_REGIONS } from '../config.js';

class GitLabClient {
  constructor(baseURL, token) {
    this.client = axios.create({
      baseURL: baseURL.endsWith('/') ? `${baseURL}api/v4` : `${baseURL}/api/v4`,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
  }

  async getGroupProjects(groupId) {
    const projects = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const response = await this.client.get(`/groups/${groupId}/projects`, {
        params: { page, per_page: 100, include_subgroups: true }
      });
      
      projects.push(...response.data);
      hasMore = response.data.length === 100;
      page++;
    }
    
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
    }

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
        await new Promise(resolve => setTimeout(resolve, 5*60000));
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