import * as admin from "firebase-admin";
import * as functions from "firebase-functions";
import { checkAndAddCustomers } from "./customers";
import { addOptimizedRoutes } from "./routes";
import { ArugasData, Route } from "./types";
import { checkAndAddVehicles } from "./vehicles";

export const getArugasData = async (date: string) => {
	const Authorization = "Basic VXNyX0dQUy5BVzphc2YkR2ZlZzQyJEYxMjAx";
	const environment = functions.config().environment?.mode;
	const organizationId = process.env[`${environment}_ARUGAS_ORG_ID`] as string;

	const customFieldsRef = admin.database().ref(`/organizations/${organizationId}/custom-field-definitions`);
	const customFieldsSnapshot = await customFieldsRef.once("value");
	const customFields = customFieldsSnapshot.val() || {};
	let lastCylindersId: string | null = null;
	let transactionTypeId: string | null = null;
	let customCustomerTypeId: string | null = null;
	console.log("customCustomerTypeId", customCustomerTypeId);
	if (Object.keys(customFields).length === 0) {
		const lastCylindersRef = customFieldsRef.push({
			createdAt: 1743021467681,
			createdBy: "system",
			description: "Last 6 cylinders",
			entityType: "CUSTOMER",
			label: "bon_cylinder",
			modifiedAt: 1743021467681,
			modifiedBy: "system",
			name: "last_cylinders",
			required: false,
			separator: ";",
			type: "TEXT",
		});
		lastCylindersId = lastCylindersRef.key;
		console.log("lastCylindersId", lastCylindersId);
		const transactionTypeRef = customFieldsRef.push({
			createdAt: 1743021997881,
			createdBy: "system",
			description: "Type of transaction, e.g. Cash on delivery",
			entityType: "ORDER",
			label: "bon_cylinder",
			modifiedAt: 1743022018886,
			modifiedBy: "system",
			name: "transaction_type",
			required: false,
			type: "TEXT",
		});
		transactionTypeId = transactionTypeRef.key;
		const customCustomerTypeRef = customFieldsRef.push({
			createdAt: 1743022018886,
			createdBy: "system",
			description: "Type of customer, e.g. Private, Business",
			entityType: "CUSTOMER",
			label: "bon_cylinder",
			modifiedAt: 1743022018886,
			modifiedBy: "system",
			name: "custom_customer_type",
			required: false,
			type: "TEXT",
		});
		customCustomerTypeId = customCustomerTypeRef.key;
	} else {
		lastCylindersId = Object.keys(customFields).find((key) => customFields[key].name === "last_cylinders") || null;
		transactionTypeId =
			Object.keys(customFields).find((key) => customFields[key].name === "transaction_type") || null;
		customCustomerTypeId =
			Object.keys(customFields).find((key) => customFields[key].name === "custom_customer_type") || null;
	}

	const transitPointsRef = admin.database().ref(`/organizations/${organizationId}/transit-points`);
	const transitPointsSnapshot = await transitPointsRef.once("value");
	const transitPoints = transitPointsSnapshot.val() || {};

	let transitPointId: string | null = null;
	let locationId: string | null = null;

	if (Object.keys(transitPoints).length === 0) {
		const locationsRef = admin.database().ref(`/organizations/${organizationId}/locations`);
		const newLocationRef = locationsRef.push({
			city: "Oranjestad",
			streetName: "Barcadera",
			streetNumber: 42,
			country: "Aruba",
			createdAt: 1741277492886,
			createdBy: "system",
			isDefault: true,
			latitude: 12.480826010629839,
			longitude: -69.98551117802504,
			modifiedAt: 1741277492886,
			modifiedBy: "system",
			notes: "",
			postalCode: "",
			type: "WAREHOUSE",
		});
		locationId = newLocationRef.key;

		const newTransitPointRef = transitPointsRef.push({
			contactEmail: "",
			contactPerson: "",
			contactPhone: {
				countryCode: "+297",
				number: "",
				type: "MOBILE",
			},
			createdAt: 1741277492886,
			createdBy: "system",
			isActive: true,
			locationId,
			modifiedAt: 1741277492886,
			modifiedBy: "system",
			notes: "",
			title: "Arugas Warehouse",
			type: "WAREHOUSE",
		});
		transitPointId = newTransitPointRef.key;
	} else {
		transitPointId =
			Object.keys(transitPoints).find((key) => transitPoints[key].title === "Arugas Warehouse") || null;
		locationId = transitPoints[transitPointId!].locationId;
	}

	if (!transitPointId) {
		throw new Error("Transit point not found");
	}

	try {
		const response = await fetch(`https://portal.arugas.com/ARGGPS/ArugasService.svc/GetDispatch/${date}`, {
			headers: {
				Authorization,
			},
		});

		if (!response.ok) {
			throw new Error(`Server responded with a status of ${response.status}`);
		}
		const { DispatchList: data } = await response.json();
		const trimmedData: ArugasData[] = data.map((item: any) => {
			const trimmedItem: { [key: string]: any } = {};
			Object.keys(item).forEach((key) => {
				// Controleer of de waarde een string is voordat je trim toepast
				trimmedItem[key] = typeof item[key] === "string" ? item[key].trim() : item[key];
			});
			let newVehicle = trimmedItem.vehicle;
			newVehicle = newVehicle.replace("-", "");
			newVehicle = newVehicle.replace("DT", "");

			trimmedItem.vehicle = "DT-" + newVehicle;

			return trimmedItem;
		});

		await checkAndAddVehicles(trimmedData, organizationId);
		await checkAndAddCustomers(trimmedData, organizationId, lastCylindersId, customCustomerTypeId);
		await addOptimizedRoutes(trimmedData, organizationId, date, transitPointId, locationId!, transactionTypeId);

		return trimmedData;
	} catch (error) {
		console.error("Error fetching data:", error);
		throw new Error(`Internal server error.`);
	}
};

export const initializeOptimizeRoute = async (route: { name: string; value: Route }) => {
	const environment = functions.config().environment?.mode;
	const vedispatchUrl = process.env[`${environment}_VEDISPATCH_URL`] as string;
	const response = await fetch(`https://${vedispatchUrl}/api/route/optimize`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify(route),
	});
	const data = await response.json();
	return data;
};

export const getOptimizedRoute = async (routeId: string, mapboxOptimizationId: string, date: string) => {
	const environment = functions.config().environment?.mode;
	const vedispatchUrl = process.env[`${environment}_VEDISPATCH_URL`] as string;

	const response = await fetch(
		`https://${vedispatchUrl}/api/route/optimize?routeId=${routeId}&mapboxOptimizationId=${mapboxOptimizationId}&date=${date}`
	);
	const data = await response.json();
	return data;
};

export const findLocationViaOpenStreetMaps = async (location: {
	streetName: string;
	streetNumber: string;
	city: string;
}) => {
	try {
		const address = `${location.streetName} ${location.streetNumber} ${location.city} Aruba`;

		const response = await fetch(
			`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}`
		);
		const data = await response.json();
		if (data.length > 0) {
			const { lat: latitude, lon: longitude } = data[0];
			if (latitude === undefined || longitude === undefined) {
				console.log("No location found");
				return {
					latitude: "0",
					longitude: "0",
				};
			}
			return { latitude, longitude };
		} else {
			console.log("No location found");
			return {
				latitude: "0",
				longitude: "0",
			};
		}
	} catch (error) {
		console.log(error);
		return {
			latitude: "0",
			longitude: "0",
		};
	}
};
