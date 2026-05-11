import fs from 'fs';
const code = fs.readFileSync('src/App.jsx', 'utf8');
const lines = code.split('\n');
let depth = 0;
const checkpoints = [];
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const startDepth = depth;
  let inStr = false;
  let strChar = '';
  for (let j = 0; j < line.length; j++) {
    const c = line[j];
    if (inStr) {
      if (c === strChar) inStr = false;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inStr = true; strChar = c; continue; }
    if (c === '/' && line[j+1] === '/') break;
    if (c === '{') depth++;
    if (c === '}') depth--;
  }
  if (line.match(/function\s+\w+|export default function/)) {
    checkpoints.push(`L${i+1} d=${startDepth}: ${line.trim().substring(0,70)}`);
  }
}
console.log('Final depth:', depth);
checkpoints.forEach(x => console.log(x));
