// Dependency-free dev runner: starts the API server and the Vite dev server
// together, prefixing their output. Ctrl-C stops both.
import { spawn } from 'node:child_process';

const procs = [
  { name: 'api', color: '\x1b[36m', cmd: 'npm', args: ['--workspace', 'server', 'run', 'dev'] },
  { name: 'web', color: '\x1b[35m', cmd: 'npm', args: ['--workspace', 'web', 'run', 'dev'] },
];

const children = [];
let shuttingDown = false;

function prefix(name, color, chunk) {
  const reset = '\x1b[0m';
  const lines = chunk.toString().split('\n');
  for (const line of lines) {
    if (line.length === 0) continue;
    process.stdout.write(`${color}[${name}]${reset} ${line}\n`);
  }
}

for (const p of procs) {
  const child = spawn(p.cmd, p.args, { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
  child.stdout.on('data', (d) => prefix(p.name, p.color, d));
  child.stderr.on('data', (d) => prefix(p.name, p.color, d));
  child.on('exit', (code) => {
    if (!shuttingDown) {
      console.log(`\n[dev] "${p.name}" exited (code ${code}). Shutting down the rest.`);
      shutdown(code ?? 1);
    }
  });
  children.push(child);
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) {
    try { c.kill('SIGTERM'); } catch { /* ignore */ }
  }
  setTimeout(() => process.exit(code), 300);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
