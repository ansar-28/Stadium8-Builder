#!/usr/bin/env node
/**
 * scan-doc.js
 * Scans documentation files and returns structured metadata as JSON.
 *
 * Designed for INTAKE agents that need file overviews (size, line count,
 * structure, keyword signals) without resorting to sed/awk/python via Bash.
 *
 * Usage:
 *   node .claude/scripts/scan-doc.js <path>                     # scan a file or directory
 *   node .claude/scripts/scan-doc.js <path> --keywords k1,k2    # also count keyword occurrences
 *
 * Examples:
 *   node .claude/scripts/scan-doc.js documentation/
 *   node .claude/scripts/scan-doc.js documentation/BRD.md
 *   node .claude/scripts/scan-doc.js documentation/ --keywords auth,role,session,compliance,mock
 *
 * Output: JSON to stdout
 */
'use strict';

const fs = require('fs');
const path = require('path');

// =============================================================================
// ARGS
// =============================================================================

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: node scan-doc.js <file-or-directory> [--keywords k1,k2,...]');
  process.exit(1);
}

const targetPath = path.resolve(args[0]);
let keywords = [];
const keywordsFlagIndex = args.indexOf('--keywords');
if (keywordsFlagIndex !== -1 && args[keywordsFlagIndex + 1]) {
  keywords = args[keywordsFlagIndex + 1].split(',').map(keyword => keyword.trim().toLowerCase()).filter(Boolean);
}

// =============================================================================
// HELPERS
// =============================================================================

/** Detect if buffer contains non-text bytes (binary content) */
function hasBinaryContent(buffer) {
  // Check first 8KB for null bytes or high concentration of control chars
  const checkLength = Math.min(buffer.length, 8192);
  let controlCount = 0;
  for (let i = 0; i < checkLength; i++) {
    const byteValue = buffer[i];
    if (byteValue === 0) return true; // null byte = binary
    // Control chars excluding tab, newline, carriage return
    if (byteValue < 32 && byteValue !== 9 && byteValue !== 10 && byteValue !== 13) controlCount++;
  }
  return checkLength > 0 && (controlCount / checkLength) > 0.1;
}

/** Guess file type from extension */
function fileType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const typesByExtension = {
    // Text/markup
    '.md': 'markdown', '.markdown': 'markdown', '.mdown': 'markdown',
    '.txt': 'text', '.text': 'text',
    '.rst': 'text', '.adoc': 'text',
    '.csv': 'csv', '.tsv': 'csv',
    '.pdf': 'pdf',
    // Structured data
    '.yaml': 'yaml', '.yml': 'yaml', '.json': 'json',
    '.xml': 'text',
    // Web
    '.html': 'html', '.htm': 'html',
    '.css': 'css', '.js': 'javascript', '.ts': 'typescript',
    '.tsx': 'tsx', '.jsx': 'jsx',
    // Images
    '.png': 'image', '.jpg': 'image', '.jpeg': 'image',
    '.gif': 'image', '.svg': 'image', '.webp': 'image',
    // Office documents (binary — cannot be read by Read tool)
    '.docx': 'office', '.doc': 'office',
    '.xlsx': 'office', '.xls': 'office',
    '.pptx': 'office', '.ppt': 'office',
    '.rtf': 'office',
  };
  return typesByExtension[extension] || 'other';
}

/** Extract markdown headings (both # syntax and standalone **bold** lines) */
function extractHeadings(content) {
  const headings = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    // Standard markdown headings: # Heading
    const hashMatch = lines[i].match(/^(#{1,6})\s+(.+)/);
    if (hashMatch) {
      headings.push({
        level: hashMatch[1].length,
        text: hashMatch[2].replace(/[*_`]/g, '').trim(),
        line: i + 1,
      });
      continue;
    }
    // Bold-text-as-heading: **Heading** on its own line (common in BRDs)
    // Matches lines where the entire content is bold, e.g., "**Screen 1: Dashboard**"
    const boldMatch = lines[i].match(/^\s*\*\*(.+?)\*\*\s*$/);
    if (boldMatch) {
      headings.push({
        level: 0,
        text: boldMatch[1].trim(),
        line: i + 1,
      });
    }
  }
  return headings;
}

/** Count keyword occurrences (case-insensitive substring match) */
function countKeywords(content, keywordList) {
  if (keywordList.length === 0) return undefined;
  const lowerContent = content.toLowerCase();
  const counts = {};
  for (const keyword of keywordList) {
    let count = 0;
    let position = 0;
    while ((position = lowerContent.indexOf(keyword, position)) !== -1) {
      count++;
      position += keyword.length;
    }
    counts[keyword] = count;
  }
  return counts;
}

/** Check for YAML frontmatter and extract simple key:value pairs */
function extractFrontmatter(content) {
  const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) return null;
  const pairs = {};
  for (const line of frontmatterMatch[1].split('\n')) {
    const keyValueMatch = line.match(/^(\w[\w_-]*):\s*"?(.+?)"?\s*$/);
    if (keyValueMatch) pairs[keyValueMatch[1]] = keyValueMatch[2];
  }
  return Object.keys(pairs).length > 0 ? pairs : null;
}

/** Scan a single file */
function scanFile(filePath) {
  const stat = fs.statSync(filePath);
  const type = fileType(filePath);
  const result = {
    path: filePath,
    name: path.basename(filePath),
    type,
    sizeBytes: stat.size,
  };

  // For known binary formats, return metadata with actionable guidance
  if (['image', 'pdf', 'office'].includes(type)) {
    result.binary = true;
    const notes = {
      pdf: 'Use Read tool with pages parameter to read PDF content',
      image: 'Use Read tool to view image content',
      office: 'Office format — cannot be read directly. Ask the user to export as .md, .txt, or .pdf',
    };
    result.note = notes[type];
    return result;
  }

  let buffer;
  try {
    buffer = fs.readFileSync(filePath);
  } catch (err) {
    result.error = 'Could not read file: ' + err.message;
    return result;
  }

  if (hasBinaryContent(buffer)) {
    result.binary = true;
    result.note = 'File contains binary content — cannot be read as text. Ask the user to provide a text-based format (.md, .txt, or .pdf)';
    return result;
  }

  const content = buffer.toString('utf8');
  const lines = content.split('\n');

  result.binary = false;
  result.lines = lines.length;

  if (type === 'markdown' || type === 'text') {
    result.headings = extractHeadings(content);
    result.frontmatter = extractFrontmatter(content);
  }

  if (type === 'yaml' || type === 'json') {
    const hasOpenApi = /["']?openapi["']?\s*:/i.test(content) || /["']?swagger["']?\s*:/i.test(content);
    result.isOpenApiSpec = hasOpenApi;
    if (hasOpenApi) {
      const versionMatch = content.match(/["']?(?:openapi|swagger)["']?\s*:\s*["']?([\d.]+)/i);
      if (versionMatch) result.openApiVersion = versionMatch[1];
    }
  }

  const keywordCounts = countKeywords(content, keywords);
  if (keywordCounts) result.keywords = keywordCounts;

  return result;
}

/** Scan a directory recursively (max 2 levels deep) */
function scanDirectory(dirPath, depth = 0) {
  const files = [];
  let entries;
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch (err) {
    return [{ path: dirPath, error: 'Could not read directory: ' + err.message }];
  }

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.name.startsWith('.')) continue;

    if (entry.isFile()) {
      files.push(scanFile(fullPath));
    } else if (entry.isDirectory() && depth < 2) {
      files.push({
        path: fullPath,
        name: entry.name,
        type: 'directory',
        children: scanDirectory(fullPath, depth + 1),
      });
    } else if (entry.isDirectory()) {
      files.push({
        path: fullPath,
        name: entry.name,
        type: 'directory',
        note: 'Max depth reached — use Read/Glob to explore further',
      });
    }
  }

  return files;
}

// =============================================================================
// MAIN
// =============================================================================

try {
  const stat = fs.statSync(targetPath);

  if (stat.isFile()) {
    const result = scanFile(targetPath);
    console.log(JSON.stringify(result, null, 2));
  } else if (stat.isDirectory()) {
    const files = scanDirectory(targetPath);
    const flatFiles = [];
    function flatten(items) {
      for (const item of items) {
        if (item.type === 'directory' && item.children) {
          flatten(item.children);
        } else if (item.type !== 'directory') {
          flatFiles.push(item);
        }
      }
    }
    flatten(files);

    // The template ships its own explainer at documentation/README.md, so a fresh clone is never
    // empty. `userProvidedFiles` is the count callers should branch on when deciding whether the
    // user has actually shared anything — `totalFiles` counts what's on disk. The file itself stays
    // in `files` either way, so a user who drops their own top-level README.md still sees it listed;
    // it just doesn't make "nothing shared" read as "1 file".
    const isTemplateReadme = (scannedFile) =>
      path.relative(targetPath, scannedFile.path).toLowerCase() === 'readme.md';

    const summary = {
      directory: targetPath,
      totalFiles: flatFiles.length,
      userProvidedFiles: flatFiles.filter((scannedFile) => !isTemplateReadme(scannedFile)).length,
      totalSizeBytes: flatFiles.reduce((sum, scannedFile) => sum + (scannedFile.sizeBytes || 0), 0),
      fileTypes: {},
    };
    for (const scannedFile of flatFiles) {
      summary.fileTypes[scannedFile.type] = (summary.fileTypes[scannedFile.type] || 0) + 1;
    }

    console.log(JSON.stringify({ summary, files }, null, 2));
  } else {
    console.error('Path is neither a file nor directory: ' + targetPath);
    process.exit(1);
  }
} catch (err) {
  if (err.code === 'ENOENT') {
    console.error('Path not found: ' + targetPath);
  } else {
    console.error('Error: ' + err.message);
  }
  process.exit(1);
}
