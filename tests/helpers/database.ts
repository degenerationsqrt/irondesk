import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Executes selected committed migrations in PostgreSQL, with minimal Supabase auth roles.
 * It intentionally does not emulate PostgREST, OAuth, or hosted Supabase services.
 */
export async function createTestDatabase(migrations: readonly string[]) {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
  `);
  const directory = join(process.cwd(), "supabase/migrations");
  for (const filename of migrations) {
    try {
      await db.exec(readFileSync(join(directory, filename), "utf8"));
    } catch (cause) {
      await db.close();
      throw new Error(`Migration failed: ${filename}`, { cause });
    }
  }
  return db;
}
