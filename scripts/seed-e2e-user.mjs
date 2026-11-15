// OPS-07: this script writes test data using the service-role key. Refuse to
// run against production and require an explicit acknowledgment so an operator
// cannot accidentally seed a live project.
if (process.env.NODE_ENV === "production") {
  throw new Error("E2E seed must never run with NODE_ENV=production; it writes test data via the service-role key.");
}
const seedConfirmed = process.env.E2E_SEED_CONFIRM === "yes" || process.env.npm_lifecycle_event === "e2e:seed";
if (!seedConfirmed) {
  throw new Error("E2E seed writes test data into the target Supabase project. Set E2E_SEED_CONFIRM=yes (or run `npm run e2e:seed`) to confirm the target is non-production.");
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;

if (!url || !serviceRoleKey || !email || !password) {
  throw new Error("E2E seed requires Supabase URL, service role key, email, and password.");
}

const headers = {
  apikey: serviceRoleKey,
  Authorization: `Bearer ${serviceRoleKey}`,
  "Content-Type": "application/json",
};

async function request(path, options = {}) {
  const response = await fetch(`${url}${path}`, {
    ...options,
    headers: { ...headers, ...(options.headers || {}) },
  });
  const body = await response.text();
  const parsed = body ? JSON.parse(body) : null;
  if (!response.ok) {
    throw new Error(`${options.method || "GET"} ${path} failed (${response.status}): ${body}`);
  }
  return parsed;
}

const created = await request("/auth/v1/admin/users", {
  method: "POST",
  body: JSON.stringify({
  email,
  password,
  email_confirm: true,
  }),
});
if (!created?.id) throw new Error("E2E user was not created.");

const userId = created.id;
await request("/rest/v1/profiles", {
  method: "POST",
  headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
  body: JSON.stringify([{
    id: userId,
    email,
    full_name: "E2E Active User",
    status: "active",
    member_type: "santri",
  }]),
});

const roles = await request("/rest/v1/roles?key=eq.santri&select=id,key");
const role = roles?.[0];
if (!role) throw new Error("Santri role was not seeded.");

await request("/rest/v1/user_roles", {
  method: "POST",
  headers: { Prefer: "return=minimal" },
  body: JSON.stringify([{
    user_id: userId,
    role_id: role.id,
  }]),
});

const profiles = await request(`/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=id,status`);
if (profiles?.[0]?.status !== "active") {
  throw new Error("E2E profile verification failed: expected active status.");
}

const assignedRoles = await request(
  `/rest/v1/user_roles?user_id=eq.${encodeURIComponent(userId)}&revoked_at=is.null&select=role_id,roles(key)`,
);
if (assignedRoles?.[0]?.roles?.key !== "santri") {
  throw new Error("E2E role verification failed: expected santri role.");
}

console.log("E2E user seeded and verified: active profile, santri role");
