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
import { COPY_PROJECT_GROUP_DESC, SOURCE_REGIONS } from '../config.js';
import { getWithRetry } from './utils/requests.js';

const HTTP_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes default

class GitLabClient {
  constructor(baseURL, token) {
    const root = baseURL.endsWith("/") ? baseURL : `${baseURL}/`;
    
    this.client = axios.create({
      baseURL: `${root}api/v4`,
      timeout: HTTP_TIMEOUT_MS,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
    this.graph = axios.create({
      baseURL: `${root}api`,
      timeout: HTTP_TIMEOUT_MS,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
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

  async listGroupProjectsGraphQL(groupFullPath, { includeSubgroups = true, pageSize = 200, maxProjects = 5000 } = {}) {
    const out = [];
    let after = null;

    const query = `
      query($fullPath: ID!, $after: String, $includeSubgroups: Boolean!, $pageSize: Int!) {
        group(fullPath: $fullPath) {
          projects(includeSubgroups: $includeSubgroups, first: $pageSize, after: $after) {
            nodes {
              fullPath
              nameWithNamespace
              httpUrlToRepo
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      }
    `;

    while (out.length < maxProjects) {
      const resp = await this.graph.post("/graphql", {
        query,
        variables: { fullPath: groupFullPath, after, includeSubgroups, pageSize },
      });

      if (resp.data?.errors?.length) {
        throw new Error(`GraphQL errors: ${JSON.stringify(resp.data.errors)}`);
      }

      const projects = resp.data?.data?.group?.projects?.nodes || [];
      const pageInfo = resp.data?.data?.group?.projects?.pageInfo;

      out.push(...projects);

      if (!pageInfo?.hasNextPage) break;
      after = pageInfo.endCursor;
    }

    return out;
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

  async getBulkImportEntitiesAll(importId, { perPage = 100, maxPages = 200 } = {}) {
    const all = [];
    let page = 1;

    while (page <= maxPages) {
      const resp = await getWithRetry(
        this.client,
        `/bulk_imports/${importId}/entities`,
        { page, per_page: perPage }
      );

      all.push(...(resp.data || []));

      const nextPage = Number(resp.headers?.['x-next-page'] || 0);
      if (!nextPage) break;

      page = nextPage;
    }

    return all;
  }

  async getGroupByFullPath(fullPath) {
    const encoded = encodeURIComponent(fullPath);
    const resp = await this.client.get(`/groups/${encoded}`);
    return resp.data;
  }

  async listBulkImports({ page = 1, perPage = 50 } = {}) {
    const resp = await getWithRetry(this.client, `/bulk_imports`, { page, per_page: perPage });
    return {
      imports: resp.data || [],
      nextPage: Number(resp.headers?.['x-next-page'] || 0),
    };
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
async function generateUrlMappingFile({ destUrl, sourceGroup, destinationGroupPath, sourceProjects }) {
  const destBase = destUrl.endsWith('/') ? destUrl.slice(0, -1) : destUrl;
  const urlMapping = {};

  for (const project of sourceProjects) {
    const oldRepoUrl = project.http_url_to_repo || project.httpUrlToRepo;

    const fullPath = project.path_with_namespace || project.fullPath || "";
    const groupPrefix = `${sourceGroup.full_path}/`;

    const relativePath = fullPath.startsWith(groupPrefix)
      ? fullPath.slice(groupPrefix.length)
      : fullPath;

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

function buildGroupImportHistoryUrl(destUrl) {
  try {
    return new URL('import/bulk_imports/history', destUrl).toString();
  } catch {
    return null;
  }
}

function summarizeBulkImportProgress(entities = []) {
  let entityTotal = 0;
  let entityFinished = 0;
  let entityFailed = 0;

  let projectTotal = 0;
  let projectFinished = 0;
  let projectFailed = 0;

  let lastCompleted = null;
  let lastCompletedTs = 0;

  for (const e of entities) {
    entityTotal++;

    const status = e.status;
    const isFinished = status === 'finished';
    const isFailed = status === 'failed';

    if (isFinished) entityFinished++;
    if (isFailed) entityFailed++;

    const isProjectEntity =
      e.source_type === 'project_entity' ||
      e.entity_type === 'project_entity' ||
      e.entity_type === 'project';

    if (isProjectEntity) {
      projectTotal++;
      if (isFinished) projectFinished++;
      if (isFailed) projectFailed++;
    }

    if (isFinished) {
      const ts = new Date(e.updated_at || e.created_at || 0).getTime();
      if (ts > lastCompletedTs) {
        lastCompletedTs = ts;
        lastCompleted = e;
      }
    }
  }

  const entityDone = entityFinished + entityFailed;
  const entityPct = entityTotal ? Math.floor((entityDone / entityTotal) * 100) : 0;

  const projectDone = projectFinished + projectFailed;
  const projectPct = projectTotal ? Math.floor((projectDone / projectTotal) * 100) : 0;

  const lastCompletedLabel = lastCompleted?.source_full_path || '';

  return {
    entityTotal,
    entityDone,
    entityFailed,
    entityPct,
    projectTotal,
    projectDone,
    projectFailed,
    projectPct,
    lastCompletedLabel,
  };
}

function formatBulkImportProgressLine(importStatus, summary) {
  if (!summary || summary.entityTotal === 0) {
    return `Import status: ${importStatus} | Progress: initializing...`;
  }

  const parts = [`Import status: ${importStatus}`];

  if (summary.projectTotal > 0) {
    parts.push(`Projects: ${summary.projectDone}/${summary.projectTotal} (${summary.projectPct}%)`);
    if (summary.projectFailed > 0) parts.push(`Project failed: ${summary.projectFailed}`);
  }

  parts.push(`Entities: ${summary.entityDone}/${summary.entityTotal} (${summary.entityPct}%)`);
  if (summary.entityFailed > 0) parts.push(`Failed: ${summary.entityFailed}`);

  if (summary.lastCompletedLabel) {
    parts.push(`Last completed: ${summary.lastCompletedLabel}`);
  }

  return parts.join(' | ');
}

function buildGroupUrl(base, path) {
  try {
    return new URL(path.replace(/^\//, ''), base).toString();
  } catch {
    return null;
  }
}

function isGroupEntity(e) {
  return e?.source_type === 'group_entity' || e?.entity_type === 'group_entity' || e?.entity_type === 'group';
}

async function handleBulkImportConflict({ destination, destUrl, sourceGroupFullPath, destinationGroupPath, importResErr }) {
  const historyUrl = buildGroupImportHistoryUrl(destUrl);
  const groupUrl = buildGroupUrl(destUrl, `/groups/${destinationGroupPath}`);
  const fallback = () => {
    console.log(`\nDestination group already exists.`);
    if (groupUrl) console.log(`Group: ${groupUrl}`);
    if (historyUrl) console.log(`Group import history: ${historyUrl}`);
    process.exit(0);
  };

  try {
    await destination.getGroupByFullPath(destinationGroupPath);
  } catch {
    fallback();
  }

  try {
    const IMPORT_PAGES = 3;
    const ENTITY_PAGES = 2;

    let page = 1;
    for (let p = 0; p < IMPORT_PAGES; p++) {
      const { imports, nextPage } = await destination.listBulkImports({ page, perPage: 50 });

      for (const bi of imports) {
        if (!bi?.id) continue;

        const status = bi.status;
        if (!['created', 'started', 'finished'].includes(status)) continue;

        const entities = await destination.getBulkImportEntitiesAll(bi.id, { perPage: 100, maxPages: ENTITY_PAGES });

        const matchesThisGroup = entities.some(e =>
          isGroupEntity(e) &&
          e.source_full_path === sourceGroupFullPath &&
          (e.destination_full_path === destinationGroupPath || e.destination_slug === destinationGroupPath)
        );

        if (!matchesThisGroup) continue;

        if (status === 'created' || status === 'started') {
          console.log(`\nGroup is already in migration...`);
          console.log(`Bulk import ID: ${bi.id}`);
          if (groupUrl) console.log(`Migrated group: ${groupUrl}`);
          if (historyUrl) console.log(`Group import history: ${historyUrl}`);
          process.exit(0);
        }

        console.log(`\nConflict detected: ${importResErr}`);
        console.log(`Please specify a new group name using -n, --new-group-slug <n> when trying again`);
        console.log(`\nGroup already migrated.`);
        if (groupUrl) console.log(`Migrated group: ${groupUrl}`);
        if (historyUrl) console.log(`Group import history: ${historyUrl}`);
        process.exit(0);
      }

      if (!nextPage) break;
      page = nextPage;
    }

    fallback();
  } catch {
    fallback();
  }
}

async function directTransfer(options) {
  const sourceUrl = validateAndConvertRegion(options.sourceRegion);
  const destUrl = validateAndConvertRegion(options.destRegion);
  const source = new GitLabClient(sourceUrl, options.sourceToken);
  const destination = new GitLabClient(destUrl, options.destToken);

  try {
    console.log(`Fetching source group from ID: ${options.groupId}...`);
    let sourceGroup;
    try {
      sourceGroup = await source.getGroup(options.groupId);
    } catch (err) {
      if (err?.response?.status === 404) {
        console.error(
          `Error: group "${options.groupId}" not found in source region "${options.sourceRegion}".\n` +
          `Tip: -g accepts numeric ID or full group path like "parent/subgroup".`
        );
        return 1;
      }

      console.error(`Error: failed to fetch group "${options.groupId}": ${err?.message || err}`);
      return 1;
    }

    let destinationGroupPath = options.newGroupSlug || sourceGroup.path;

    let sourceProjects;
    try {
      sourceProjects = await source.listGroupProjectsGraphQL(sourceGroup.full_path, {
        includeSubgroups: true,
        pageSize: 100,
        maxProjects: 10000,
      });
    } catch (e) {
      console.warn(`[WARN] GraphQL listing failed (${e.message}). Falling back to REST safe listing...`);
      sourceProjects = await source.getGroupProjects(sourceGroup.id);
    }
    
    console.log(`Found ${sourceProjects.length} projects in source group`);
    if (sourceProjects.length > 0) {
      console.log('Projects to be migrated:');
      sourceProjects.forEach(p => console.log(p.name_with_namespace || p.nameWithNamespace || p.fullPath));
    }

    if (options.newGroupSlug) {
      await promptUser(options.newGroupSlug);
    }

    // Generate URL mapping JSON before starting the migration
    await generateUrlMappingFile({
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
        await handleBulkImportConflict({
          destination,
          destUrl,
          sourceGroupFullPath: sourceGroup.full_path,
          destinationGroupPath,
          importResErr: importRes.error
        });
      }
    } catch (error) {
      console.log(`Bulk import request failed - ${error.message}`);
      process.exit(0);
    }

    console.log('\nPolling bulk import status (adaptive: 1m→2m→3m→4m→5m, max 60 checks)...');
    const MAX_ATTEMPTS = 60;
    const POLLS_PER_STEP = 5;
    const MIN_INTERVAL_MIN = 1;
    const MAX_INTERVAL_MIN = 5;

    let importStatus = 'created';
    let attempts = 0;

    while (!['finished', 'failed', 'timeout'].includes(importStatus) && attempts < MAX_ATTEMPTS) {
      if (attempts > 0) {
        const step = Math.floor(attempts / POLLS_PER_STEP);
        const waitMin = Math.min(MIN_INTERVAL_MIN + step, MAX_INTERVAL_MIN);

        console.log(`Waiting ${waitMin} minute before next status check...`);
        await new Promise(resolve => setTimeout(resolve, waitMin * 60000));
      }
      try {
        const importDetails = await destination.getBulkImport(bulkImport.id);
        importStatus = importDetails.status;
        let progressLine;
        try {
          const entitiesAll = await destination.getBulkImportEntitiesAll(bulkImport.id);
          const summary = summarizeBulkImportProgress(entitiesAll);
          progressLine = formatBulkImportProgressLine(importStatus, summary);
        } catch {
          progressLine = `Import status: ${importStatus} | Progress: (unable to fetch entity details)`;
        }

        console.log(`[${new Date().toLocaleTimeString()}] ${progressLine}`);

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

    if (attempts >= MAX_ATTEMPTS) {
      const historyUrl = buildGroupImportHistoryUrl(destUrl);

      console.error('\nThe CLI has stopped polling for the GitLab bulk import.');
      console.error('The migration itself may still be running inside GitLab — the CLI only waits for a limited time.');
      console.error(`Last reported status for bulk import ${bulkImport.id}: ${importStatus}`);

      if (historyUrl) {
        console.error('\nYou can continue monitoring this migration in the GitLab UI.');
        console.error(`Group import history: ${historyUrl}`);
      } else {
        console.error('\nYou can continue monitoring this migration from the Group import history page in the GitLab UI.');
      }
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
      const migratedGroupUrl = buildGroupUrl(destUrl, `/groups/${destinationGroupPath}`);
      if (migratedGroupUrl) console.log(`\nMigrated group: ${migratedGroupUrl}`);

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
  .summary('Copies all Git Repos and Issue Tracking projects in a group to another region.')
  .description(COPY_PROJECT_GROUP_DESC)
  .requiredOption('-s, --source-region <region>', 'The source region from which to copy the project group (choices: "au-syd", "br-sao", "ca-mon", "ca-tor", "eu-de", "eu-es", "eu-gb", "jp-osa", "jp-tok", "us-east", "us-south")')
  .requiredOption('-d, --dest-region <region>', 'The destination region to copy the projects to (choices: "au-syd", "br-sao", "ca-mon", "ca-tor", "eu-de", "eu-es", "eu-gb", "jp-osa", "jp-tok", "us-east", "us-south")')
  .requiredOption('--st, --source-token <token>', 'A Git Repos and Issue Tracking personal access token from the source region. The api scope is required on the token.')
  .requiredOption('--dt, --dest-token <token>', 'A Git Repos and Issue Tracking personal access token from the target region. The api scope is required on the token.')
  .requiredOption('-g, --group-id <id>', 'The id of the group to copy from the source region (e.g. "1796019"), or the group name (e.g. "mygroup") for top-level groups. For sub-groups, a path is also allowed, e.g. "mygroup/subgroup"')
  .option('-n, --new-group-slug <slug>', '(Optional) Destination group URL slug (single path segment, e.g. "mygroup-copy"). Must be unique. Group display name remains the same as source.')
  .showHelpAfterError()
  .hook('preAction', cmd => cmd.showHelpAfterError(false)) // only show help during validation
  .action(async (options) => {
    await directTransfer(options);
  });

export default command;