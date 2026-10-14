import { cpSync, renameSync } from 'node:fs';
// Only the built demo belongs in the site. Private notes never enter the deployment tree.
renameSync('dist-site/hero.html', 'dist-site/index.html');
cpSync('dist-demo', 'dist-site/demo', { recursive: true });
