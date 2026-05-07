const fs = require("fs");
const path = require("path");
const dns = require("dns").promises;
const net = require("net");

const envPath = path.join(__dirname, "..", ".env");

const loadEnvValue = (key) => {
  if (!fs.existsSync(envPath)) {
    return null;
  }

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);

  for (const line of lines) {
    const trimmedLine = line.trim();

    if (!trimmedLine || trimmedLine.startsWith("#")) {
      continue;
    }

    const prefix = `${key}=`;

    if (!trimmedLine.startsWith(prefix)) {
      continue;
    }

    const rawValue = trimmedLine.slice(prefix.length).trim();
    return rawValue.replace(/^['"]/, "").replace(/['"]$/, "");
  }

  return null;
};

const resolveRecords = async (hostname) => {
  const result = {
    ipv4: [],
    ipv6: [],
  };

  try {
    result.ipv4 = await dns.resolve4(hostname);
  } catch {}

  try {
    result.ipv6 = await dns.resolve6(hostname);
  } catch {}

  return result;
};

const testTcpConnection = (hostname, port) =>
  new Promise((resolve) => {
    const socket = net.createConnection({
      host: hostname,
      port,
      timeout: 5000,
    });

    let finished = false;

    const finish = (status, detail = null) => {
      if (finished) {
        return;
      }

      finished = true;
      socket.destroy();
      resolve({ status, detail });
    };

    socket.on("connect", () => finish("ok"));
    socket.on("timeout", () => finish("timeout"));
    socket.on("error", (error) => finish("error", error.message));
  });

const describeSupabaseMode = (url) => {
  if (url.hostname.endsWith(".pooler.supabase.com")) {
    return "pooler";
  }

  if (url.hostname.endsWith(".supabase.co")) {
    return "direct";
  }

  return "other";
};

const validateNamedUrl = async (envName, databaseUrl) => {
  if (!databaseUrl) {
    throw new Error(`${envName} is missing. Add it to functions/.env before running the database checks.`);
  }

  let parsedUrl;

  try {
    parsedUrl = new URL(databaseUrl);
  } catch {
    throw new Error(`${envName} is not a valid URI.`);
  }

  const mode = describeSupabaseMode(parsedUrl);
  const records = await resolveRecords(parsedUrl.hostname);
  const tcpResult = await testTcpConnection(parsedUrl.hostname, Number(parsedUrl.port || 5432));

  console.log(`${envName} host: ${parsedUrl.hostname}`);
  console.log(`${envName} mode: ${mode}`);
  console.log(`${envName} IPv4 records: ${records.ipv4.length ? records.ipv4.join(", ") : "none"}`);
  console.log(`${envName} IPv6 records: ${records.ipv6.length ? records.ipv6.join(", ") : "none"}`);
  console.log(`${envName} TCP connectivity: ${tcpResult.status}${tcpResult.detail ? ` (${tcpResult.detail})` : ""}`);

  if (mode === "direct" && records.ipv4.length === 0) {
    throw new Error(
      `${envName} points to a Supabase direct host that is IPv6-only from the current DNS view. Use the Supavisor Session pooler URI on this machine, or enable the Supabase IPv4 Add-On.`
    );
  }

  if (mode === "direct" && parsedUrl.searchParams.get("sslmode") !== "require") {
    throw new Error(`${envName} uses a Supabase direct URI without ?sslmode=require.`);
  }

  if (tcpResult.status !== "ok") {
    throw new Error(
      `${envName} is not reachable from this machine. If this is Supabase, switch to the Session pooler connection string or verify your network supports the selected host.`
    );
  }
};

const run = async () => {
  const databaseUrl = process.env.DATABASE_URL || loadEnvValue("DATABASE_URL");
  const directUrl = process.env.DIRECT_URL || loadEnvValue("DIRECT_URL");

  await validateNamedUrl("DATABASE_URL", databaseUrl);
  console.log("");
  await validateNamedUrl("DIRECT_URL", directUrl);
  console.log("");
  console.log("Database connection settings look reachable from this machine.");
};

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
