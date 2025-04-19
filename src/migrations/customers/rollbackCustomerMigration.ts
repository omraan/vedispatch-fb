import * as admin from "firebase-admin";
import * as functions from "firebase-functions";
import { BaseMigrationResult, logMigration } from "../utils/migrationHelpers";

interface RollbackResult extends BaseMigrationResult {
	organizationId: string;
	removedCustomers: number;
	removedLocations: number;
}

/**
 * Rolls back the customer migration by removing migrated customers from the new structure.
 * This is intended for development/testing use only and should be used with caution.
 */
export const rollbackCustomerMigration = functions.https.onRequest(async (req, res) => {
	// Start timing for performance metrics
	const startTime = Date.now();

	try {
		// Get parameters
		const specificOrganizationId = req.query.organizationId as string | undefined;
		const dryRun = req.query.dryRun === "true";
		const migrationCutoffTime = parseInt(req.query.cutoffTime as string) || undefined;

		console.log(`Rollback started with config:`, {
			specificOrganizationId: specificOrganizationId || "all",
			dryRun,
			migrationCutoffTime: migrationCutoffTime ? new Date(migrationCutoffTime).toISOString() : "none",
		});

		// Get organizations
		const orgsRef = admin.database().ref("/organizations");
		const orgsSnapshot = await orgsRef.once("value");
		const organizations = orgsSnapshot.val() || {};

		// Filter to specific org if provided
		const orgIds = specificOrganizationId ? [specificOrganizationId] : Object.keys(organizations);

		if (orgIds.length === 0) {
			res.status(404).send("No organizations found");
			return;
		}

		// Process each organization
		const rollbackResults: RollbackResult[] = [];

		for (const organizationId of orgIds) {
			console.log(`Processing rollback for organization: ${organizationId}`);

			const result = await rollbackOrganization(organizationId, {
				dryRun,
				cutoffTime: migrationCutoffTime,
			});

			rollbackResults.push(result);
		}

		// Calculate results
		const totalRemoved = rollbackResults.reduce((sum, result) => sum + result.removedCustomers, 0);
		const totalLocationsRemoved = rollbackResults.reduce((sum, result) => sum + result.removedLocations, 0);
		const endTime = Date.now();
		const executionTime = (endTime - startTime) / 1000; // in seconds

		const summary = {
			totalOrganizations: rollbackResults.length,
			totalRemoved,
			totalLocationsRemoved,
			executionTimeSeconds: executionTime,
			dryRun,
		};

		// Log the migration, but only if it's not a dry run
		if (!dryRun) {
			await logMigration("rollbackCustomerMigration", {
				startTime,
				endTime,
				result: summary,
				params: {
					specificOrganizationId,
					migrationCutoffTime,
				},
			});
		}

		// Send results back
		res.status(200).json({
			summary,
			organizationResults: rollbackResults,
		});
	} catch (error) {
		console.error("Unexpected error during rollback:", error);
		res.status(500).json({
			error: "Unexpected error during rollback",
			details: error,
		});
	}
});

async function rollbackOrganization(
	organizationId: string,
	options: {
		dryRun: boolean;
		cutoffTime?: number;
	}
): Promise<RollbackResult> {
	const { dryRun, cutoffTime } = options;

	console.log(`Rolling back org ${organizationId} with options:`, { dryRun, cutoffTime });

	// Initialize result object
	const result: RollbackResult = {
		organizationId,
		processed: 0,
		skipped: 0,
		total: 0,
		errors: [],
		removedCustomers: 0,
		removedLocations: 0,
	};

	try {
		// Get customers in the new structure
		const customersRef = admin.database().ref(`/organizations/${organizationId}/customers`);
		const customersSnapshot = await customersRef.once("value");
		const customers = customersSnapshot.val() || {};

		result.total = Object.keys(customers).length;

		if (result.total === 0) {
			console.log(`No customers found for organization ${organizationId}`);
			return result;
		}

		console.log(`Found ${result.total} customers in organization ${organizationId}`);

		// Get locations in the new structure
		const locationsRef = admin.database().ref(`/organizations/${organizationId}/locations`);
		const locationsSnapshot = await locationsRef.once("value");
		const locations = locationsSnapshot.val() || {};

		// Keep track of customers and locations to remove
		const customersToRemove: string[] = [];
		const locationsToRemove: string[] = [];

		// Process each customer
		for (const customerId in customers) {
			result.processed++;

			const customer = customers[customerId];

			// Skip customers created before the cutoff time if specified
			if (cutoffTime && customer.createdAt && customer.createdAt < cutoffTime) {
				console.log(`Skipping customer ${customerId} as it was created before cutoff time`);
				result.skipped++;
				continue;
			}

			// Check if this customer was system-created (likely by the migration process)
			if (customer.createdBy === "System" || customer.createdBy === "system") {
				customersToRemove.push(customerId);

				// Also remove the corresponding location if it exists
				if (customer.defaultLocationId && locations[customer.defaultLocationId]) {
					const location = locations[customer.defaultLocationId];

					// Only remove the location if it was also system-created
					if (location.createdBy === "System" || location.createdBy === "system") {
						locationsToRemove.push(customer.defaultLocationId);
					}
				}
			} else {
				// This customer was not created by the system, so skip it
				result.skipped++;
			}
		}

		result.removedCustomers = customersToRemove.length;
		result.removedLocations = locationsToRemove.length;

		console.log(`Will remove ${result.removedCustomers} customers and ${result.removedLocations} locations`);

		// Actually remove customers and locations if not dry run
		if (!dryRun) {
			const removePromises: Promise<void>[] = [];

			// Remove customers
			for (const customerId of customersToRemove) {
				removePromises.push(customersRef.child(customerId).remove());
			}

			// Remove locations
			for (const locationId of locationsToRemove) {
				removePromises.push(locationsRef.child(locationId).remove());
			}

			// Wait for all remove operations to complete
			await Promise.all(removePromises);

			console.log(`Removed ${result.removedCustomers} customers and ${result.removedLocations} locations`);
		} else {
			console.log(
				`[DRY RUN] Would remove ${result.removedCustomers} customers and ${result.removedLocations} locations`
			);
		}

		return result;
	} catch (error) {
		console.error(`Error rolling back organization ${organizationId}:`, error);
		result.errors.push({
			id: organizationId,
			error: error instanceof Error ? error.message : String(error),
		});
		return result;
	}
}
