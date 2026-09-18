'use strict';

const crypto = require('crypto');

/** Stable id for a job: prefer the apply URL (normalized), fall back to a
 * hash of title+employer+city so near-identical postings on different
 * sources still collapse to one card. */
function jobId(job) {
  const basis = job.applyUrl
    ? normalizeUrl(job.applyUrl)
    : `${job.title}|${job.employer}|${job.city}`.toLowerCase();
  return crypto.createHash('sha1').update(basis).digest('hex').slice(0, 16);
}

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    u.search = '';
    return `${u.origin}${u.pathname}`.toLowerCase().replace(/\/$/, '');
  } catch {
    return String(url).toLowerCase();
  }
}

/** De-duplicates jobs across sources. When the same posting is found on
 * multiple sites (e.g. mirrored between an agency site and GovernmentJobs.com),
 * keeps the first occurrence and records the other sources it was seen on. */
function dedupeJobs(jobs) {
  const byKey = new Map();
  const seenTitleEmployer = new Map();

  for (const job of jobs) {
    const id = jobId(job);
    const looseKey = `${job.title}|${job.employer}|${job.city}`.toLowerCase().replace(/\s+/g, ' ').trim();

    let existing = byKey.get(id) || seenTitleEmployer.get(looseKey);
    if (existing) {
      if (!existing.alsoListedOn.includes(job.sourceName)) {
        existing.alsoListedOn.push(job.sourceName);
      }
      continue;
    }

    const record = { ...job, id, alsoListedOn: [] };
    byKey.set(id, record);
    seenTitleEmployer.set(looseKey, record);
  }

  return [...byKey.values()];
}

module.exports = { jobId, dedupeJobs };
