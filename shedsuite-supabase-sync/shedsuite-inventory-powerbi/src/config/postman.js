'use strict';

const fs = require('fs');
const path = require('path');

function readJsonSafe(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function extractVariables(json) {
  if (!json || !Array.isArray(json.variable)) return {};
  const vars = {};
  for (const v of json.variable) {
    if (v && v.key) vars[v.key] = v.value;
  }
  return vars;
}

function loadPostmanDefaults(serviceRootDir) {
  const postmanDir = path.resolve(serviceRootDir, 'postman');
  const candidates = [
    path.join(postmanDir, 'Public API.postman_collection.json'),
    path.join(postmanDir, 'shed_suite_public_api.postman_collection.json')
  ];
  let defaults = {};
  for (const file of candidates) {
    const json = readJsonSafe(file);
    if (!json) continue;
    const vars = extractVariables(json);
    const token =
      vars['Public API Token 1'] ||
      vars['Public API Token 2: Only with write scope'] ||
      vars['Public API Token - REVOKED'] ||
      '';
    const publicApiUrlPath = vars['publicApiUrlPath'] || '';
    // baseURL often lives in the Postman environment file; fallback to app domain
    const baseURL = vars['baseURL'] || 'https://app.shedsuite.com';
    defaults = { baseURL, publicApiUrlPath, token };
    break; // first one found is enough
  }
  return defaults;
}

module.exports = { loadPostmanDefaults };


