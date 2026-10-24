import {readdirSync} from 'node:fs';
import {defineConfig} from 'vite';

const aiPages = readdirSync('ai', {recursive: true, encoding: 'utf8'})
  .filter(f => f.endsWith('index.html'))
  .map(f => `ai/${f}`);

export default defineConfig({
  appType: 'mpa',
  build: {rollupOptions: {input: ['index.html', ...aiPages]}},
});
