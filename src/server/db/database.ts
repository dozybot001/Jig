import { DatabaseSync } from "node:sqlite";
import { migrations } from "./migrations.ts";

export type Db = DatabaseSync;

/** Opens (and creates or migrates) the database. Pass ":memory:" in tests. */
export function openDatabase(path: string): Db {
	const db = new DatabaseSync(path, { timeout: 5000 });
	db.exec("PRAGMA foreign_keys = ON");
	if (path !== ":memory:") {
		db.exec("PRAGMA journal_mode = WAL");
		db.exec("PRAGMA synchronous = NORMAL");
	}
	migrate(db);
	return db;
}

export function migrate(db: Db): void {
	const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
	if (row.user_version > migrations.length) {
		throw new Error(
			`The database was written by a newer version of Jig (schema ${row.user_version}); upgrade Jig.`,
		);
	}
	for (let version = row.user_version; version < migrations.length; version++) {
		transaction(db, () => {
			db.exec(migrations[version] as string);
			db.exec(`PRAGMA user_version = ${version + 1}`);
		});
	}
}

/** Runs `fn` in one write transaction; nested calls join the outer one. */
export function transaction<T>(db: Db, fn: () => T): T {
	if (db.isTransaction) return fn();
	db.exec("BEGIN IMMEDIATE");
	try {
		const result = fn();
		db.exec("COMMIT");
		return result;
	} catch (error) {
		if (db.isTransaction) db.exec("ROLLBACK");
		throw error;
	}
}

export function json<T>(text: string | null | undefined, fallback: T): T {
	if (text == null) return fallback;
	return JSON.parse(text) as T;
}
