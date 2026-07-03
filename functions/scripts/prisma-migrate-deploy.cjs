const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const functionsDir = path.resolve(__dirname, "..");
const prismaDir = path.join(functionsDir, "prisma");
const migrationsDir = path.join(prismaDir, "migrations");
const envFilePath = path.join(functionsDir, ".env");
const resolveBin = (binName) => {
  const candidateNames = process.platform === "win32"
    ? [`${binName}.cmd`, binName]
    : [binName];

  const searchRoots = [
    path.resolve(functionsDir, "node_modules", ".bin"),
    path.resolve(functionsDir, "..", "node_modules", ".bin"),
  ];

  for (const root of searchRoots) {
    for (const candidate of candidateNames) {
      const resolved = path.join(root, candidate);
      if (fs.existsSync(resolved)) {
        return resolved;
      }
    }
  }

  throw new Error(`Unable to locate ${binName} binary in node_modules/.bin.`);
};

const prismaBin = resolveBin("prisma");
const supabaseBin = resolveBin("supabase");

const PRISMA_MIGRATIONS_QUERY = `
select migration_name, finished_at, rolled_back_at
from "_prisma_migrations"
order by finished_at nulls last, migration_name;
`.trim();

const readDotEnv = () => {
  if (!fs.existsSync(envFilePath)) {
    return;
  }

  const raw = fs.readFileSync(envFilePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex < 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();
    if (!key || process.env[key]) {
      continue;
    }

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
};

const run = (command, args, extraEnv = {}) => {
  const isWindowsCmd = process.platform === "win32" && command.toLowerCase().endsWith(".cmd");
  const result = spawnSync(command, args, {
    cwd: functionsDir,
    env: {
      ...process.env,
      ...extraEnv,
    },
    encoding: "utf8",
    shell: isWindowsCmd,
    stdio: ["ignore", "pipe", "pipe"],
  });

  return result;
};

const printCapturedOutput = (result) => {
  if (result.error) {
    process.stderr.write(`${result.error.message}\n`);
  }

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }

  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
};

const writeTempSql = (contents, name) => {
  const filePath = path.join(os.tmpdir(), name);
  fs.writeFileSync(filePath, contents, "utf8");
  return filePath;
};

const runSupabaseQuery = ({ filePath, dbUrl, output = "json" }) => {
  return run(supabaseBin, [
    "db",
    "query",
    "--db-url",
    dbUrl,
    "--file",
    filePath,
    "--output",
    output,
  ]);
};

const parseQueryRows = (rawOutput) => {
  const trimmed = rawOutput.trim();
  if (!trimmed) {
    return [];
  }

  const parsed = JSON.parse(trimmed);
  return Array.isArray(parsed.rows) ? parsed.rows : [];
};

const loadRemotePrismaMigrations = (directUrl) => {
  const queryFile = writeTempSql(
    PRISMA_MIGRATIONS_QUERY,
    `ebuy-prisma-migrations-${Date.now()}.sql`
  );

  try {
    const result = runSupabaseQuery({
      filePath: queryFile,
      dbUrl: directUrl,
    });

    if (result.status !== 0) {
      printCapturedOutput(result);
      throw new Error("Unable to load remote Prisma migration history.");
    }

    return parseQueryRows(result.stdout);
  } finally {
    fs.rmSync(queryFile, { force: true });
  }
};

const applySqlFile = (filePath, directUrl) => {
  const result = runSupabaseQuery({
    filePath,
    dbUrl: directUrl,
  });

  if (result.status !== 0) {
    printCapturedOutput(result);
    throw new Error(`Failed applying migration SQL file: ${filePath}`);
  }
};

const recordMigrationHistory = (migrationName, checksum, directUrl) => {
  const now = new Date().toISOString();
  const insertSql = `
insert into "_prisma_migrations" (
  id,
  checksum,
  finished_at,
  migration_name,
  logs,
  rolled_back_at,
  started_at,
  applied_steps_count
)
select
  gen_random_uuid()::text,
  '${checksum}',
  '${now}'::timestamptz,
  '${migrationName}',
  '',
  null,
  '${now}'::timestamptz,
  1
where not exists (
  select 1
  from "_prisma_migrations"
  where migration_name = '${migrationName}'
    and rolled_back_at is null
);
`.trim();

  const queryFile = writeTempSql(
    insertSql,
    `ebuy-prisma-record-${migrationName}-${Date.now()}.sql`
  );

  try {
    const result = runSupabaseQuery({
      filePath: queryFile,
      dbUrl: directUrl,
    });

    if (result.status !== 0) {
      printCapturedOutput(result);
      throw new Error(`Failed recording Prisma migration history for ${migrationName}.`);
    }
  } finally {
    fs.rmSync(queryFile, { force: true });
  }
};

const getLocalMigrations = () =>
  fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      checksum: crypto
        .createHash("sha256")
        .update(
          fs.readFileSync(path.join(migrationsDir, entry.name, "migration.sql"), "utf8"),
          "utf8"
        )
        .digest("hex"),
      name: entry.name,
      sqlFile: path.join(migrationsDir, entry.name, "migration.sql"),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));

const main = () => {
  readDotEnv();

  const prismaResult = run(prismaBin, ["migrate", "deploy"]);
  if (prismaResult.status === 0) {
    printCapturedOutput(prismaResult);
    process.exit(0);
  }

  const combinedOutput = `${prismaResult.stdout ?? ""}\n${prismaResult.stderr ?? ""}`;
  if (!combinedOutput.includes("Schema engine error")) {
    printCapturedOutput(prismaResult);
    process.exit(prismaResult.status ?? 1);
  }

  const directUrl = process.env.DIRECT_URL;
  if (!directUrl) {
    printCapturedOutput(prismaResult);
    throw new Error("DIRECT_URL is required for the Supabase fallback migration path.");
  }

  process.stdout.write(
    "Prisma schema engine failed on this machine. Falling back to direct SQL migration deployment via Supabase CLI.\n"
  );

  const remoteRows = loadRemotePrismaMigrations(directUrl);
  const appliedMigrationNames = new Set(
    remoteRows
      .filter((row) => row.migration_name && !row.rolled_back_at)
      .map((row) => row.migration_name)
  );

  const pendingMigrations = getLocalMigrations().filter(
    (migration) => !appliedMigrationNames.has(migration.name)
  );

  if (pendingMigrations.length === 0) {
    process.stdout.write("No pending migrations remain after fallback inspection.\n");
    process.exit(0);
  }

  for (const migration of pendingMigrations) {
    process.stdout.write(`Applying ${migration.name} via Supabase CLI fallback...\n`);
    applySqlFile(migration.sqlFile, directUrl);
    recordMigrationHistory(migration.name, migration.checksum, directUrl);
  }

  process.stdout.write("Fallback migration deployment completed successfully.\n");
};

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
