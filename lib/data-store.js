const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const teamsPath = path.join(rootDir, "data", "teams-2026-qualified.json");
const resultsPath = path.join(rootDir, "data", "results-2026.json");
const squadContextPath = path.join(rootDir, "data", "squad-context.json");

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }

  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function createSupabaseClient() {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    return null;
  }

  const { createClient } = require("@supabase/supabase-js");
  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}

async function loadRemoteState(client, key) {
  const { data, error } = await client
    .from("app_state")
    .select("value, updated_at")
    .eq("key", key)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data || null;
}

async function loadAppData() {
  const teams = readJson(teamsPath, []);
  const localResults = readJson(resultsPath, []);
  const localSquadContext = readJson(squadContextPath, {
    updatedAt: "",
    version: 1,
    teams: {}
  });
  const client = createSupabaseClient();

  if (!client) {
    return {
      teams,
      results: localResults,
      squadContext: localSquadContext,
      meta: {
        mode: "local-files"
      }
    };
  }

  try {
    const [resultsState, squadState] = await Promise.all([
      loadRemoteState(client, "results"),
      loadRemoteState(client, "squad_context")
    ]);

    return {
      teams,
      results: resultsState?.value || localResults,
      squadContext: squadState?.value || localSquadContext,
      meta: {
        mode: "supabase",
        resultsUpdatedAt: resultsState?.updated_at || null,
        squadUpdatedAt: squadState?.updated_at || null
      }
    };
  } catch (error) {
    return {
      teams,
      results: localResults,
      squadContext: localSquadContext,
      meta: {
        mode: "local-files-fallback",
        error: error.message
      }
    };
  }
}

async function persistState(key, value) {
  const client = createSupabaseClient();

  if (client) {
    const { error } = await client.from("app_state").upsert(
      {
        key,
        value,
        updated_at: new Date().toISOString()
      },
      {
        onConflict: "key"
      }
    );

    if (error) {
      throw error;
    }

    return { mode: "supabase", key };
  }

  if (key === "results") {
    writeJson(resultsPath, value);
  } else if (key === "squad_context") {
    writeJson(squadContextPath, value);
  } else {
    throw new Error(`Unsupported local persistence key: ${key}`);
  }

  return { mode: "local-files", key };
}

module.exports = {
  loadAppData,
  persistState
};
