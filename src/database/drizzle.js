import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '#dbSchema/index';
import { logger } from '#utils';
import { config } from '#config';

/** Singleton Drizzle ORM instance. */
let db = null;
/** Underlying postgres.js client, kept for graceful shutdown. */
let client = null;

/**
 * Initialises the PostgreSQL connection and Drizzle ORM instance.
 * Idempotent — returns the existing instance if already initialised.
 * @throws {Error} If `DATABASE_URL` is not set in config.
 * @returns {import('drizzle-orm/postgres-js').PostgresJsDatabase} The Drizzle db instance.
 */
export const initDatabase = () => {
	if (db) return db;

	const connectionString = config.database.url;

	if (!connectionString) {
		throw new Error('DATABASE_URL is required');
	}

	client = postgres(connectionString, {
		max: config.database.max_connections,
		connect_timeout: config.database.connect_timeout,
		max_lifetime: config.database.max_lifetime,
	});

	db = drizzle(client, { schema, logger: config.database.logger });

	logger.success('Database', 'PostgreSQL connection initialized');
	return db;
};

/**
 * Returns the active Drizzle instance.
 * @throws {Error} If {@link initDatabase} has not been called yet.
 * @returns {import('drizzle-orm/postgres-js').PostgresJsDatabase}
 */
export const getDatabase = () => {
	if (!db) {
		throw new Error('Database not initialized');
	}
	return db;
};

/**
 * Gracefully closes the postgres.js connection pool and resets the singletons.
 * No-ops if the connection was never opened.
 * @returns {Promise<void>}
 */
export const closeDatabase = async () => {
	if (client) {
		await client.end();
		db = null;
		client = null;
		logger.info('Database', 'PostgreSQL connection closed');
	}
};
