'use strict';

const fs = require('fs');
const path = require('path');

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function createCsvWriter(filePath, headers) {
  let stream;
  if (filePath && filePath !== '-') {
    ensureDir(path.dirname(filePath));
    stream = fs.createWriteStream(filePath, { encoding: 'utf8' });
  } else {
    stream = process.stdout;
    // Prevent EPIPE when piping to tools like `head`
    stream.on('error', (err) => {
      if (err && err.code === 'EPIPE') {
        // ignore silently
        return;
      }
    });
  }
  stream.write(headers.join(',') + '\n');

  function writeRows(rows) {
    if (!rows || rows.length === 0) return;
    for (const row of rows) {
      const line = headers.map((h) => csvEscape(row[h])).join(',');
      stream.write(line + '\n');
    }
  }

  function close() {
    if (stream === process.stdout) return Promise.resolve();
    return new Promise((resolve) => {
      stream.end(resolve);
    });
  }

  return { writeRows, close };
}

module.exports = { createCsvWriter };


