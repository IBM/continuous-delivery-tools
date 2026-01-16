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
import { writeFile } from 'fs/promises';
import { COPY_PROJECT_GROUP_DESC, SOURCE_REGIONS } from '../config.js';
import { getWithRetry } from './utils/requests.js';
import Papa from 'papaparse';
import fs from 'fs';
import { logger, LOG_STAGES } from './utils/logger.js';
import { promptUserYesNo } from './utils/utils.js';

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

    logger.debug(
      `Starting BFS project listing from group ${groupId} (maxProjects=${maxProjects}, maxRequests=${maxRequests})`,
      LOG_STAGES.setup
    );

    while (toVisit.length > 0) {
      const currentGroupId = toVisit.shift();
      if (visited.has(currentGroupId)) continue;
      visited.add(currentGroupId);

      logger.debug(`Visiting group ${currentGroupId}. Remaining groups in queue: ${toVisit.length}`, LOG_STAGES.setup);

      // List projects for THIS group (no include_subgroups!)
      let projPage = 1;
      let hasMoreProjects = true;

      while (hasMoreProjects) {
        if (requestCount >= maxRequests || projects.length >= maxProjects) {
          logger.warn(`Stopping project traversal early: requestCount=${requestCount}, projects=${projects.length}`, LOG_STAGES.setup);
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
          logger.warn(`Stopping subgroup traversal early: requestCount=${requestCount}`, LOG_STAGES.setup);
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

    logger.debug(`Finished BFS project listing. Total projects=${projects.length}, total requests=${requestCount}`, LOG_STAGES.setup);
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

  async getGroupPlaceholderCsv(groupId) {
    const response = await this.client.get(`/groups/${groupId}/placeholder_reassignments`);
    return response.data;
  }

  async reassignGroupPlaceholder(groupId, form) {
    const response = await this.client.postForm(`/groups/${groupId}/placeholder_reassignments`, form);
    return response.data;
  }

  async getGroup(groupId) {
    const response = await this.client.get(`/groups/${groupId}`);
    return response.data;
  }

  async syncUser(syncData) {
    const response = await this.client.post(`https://otc-github-consolidated-broker.${syncData.destRegion}.devops.cloud.ibm.com/git-user-sync`, syncData);
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

  logger.print();
  logger.info(`Created file mapping old project urls to new urls at: ${mappingFile}`, LOG_STAGES.info);
  logger.info(`Total mapped projects: ${sourceProjects.length}`, LOG_STAGES.info);
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
    entityFinished,
    entityDone,
    entityFailed,
    entityPct,
    projectTotal,
    projectFinished,
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
    logger.print();
    logger.warn(`Destination group already exists.`, LOG_STAGES.import);
    if (groupUrl) logger.info(`Group: ${groupUrl}`, LOG_STAGES.import);
    if (historyUrl) logger.info(`Group import history: ${historyUrl}`, LOG_STAGES.import);
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
          logger.print();
          logger.warn(`Group is already in migration...`, LOG_STAGES.import);
          logger.info(`Bulk import ID: ${bi.id}`, LOG_STAGES.import);
          if (groupUrl) logger.info(`Group URL: ${groupUrl}`, LOG_STAGES.import);
          if (historyUrl) logger.info(`Group import history: ${historyUrl}`, LOG_STAGES.import);
          process.exit(0);
        }

        logger.print();
        logger.warn(`Conflict detected: ${importResErr}`, LOG_STAGES.import);
        logger.info(`Tip: specify a new group name using -n, --new-group-slug <slug> and try again.`, LOG_STAGES.import);
        logger.print();
        logger.info(`Group already migrated.`, LOG_STAGES.import);
        if (groupUrl) logger.info(`Group URL: ${groupUrl}`, LOG_STAGES.import);
        if (historyUrl) logger.info(`Group import history: ${historyUrl}`, LOG_STAGES.import);
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
    logger.info(`Fetching source group from ID: ${options.groupId}...`, LOG_STAGES.setup);
    let sourceGroup;
    try {
      sourceGroup = await source.getGroup(options.groupId);
    } catch (err) {
      if (err?.response?.status === 404) {
        logger.error(
          `Error: group "${options.groupId}" not found in source region "${options.sourceRegion}".\n` +
          `Tip: -g accepts numeric ID or full group path like "parent/subgroup".`
        );
        return 1;
      }

      logger.error(`Error: failed to fetch group "${options.groupId}": ${err?.message || err}`, LOG_STAGES.setup);
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
      logger.warn(`GraphQL listing failed. Falling back to REST project listing...`, LOG_STAGES.setup);
      logger.debug(`GraphQL error: ${e.message}`, LOG_STAGES.setup);
      sourceProjects = await source.getGroupProjects(sourceGroup.id);
    }
    
    logger.info(`Found ${sourceProjects.length} projects in source group`, LOG_STAGES.setup);
    if (sourceProjects.length > 0) {
      logger.info('Projects to be migrated:', LOG_STAGES.setup);
      sourceProjects.forEach(p => logger.print(p.name_with_namespace || p.nameWithNamespace || p.fullPath));
    }

    if (options.newGroupSlug) {
      const ok = await promptUserYesNo(`Your new group slug is "${options.newGroupSlug}". Proceed?`);
      if (!ok) return 0;
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
      logger.print();
      logger.info(`Requesting bulk import request in '${options.destRegion}'...`, LOG_STAGES.request);
      importRes = await destination.bulkImport(requestPayload);
      if (importRes.success) {
        bulkImport = importRes.data;
        logger.success(`✔ Bulk import initiated successfully (ID: ${importRes.data?.id})`, LOG_STAGES.request);
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
      logger.error(`✖ Bulk import request failed - ${error.message}`, LOG_STAGES.request);
      process.exit(0);
    }
        
    logger.print();
    const spinnerOff = process.env.DISABLE_SPINNER === 'true';
    if (spinnerOff) {
      logger.info('Waiting for bulk project import to complete...', LOG_STAGES.import);
      logger.info('This may take time depending on the number and size of projects.', LOG_STAGES.import);
    }

    const MAX_ATTEMPTS = 60;
    const POLLS_PER_STEP = 5;
    const MIN_INTERVAL_MIN = 1;
    const MAX_INTERVAL_MIN = 5;

    let importStatus = 'created';
    let attempts = 0;
    let entitiesAll = [];

    const emit = (msg) => {
      if (spinnerOff) logger.info(msg, LOG_STAGES.import);
      else logger.updateSpinnerMsg(msg);
    };

    const waitStep = async () => {
      const step = Math.floor(attempts / POLLS_PER_STEP);
      const waitMin = Math.min(MIN_INTERVAL_MIN + step, MAX_INTERVAL_MIN);

      if (options.verbose) emit(`Waiting ${waitMin} minute before next status check...`);
      await new Promise(r => setTimeout(r, waitMin * 60000));
    };

    const pollBulkImport = async () => {
      while (!['finished', 'failed', 'timeout'].includes(importStatus) && attempts < MAX_ATTEMPTS) {
        if (attempts > 0) await waitStep();

        const importDetails = await destination.getBulkImport(bulkImport.id);
        importStatus = importDetails.status;

        let progressLine;
        try {
          entitiesAll = await destination.getBulkImportEntitiesAll(bulkImport.id);
          progressLine = formatBulkImportProgressLine(importStatus, summarizeBulkImportProgress(entitiesAll));
        } catch {
          progressLine = `Import status: ${importStatus} | Progress: (unable to fetch entity details)`;
        }

        emit(progressLine);

        if (importStatus === 'finished') return { importStatus, entitiesAll };
        if (importStatus === 'failed') throw new Error('GitLab bulk import failed');

        attempts++;
      }

      if (attempts >= MAX_ATTEMPTS) {
        const err = new Error('POLLING_TIMEOUT');
        err.code = 'POLLING_TIMEOUT';
        err.importStatus = importStatus;
        throw err;
      }

      return { importStatus, entitiesAll };
    };

    let pollResult;
    try {
      pollResult = await logger.withSpinner(
        pollBulkImport,
        'Waiting for bulk project import to complete... (may take some time)',
        'Bulk import completed successfully!',
        LOG_STAGES.import
      );

      if (spinnerOff) logger.success('Bulk import completed successfully!', LOG_STAGES.import);
      importStatus = pollResult.importStatus;
      entitiesAll = pollResult.entitiesAll?.length ? pollResult.entitiesAll : entitiesAll;
    } catch (e) {
      logger.failSpinner('✖ Bulk import did not complete');
      logger.resetSpinner();

      if (e?.code === 'POLLING_TIMEOUT') {
        const historyUrl = buildGroupImportHistoryUrl(destUrl);

        logger.print();
        logger.error('The CLI has stopped polling for the GitLab bulk import.', LOG_STAGES.import);
        logger.error('The migration itself may still be running inside GitLab — the CLI only waits for a limited time.', LOG_STAGES.import);
        logger.error(`Last reported status for bulk import ${bulkImport.id}: ${e.importStatus}`, LOG_STAGES.import);

        logger.print();
        if (historyUrl) {
          logger.info('You can continue monitoring this migration in the GitLab UI:', LOG_STAGES.import);
          logger.info(`Group import history: ${historyUrl}`, LOG_STAGES.import);
        } else {
          logger.info('You can continue monitoring this migration from the Group import history page in the GitLab UI.', LOG_STAGES.import);
        }
        process.exit(0);
      }

      throw e;
    }

    const summary = summarizeBulkImportProgress(entitiesAll);

    if (importStatus === 'finished' && summary.entityFinished > 0) {
      const newGroupUrl = buildGroupUrl(destUrl, `/groups/${destinationGroupPath}`);

      logger.print();
      logger.success('✔ Project group copy completed successfully.', LOG_STAGES.import);
      logger.info('Summary:', LOG_STAGES.import);
      logger.info(`${sourceProjects.length} projects copied successfully`, LOG_STAGES.import);
      logger.info(`${summary.entityFinished} entities copied successfully`, LOG_STAGES.import);
      logger.info(`${summary.entityFailed} entities failed to copy`, LOG_STAGES.import);
      if (newGroupUrl) logger.info(`New group URL: ${newGroupUrl}`, LOG_STAGES.import);

      const getGroupPlaceholderCsvData = await destination.getGroupPlaceholderCsv(destinationGroupPath);
      const groupPlaceholders = Papa.parse(getGroupPlaceholderCsvData, { header: true, skipEmptyLines: true }).data;
      console.log(JSON.stringify(groupPlaceholders));

      for (let i = 0; i < groupPlaceholders.length; i++) {
        console.log(JSON.stringify(groupPlaceholders[i]));
        const { username: destinationUsername } = await destination.syncUser({
          sourceRegion: options.sourceRegion,
          destRegion: options.destRegion,
          groupId: destinationGroupPath,
          userId: groupPlaceholders[i]['Source user identifier'],
        });
        console.log(destinationUsername);
        groupPlaceholders[i]['GitLab username'] = destinationUsername;
      }

      const csvForm = Papa.unparse(groupPlaceholders);
      fs.writeFileSync('groupPlaceholders.csv', csvForm, 'utf8');
      const csvConfig = {
        file : fs.createReadStream('groupPlaceholders.csv')
      };

      const reassignGroupPlaceholderData = await destination.reassignGroupPlaceholder(destinationGroupPath, csvConfig);
      console.log(reassignGroupPlaceholderData);

      // show failed list only in verbose (or if failures exist)
      if (summary.entityFailed > 0) {
        logger.print();
        logger.warn('Failed entities:', LOG_STAGES.import);
        entitiesAll.filter(e => e.status === 'failed').forEach(e => {
          logger.print(`- ${e.source_type}: ${e.source_full_path} (${e.status})`);
        });
      }
      return 0;
    } else {
      logger.print();
      logger.error('✖ Bulk import failed!', LOG_STAGES.import);
      throw new Error('GitLab bulk import failed');
    }

  } catch (error) {
    logger.error(`Project group copy failed: ${error.message}`, LOG_STAGES.import);
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
  .option('-v, --verbose', 'Enable verbose output (debug logs + wait details)')
  .showHelpAfterError()
  .hook('preAction', cmd => cmd.showHelpAfterError(false)) // only show help during validation
  .action(async (options) => {
    logger.setVerbosity(options.verbose ? 2 : 1);
    await directTransfer(options);
  });

export default command;