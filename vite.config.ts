import {readdirSync} from 'node:fs';
import {defineConfig} from 'vite';

const AI_URL = 'http://127.0.0.1:8000';
const aiRoutes = ['api', 'texts', ...readdirSync('ai/static')];
const proxy = Object.fromEntries(aiRoutes.map(r => [`/${r}`, AI_URL]));

export default defineConfig({
  base: './',
  server: {proxy},
  preview: {proxy},
});
