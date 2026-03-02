import { initDatabase, closeDatabase } from '#db/drizzle';
import { GuildService } from '#dbServices/guilds';
import { BlacklistService } from '#dbServices/blacklist';
import { WarnService } from '#dbServices/warns';
import { logger } from '#utils';

/**
 * Facade that owns all database service instances and manages the connection lifecycle.
 *
 * Obtain the shared instance via the exported {@link db} constant rather than
 * constructing this class directly.
 */
export class DatabaseManager {
	constructor() {
		/** @type {GuildService|null} */
		this.guild = null;
		/** @type {BlacklistService|null} */
		this.blacklist = null;
		/** Whether {@link init} has completed successfully. @type {boolean} */
		this.initialized = false;
	}

	/**
	 * Connects to the database and instantiates all service classes.
	 * Idempotent — returns `this` immediately if already initialised.
	 * @throws {Error} Re-throws any error from {@link initDatabase} after logging it.
	 * @returns {this}
	 */
	init() {
		if (this.initialized) return this;

		try {
			initDatabase();

			this.guild = new GuildService();
			this.blacklist = new BlacklistService();
			this.warns = new WarnService();

			this.initialized = true;
			logger.success('DatabaseManager', 'Databases initialized successfully');
		} catch (error) {
			logger.error('DatabaseManager', 'Failed to initialize databases', error);
			throw error;
		}

		return this;
	}

	/**
	 * Closes all database connections and resets the initialised flag.
	 * No-ops if not yet initialised.
	 * @throws {Error} Re-throws any error from {@link closeDatabase} after logging it.
	 * @returns {Promise<void>}
	 */
	async closeAll() {
		if (!this.initialized) return;

		try {
			await closeDatabase();
			this.initialized = false;
			logger.info('DatabaseManager', 'All database connections closed');
		} catch (error) {
			logger.error('DatabaseManager', 'Failed to close database connections', error);
			throw error;
		}
	}
}

let dbInstance = null;

/**
 * Returns the process-wide {@link DatabaseManager} singleton, creating it on first call.
 * @returns {DatabaseManager}
 */
export const getDb = () => {
	if (!dbInstance) {
		dbInstance = new DatabaseManager();
	}
	return dbInstance;
};

/** Shared {@link DatabaseManager} instance. Call `.init()` before use. */
export const db = getDb();
