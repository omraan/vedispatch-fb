#!/usr/bin/env node
/**
 * Command-line tool for executing and validating database migrations.
 *
 * Usage:
 *   npm run migrate -- customers --dryRun
 *   npm run migrate -- validate-customers --org=myOrgId
 *   npm run migrate -- project-info  (shows current project info)
 */
import * as admin from "firebase-admin";
import fetch from "node-fetch";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { BaseMigrationResult, getMigrationTimestamp } from "./utils/migrationHelpers";

// Initialize Firebase if not already initialized
if (!admin.apps.length) {
	admin.initializeApp();
}

// Helper function to get the current Firebase project ID
function getCurrentProjectId(): string {
	// Probeer eerst projectId uit de Firebase CLI configuratie te krijgen
	try {
		const child_process = require("child_process");
		// Gebruik 'firebase use --json' om het huidige project te bepalen in JSON formaat
		const result = child_process.execSync("firebase use --json", { encoding: "utf8" });
		const firebaseConfig = JSON.parse(result);
		if (firebaseConfig && firebaseConfig.result) {
			return firebaseConfig.result;
		}
	} catch (error: any) {
		console.warn("Could not retrieve project ID from Firebase CLI:", error.message);
	}

	// Fallback naar de app configuratie
	return process.env.GCLOUD_PROJECT || (admin.app().options as any).projectId || "innova-gps-tracking-dev";
}

// Helper function to determine project environment
function getProjectEnvironment(projectId: string): "development" | "testing" | "production" | "unknown" {
	if (projectId.includes("-dev")) return "development";
	if (projectId.includes("-test")) return "testing";
	if (projectId === "innova-gps-tracking") return "production";
	return "unknown";
}

// Get information about the current Firebase project
async function getProjectInfo(): Promise<CommandResult> {
	try {
		const projectId = getCurrentProjectId();
		const environment = getProjectEnvironment(projectId);
		const functionBase = `https://us-central1-${projectId}.cloudfunctions.net`;

		console.log("\n=== Firebase Project Information ===");
		console.log(`Project ID:       ${projectId}`);
		console.log(`Environment:      ${environment}`);
		console.log(`Function Base:    ${functionBase}`);
		console.log(`Admin SDK Auth:   ${admin.auth().app.name}`);
		console.log("================================\n");

		return {
			success: true,
			message: "Project information retrieved successfully",
			result: {
				processed: 0,
				skipped: 0,
				total: 0,
				errors: [],
				projectId,
				environment,
				functionBase,
			},
		};
	} catch (error) {
		console.error("Error retrieving project information:", error);
		return {
			success: false,
			message: "Failed to retrieve project information",
			error,
		};
	}
}

interface CommandResult {
	success: boolean;
	message: string;
	result?: BaseMigrationResult & {
		projectId?: string;
		environment?: string;
		functionBase?: string;
	};
	error?: any;
}

/**
 * Execute customer migration process by calling the Firebase Function
 */
async function runCustomerMigration(options: {
	dryRun?: boolean;
	orgId?: string;
	batchSize?: number;
	skipExisting?: boolean;
}): Promise<CommandResult> {
	try {
		const timestamp = getMigrationTimestamp();
		console.log(`Starting customer migration at ${timestamp}`);
		console.log("Options:", options);

		// Get the current Firebase project ID
		const projectId = getCurrentProjectId();

		// Build the URL to call the HTTP function
		let url = `https://us-central1-${projectId}.cloudfunctions.net/importCustomers`;

		// Add query parameters
		const params = new URLSearchParams();
		if (options.dryRun !== undefined) {
			params.append("dryRun", options.dryRun.toString());
		}

		if (options.orgId) {
			params.append("organizationId", options.orgId);
		}

		if (options.batchSize) {
			params.append("batchSize", options.batchSize.toString());
		}

		if (options.skipExisting !== undefined) {
			params.append("skipExisting", options.skipExisting.toString());
		}

		// Add params to URL if there are any
		if (params.toString()) {
			url += `?${params.toString()}`;
		}

		console.log(`Calling Firebase Function: ${url}`);

		// Call the function
		const response = await fetch(url);

		if (!response.ok) {
			throw new Error(`HTTP error! Status: ${response.status}, ${await response.text()}`);
		}

		const result = await response.json();

		// Extract the migration results from the response
		const migrationResult = result.summary || result;

		return {
			success: true,
			message: `Customer migration ${options.dryRun ? "(dry run) " : ""}completed successfully`,
			result: {
				processed: migrationResult.totalProcessed || migrationResult.processed || 0,
				skipped: migrationResult.totalSkipped || migrationResult.skipped || 0,
				total: migrationResult.totalCustomers || migrationResult.total || 0,
				errors: migrationResult.errors || [],
			},
		};
	} catch (error) {
		console.error("Migration error:", error);
		return {
			success: false,
			message: "Customer migration failed",
			error,
		};
	}
}

/**
 * Execute customer migration validation by calling the Firebase Function
 */
async function runValidateCustomerMigration(options: {
	orgId?: string;
	detailedReport?: boolean;
	generateFixScript?: boolean;
}): Promise<CommandResult> {
	try {
		const timestamp = getMigrationTimestamp();
		console.log(`Starting customer migration validation at ${timestamp}`);
		console.log("Options:", options);

		// Get the current Firebase project ID
		const projectId = getCurrentProjectId();

		// Build the URL to call the HTTP function
		let url = `https://us-central1-${projectId}.cloudfunctions.net/validateCustomerMigration`;

		// Add query parameters
		const params = new URLSearchParams();
		if (options.orgId) {
			params.append("organizationId", options.orgId);
		}

		if (options.detailedReport !== undefined) {
			params.append("detailedReport", options.detailedReport.toString());
		}

		if (options.generateFixScript !== undefined) {
			params.append("generateFixScript", options.generateFixScript.toString());
		}

		// Add params to URL if there are any
		if (params.toString()) {
			url += `?${params.toString()}`;
		}

		console.log(`Calling Firebase Function: ${url}`);

		// Call the function
		const response = await fetch(url);

		if (!response.ok) {
			throw new Error(`HTTP error! Status: ${response.status}, ${await response.text()}`);
		}

		const result = await response.json();

		// Extract the validation results
		const validationResults = result.validationResults || result;

		// If we have multiple organization results, aggregate them
		let processed = 0;
		let skipped = 0;
		let total = 0;
		let errors: any[] = [];

		if (Array.isArray(validationResults)) {
			validationResults.forEach((res: any) => {
				processed += res.processed || 0;
				skipped += res.skipped || 0;
				total += res.total || 0;
				if (res.errors && res.errors.length) {
					errors = errors.concat(res.errors);
				}
			});
		} else {
			processed = validationResults.processed || 0;
			skipped = validationResults.skipped || 0;
			total = validationResults.total || 0;
			errors = validationResults.errors || [];
		}

		return {
			success: true,
			message: "Customer migration validation completed",
			result: {
				processed,
				skipped,
				total,
				errors,
			},
		};
	} catch (error) {
		console.error("Validation error:", error);
		return {
			success: false,
			message: "Customer migration validation failed",
			error,
		};
	}
}

/**
 * Roll back a customer migration by removing migrated customers
 */
async function runRollbackCustomerMigration(options: {
	dryRun?: boolean;
	orgId?: string;
	cutoffTime?: number;
}): Promise<CommandResult> {
	try {
		const timestamp = getMigrationTimestamp();
		console.log(`Starting customer migration rollback at ${timestamp}`);
		console.log("Options:", options);

		// Get the current Firebase project ID
		const projectId = getCurrentProjectId();

		// Build the URL to call the HTTP function
		let url = `https://us-central1-${projectId}.cloudfunctions.net/rollbackCustomerMigration`;

		// Add query parameters
		const params = new URLSearchParams();
		if (options.dryRun !== undefined) {
			params.append("dryRun", options.dryRun.toString());
		}

		if (options.orgId) {
			params.append("organizationId", options.orgId);
		}

		if (options.cutoffTime) {
			params.append("cutoffTime", options.cutoffTime.toString());
		}

		// Add params to URL if there are any
		if (params.toString()) {
			url += `?${params.toString()}`;
		}

		console.log(`Calling Firebase Function: ${url}`);

		// Call the function
		const response = await fetch(url);

		if (!response.ok) {
			throw new Error(`HTTP error! Status: ${response.status}, ${await response.text()}`);
		}

		const result = await response.json();

		// Extract the rollback results from the response
		const rollbackResult = result.summary || result;

		return {
			success: true,
			message: `Customer migration rollback ${options.dryRun ? "(dry run) " : ""}completed successfully`,
			result: {
				processed: rollbackResult.processed || 0,
				skipped: rollbackResult.skipped || 0,
				total: rollbackResult.total || 0,
				errors: rollbackResult.errors || [],
			},
		};
	} catch (error) {
		console.error("Rollback error:", error);
		return {
			success: false,
			message: "Customer migration rollback failed",
			error,
		};
	}
}

/**
 * Restore database from a backup file
 */
async function runRestoreFromBackup(options: {
	backupPath: string;
	targetPath?: string;
	dryRun?: boolean;
}): Promise<CommandResult> {
	try {
		const timestamp = getMigrationTimestamp();
		console.log(`Starting database restore at ${timestamp}`);
		console.log("Options:", options);

		if (!options.backupPath) {
			return {
				success: false,
				message: "Missing required parameter: backupPath",
				error: new Error("backupPath is required"),
			};
		}

		// Get the current Firebase project ID
		const projectId = getCurrentProjectId();

		// Build the URL to call the HTTP function
		let url = `https://us-central1-${projectId}.cloudfunctions.net/restoreFromBackup`;

		// Add query parameters
		const params = new URLSearchParams();
		params.append("backupPath", options.backupPath);

		if (options.targetPath) {
			params.append("targetPath", options.targetPath);
		}

		if (options.dryRun !== undefined) {
			params.append("dryRun", options.dryRun.toString());
		}

		// Add params to URL if there are any
		if (params.toString()) {
			url += `?${params.toString()}`;
		}

		console.log(`Calling Firebase Function: ${url}`);

		// Call the function
		const response = await fetch(url);

		if (!response.ok) {
			throw new Error(`HTTP error! Status: ${response.status}, ${await response.text()}`);
		}

		const result = await response.json();

		// Extract the results
		const summary = result.summary || {};

		return {
			success: true,
			message: `Database restore ${options.dryRun ? "(dry run) " : ""}completed successfully`,
			result: {
				processed: summary.nodesCount || 0,
				skipped: 0,
				total: summary.nodesCount || 0,
				errors: [],
			},
		};
	} catch (error) {
		console.error("Restore error:", error);
		return {
			success: false,
			message: "Database restore failed",
			error,
		};
	}
}

// Setup command structure with yargs
yargs(hideBin(process.argv))
	.command(
		"customers",
		"Migrate customers from old to new structure",
		(yargsInstance) => {
			return yargsInstance
				.option("dryRun", {
					type: "boolean",
					default: false,
					describe: "Perform a simulation without modifying data",
				})
				.option("orgId", {
					type: "string",
					describe: "Specific organization ID to migrate",
				})
				.option("batchSize", {
					type: "number",
					default: 100,
					describe: "Number of customers per batch",
				})
				.option("skipExisting", {
					type: "boolean",
					default: true,
					describe: "Skip existing customers",
				});
		},
		async (argv) => {
			const result = await runCustomerMigration({
				dryRun: argv.dryRun as boolean | undefined,
				orgId: argv.orgId as string | undefined,
				batchSize: argv.batchSize as number | undefined,
				skipExisting: argv.skipExisting as boolean | undefined,
			});

			if (result.success) {
				console.log("\x1b[32m%s\x1b[0m", result.message);
				console.log("Result:", result.result);
			} else {
				console.error("\x1b[31m%s\x1b[0m", result.message);
				console.error(result.error);
				process.exit(1);
			}
		}
	)
	.command(
		"validate-customers",
		"Validate if customers were correctly migrated",
		(yargsInstance) => {
			return yargsInstance
				.option("orgId", {
					type: "string",
					describe: "Specific organization ID to validate",
				})
				.option("detailedReport", {
					type: "boolean",
					default: false,
					describe: "Generate a detailed report",
				})
				.option("generateFixScript", {
					type: "boolean",
					default: false,
					describe: "Generate a script to fix issues",
				});
		},
		async (argv) => {
			const result = await runValidateCustomerMigration({
				orgId: argv.orgId as string | undefined,
				detailedReport: argv.detailedReport as boolean | undefined,
				generateFixScript: argv.generateFixScript as boolean | undefined,
			});

			if (result.success) {
				console.log("\x1b[32m%s\x1b[0m", result.message);
				console.log("Result:", result.result);
			} else {
				console.error("\x1b[31m%s\x1b[0m", result.message);
				console.error(result.error);
				process.exit(1);
			}
		}
	)
	.command(
		"rollback-customers",
		"Roll back customer migration by removing migrated customers",
		(yargsInstance) => {
			return yargsInstance
				.option("dryRun", {
					type: "boolean",
					default: true, // Default to dry run for safety
					describe: "Perform a simulation without modifying data",
				})
				.option("orgId", {
					type: "string",
					describe: "Specific organization ID to roll back",
				})
				.option("cutoffTime", {
					type: "number",
					describe: "Unix timestamp - only roll back customers created after this time",
				});
		},
		async (argv) => {
			const result = await runRollbackCustomerMigration({
				dryRun: argv.dryRun as boolean | undefined,
				orgId: argv.orgId as string | undefined,
				cutoffTime: argv.cutoffTime as number | undefined,
			});

			if (result.success) {
				console.log("\x1b[32m%s\x1b[0m", result.message);
				console.log("Result:", result.result);
			} else {
				console.error("\x1b[31m%s\x1b[0m", result.message);
				console.error(result.error);
				process.exit(1);
			}
		}
	)
	.command(
		"restore",
		"Restore database from a backup file",
		(yargsInstance) => {
			return yargsInstance
				.option("backupPath", {
					type: "string",
					demandOption: true,
					describe: "Path to the backup file (JSON)",
				})
				.option("targetPath", {
					type: "string",
					default: "/",
					describe: "Target path in the database to restore to",
				})
				.option("dryRun", {
					type: "boolean",
					default: true, // Default to dry run for safety
					describe: "Perform a simulation without modifying data",
				});
		},
		async (argv) => {
			const result = await runRestoreFromBackup({
				backupPath: argv.backupPath as string,
				targetPath: argv.targetPath as string,
				dryRun: argv.dryRun as boolean | undefined,
			});

			if (result.success) {
				console.log("\x1b[32m%s\x1b[0m", result.message);
				console.log("Result:", result.result);
			} else {
				console.error("\x1b[31m%s\x1b[0m", result.message);
				console.error(result.error);
				process.exit(1);
			}
		}
	)
	.command(
		"project-info",
		"Display information about the current Firebase project",
		() => {},
		async () => {
			const result = await getProjectInfo();
			if (result.success) {
				console.log("\x1b[32m%s\x1b[0m", result.message);
			} else {
				console.error("\x1b[31m%s\x1b[0m", result.message);
				console.error(result.error);
				process.exit(1);
			}
		}
	)
	.demandCommand(1, "You must specify a command")
	.strict()
	.help()
	.parse();
