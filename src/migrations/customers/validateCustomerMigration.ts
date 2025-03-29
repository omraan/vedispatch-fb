import * as admin from "firebase-admin";
import * as functions from "firebase-functions";
import { BaseMigrationResult, logMigration } from "../utils/migrationHelpers";

interface ValidationSummary extends BaseMigrationResult {
	organizationId: string;
	totalOldCustomers: number;
	totalNewCustomers: number;
	missingCustomers: string[]; // Codes van klanten die missen
	invalidCustomers: Array<{
		code: string;
		issues: string[];
	}>;
	validCustomers: number;
}

/**
 * Valideert of de klantmigratie correct is verlopen door te controleren of alle
 * oude klanten goed zijn overgezet naar de nieuwe structuur.
 */
export const validateCustomerMigration = functions.https.onRequest(async (req, res) => {
	// Start timing voor performance metrics
	const startTime = Date.now();

	try {
		// Get parameters
		const specificOrganizationId = req.query.organizationId as string | undefined;
		const generateFixScript = req.query.generateFixScript === "true";
		const detailedReport = req.query.detailedReport === "true";

		console.log(`Validation started with config:`, {
			specificOrganizationId: specificOrganizationId || "all",
			generateFixScript,
			detailedReport,
		});

		// First get all old customers
		const oldCustomersRef = admin.database().ref("/customers");
		const oldCustomersSnapshot = await oldCustomersRef.once("value");
		const oldCustomers = oldCustomersSnapshot.val() || {};

		if (Object.keys(oldCustomers).length === 0) {
			res.status(404).send("No customers found in old structure");
			return;
		}

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

		// Validate each organization
		const validationResults: ValidationSummary[] = [];
		const fixScripts: string[] = [];

		for (const organizationId of orgIds) {
			console.log(`Validating organization: ${organizationId}`);

			const customersRef = admin.database().ref(`/organizations/${organizationId}/customers`);
			const customersSnapshot = await customersRef.once("value");
			const customers = customersSnapshot.val() || {};

			const validationSummary: ValidationSummary = {
				organizationId,
				totalOldCustomers: Object.keys(oldCustomers).length,
				totalNewCustomers: Object.keys(customers).length,
				missingCustomers: [],
				invalidCustomers: [],
				validCustomers: 0,
				processed: 0,
				skipped: 0,
				total: Object.keys(oldCustomers).length,
				errors: [],
			};

			// Track customer codes that are found
			const foundCustomerCodes = new Set<string>();

			// Check each customer in the new structure
			for (const customerId in customers) {
				const customer = customers[customerId];
				validationSummary.processed++;

				if (!customer.code) {
					validationSummary.invalidCustomers.push({
						code: customerId,
						issues: ["Missing customer code"],
					});
					continue;
				}

				// Find matching old customer
				const oldCustomerId = Object.keys(oldCustomers).find((key) => oldCustomers[key].code === customer.code);

				if (!oldCustomerId) {
					// This is a new customer not from the migration
					validationSummary.skipped++;
					continue;
				}

				foundCustomerCodes.add(customer.code);

				const oldCustomer = oldCustomers[oldCustomerId];
				const issues: string[] = [];

				// Validate basic fields
				if (!customer.defaultLocationId) {
					issues.push("Missing defaultLocationId");
				} else {
					// Validate the location exists and has correct coordinates
					const locationRef = admin
						.database()
						.ref(`/organizations/${organizationId}/locations/${customer.defaultLocationId}`);
					const locationSnapshot = await locationRef.once("value");
					const location = locationSnapshot.val();

					if (!location) {
						issues.push("Referenced location does not exist");
					} else {
						// Verify location coordinates match original
						const oldLat = parseFloat(oldCustomer.lat) || 0;
						const oldLng = parseFloat(oldCustomer.lng) || 0;

						if (Math.abs(location.latitude - oldLat) > 0.00001) {
							issues.push(`Latitude mismatch: ${location.latitude} vs ${oldLat}`);
						}

						if (Math.abs(location.longitude - oldLng) > 0.00001) {
							issues.push(`Longitude mismatch: ${location.longitude} vs ${oldLng}`);
						}

						// Verify address info
						if (location.streetName !== oldCustomer.streetName) {
							issues.push(`Street name mismatch: ${location.streetName} vs ${oldCustomer.streetName}`);
						}

						if (location.streetNumber !== oldCustomer.streetNumber) {
							issues.push(
								`Street number mismatch: ${location.streetNumber} vs ${oldCustomer.streetNumber}`
							);
						}
					}
				}

				// Verify phone numbers
				const oldPhones = [oldCustomer.phoneNumber, oldCustomer.phoneNumber2, oldCustomer.phoneNumber3].filter(
					Boolean
				);

				const newPhones = (customer.phoneNumbers || []).map((p: any) => p.number);

				if (oldPhones.length > 0 && newPhones.length === 0) {
					issues.push("Missing phone numbers");
				}

				// If issues were found, add to invalid list
				if (issues.length > 0) {
					validationSummary.invalidCustomers.push({
						code: customer.code,
						issues,
					});
				} else {
					validationSummary.validCustomers++;
				}
			}

			// Find missing customers (in old structure but not migrated)
			for (const oldCustomerId in oldCustomers) {
				const oldCustomer = oldCustomers[oldCustomerId];
				if (!foundCustomerCodes.has(oldCustomer.code)) {
					validationSummary.missingCustomers.push(oldCustomer.code);
				}
			}

			validationResults.push(validationSummary);

			// Generate fix script if requested
			if (
				generateFixScript &&
				(validationSummary.missingCustomers.length > 0 || validationSummary.invalidCustomers.length > 0)
			) {
				let fixScript = `// Fix script for organization ${organizationId}\n`;

				// Fix for missing customers
				if (validationSummary.missingCustomers.length > 0) {
					fixScript += `\n// Import missing customers\n`;
					fixScript += `// Use: firebase functions:call importCustomers --data '{"organizationId": "${organizationId}", "customerCodes": ${JSON.stringify(
						validationSummary.missingCustomers
					)}}';\n\n`;
				}

				// Fix for invalid customers
				if (validationSummary.invalidCustomers.length > 0) {
					fixScript += `\n// Fix invalid customers\n`;

					for (const invalid of validationSummary.invalidCustomers) {
						fixScript += `// Customer ${invalid.code}: ${invalid.issues.join(", ")}\n`;

						// Find the customer ID
						const customerId = Object.keys(customers).find((key) => customers[key].code === invalid.code);

						if (customerId) {
							fixScript += `// Update with: firebase database:update /organizations/${organizationId}/customers/${customerId} '{ ... }'\n\n`;
						}
					}
				}

				fixScripts.push(fixScript);
			}
		}

		// Bereken resultaten
		const totalValidCustomers = validationResults.reduce((sum, result) => sum + result.validCustomers, 0);
		const totalMissingCustomers = validationResults.reduce(
			(sum, result) => sum + result.missingCustomers.length,
			0
		);
		const totalInvalidCustomers = validationResults.reduce(
			(sum, result) => sum + result.invalidCustomers.length,
			0
		);
		const endTime = Date.now();
		const executionTime = (endTime - startTime) / 1000; // in seconden

		const summary = {
			totalOrganizations: validationResults.length,
			totalOldCustomers: Object.keys(oldCustomers).length,
			totalValidCustomers,
			totalMissingCustomers,
			totalInvalidCustomers,
			validationCompleteness: ((totalValidCustomers / Object.keys(oldCustomers).length) * 100).toFixed(2) + "%",
			executionTimeSeconds: executionTime,
		};

		// Log de validatie
		await logMigration("validateCustomerMigration", {
			startTime,
			endTime,
			result: summary,
			params: {
				specificOrganizationId,
				generateFixScript,
				detailedReport,
			},
		});

		// Generate response
		const response: any = {
			summary,
			validationResults: validationResults.map((result) => {
				// Remove detailed lists if not requested
				if (!detailedReport) {
					return {
						organizationId: result.organizationId,
						totalOldCustomers: result.totalOldCustomers,
						totalNewCustomers: result.totalNewCustomers,
						missingCustomersCount: result.missingCustomers.length,
						invalidCustomersCount: result.invalidCustomers.length,
						validCustomers: result.validCustomers,
						migrationCompleteness:
							((result.validCustomers / result.totalOldCustomers) * 100).toFixed(2) + "%",
					};
				}
				return result;
			}),
		};

		if (generateFixScript) {
			response.fixScripts = fixScripts;
		}

		res.status(200).json(response);
	} catch (error) {
		console.error("Error during validation:", error);
		res.status(500).json({ error: "Validation failed", details: error });
	}
});
