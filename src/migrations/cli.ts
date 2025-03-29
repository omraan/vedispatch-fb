#!/usr/bin/env node
/**
 * Command-line tool for executing and validating database migrations.
 *
 * Usage:
 *   npm run migrate -- customers --dryRun
 *   npm run migrate -- validate-customers --org=myOrgId
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

interface CommandResult {
	success: boolean;
	message: string;
	result?: BaseMigrationResult;
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
		const projectId =
			process.env.GCLOUD_PROJECT || (admin.app().options as any).projectId || "innova-gps-tracking-dev";

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
		const projectId =
			process.env.GCLOUD_PROJECT || (admin.app().options as any).projectId || "innova-gps-tracking-dev";

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
	.demandCommand(1, "You must specify a command")
	.strict()
	.help()
	.parse();
