const { readFileSync } = require('fs');
const content = readFileSync('broxlab-docs.md', 'utf8');
const startMarker = '<!-- RELEASE_NOTES_START -->';
const endMarker = '<!-- RELEASE_NOTES_END -->';
const regex = new RegExp(`(${startMarker})([\s\S]*?)(${endMarker})`, 'm');
console.log('start index', content.indexOf(startMarker));
console.log('end index', content.indexOf(endMarker));
console.log('match test', regex.test(content));
console.log('snippet:', content.slice(content.indexOf(startMarker) - 20, content.indexOf(endMarker) + 20));
