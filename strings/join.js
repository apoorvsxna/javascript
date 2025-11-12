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
  const nodes = [];
  const edges = [];
  const edgeSet = new Set();

  jobsData.forEach((job) => {
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
            type: 'straight',
            animated: false,
            style: { stroke: '#AEAEB2', strokeWidth: 2 },
            data: { isHighlighted: false },
          });
          edgeSet.add(edgeId);
        }
      });
    }
  });

  return { nodes, edges };
};

export const getLayoutedElements = (nodes, edges, direction = 'TB') => {
  console.log(`[Job Service] Starting layout for ${nodes.length} nodes and ${edges.length} edges`);
  const startTime = Date.now();

  const nodeWidth = 200;
  const nodeHeight = 80;
  const horizontalSpacing = 80; 
  const verticalSpacing = 120;  

  const childrenMap = new Map();
  const parentsMap = new Map();

  edges.forEach(edge => {
    if (!childrenMap.has(edge.source)) {
      childrenMap.set(edge.source, []);
    }
    childrenMap.get(edge.source).push(edge.target);

    if (!parentsMap.has(edge.target)) {
      parentsMap.set(edge.target, []);
    }
    parentsMap.get(edge.target).push(edge.source);
  });

  const rootNodes = nodes.filter(node => !parentsMap.has(node.id));
  console.log(`[Job Service] Found ${rootNodes.length} root nodes`);

  const levels = new Map();
  const visited = new Set();
  const queue = [];
  const MAX_ITERATIONS = nodes.length * 10; 
  let iterations = 0;

  rootNodes.forEach(node => {
    levels.set(node.id, 0);
    visited.add(node.id);
    queue.push(node.id);
  });

  let lastLogTime = Date.now();
  const LOG_INTERVAL = 2000; 

  while (queue.length > 0 && iterations < MAX_ITERATIONS) {
    iterations++;
    const nodeId = queue.shift();
    const currentLevel = levels.get(nodeId);
    const children = childrenMap.get(nodeId) || [];

    children.forEach(childId => {
      if (!visited.has(childId)) {
        visited.add(childId);
        levels.set(childId, currentLevel + 1);
        queue.push(childId);
      } else {

        const existingLevel = levels.get(childId);
        if (currentLevel + 1 > existingLevel) {
          levels.set(childId, currentLevel + 1);
          queue.push(childId); 
        }
      }
    });

    const now = Date.now();
    if (now - lastLogTime > LOG_INTERVAL) {
      const progress = ((iterations / MAX_ITERATIONS) * 100).toFixed(1);
      console.log(`[Job Service] BFS Progress: ${iterations}/${MAX_ITERATIONS} iterations (${progress}%), ${visited.size}/${nodes.length} nodes visited, queue: ${queue.length}`);
      lastLogTime = now;
    }
  }

  if (iterations >= MAX_ITERATIONS) {
    console.warn(`[Job Service] Layout BFS hit iteration limit (${MAX_ITERATIONS}). Possible circular dependencies.`);
  }

  console.log(`[Job Service] BFS completed: ${iterations} iterations, ${visited.size} nodes visited`);

  console.log(`[Job Service] Handling orphan nodes...`);
  let orphanCount = 0;
  nodes.forEach(node => {
    if (!levels.has(node.id)) {
      levels.set(node.id, 0);
      orphanCount++;
    }
  });
  if (orphanCount > 0) {
    console.log(`[Job Service] Found ${orphanCount} orphan nodes, placed at level 0`);
  }

  console.log(`[Job Service] Analyzing level distribution...`);
  const levelValues = Array.from(levels.values());
  const maxLevel = Math.max(...levelValues);
  const minLevel = Math.min(...levelValues);

  const sortedLevelValues = [...levelValues].sort((a, b) => a - b);
  const p95Index = Math.floor(sortedLevelValues.length * 0.95); 
  const p95Level = sortedLevelValues[p95Index];

  console.log(`[Job Service] Level stats: min=${minLevel}, max=${maxLevel}, 95th percentile=${p95Level}`);

  const hasOutliers = maxLevel > p95Level * 2;

  if (hasOutliers) {
    console.warn(`[Job Service] Detected outlier levels (max=${maxLevel} vs p95=${p95Level}), normalizing...`);

    const compressionThreshold = Math.ceil(p95Level * 1.1); 
    const maxReasonableLevel = compressionThreshold + 10; 

    console.log(`[Job Service] Compression threshold: ${compressionThreshold}, target max: ${maxReasonableLevel}`);

    let compressedCount = 0;
    nodes.forEach(node => {
      const currentLevel = levels.get(node.id);

      if (currentLevel <= compressionThreshold) {

      } else {

        const outlierRange = maxLevel - compressionThreshold;
        const targetRange = maxReasonableLevel - compressionThreshold;

        if (outlierRange > 0 && targetRange > 0) {
          const relativePosition = (currentLevel - compressionThreshold) / outlierRange;
          const compressedLevel = compressionThreshold + Math.ceil(relativePosition * targetRange);
          levels.set(node.id, compressedLevel);
          compressedCount++;
        } else {

          levels.set(node.id, compressionThreshold);
          compressedCount++;
        }
      }
    });

    console.log(`[Job Service] Compressed ${compressedCount} outlier jobs into range [${compressionThreshold}, ${maxReasonableLevel}]`);
  } else {

    const maxReasonableLevel = Math.min(Math.ceil(nodes.length / 5), 50);

    if (maxLevel > maxReasonableLevel) {
      console.warn(`[Job Service] Max level ${maxLevel} exceeds reasonable limit, compressing to ${maxReasonableLevel}`);

      nodes.forEach(node => {
        const currentLevel = levels.get(node.id);
        const normalizedLevel = Math.floor((currentLevel / maxLevel) * maxReasonableLevel);
        levels.set(node.id, normalizedLevel);
      });
    }
  }

  console.log(`[Job Service] Grouping nodes by level...`);
  const nodesByLevel = new Map();
  nodes.forEach(node => {
    const level = levels.get(node.id);
    if (!nodesByLevel.has(level)) {
      nodesByLevel.set(level, []);
    }
    nodesByLevel.get(level).push(node);
  });

  const sortedLevels = Array.from(nodesByLevel.keys()).sort((a, b) => a - b);
  console.log(`[Job Service] Jobs distributed across ${sortedLevels.length} levels (0-${Math.max(...sortedLevels)})`);

  const levelDistribution = sortedLevels.map(level => ({
    level,
    count: nodesByLevel.get(level).length
  }));
  const topLevels = levelDistribution.slice(0, 10).map(l => `L${l.level}:${l.count}`).join(', ');
  console.log(`[Job Service] Level distribution (first 10): ${topLevels}`);

  if (levelDistribution.length > 20) {
    const bottomLevels = levelDistribution.slice(-5).map(l => `L${l.level}:${l.count}`).join(', ');
    console.log(`[Job Service] Level distribution (last 5): ${bottomLevels}`);
  }

  console.log(`[Job Service] Optimizing node ordering...`);
  const optimizeNodeOrdering = () => {

    for (let i = 1; i < sortedLevels.length; i++) {
      const level = sortedLevels[i];
      const nodesAtLevel = nodesByLevel.get(level);
      const prevLevel = sortedLevels[i - 1];
      const prevNodes = nodesByLevel.get(prevLevel);

      const prevPositions = new Map();
      prevNodes.forEach((node, index) => {
        prevPositions.set(node.id, index);
      });

      nodesAtLevel.forEach(node => {
        const parents = parentsMap.get(node.id) || [];
        if (parents.length > 0) {
          const sum = parents.reduce((acc, parentId) => {
            return acc + (prevPositions.get(parentId) || 0);
          }, 0);
          node._barycenter = sum / parents.length;
        } else {
          node._barycenter = Infinity; 
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
      nextNodes.forEach((node, index) => {
        nextPositions.set(node.id, index);
      });

      nodesAtLevel.forEach(node => {
        const children = childrenMap.get(node.id) || [];
        if (children.length > 0) {
          const sum = children.reduce((acc, childId) => {
            return acc + (nextPositions.get(childId) || 0);
          }, 0);
          node._barycenterBackward = sum / children.length;
        } else {
          node._barycenterBackward = Infinity;
        }
      });

      nodesAtLevel.sort((a, b) => {
        if (a._barycenterBackward === b._barycenterBackward) {
          return a.id.localeCompare(b.id);
        }
        return a._barycenterBackward - b._barycenterBackward;
      });
    }
  };

  const optimizationPasses = nodes.length > 1000 ? 1 : 3;
  console.log(`[Job Service] Running ${optimizationPasses} optimization pass(es)...`);

  for (let pass = 0; pass < optimizationPasses; pass++) {
    const passStart = Date.now();
    optimizeNodeOrdering();
    const passEnd = Date.now();
    console.log(`[Job Service] Optimization pass ${pass + 1}/${optimizationPasses} completed in ${passEnd - passStart}ms`);
  }

  console.log(`[Job Service] Positioning ${nodes.length} nodes...`);
  const layoutedNodes = [];

  sortedLevels.forEach(level => {
    const nodesAtLevel = nodesByLevel.get(level);
    const levelWidth = nodesAtLevel.length * nodeWidth + (nodesAtLevel.length - 1) * horizontalSpacing;
    const startX = -levelWidth / 2;

    nodesAtLevel.forEach((node, index) => {
      const x = startX + index * (nodeWidth + horizontalSpacing) + nodeWidth / 2;
      const y = level * (nodeHeight + verticalSpacing);

      delete node._barycenter;
      delete node._barycenterBackward;

      layoutedNodes.push({
        ...node,
        position: {
          x: x,
          y: y
        }
      });
    });
  });

  const endTime = Date.now();
  console.log(`[Job Service] Layout completed in ${endTime - startTime}ms`);

  return layoutedNodes;
};

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
