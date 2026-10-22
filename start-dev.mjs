import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('========================================================');
console.log('   Starting Traject Backend & Frontend Dev Servers...   ');
console.log('========================================================\n');

const backend = spawn('npm', ['run', 'dev'], {
  cwd: path.join(__dirname, 'backend'),
  stdio: 'inherit',
  shell: true,
});

const frontend = spawn('npm', ['run', 'dev'], {
  cwd: path.join(__dirname, 'frontend'),
  stdio: 'inherit',
  shell: true,
});

function cleanup() {
  console.log('\nShutting down dev servers...');
  backend.kill();
  frontend.kill();
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
