const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const appDir = process.env.npm_package_json
  ? path.dirname(process.env.npm_package_json)
  : process.cwd();

const parseEnvFile = (filePath) => {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const contents = fs.readFileSync(filePath, 'utf8');
  const result = {};

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }

  return result;
};

const sharedEnvPath = path.join(repoRoot, '.env.apps');
const appEnvPath = path.join(appDir, '.env');
const mergedEnv = {
  ...process.env,
  ...parseEnvFile(sharedEnvPath),
  ...parseEnvFile(appEnvPath),
};

const expoCliPath = path.join(repoRoot, 'node_modules', 'expo', 'bin', 'cli');
const expoArgs = process.argv.slice(2);

const child = spawn(process.execPath, [expoCliPath, ...expoArgs], {
  cwd: appDir,
  env: mergedEnv,
  stdio: 'inherit',
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
