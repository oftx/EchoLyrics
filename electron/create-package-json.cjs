const fs = require('fs');
const path = require('path');

const dest = path.join(__dirname, '../dist-electron/package.json');
const content = JSON.stringify({ type: 'commonjs' }, null, 2);

// Ensure dir exists
const dir = path.dirname(dest);
if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
}

fs.writeFileSync(dest, content);
console.log('Created dist-electron/package.json');
