import * as admin from "firebase-admin";
import { findLocationViaOpenStreetMaps } from "./api";
import { isInvalidCoordinate } from "./sanitizeCoordinates";
import { ArugasData } from "./types";
import { replaceInvalidStreetNames } from "./utils";

export const checkAndAddCustomers = async (
	trimmedData: ArugasData[],
	organizationId: string,
	lastCylindersId: string | null,
	customCustomerTypeId: string | null
): Promise<any> => {
	const customersRef = admin.database().ref(`/organizations/${organizationId}/customers`);
	const customersSnapshot = await customersRef.once("value");
	let customers = customersSnapshot.val() || {};

	const locationsRef = admin.database().ref(`/organizations/${organizationId}/locations`);

	const updatesCustomer: { [key: string]: any } = {};
	const updatesLocation: { [key: string]: any } = {};
	const addedCustomers = new Set<string>();

	try {
		// Eerst verzamelen we alle updates
		for (const item of trimmedData) {
			if (addedCustomers.has(item.clientID)) {
				continue;
			}
			const matchedCustomerId = Object.keys(customers).find((key) => customers[key].code === item.clientID);
			const last_six_cylinders = `${item.Cylinder1};${item.Cylinder2};${item.Cylinder3};${item.Cylinder4};${item.Cylinder5};${item.Cylinder6}`;

			// A) Bestaat de klant nog niet? => nieuwe klant en nieuwe locatie
			if (!matchedCustomerId) {
				// Zet customer-data
				const newCustomerRef = customersRef.push();
				const newCustomerId = newCustomerRef.key;

				const phoneNumbers = item.clientPhone ? item.clientPhone.split(" ").filter(Boolean) : [];
				const newLocationRef = locationsRef.push();
				const newLocationId = newLocationRef.key;

				let latitude = item.latitude;
				let longitude = item.longitude;
				let sanitizedStreetName = item.clientStreetName || "";

				// Only call OpenStreetMap API if coordinates are invalid
				if (
					!latitude ||
					!longitude ||
					parseFloat(latitude) === 0 ||
					parseFloat(longitude) === 0 ||
					isInvalidCoordinate(parseFloat(latitude), parseFloat(longitude))
				) {
					console.log(
						`Invalid coordinates for customer ${item.clientID} (${latitude}, ${longitude}). Attempting to geocode address.`
					);
					sanitizedStreetName = replaceInvalidStreetNames(item.clientStreetName || "");

					// Only make API call if we have a meaningful address
					if (sanitizedStreetName.trim() || item.clientHouseNumber?.trim()) {
						const location = await findLocationViaOpenStreetMaps({
							streetName: sanitizedStreetName,
							streetNumber: item.clientHouseNumber || "",
							city: "",
						});
						latitude = location.latitude;
						longitude = location.longitude;
					} else {
						console.log(
							`No valid address to geocode for customer ${item.clientID}, using default coordinates.`
						);
						latitude = "0";
						longitude = "0";
					}
				} else {
					console.log(`Valid coordinates found for customer ${item.clientID}: ${latitude}, ${longitude}`);
				}

				// Zet location-data
				const newLocation: any = {
					title: "Location 1",
					postalCode: "",
					country: "Aruba",
					notes: "",
					customerId: newCustomerId,
					streetName: sanitizedStreetName || "",
					streetNumber: item.clientHouseNumber || "",
					latitude,
					longitude,
					city: "",
					type: "CONSUMER",
					isDefault: true,
					serviceTime: "00:05:00",
				};

				newLocation.createdBy = "System";
				newLocation.createdAt = Date.now();
				newLocation.modifiedBy = "System";
				newLocation.modifiedAt = Date.now();
				if (newLocationId) {
					updatesLocation[newLocationId] = newLocation;
				}

				if (newCustomerId) {
					const customFields: any[] = [];
					if (lastCylindersId) {
						customFields.push({
							fieldId: lastCylindersId,
							fieldName: "last_cylinders",
							value: last_six_cylinders || "",
						});
					}
					if (customCustomerTypeId) {
						customFields.push({
							fieldId: customCustomerTypeId,
							fieldName: "customer_type",
							value: item.Type,
						});
					}
					const newCustomer: any = {
						firstName: "",
						lastName: item.clientname,
						companyName: "",
						email: "",
						code: item.clientID,
						phoneNumbers: phoneNumbers.map((phoneNumber: string) => ({
							type: "MOBILE",
							countryCode: "+297",
							number: phoneNumber,
						})),
						notes: item.Client_notes || "",
						type: item.Type === "Domestic" ? "PRIVATE" : "COMMERCIAL",
						defaultLocationId: newLocationId,
						locationIds: [newLocationId],
						customFields,
					};

					newCustomer.createdBy = "System";
					newCustomer.createdAt = Date.now();
					newCustomer.modifiedBy = "System";
					newCustomer.modifiedAt = Date.now();
					updatesCustomer[newCustomerId] = newCustomer;
				}
			} else {
				// B) Klant bestaat al => alleen last_six_cylinders updaten
				const matchedCustomer = customers[matchedCustomerId];
				const last_six_cylinders = `${item.Cylinder1};${item.Cylinder2};${item.Cylinder3};${item.Cylinder4};${item.Cylinder5};${item.Cylinder6}`;

				if (last_six_cylinders && lastCylindersId) {
					const updatedCustomFields = [...(matchedCustomer.customFields || [])];
					const customFieldIndex = updatedCustomFields.findIndex(
						(cf: any) => cf.fieldName === "last_cylinders"
					);

					if (customFieldIndex >= 0) {
						// Update bestaande last_cylinders field
						updatedCustomFields[customFieldIndex] = {
							...updatedCustomFields[customFieldIndex],
							value: last_six_cylinders,
						};
					} else {
						// Voeg nieuwe last_cylinders field toe
						updatedCustomFields.push({
							fieldId: lastCylindersId,
							fieldName: "last_cylinders",
							value: last_six_cylinders,
						});
					}

					// Update alleen de customFields van de klant
					updatesCustomer[matchedCustomerId] = {
						...matchedCustomer,
						customFields: updatedCustomFields,
						modifiedAt: Date.now(),
						modifiedBy: "System",
					};
				}
			}
			addedCustomers.add(item.clientID);
		}

		// Voer alle updates uit
		await customersRef.update(updatesCustomer);
		await locationsRef.update(updatesLocation);
	} catch (error) {
		console.error(`Fout bij het controleren/updaten van klanten/locaties`, error);
		throw error;
	}
};
