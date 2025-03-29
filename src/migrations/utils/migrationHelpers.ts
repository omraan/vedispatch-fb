import * as admin from "firebase-admin";
import * as functions from "firebase-functions";

/**
 * Algemene interface voor basismigratieresultaten
 */
export interface BaseMigrationResult {
	processed: number;
	skipped: number;
	total: number;
	errors: any[];
}

/**
 * Verwerkt data in batches om geheugengebruik te beperken en timeouts te voorkomen.
 *
 * @param items De items om te verwerken
 * @param batchProcessor Functie die een batch verwerkt
 * @param batchSize Grootte van elke batch
 * @param onBatchComplete Callback na elke batch
 */
export async function processBatch<T, R>(
	items: T[],
	batchProcessor: (batch: T[]) => Promise<R>,
	batchSize = 100,
	onBatchComplete?: (batchResult: R, batchNumber: number, totalBatches: number) => void
): Promise<R[]> {
	const results: R[] = [];
	const totalBatches = Math.ceil(items.length / batchSize);

	for (let i = 0; i < items.length; i += batchSize) {
		const batch = items.slice(i, i + batchSize);
		const batchNumber = Math.floor(i / batchSize) + 1;

		try {
			const result = await batchProcessor(batch);
			results.push(result);

			if (onBatchComplete) {
				onBatchComplete(result, batchNumber, totalBatches);
			}
		} catch (error) {
			console.error(`Error processing batch ${batchNumber}/${totalBatches}:`, error);
			throw error;
		}
	}

	return results;
}

/**
 * Maakt een log-entry in de database voor een migratie.
 *
 * @param migrationName Naam van de migratie
 * @param data Migratiegegevens om op te slaan
 */
export async function logMigration(
	migrationName: string,
	data: {
		startTime: number;
		endTime: number;
		result: any;
		params?: any;
	}
): Promise<void> {
	try {
		const migrationsRef = admin.database().ref("/migrations");
		const entry = {
			...data,
			migrationName,
			timestamp: Date.now(),
			durationSeconds: (data.endTime - data.startTime) / 1000,
		};

		await migrationsRef.push(entry);
	} catch (error) {
		console.error("Failed to log migration:", error);
	}
}

export interface MigrationProgress {
	total: number;
	processed: number;
	skipped: number;
	failed: number;
	succeeded: number;
}

export interface MigrationError {
	id: string;
	error: string;
}

export interface MigrationResult extends MigrationProgress {
	completedAt: string;
	startedAt: string;
	duration: number;
	dryRun: boolean;
	errors: MigrationError[];
}

/**
 * Initializes a migration result object
 */
export function initMigrationResult(dryRun = false): MigrationResult {
	const now = new Date().toISOString();
	return {
		startedAt: now,
		completedAt: now,
		duration: 0,
		dryRun,
		total: 0,
		processed: 0,
		skipped: 0,
		failed: 0,
		succeeded: 0,
		errors: [],
	};
}

/**
 * Processes data in batches to avoid timeouts on large datasets
 * @param items List of items to process
 * @param batchProcessor Function to process each batch
 * @param batchSize Size of each batch
 */
export async function processBatches<T>(
	items: T[],
	batchProcessor: (batch: T[]) => Promise<void>,
	batchSize = 100
): Promise<void> {
	const batches = [];
	for (let i = 0; i < items.length; i += batchSize) {
		batches.push(items.slice(i, i + batchSize));
	}

	for (const batch of batches) {
		await batchProcessor(batch);
	}
}

/**
 * Safely logs migration progress to a specified path in the database
 * @param migrationId Unique identifier for this migration run
 * @param result The migration result to log
 * @param dryRun If true, no data will be written
 */
export async function logMigrationProgress(
	migrationId: string,
	result: MigrationResult,
	path = "/migrations"
): Promise<void> {
	if (result.dryRun) {
		functions.logger.info("Dry run - not logging migration progress");
		return;
	}

	try {
		// Update the completion time and duration
		result.completedAt = new Date().toISOString();
		result.duration = new Date(result.completedAt).getTime() - new Date(result.startedAt).getTime();

		await admin.database().ref(`${path}/${migrationId}`).set(result);
	} catch (error) {
		functions.logger.error("Failed to log migration progress", error);
	}
}

/**
 * Creates a batch write operation for Firebase Realtime Database
 * @param updates Object of updates to apply
 * @param dryRun If true, updates will be logged but not applied
 */
export async function batchDatabaseUpdate(updates: Record<string, any>, dryRun = false): Promise<void> {
	if (dryRun) {
		functions.logger.info("Dry run - would apply the following updates:", Object.keys(updates).length, "paths");
		return;
	}

	if (Object.keys(updates).length === 0) {
		functions.logger.info("No updates to apply");
		return;
	}

	await admin.database().ref().update(updates);
}

/**
 * Safely checks if a value exists at the given database path
 */
export async function doesPathExist(path: string): Promise<boolean> {
	try {
		const snapshot = await admin.database().ref(path).once("value");
		return snapshot.exists();
	} catch (error) {
		functions.logger.error("Error checking if path exists:", path, error);
		return false;
	}
}

/**
 * Gets a timestamp string for use in migration runs
 */
export function getMigrationTimestamp(): string {
	return new Date().toISOString().replace(/[:.]/g, "-");
}

/**
 * Creates a unique ID for a migration run
 */
export function createMigrationRunId(type: string): string {
	return `${type}_${getMigrationTimestamp()}`;
}
