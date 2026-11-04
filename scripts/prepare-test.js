// `npm test` runs this first (was `gulp prepare-test`): writes the names of the
// test/data/*.json files, sorted, to test/data-json-filelist.json, which the
// Karma specs load to find their fixtures.
'use strict';

const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'test');
const names = fs.readdirSync(path.join(dir, 'data')).filter(f => f.endsWith('.json')).sort();
fs.writeFileSync(path.join(dir, 'data-json-filelist.json'), JSON.stringify(names, null, 2));
