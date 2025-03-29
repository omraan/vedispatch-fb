import * as admin from "firebase-admin";
import * as functions from "firebase-functions";
import { BaseMigrationResult, logMigration } from "../utils/migrationHelpers";

interface OldCustomer {
	city: string;
	code: string;
	email: string;
	lat: string;
	lng: string;
	name: string;
	phoneNumber: string;
	phoneNumber2: string;
	phoneNumber3: string;
	streetName: string;
	streetNumber: string;
}

interface ImportResult extends BaseMigrationResult {
	organizationId: string;
	customFields: {
		lastCylindersId: string | null;
		customCustomerTypeId: string | null;
	};
}

export const importCustomers = functions
	.runWith({
		timeoutSeconds: 540, // 9 minuten (max is 9 minuten voor HTTP functions)
		memory: "1GB",
	})
	.https.onRequest(async (req, res) => {
		// Start timing voor performance metrics
		const startTime = Date.now();

		// Haal configuratie op uit query parameters
		const specificOrganizationId = req.query.organizationId as string | undefined;
		const dryRun = req.query.dryRun === "true";
		const batchSize = parseInt((req.query.batchSize as string) || "100");
		const skipExisting = req.query.skipExisting !== "false"; // Default true

		console.log(`Import started with config:`, {
			specificOrganizationId: specificOrganizationId || "all",
			dryRun,
			batchSize,
			skipExisting,
		});

		try {
			// Eerst bepalen welke organisaties we gaan verwerken
			const orgsRef = admin.database().ref("/organizations");
			const orgsSnapshot = await orgsRef.once("value");
			const organizations = orgsSnapshot.val() || {};

			// Filter op specifieke organisatie indien opgegeven
			const orgIds = specificOrganizationId ? [specificOrganizationId] : Object.keys(organizations);

			if (orgIds.length === 0) {
				res.status(404).send("No organizations found");
				return;
			}

			console.log(`Found ${orgIds.length} organizations to process`);

			// Lees de oude customers data one-time
			const oldCustomersRef = admin.database().ref(`/customers`);
			const oldCustomersSnapshot = await oldCustomersRef.once("value");
			const oldCustomers = oldCustomersSnapshot.val() || {};

			if (Object.keys(oldCustomers).length === 0) {
				res.status(404).send("No customers found in old structure");
				return;
			}

			console.log(`Found ${Object.keys(oldCustomers).length} customers in old structure`);

			// Resultaten voor alle organisaties bijhouden
			const results: ImportResult[] = [];

			// Loop door elke organisatie
			for (const organizationId of orgIds) {
				console.log(`Processing organization: ${organizationId}`);

				try {
					const result = await processOrganization(organizationId, oldCustomers, {
						dryRun,
						batchSize,
						skipExisting,
					});
					results.push(result);
				} catch (err) {
					console.error(`Error processing organization ${organizationId}:`, err);
					results.push({
						organizationId,
						processed: 0,
						skipped: 0,
						total: Object.keys(oldCustomers).length,
						errors: [err],
						customFields: {
							lastCylindersId: null,
							customCustomerTypeId: null,
						},
					});
				}
			}

			// Bereken resultaten
			const totalProcessed = results.reduce((sum, result) => sum + result.processed, 0);
			const totalSkipped = results.reduce((sum, result) => sum + result.skipped, 0);
			const endTime = Date.now();
			const executionTime = (endTime - startTime) / 1000; // in seconden

			const summary = {
				totalOrganizations: results.length,
				totalProcessed,
				totalSkipped,
				totalCustomers: Object.keys(oldCustomers).length,
				executionTimeSeconds: executionTime,
				dryRun,
			};

			// Log de migratie, maar alleen als het geen dry run is
			if (!dryRun) {
				await logMigration("importCustomers", {
					startTime,
					endTime,
					result: summary,
					params: {
						specificOrganizationId,
						batchSize,
						skipExisting,
					},
				});
			}

			// Stuur resultaten terug
			res.status(200).json({
				summary,
				organizationResults: results,
			});
		} catch (error) {
			console.error("Unexpected error during import:", error);
			res.status(500).json({
				error: "Unexpected error during import",
				details: error,
			});
		}
	});

async function processOrganization(
	organizationId: string,
	oldCustomers: Record<string, OldCustomer>,
	options: {
		dryRun: boolean;
		batchSize: number;
		skipExisting: boolean;
	}
): Promise<ImportResult> {
	const { dryRun, batchSize, skipExisting } = options;

	console.log(`Processing org ${organizationId} with options:`, { dryRun, batchSize, skipExisting });

	// Resultaat object initialiseren
	const result: ImportResult = {
		organizationId,
		processed: 0,
		skipped: 0,
		total: Object.keys(oldCustomers).length,
		errors: [],
		customFields: {
			lastCylindersId: null,
			customCustomerTypeId: null,
		},
	};

	// Haal custom field definities op of maak ze aan
	const customFieldsRef = admin.database().ref(`/organizations/${organizationId}/custom-field-definitions`);
	const customFieldsSnapshot = await customFieldsRef.once("value");
	const customFields = customFieldsSnapshot.val() || {};

	let lastCylindersId: string | null = null;
	let customCustomerTypeId: string | null = null;

	if (Object.keys(customFields).length === 0) {
		// Maak de custom fields aan als ze niet bestaan (behalve in dry-run)
		console.log(`Creating custom fields for org ${organizationId}...`);

		if (!dryRun) {
			const lastCylindersRef = customFieldsRef.push({
				createdAt: Date.now(),
				createdBy: "system",
				description: "Last 6 cylinders",
				entityType: "CUSTOMER",
				label: "bon_cylinder",
				modifiedAt: Date.now(),
				modifiedBy: "system",
				name: "last_cylinders",
				required: false,
				separator: ";",
				type: "TEXT",
			});
			lastCylindersId = lastCylindersRef.key;

			const customCustomerTypeRef = customFieldsRef.push({
				createdAt: Date.now(),
				createdBy: "system",
				description: "Type of customer, e.g. Private, Business",
				entityType: "CUSTOMER",
				label: "bon_cylinder",
				modifiedAt: Date.now(),
				modifiedBy: "system",
				name: "custom_customer_type",
				required: false,
				type: "TEXT",
			});
			customCustomerTypeId = customCustomerTypeRef.key;
		} else {
			// In dry-run modus gebruiken we tijdelijke IDs
			lastCylindersId = "dry-run-cylinders-id";
			customCustomerTypeId = "dry-run-customer-type-id";
			console.log("Dry run: skipping custom field creation");
		}
	} else {
		// Zoek bestaande custom field definities
		lastCylindersId = Object.keys(customFields).find((key) => customFields[key].name === "last_cylinders") || null;
		customCustomerTypeId =
			Object.keys(customFields).find((key) => customFields[key].name === "custom_customer_type") || null;
	}

	if (!lastCylindersId || !customCustomerTypeId) {
		const error = "Failed to create or retrieve custom field definitions.";
		result.errors.push(error);
		console.error(error);
		return result;
	}

	result.customFields.lastCylindersId = lastCylindersId;
	result.customFields.customCustomerTypeId = customCustomerTypeId;

	// Refs voor de nieuwe data structuur
	const customersRef = admin.database().ref(`/organizations/${organizationId}/customers`);
	const locationsRef = admin.database().ref(`/organizations/${organizationId}/locations`);

	// Haal bestaande customers en locaties op (om duplicaten te voorkomen)
	const customersSnapshot = await customersRef.once("value");
	const existingCustomers = customersSnapshot.val() || {};

	// Batch updates voor customers en locaties
	const updatesCustomer: { [key: string]: any } = {};
	const updatesLocation: { [key: string]: any } = {};

	// Loop door alle oude klanten
	const totalOldCustomers = Object.keys(oldCustomers).length;
	console.log(`Processing ${totalOldCustomers} customers for org ${organizationId}...`);

	for (const oldCustomerId in oldCustomers) {
		const oldCustomer: OldCustomer = oldCustomers[oldCustomerId];

		// Controleer of er al een klant bestaat met dezelfde code
		const existingCustomerId = Object.keys(existingCustomers).find(
			(key) => existingCustomers[key]?.code === oldCustomer.code
		);

		if (existingCustomerId && skipExisting) {
			result.skipped++;
			continue; // Skip deze klant als die al bestaat
		}

		// Verwerk de telefoonnummers
		const phoneNumbers = [];
		if (oldCustomer.phoneNumber) {
			phoneNumbers.push({
				type: "MOBILE",
				countryCode: "+297",
				number: oldCustomer.phoneNumber.trim(),
			});
		}
		if (oldCustomer.phoneNumber2) {
			phoneNumbers.push({
				type: "MOBILE",
				countryCode: "+297",
				number: oldCustomer.phoneNumber2.trim(),
			});
		}
		if (oldCustomer.phoneNumber3) {
			phoneNumbers.push({
				type: "MOBILE",
				countryCode: "+297",
				number: oldCustomer.phoneNumber3.trim(),
			});
		}

		// Genereer een nieuwe locatie ID
		let newLocationId: string | null;
		if (!dryRun) {
			const newLocationRef = locationsRef.push();
			newLocationId = newLocationRef.key;

			if (!newLocationId) {
				console.error(`Failed to create location key for customer ${oldCustomer.code}`);
				result.errors.push(`Failed to create location key for customer ${oldCustomer.code}`);
				continue;
			}
		} else {
			// In dry-run modus, genereer een fake key
			newLocationId = `dry-run-loc-${oldCustomerId}`;
		}

		// Creëer de locatie data
		const newLocation: any = {
			title: "Location 1",
			postalCode: "",
			country: "Aruba",
			notes: "",
			streetName: oldCustomer.streetName || "",
			streetNumber: oldCustomer.streetNumber || "",
			latitude: parseFloat(oldCustomer.lat) || 0,
			longitude: parseFloat(oldCustomer.lng) || 0,
			city: oldCustomer.city || "",
			type: "CONSUMER",
			isDefault: true,
			serviceTime: "00:05:00",
			events: [
				{
					timestamp: Date.now(),
					description: "Location created during import",
					changedBy: "System",
					changed: {
						action: "import",
						source: "old_database",
					},
				},
			],
			createdBy: "System",
			createdAt: Date.now(),
			modifiedBy: "System",
			modifiedAt: Date.now(),
		};

		// Genereer een nieuwe customer ID
		let newCustomerId: string | null;
		if (!dryRun) {
			const newCustomerRef = customersRef.push();
			newCustomerId = newCustomerRef.key;

			if (!newCustomerId) {
				console.error(`Failed to create customer key for customer ${oldCustomer.code}`);
				result.errors.push(`Failed to create customer key for customer ${oldCustomer.code}`);
				continue;
			}
		} else {
			// In dry-run modus, genereer een fake key
			newCustomerId = `dry-run-cust-${oldCustomerId}`;
		}

		// Probeer voor- en achternaam te scheiden
		let firstName = "";
		let lastName = oldCustomer.name;
		let companyName = "";

		// Als de naam zakelijk lijkt (bevat BV, NV, etc.)
		const isCompany = /\b(BV|NV|Inc|LLC|LTD|GmbH|Corp|Corporation|Company)\b/i.test(oldCustomer.name);
		if (isCompany) {
			companyName = oldCustomer.name;
			lastName = "";
		} else {
			// Simpele splitsing op eerste spatie
			const nameParts = oldCustomer.name.split(" ");
			if (nameParts.length > 1) {
				firstName = nameParts[0];
				lastName = nameParts.slice(1).join(" ");
			}
		}

		// Bepaal het klanttype (standaard PRIVATE)
		const customerType = isCompany ? "COMMERCIAL" : "PRIVATE";

		const customFields: any[] = [];
		if (lastCylindersId) {
			customFields.push({
				fieldId: lastCylindersId,
				fieldName: "last_cylinders",
				value: "", // Geen historische data voor cylinders
			});
		}
		if (customCustomerTypeId) {
			customFields.push({
				fieldId: customCustomerTypeId,
				fieldName: "custom_customer_type",
				value: customerType,
			});
		}

		const newCustomer: any = {
			firstName,
			lastName,
			companyName,
			email: oldCustomer.email || "",
			code: oldCustomer.code,
			phoneNumbers,
			notes: "",
			type: customerType,
			defaultLocationId: newLocationId,
			customFields,
			events: [
				{
					timestamp: Date.now(),
					description: "Customer created during import",
					changedBy: "System",
					changed: {
						action: "import",
						source: "old_database",
					},
				},
			],
			createdBy: "System",
			createdAt: Date.now(),
			modifiedBy: "System",
			modifiedAt: Date.now(),
		};

		// Voeg toe aan batch updates
		updatesLocation[newLocationId] = newLocation;
		updatesCustomer[newCustomerId] = newCustomer;

		result.processed++;

		// Process in batches om memory issues te voorkomen
		if (result.processed % batchSize === 0) {
			console.log(
				`Org ${organizationId}: Processed ${result.processed}/${totalOldCustomers} customers so far...`
			);

			if (!dryRun) {
				try {
					await customersRef.update(updatesCustomer);
					await locationsRef.update(updatesLocation);

					// Reset de batches
					Object.keys(updatesCustomer).forEach((key) => delete updatesCustomer[key]);
					Object.keys(updatesLocation).forEach((key) => delete updatesLocation[key]);
				} catch (err) {
					console.error(`Error updating batch for org ${organizationId}:`, err);
					result.errors.push(`Batch update error at ${result.processed} customers: ${err}`);
				}
			} else {
				console.log(
					`Dry run: would update ${Object.keys(updatesCustomer).length} customers and ${
						Object.keys(updatesLocation).length
					} locations`
				);
				// Reset de batches ook in dry-run
				Object.keys(updatesCustomer).forEach((key) => delete updatesCustomer[key]);
				Object.keys(updatesLocation).forEach((key) => delete updatesLocation[key]);
			}
		}
	}

	// Update de resterende klanten en locaties
	if (Object.keys(updatesCustomer).length > 0 && !dryRun) {
		try {
			await customersRef.update(updatesCustomer);
			await locationsRef.update(updatesLocation);
		} catch (err) {
			console.error(`Error updating final batch for org ${organizationId}:`, err);
			result.errors.push(`Final batch update error: ${err}`);
		}
	} else if (dryRun) {
		console.log(
			`Dry run: would update final batch of ${Object.keys(updatesCustomer).length} customers and ${
				Object.keys(updatesLocation).length
			} locations`
		);
	}

	console.log(`Import completed for org ${organizationId}:`, {
		processed: result.processed,
		skipped: result.skipped,
		errors: result.errors.length,
	});

	return result;
}
