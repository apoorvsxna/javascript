import fs from 'fs';
import path from 'path';
import { XMLParser } from 'fast-xml-parser';
import sax from 'sax';

const STREAMING_THRESHOLD = 100 * 1024 * 1024; 

const JOB_STATUSES = ['success', 'failed', 'running', 'waiting', 'idle'];

const getRandomStatus = () => {
  return JOB_STATUSES[Math.floor(Math.random() * JOB_STATUSES.length)];
};

export const parseControlMXml = async (filePath) => {
  try {
    console.log(`[XML Parser] Starting to parse: ${filePath}`);
    const startTime = Date.now();

    const stats = await fs.promises.stat(filePath);
    const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
    console.log(`[XML Parser] File size: ${fileSizeMB}MB`);

    let jobs;

    if (stats.size >= STREAMING_THRESHOLD) {
      console.log(`[XML Parser] Using streaming parser (file >= 100MB)`);
      jobs = await parseControlMXmlStreaming(filePath);
    } else {
      console.log(`[XML Parser] Using fast parser (file < 100MB)`);
      jobs = await parseControlMXmlFast(filePath);
    }

    const endTime = Date.now();
    console.log(`[XML Parser] Parsed ${jobs.length} jobs in ${endTime - startTime}ms`);

    return jobs;
  } catch (error) {
    console.error('[XML Parser] Error parsing XML:', error);
    throw new Error(`Failed to parse XML file: ${error.message}`);
  }
};

const parseControlMXmlFast = async (filePath) => {

  const xmlData = await fs.promises.readFile(filePath, 'utf8');

  const parserOptions = {
    ignoreAttributes: false,
    attributeNamePrefix: '',
    allowBooleanAttributes: true,
    parseAttributeValue: false, 
    trimValues: true,
    ignoreDeclaration: true,
    ignorePiTags: true,
  };

  const parser = new XMLParser(parserOptions);
  const result = parser.parse(xmlData);

  return extractJobsFromParsedXml(result);
};

const parseControlMXmlStreaming = (filePath) => {
  return new Promise((resolve, reject) => {
    const jobs = [];
    const saxStream = sax.createStream(true, { trim: true, normalize: true });

    let currentJob = null;
    let currentFolder = null;
    let currentElement = null;
    let folderCount = 0;

    saxStream.on('opentag', (node) => {
      const tagName = node.name;

      if (tagName === 'SMART_FOLDER') {
        folderCount++;
        currentFolder = node.attributes.FOLDER_NAME || 
                       node.attributes.JOBNAME || 
                       `Folder_${folderCount}`;
      }

      if (tagName === 'JOB') {

        currentJob = {
          jobname: node.attributes.JOBNAME || node.attributes.MEMNAME,
          folderName: currentFolder,
          inconds: [],
          outconds: [],
          status: getRandomStatus(),

          application: node.attributes.APPLICATION || 'N/A',
          subApplication: node.attributes.SUB_APPLICATION || 'N/A',
          smartFolder: currentFolder,

          metadata: {
            tasktype: node.attributes.TASKTYPE,
            description: node.attributes.DESCRIPTION,
            parentFolder: node.attributes.PARENT_FOLDER,
            runAs: node.attributes.RUN_AS,
            platform: node.attributes.PLATFORM,
            createdBy: node.attributes.CREATED_BY,
          }
        };
      }

      if (tagName === 'INCOND' && currentJob) {
        const condName = node.attributes.NAME;
        if (condName) {
          currentJob.inconds.push(condName);
        }
      }

      if (tagName === 'OUTCOND' && currentJob) {
        const condName = node.attributes.NAME;
        const sign = node.attributes.SIGN;

        if (condName && sign === '+') {
          currentJob.outconds.push(condName);
        }
      }
    });

    saxStream.on('closetag', (tagName) => {
      if (tagName === 'JOB' && currentJob) {

        if (currentJob.jobname) {
          jobs.push(currentJob);
        }
        currentJob = null;
      }

      if (tagName === 'SMART_FOLDER') {
        if (jobs.length > 0 && jobs.length % 100 === 0) {
          console.log(`[XML Parser] Streaming: Processed ${jobs.length} jobs...`);
        }
      }
    });

    saxStream.on('error', (error) => {
      console.error('[XML Parser] Streaming error:', error);
      reject(error);
    });

    saxStream.on('end', () => {
      console.log(`[XML Parser] Streaming complete: ${jobs.length} jobs extracted`);
      resolve(jobs);
    });

    const fileStream = fs.createReadStream(filePath, { encoding: 'utf8' });
    fileStream.pipe(saxStream);

    fileStream.on('error', (error) => {
      reject(error);
    });
  });
};

const extractJobsFromParsedXml = (parsedXml) => {
  const jobs = [];

  const deftable = parsedXml.DEFTABLE;
  if (!deftable) {
    console.warn('[XML Parser] No DEFTABLE found in XML');
    return jobs;
  }

  const folders = Array.isArray(deftable.SMART_FOLDER) 
    ? deftable.SMART_FOLDER 
    : [deftable.SMART_FOLDER].filter(Boolean);

  console.log(`[XML Parser] Found ${folders.length} folders`);

  folders.forEach((folder, folderIndex) => {
    const folderName = folder.FOLDER_NAME || folder.JOBNAME || `Folder_${folderIndex}`;

    const folderJobs = folder.JOB 
      ? (Array.isArray(folder.JOB) ? folder.JOB : [folder.JOB])
      : [];

    console.log(`[XML Parser] Folder "${folderName}" has ${folderJobs.length} jobs`);

    folderJobs.forEach((job) => {
      const jobData = extractJobData(job, folderName);
      if (jobData) {
        jobs.push(jobData);
      }
    });
  });

  return jobs;
};

const extractJobData = (job, folderName) => {

  const jobname = job.JOBNAME || job.MEMNAME;

  if (!jobname) {
    console.warn(`[XML Parser] Job without JOBNAME or MEMNAME found in folder "${folderName}"`);
    return null;
  }

  const incondElements = job.INCOND 
    ? (Array.isArray(job.INCOND) ? job.INCOND : [job.INCOND])
    : [];

  const outcondElements = job.OUTCOND 
    ? (Array.isArray(job.OUTCOND) ? job.OUTCOND : [job.OUTCOND])
    : [];

  const inconds = incondElements
    .map(incond => incond.NAME)
    .filter(Boolean);

  const outconds = outcondElements
    .filter(outcond => outcond.SIGN === '+') 
    .map(outcond => outcond.NAME)
    .filter(Boolean);

  return {
    jobname,
    folderName,
    inconds,  
    outconds, 
    status: getRandomStatus(), 

    application: job.APPLICATION || 'N/A',
    subApplication: job.SUB_APPLICATION || 'N/A',
    smartFolder: folderName,

    metadata: {
      tasktype: job.TASKTYPE,
      description: job.DESCRIPTION,
      parentFolder: job.PARENT_FOLDER,
      runAs: job.RUN_AS,
      platform: job.PLATFORM,
      createdBy: job.CREATED_BY,
    }
  };
};

const extractJobNamesFromCondition = (conditionName) => {

  const segments = conditionName.split('-');

  const formatKeywords = new Set(['TO', 'ENDED', 'OK', 'COMPLETE', 'START', 'STOP', 'FINISH']);

  return segments.filter(segment => {

    if (!segment || segment.trim() === '') return false;

    if (formatKeywords.has(segment.toUpperCase())) return false;

    return /^[A-Z0-9_#]+$/i.test(segment);
  });
};

const findMatchingJobNames = (segments, allJobNames) => {
  const matches = [];

  for (const segment of segments) {

    if (allJobNames.has(segment)) {
      matches.push(segment);
      continue;
    }

  }

  return matches;
};

export const resolveJobDependencies = (jobs) => {
  console.log(`[XML Parser] ========================================`);
  console.log(`[XML Parser] TWO-PASS DEPENDENCY RESOLUTION STARTING`);
  console.log(`[XML Parser] Processing ${jobs.length} jobs`);
  console.log(`[XML Parser] ========================================`);
  const startTime = Date.now();

  console.log(`[XML Parser] PASS 1: Building condition producers map...`);
  const conditionProducers = new Map(); 

  jobs.forEach(job => {
    job.outconds.forEach(condName => {

      if (!conditionProducers.has(condName)) {
        conditionProducers.set(condName, []);
      }

      conditionProducers.get(condName).push(job.jobname);
    });
  });

  console.log(`[XML Parser] PASS 1 Complete: Found ${conditionProducers.size} unique conditions with producers`);

  console.log(`[XML Parser] PASS 2: Building job predecessors map...`);
  const jobPredecessors = new Map(); 
  let externalDependencyCount = 0;
  const externalDeps = []; 

  jobs.forEach(job => {
    const predecessors = [];

    job.inconds.forEach(condName => {

      const producers = conditionProducers.get(condName);

      if (producers && producers.length > 0) {

        producers.forEach(producerJob => {

          if (producerJob !== job.jobname) {
            predecessors.push(producerJob);
          }
        });
      } else {

        externalDependencyCount++;
        externalDeps.push({ job: job.jobname, condition: condName });
        console.warn(`[XML Parser] WARNING: Job "${job.jobname}" has unresolved dependency on condition "${condName}". Source not found in this XML.`);
        predecessors.push('EXTERNAL_DEPENDENCY');
      }
    });

    jobPredecessors.set(job.jobname, [...new Set(predecessors)]);
  });

  console.log(`[XML Parser] PASS 2 Complete: Mapped predecessors for ${jobPredecessors.size} jobs`);
  if (externalDependencyCount > 0) {
    console.log(`[XML Parser] WARNING: Found ${externalDependencyCount} external dependencies (conditions with no producer in this XML)`);
  }

  console.log(`[XML Parser] PASS 3: Building job successors map (inverse of predecessors)...`);
  const jobSuccessors = new Map(); 

  jobs.forEach(job => {
    jobSuccessors.set(job.jobname, []);
  });

  jobPredecessors.forEach((predecessors, jobName) => {
    predecessors.forEach(predecessorJob => {

      if (predecessorJob === 'EXTERNAL_DEPENDENCY') {
        return;
      }

      if (!jobSuccessors.has(predecessorJob)) {
        jobSuccessors.set(predecessorJob, []);
      }

      jobSuccessors.get(predecessorJob).push(jobName);
    });
  });

  console.log(`[XML Parser] PASS 3 Complete: Mapped successors for ${jobSuccessors.size} jobs`);

  console.log(`[XML Parser] Building final output structure...`);
  const resolvedJobs = jobs.map(job => {
    return {
      jobname: job.jobname,
      inconds: jobPredecessors.get(job.jobname) || [], 
      outconds: jobSuccessors.get(job.jobname) || [],  
      status: job.status,

      application: job.application,
      subApplication: job.subApplication,
      smartFolder: job.smartFolder,
      metadata: job.metadata,
    };
  });

  const endTime = Date.now();
  const duration = ((endTime - startTime) / 1000).toFixed(2);

  console.log(`[XML Parser] ========================================`);
  console.log(`[XML Parser] DEPENDENCY RESOLUTION COMPLETE`);
  console.log(`[XML Parser] Total time: ${duration}s`);
  console.log(`[XML Parser] Jobs processed: ${resolvedJobs.length}`);
  console.log(`[XML Parser] Unique conditions: ${conditionProducers.size}`);
  console.log(`[XML Parser] External dependencies: ${externalDependencyCount}`);
  console.log(`[XML Parser] ========================================`);

  console.log(`[XML Parser] Checking for circular dependencies...`);
  const circularDeps = detectCircularDependencies(resolvedJobs);
  if (circularDeps.length > 0) {
    console.warn(`[XML Parser] WARNING: Found ${circularDeps.length} circular dependency chains:`);
    circularDeps.slice(0, 5).forEach(chain => {
      console.warn(`[XML Parser]   - ${chain.join(' -> ')}`);
    });
    if (circularDeps.length > 5) {
      console.warn(`[XML Parser]   ... and ${circularDeps.length - 5} more`);
    }
  } else {
    console.log(`[XML Parser] No circular dependencies detected`);
  }

  return resolvedJobs;
};

const detectCircularDependencies = (jobs) => {
  const circularChains = [];
  const visited = new Set();
  const recursionStack = new Set();

  const adjacency = new Map();
  jobs.forEach(job => {
    adjacency.set(job.jobname, job.outconds || []);
  });

  const dfs = (jobName, path = []) => {
    if (recursionStack.has(jobName)) {

      const cycleStart = path.indexOf(jobName);
      if (cycleStart >= 0) {
        const cycle = [...path.slice(cycleStart), jobName];
        circularChains.push(cycle);
      }
      return;
    }

    if (visited.has(jobName)) {
      return;
    }

    visited.add(jobName);
    recursionStack.add(jobName);
    path.push(jobName);

    const children = adjacency.get(jobName) || [];
    for (const child of children) {
      dfs(child, [...path]);
    }

    recursionStack.delete(jobName);
  };

  jobs.forEach(job => {
    if (!visited.has(job.jobname)) {
      dfs(job.jobname);
    }
  });

  return circularChains;
};

export const parseAndResolveControlMXml = async (filePath) => {
  const jobs = await parseControlMXml(filePath);
  const resolvedJobs = resolveJobDependencies(jobs);
  return resolvedJobs;
};

export const getDefaultXmlFilePath = () => {
  return path.join(process.cwd(), 'src', 'data', 'real-format.xml');
};















import { getJobsData } from '../models/jobModel.js';

export const getAllJobsWithLayout = async (direction = 'TB') => {
  try {
    console.log(`[Job Service] Getting all jobs with layout (direction: ${direction})`);
    const jobsData = await getJobsData();
    console.log(`[Job Service] Retrieved ${jobsData.length} jobs from data source`);

    const { nodes, edges } = transformJobsToFlowData(jobsData);
    console.log(`[Job Service] Transformed to ${nodes.length} nodes and ${edges.length} edges`);

    const layoutedNodes = getLayoutedElements(nodes, edges, direction);
    console.log(`[Job Service] Layout complete, returning ${layoutedNodes.length} nodes`);

    return {
      nodes: layoutedNodes,
      edges,
      totalJobs: jobsData.length
    };
  } catch (error) {
    console.error('[Job Service] Error in getAllJobsWithLayout:', error);
    throw error;
  }
};

export const searchJobs = async (query, direction = 'TB') => {
  const jobsData = await getJobsData();
  const { nodes, edges } = transformJobsToFlowData(jobsData);

  const queryLower = query.toLowerCase();
  const filteredNodes = nodes.filter((node) =>
    node.data.label.toLowerCase().includes(queryLower)
  );

  const filteredNodeIds = new Set(filteredNodes.map((n) => n.id));
  const filteredEdges = edges.filter(
    (edge) => filteredNodeIds.has(edge.source) && filteredNodeIds.has(edge.target)
  );

  const layoutedNodes = getLayoutedElements(filteredNodes, filteredEdges, direction);

  return {
    nodes: layoutedNodes,
    edges: filteredEdges,
    totalJobs: jobsData.length,
    matchedJobs: filteredNodes.length
  };
};

export const filterJobsByStatus = async (statusFilters, direction = 'TB') => {
  const jobsData = await getJobsData();
  const { nodes, edges } = transformJobsToFlowData(jobsData);

  const statusSet = new Set(statusFilters);
  const filteredNodes = nodes.filter((node) => statusSet.has(node.data.status));

  const filteredNodeIds = new Set(filteredNodes.map((n) => n.id));
  const filteredEdges = edges.filter(
    (edge) => filteredNodeIds.has(edge.source) && filteredNodeIds.has(edge.target)
  );

  const layoutedNodes = getLayoutedElements(filteredNodes, filteredEdges, direction);

  return {
    nodes: layoutedNodes,
    edges: filteredEdges,
    totalJobs: jobsData.length,
    filteredJobs: filteredNodes.length
  };
};

export const filterJobsAdvanced = async (filters, direction = 'TB') => {
  const jobsData = await getJobsData();
  const { nodes, edges } = transformJobsToFlowData(jobsData);

  let filteredNodes = nodes;

  if (filters.status && filters.status.length > 0) {
    const statusSet = new Set(filters.status);
    filteredNodes = filteredNodes.filter((node) => statusSet.has(node.data.status));
  }

  if (filters.application && filters.application.length > 0) {
    const applicationSet = new Set(filters.application);
    filteredNodes = filteredNodes.filter((node) => applicationSet.has(node.data.application));
  }

  if (filters.subApplication && filters.subApplication.length > 0) {
    const subApplicationSet = new Set(filters.subApplication);
    filteredNodes = filteredNodes.filter((node) => subApplicationSet.has(node.data.subApplication));
  }

  if (filters.smartFolder && filters.smartFolder.length > 0) {
    const smartFolderSet = new Set(filters.smartFolder);
    filteredNodes = filteredNodes.filter((node) => smartFolderSet.has(node.data.smartFolder));
  }

  const filteredNodeIds = new Set(filteredNodes.map((n) => n.id));
  const filteredEdges = edges.filter(
    (edge) => filteredNodeIds.has(edge.source) && filteredNodeIds.has(edge.target)
  );

  const layoutedNodes = getLayoutedElements(filteredNodes, filteredEdges, direction);

  return {
    nodes: layoutedNodes,
    edges: filteredEdges,
    totalJobs: jobsData.length,
    filteredJobs: filteredNodes.length
  };
};

export const getFilterOptions = async () => {
  const jobsData = await getJobsData();

  const applications = new Set();
  const subApplications = new Set();
  const smartFolders = new Set();

  jobsData.forEach(job => {
    if (job.application) applications.add(job.application);
    if (job.subApplication) subApplications.add(job.subApplication);
    if (job.smartFolder) smartFolders.add(job.smartFolder);
  });

  return {
    applications: Array.from(applications).sort(),
    subApplications: Array.from(subApplications).sort(),
    smartFolders: Array.from(smartFolders).sort(),
  };
};

export const getJobStatistics = async () => {
  const jobsData = await getJobsData();

  const stats = {
    totalJobs: jobsData.length,
    rootJobs: 0,
    leafJobs: 0,
    statusBreakdown: {
      success: 0,
      failed: 0,
      running: 0,
      waiting: 0,
      idle: 0,
    },
    successRate: 0,
  };

  jobsData.forEach((job) => {
    if (!job.inconds || job.inconds.length === 0) {
      stats.rootJobs++;
    }
    if (!job.outconds || job.outconds.length === 0) {
      stats.leafJobs++;
    }

    const status = job.status || 'idle';
    if (stats.statusBreakdown.hasOwnProperty(status)) {
      stats.statusBreakdown[status]++;
    }
  });

  const completed = stats.statusBreakdown.success + stats.statusBreakdown.failed;
  if (completed > 0) {
    stats.successRate = Math.round((stats.statusBreakdown.success / completed) * 100);
  }

  return stats;
};

export const highlightDependencies = async (selectedJobId, nodes, edges) => {
  if (!selectedJobId) {
    return {
      nodes: nodes.map(node => ({
        ...node,
        data: { ...node.data, isHighlighted: false, isDimmed: false },
      })),
      edges: edges.map(edge => ({
        ...edge,
        style: { ...edge.style, stroke: '#AEAEB2', strokeWidth: 2 },
        animated: false,
        data: { ...edge.data, isHighlighted: false },
      })),
    };
  }

  const upstream = getUpstreamDependencies(selectedJobId, nodes);
  const downstream = getDownstreamDependencies(selectedJobId, nodes);
  const allRelated = new Set([...upstream, ...downstream]);

  const highlightedNodes = nodes.map(node => ({
    ...node,
    data: {
      ...node.data,
      isHighlighted: allRelated.has(node.id),
      isDimmed: !allRelated.has(node.id),
    },
  }));

  const highlightedEdges = edges.map(edge => {
    const isHighlighted = allRelated.has(edge.source) && allRelated.has(edge.target);
    return {
      ...edge,
      style: {
        ...edge.style,
        stroke: isHighlighted ? '#E0001B' : '#AEAEB2',
        strokeWidth: isHighlighted ? 3 : 2,
      },
      animated: isHighlighted,
      data: { ...edge.data, isHighlighted },
    };
  });

  return { nodes: highlightedNodes, edges: highlightedEdges };
};

const transformJobsToFlowData = (jobsData) => {
  console.log(`[Job Service] Transforming ${jobsData.length} jobs to flow data...`);
  const startTime = Date.now();

  const nodes = [];
  const edges = [];
  const edgeSet = new Set();

  jobsData.forEach((job, index) => {

    if (index > 0 && index % 10000 === 0) {
      console.log(`[Job Service] Transform progress: ${index}/${jobsData.length} jobs processed`);
    }

    nodes.push({
      id: job.jobname,
      type: 'jobNode',
      data: {
        label: job.jobname,
        inconds: job.inconds || [],
        outconds: job.outconds || [],
        status: job.status || 'idle',

        application: job.application || 'N/A',
        subApplication: job.subApplication || 'N/A',
        smartFolder: job.smartFolder || 'N/A',

        metadata: job.metadata || {},
        isHighlighted: false,
        isDimmed: false,
      },
      position: { x: 0, y: 0 },
    });

    if (job.outconds && job.outconds.length > 0) {
      job.outconds.forEach((outcond) => {
        const edgeId = `${job.jobname}-${outcond}`;
        if (!edgeSet.has(edgeId)) {
          edges.push({
            id: edgeId,
            source: job.jobname,
            target: outcond,
            type: 'slantedstep',
            animated: false,
            style: { stroke: '#AEAEB2', strokeWidth: 2 },
            data: { isHighlighted: false },
          });
          edgeSet.add(edgeId);
        }
      });
    }
  });

  const endTime = Date.now();
  console.log(`[Job Service] Transform completed in ${endTime - startTime}ms: ${nodes.length} nodes, ${edges.length} edges`);

  return { nodes, edges };
};

export const getLayoutedElements = (nodes, edges, direction = 'TB') => {
  console.log(`\n========================================`);
  console.log(`LAYOUT ENGINE STARTING`);
  console.log(`Input: ${nodes.length} nodes, ${edges.length} edges`);
  console.log(`========================================\n`);

  const startTime = Date.now();

  const config = {
    nodeWidth: 200,
    nodeHeight: 80,
    horizontalSpacing: 100,  
    verticalSpacing: 250,     
    optimizationPasses: nodes.length > 5000 ? 1 : 2, 
  };

  console.log(`[Step 1/4] Building graph structure...`);
  const graph = buildGraphStructure(nodes, edges);
  console.log(`  - Root nodes: ${graph.roots.length}`);
  console.log(`  - Leaf nodes: ${graph.leaves.length}`);
  console.log(`  - Connected nodes: ${nodes.length - graph.isolatedNodes.length}`);
  console.log(`  - Isolated nodes: ${graph.isolatedNodes.length}`);

  console.log(`\n[Step 2/4] Assigning levels using topological sort...`);
  const levelAssignments = assignLevelsTopological(nodes, graph);
  const maxLevel = Math.max(...Array.from(levelAssignments.values()));
  console.log(`  - Levels assigned: 0 to ${maxLevel} (${maxLevel + 1} levels total)`);

  const levelCounts = new Map();
  levelAssignments.forEach(level => {
    levelCounts.set(level, (levelCounts.get(level) || 0) + 1);
  });
  const distribution = Array.from(levelCounts.entries())
    .sort((a, b) => a[0] - b[0])
    .slice(0, 10)
    .map(([lvl, cnt]) => `L${lvl}:${cnt}`)
    .join(', ');
  console.log(`  - Distribution (first 10 levels): ${distribution}`);

  console.log(`\n[Step 3/4] Optimizing node ordering to minimize edge crossings...`);
  const orderedNodesByLevel = optimizeNodeOrdering(
    nodes,
    levelAssignments,
    graph,
    config.optimizationPasses
  );
  console.log(`  - Optimization complete (${config.optimizationPasses} passes)`);

  console.log(`\n[Step 4/4] Calculating final node positions...`);
  const layoutedNodes = positionNodes(
    orderedNodesByLevel,
    levelAssignments,
    config
  );

  const endTime = Date.now();
  const duration = ((endTime - startTime) / 1000).toFixed(2);

  console.log(`\n========================================`);
  console.log(`LAYOUT ENGINE COMPLETE`);
  console.log(`Duration: ${duration}s`);
  console.log(`Output: ${layoutedNodes.length} positioned nodes`);
  console.log(`========================================\n`);

  return layoutedNodes;
};

function buildGraphStructure(nodes, edges) {
  const children = new Map(); 
  const parents = new Map();  

  nodes.forEach(node => {
    children.set(node.id, []);
    parents.set(node.id, []);
  });

  edges.forEach(edge => {
    const sourceChildren = children.get(edge.source);
    const targetParents = parents.get(edge.target);

    if (sourceChildren) sourceChildren.push(edge.target);
    if (targetParents) targetParents.push(edge.source);
  });

  const roots = [];
  const leaves = [];
  const isolatedNodes = [];

  nodes.forEach(node => {
    const nodeParents = parents.get(node.id) || [];
    const nodeChildren = children.get(node.id) || [];

    if (nodeParents.length === 0 && nodeChildren.length === 0) {
      isolatedNodes.push(node.id);
    } else if (nodeParents.length === 0) {
      roots.push(node.id);
    } else if (nodeChildren.length === 0) {
      leaves.push(node.id);
    }
  });

  return { children, parents, roots, leaves, isolatedNodes };
}

function assignLevelsTopological(nodes, graph) {
  const levels = new Map();
  const visited = new Set();
  const queue = [];

  graph.roots.forEach(rootId => {
    levels.set(rootId, 0);
    visited.add(rootId);
    queue.push(rootId);
  });

  graph.isolatedNodes.forEach(nodeId => {
    levels.set(nodeId, 0);
    visited.add(nodeId);
  });

  while (queue.length > 0) {
    const nodeId = queue.shift();
    const currentLevel = levels.get(nodeId);
    const children = graph.children.get(nodeId) || [];

    children.forEach(childId => {
      const newLevel = currentLevel + 1;

      if (!visited.has(childId)) {

        levels.set(childId, newLevel);
        visited.add(childId);
        queue.push(childId);
      } else {

        const existingLevel = levels.get(childId) || 0;
        if (newLevel > existingLevel) {
          levels.set(childId, newLevel);

          if (!queue.includes(childId)) {
            queue.push(childId);
          }
        }
      }
    });
  }

  nodes.forEach(node => {
    if (!levels.has(node.id)) {
      console.warn(`  WARNING: Node "${node.id}" not reached during level assignment, placing at level 0`);
      levels.set(node.id, 0);
    }
  });

  return levels;
}

function optimizeNodeOrdering(nodes, levelAssignments, graph, passes) {

  const nodesByLevel = new Map();
  nodes.forEach(node => {
    const level = levelAssignments.get(node.id);
    if (!nodesByLevel.has(level)) {
      nodesByLevel.set(level, []);
    }
    nodesByLevel.get(level).push(node);
  });

  const sortedLevels = Array.from(nodesByLevel.keys()).sort((a, b) => a - b);

  for (let pass = 0; pass < passes; pass++) {

    for (let i = 1; i < sortedLevels.length; i++) {
      const level = sortedLevels[i];
      const nodesAtLevel = nodesByLevel.get(level);
      const prevLevel = sortedLevels[i - 1];
      const prevNodes = nodesByLevel.get(prevLevel);

      const prevPositions = new Map();
      prevNodes.forEach((node, idx) => prevPositions.set(node.id, idx));

      nodesAtLevel.forEach(node => {
        const nodeParents = graph.parents.get(node.id) || [];
        const parentPositions = nodeParents
          .map(pid => prevPositions.get(pid))
          .filter(pos => pos !== undefined);

        if (parentPositions.length > 0) {
          const sum = parentPositions.reduce((a, b) => a + b, 0);
          node._barycenter = sum / parentPositions.length;
        } else {
          node._barycenter = nodesAtLevel.length; 
        }
      });

      nodesAtLevel.sort((a, b) => {
        if (a._barycenter === b._barycenter) {
          return a.id.localeCompare(b.id);
        }
        return a._barycenter - b._barycenter;
      });
    }

    for (let i = sortedLevels.length - 2; i >= 0; i--) {
      const level = sortedLevels[i];
      const nodesAtLevel = nodesByLevel.get(level);
      const nextLevel = sortedLevels[i + 1];
      const nextNodes = nodesByLevel.get(nextLevel);

      const nextPositions = new Map();
      nextNodes.forEach((node, idx) => nextPositions.set(node.id, idx));

      nodesAtLevel.forEach(node => {
        const nodeChildren = graph.children.get(node.id) || [];
        const childPositions = nodeChildren
          .map(cid => nextPositions.get(cid))
          .filter(pos => pos !== undefined);

        if (childPositions.length > 0) {
          const sum = childPositions.reduce((a, b) => a + b, 0);
          node._barycenter = sum / childPositions.length;
        } else {
          node._barycenter = nodesAtLevel.length;
        }
      });

      nodesAtLevel.sort((a, b) => {
        if (a._barycenter === b._barycenter) {
          return a.id.localeCompare(b.id);
        }
        return a._barycenter - b._barycenter;
      });
    }
  }

  return nodesByLevel;
}

function positionNodes(nodesByLevel, levelAssignments, config) {
  const layoutedNodes = [];
  const sortedLevels = Array.from(nodesByLevel.keys()).sort((a, b) => a - b);

  sortedLevels.forEach(level => {
    const nodesAtLevel = nodesByLevel.get(level);
    const levelWidth = nodesAtLevel.length * config.nodeWidth + 
                       (nodesAtLevel.length - 1) * config.horizontalSpacing;
    const startX = -levelWidth / 2; 

    nodesAtLevel.forEach((node, index) => {
      const x = startX + index * (config.nodeWidth + config.horizontalSpacing) + config.nodeWidth / 2;
      const y = level * (config.nodeHeight + config.verticalSpacing);

      delete node._barycenter;

      layoutedNodes.push({
        ...node,
        position: { x, y }
      });
    });
  });

  return layoutedNodes;
}

const getUpstreamDependencies = (jobId, nodes, visited = new Set()) => {
  if (visited.has(jobId)) return visited;

  visited.add(jobId);
  const node = nodes.find(n => n.id === jobId);

  if (node && node.data.inconds) {
    node.data.inconds.forEach(parentId => {
      getUpstreamDependencies(parentId, nodes, visited);
    });
  }

  return visited;
};

const getDownstreamDependencies = (jobId, nodes, visited = new Set()) => {
  if (visited.has(jobId)) return visited;

  visited.add(jobId);
  const node = nodes.find(n => n.id === jobId);

  if (node && node.data.outconds) {
    node.data.outconds.forEach(childId => {
      getDownstreamDependencies(childId, nodes, visited);
    });
  }

  return visited;
};
