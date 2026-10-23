const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const decoder = new TextDecoder('utf-8', { fatal: true });
let count = 0;
for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
  if (!entry.isFile() || !/\.(js|css|html|json)$/.test(entry.name)) continue;
  try { decoder.decode(fs.readFileSync(path.join(root, entry.name))); }
  catch (error) { throw new Error(`${entry.name} must be valid UTF-8`, { cause: error }); }
  count++;
}
console.log(`PASS: ${count} extension text files are valid UTF-8.`);
