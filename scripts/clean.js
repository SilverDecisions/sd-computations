// `npm run clean`: removes dist/ (the build writes it from scratch).
'use strict';

const fs = require('fs');
const path = require('path');

fs.rmSync(path.join(__dirname, '..', 'dist'), {recursive: true, force: true});
