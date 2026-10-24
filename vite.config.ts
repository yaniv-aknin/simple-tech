import {readdirSync} from 'node:fs';
import {defineConfig} from 'vite';

const pages = ['ai', 'computer'].flatMap(dir =>
  readdirSync(dir, {recursive: true, encoding: 'utf8'})
    .filter(f => f.endsWith('index.html'))
    .map(f => `${dir}/${f}`),
);

export default defineConfig({
  appType: 'mpa',
  build: {rollupOptions: {input: ['index.html', ...pages]}},
  worker: {format: 'es'},
});
