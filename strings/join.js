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
  console.log(`[XML Parser] Resolving dependencies for ${jobs.length} jobs`);
  const startTime = Date.now();

  console.log(`[XML Parser] Building job name index...`);
  const allJobNames = new Set(jobs.map(job => job.jobname));

  console.log(`[XML Parser] Building condition producers map...`);
  const conditionProducers = new Map();

  jobs.forEach(job => {
    job.outconds.forEach(condName => {
      if (!conditionProducers.has(condName)) {
        conditionProducers.set(condName, []);
      }
      conditionProducers.get(condName).push(job.jobname);
    });
  });

  console.log(`[XML Parser] Building condition consumers map...`);
  const conditionConsumers = new Map();

  jobs.forEach(job => {
    job.inconds.forEach(condName => {
      if (!conditionConsumers.has(condName)) {
        conditionConsumers.set(condName, []);
      }
      conditionConsumers.get(condName).push(job.jobname);
    });
  });

  console.log(`[XML Parser] Analyzing condition names for job references...`);
  const conditionToJobs = new Map();

  const allConditionNames = new Set([
    ...conditionProducers.keys(),
    ...conditionConsumers.keys()
  ]);

  console.log(`[XML Parser] Found ${allConditionNames.size} unique conditions to analyze`);

  let processedCount = 0;
  const totalConditions = allConditionNames.size;
  let lastLogTime = Date.now();
  const LOG_INTERVAL = 2000; 

  allConditionNames.forEach(condName => {
    const segments = extractJobNamesFromCondition(condName);
    const matchedJobs = findMatchingJobNames(segments, allJobNames);
    if (matchedJobs.length > 0) {
      conditionToJobs.set(condName, matchedJobs);
    }

    processedCount++;

    const now = Date.now();
    if (now - lastLogTime > LOG_INTERVAL) {
      const progress = ((processedCount / totalConditions) * 100).toFixed(1);
      console.log(`[XML Parser] Condition analysis progress: ${processedCount}/${totalConditions} (${progress}%)`);
      lastLogTime = now;
    }
  });

  console.log(`[XML Parser] Found ${conditionToJobs.size} conditions with job references`);

  console.log(`[XML Parser] Resolving job dependencies...`);
  const resolvedJobs = jobs.map(job => {

    const parentJobs = [];

    job.inconds.forEach(condName => {

      const producers = conditionProducers.get(condName) || [];

      const validProducers = producers.filter(p => p !== job.jobname);
      parentJobs.push(...validProducers);

      if (validProducers.length === 0) {
        const jobsInCondition = conditionToJobs.get(condName) || [];

        const validParents = jobsInCondition.filter(j => j !== job.jobname);
        parentJobs.push(...validParents);
      }
    });

    const childJobs = [];

    job.outconds.forEach(condName => {

      const consumers = conditionConsumers.get(condName) || [];

      const validConsumers = consumers.filter(c => c !== job.jobname);
      childJobs.push(...validConsumers);

      if (validConsumers.length === 0) {
        const jobsInCondition = conditionToJobs.get(condName) || [];

        const validChildren = jobsInCondition.filter(j => j !== job.jobname);
        childJobs.push(...validChildren);
      }
    });

    return {
      jobname: job.jobname,
      inconds: [...new Set(parentJobs)], 
      outconds: [...new Set(childJobs)], 
      status: job.status,

      application: job.application,
      subApplication: job.subApplication,
      smartFolder: job.smartFolder,
      metadata: job.metadata,

      _originalInconds: job.inconds,
      _originalOutconds: job.outconds,
    };
  });

  const endTime = Date.now();
  const resolvedCount = resolvedJobs.filter(j => j.inconds.length > 0 || j.outconds.length > 0).length;
  console.log(`[XML Parser] Dependencies resolved in ${endTime - startTime}ms: ${resolvedCount}/${jobs.length} jobs have connections`);

  console.log(`[XML Parser] Checking for self-referencing conditions...`);
  const selfRefJobs = jobs.filter(job => {
    const commonConds = job.inconds.filter(cond => job.outconds.includes(cond));
    return commonConds.length > 0;
  });

  if (selfRefJobs.length > 0) {
    console.warn(`[XML Parser] Found ${selfRefJobs.length} jobs with self-referencing conditions (same condition in INCOND and OUTCOND)`);
    selfRefJobs.slice(0, 5).forEach(job => {
      const commonConds = job.inconds.filter(cond => job.outconds.includes(cond));
      console.warn(`  - ${job.jobname}: ${commonConds.join(', ')}`);
    });
    if (selfRefJobs.length > 5) {
      console.warn(`  ... and ${selfRefJobs.length - 5} more`);
    }
  }

  console.log(`[XML Parser] Checking for circular dependencies...`);
  const circularDeps = detectCircularDependencies(resolvedJobs);
  if (circularDeps.length > 0) {
    console.warn(`[XML Parser] Found ${circularDeps.length} circular dependency chains:`);
    circularDeps.slice(0, 3).forEach(chain => {
      console.warn(`  - ${chain.join(' -> ')}`);
    });
    if (circularDeps.length > 3) {
      console.warn(`  ... and ${circularDeps.length - 3} more`);
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
  return path.join(process.cwd(), 'src', 'data', 'ctlm-aug.xml');
};
