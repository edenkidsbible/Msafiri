import bcrypt from "bcrypt";
import pg from "pg";

async function main(): Promise<void> {
  const email = process.env.SEED_ADMIN_EMAIL?.toLowerCase().trim();
  const password = process.env.SEED_ADMIN_PASSWORD;
  const name = process.env.SEED_ADMIN_NAME ?? "Super Admin";

  if (!email || !password) {
    console.error("SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD env vars are required.");
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL must be set.");
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const { Pool } = pg;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  const { rows } = await pool.query(
    `SELECT id FROM admin_users WHERE email = $1`,
    [email],
  );

  if (rows.length > 0) {
    await pool.query(
      `UPDATE admin_users SET password_hash = $1, role = 'admin', name = $2 WHERE email = $3`,
      [passwordHash, name, email],
    );
    console.log(`Updated existing admin account: ${email}`);
  } else {
    await pool.query(
      `INSERT INTO admin_users (email, name, password_hash, role) VALUES ($1, $2, $3, 'admin')`,
      [email, name, passwordHash],
    );
    console.log(`Created new admin account: ${email}`);
  }

  await pool.end();
  process.exit(0);
}

main().catch((err) => {
  console.error("seedAdmin failed:", err);
  process.exit(1);
});
