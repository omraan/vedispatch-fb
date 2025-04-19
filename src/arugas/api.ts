import * as admin from "firebase-admin";
import * as functions from "firebase-functions";
import moment from "moment";
import { checkAndAddCustomers } from "./customers";
import { addRoutes } from "./routes";
import { ArugasData } from "./types";
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

		// First process vehicles and customers
		await checkAndAddVehicles(trimmedData, organizationId);
		await checkAndAddCustomers(trimmedData, organizationId, lastCylindersId, customCustomerTypeId);

		// Then create the routes
		console.log(`Creating routes for date: ${date}`);
		await addRoutes(trimmedData, organizationId, date, transitPointId, locationId!, transactionTypeId);

		// Verify routes were created
		const routesRef = admin.database().ref(`/organizations/${organizationId}/routes/${date}`);
		const routesSnapshot = await routesRef.once("value");
		const routes = routesSnapshot.val() || {};
		const routeIds = Object.keys(routes);

		console.log(`Created ${routeIds.length} routes for date ${date}`);

		// Attempt route optimization if routes were created
		if (routeIds.length > 0) {
			try {
				await Promise.all(routeIds.map((routeId) => optimizeRoute(organizationId, date, routeId)));
			} catch (error) {
				console.error("Error during route optimization process:", error);
				console.log("Continuing with unoptimized routes");
			}
		} else {
			console.warn("No routes were created, skipping optimization step");
		}

		return trimmedData;
	} catch (error) {
		console.error("Error fetching data:", error);
		throw new Error(`Internal server error.`);
	}
};

const optimizeRoute = async (organizationId: string, date: string, routeId: string) => {
	const mapboxOptimizationId = await postRouteToVedispatch(organizationId, date, routeId);

	if (mapboxOptimizationId) {
		console.log(`Starting optimization polling for ID: ${mapboxOptimizationId}`);

		// Function to wait for a specified time
		const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

		// Polling mechanism with retries
		const maxRetries = 10;
		const pollingInterval = 5000; // 5 seconds

		let optimizationResult = null;
		let retryCount = 0;

		// Poll until we get a result or reach max retries
		while (retryCount < maxRetries && !optimizationResult) {
			console.log(`Polling optimization status (attempt ${retryCount + 1}/${maxRetries})...`);

			try {
				// Wait before checking
				await sleep(pollingInterval);

				// Check optimization status
				optimizationResult = await getOptimizationFromVedispatch(mapboxOptimizationId);

				if (optimizationResult) {
					console.log(`Optimization completed successfully after ${retryCount + 1} attempts`);
				}
			} catch (error) {
				console.error(`Error polling optimization (attempt ${retryCount + 1}):`, error);
			}

			retryCount++;
		}

		// If we have optimization results, update the route with the new stop sequence
		if (optimizationResult) {
			// Get routes to apply optimization results
			const routesRef = admin.database().ref(`/organizations/${organizationId}/routes/${date}`);
			const routesSnapshot = await routesRef.once("value");
			const routes = routesSnapshot.val() || {};
			const routeIds = Object.keys(routes);

			// Apply optimization results to each route
			for (const routeId of routeIds) {
				try {
					console.log(`Fetching directions for route: ${routeId}`);

					// Update route with stop sequence optimization before getting directions
					const routeRef = routesRef.child(routeId);
					const routeSnapshot = await routeRef.once("value");
					const route = routeSnapshot.val();

					if (route && route.stops) {
						// Record original sequence for logging
						const originalSequence: { [stopId: string]: number } = {};
						Object.keys(route.stops).forEach((stopId) => {
							if (route.stops[stopId].sequence !== undefined) {
								originalSequence[stopId] = route.stops[stopId].sequence;
							}
						});

						// Update stop sequences based on optimization results
						optimizationResult.forEach((stop) => {
							if (route.stops[stop.stopId]) {
								route.stops[stop.stopId].sequence = stop.index;
							}
						});

						// Log sequence changes
						console.log(`Updated stop sequence for route ${routeId}:`);
						Object.keys(route.stops).forEach((stopId) => {
							if (
								originalSequence[stopId] !== undefined &&
								route.stops[stopId].sequence !== originalSequence[stopId]
							) {
								console.log(
									`  - Stop ${stopId}: ${originalSequence[stopId]} -> ${route.stops[stopId].sequence}`
								);
							}
						});

						// Update route with new sequences
						await routeRef.set(route);
					}

					// Get directions for the optimized route
					await fetchRouteDirections(organizationId, routeId, date);
					console.log(`Successfully updated route ${routeId} with optimized directions`);
				} catch (directionError) {
					console.error(`Error fetching directions for route ${routeId}:`, directionError);
				}
			}
		} else {
			console.warn(`Failed to get optimization results after ${maxRetries} attempts`);
		}
	} else {
		console.warn("Route optimization not available or failed. Routes were created but not optimized.");
	}
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

const getRelatedLocation = async (organizationId: string, locationId: string) => {
	const locationRef = admin.database().ref(`/organizations/${organizationId}/locations/${locationId}`);
	const locationSnapshot = await locationRef.once("value");
	const location = locationSnapshot.val() || {};
	return location;
};

const transformRouteStopsForVedispatch = async (organizationId: string, route: any) => {
	const stopIds = Object.keys(route.stops);
	const stops = await Promise.all(
		stopIds.map(async (stopId) => {
			const stop = route.stops[stopId];
			let locationId: string | undefined = stop.locationId;
			if (stop.dispatch?.locationId) {
				locationId = stop.dispatch.locationId;
			}
			if (!locationId) {
				throw new Error("Location ID not found");
			}
			const location = await getRelatedLocation(organizationId, locationId);
			const { latitude, longitude } = location;
			return {
				name: stopId,
				value: {
					...stop,
					locationId,
					location: {
						...location,
						latitude: typeof latitude === "string" ? parseFloat(latitude).toFixed(6) : latitude,
						longitude: typeof longitude === "string" ? parseFloat(longitude).toFixed(6) : longitude,
					},
				},
			};
		})
	);

	return stops;
};

const transformVedispatchStopsBackToRoute = (stopsArray: Array<{ name: string; value: any }>) => {
	// Converteer de array van name/value objecten terug naar een object met stopId als key
	const stopsObject: { [key: string]: any } = {};

	stopsArray.forEach((stop) => {
		const { location, ...rest } = stop.value;
		stopsObject[stop.name] = rest;
	});

	return stopsObject;
};

const postRouteToVedispatch = async (organizationId: string, date: string, routeId: string) => {
	const environment = functions.config().environment?.mode;
	const vedispatchUrl = process.env[`${environment}_VEDISPATCH_URL`] as string;

	console.log(`Using VeDispatch URL: ${vedispatchUrl}`);
	if (!vedispatchUrl) {
		console.error(`Missing VeDispatch URL in environment variables for environment: ${environment}`);
		return null;
	}

	const routesRef = admin.database().ref(`/organizations/${organizationId}/routes/${date}/${routeId}`);
	const routesSnapshot = await routesRef.once("value");
	const route = routesSnapshot.val() || {};

	console.log(`Found route: ${routeId} for date: ${date}`);

	if (!route) {
		console.log("No route found to optimize");
		return null;
	}

	try {
		// Just use the first route for now to check connection
		const routeOptimizationRef = routesRef.child(routeId).child("optimization");

		const apiUrl = `https://${vedispatchUrl}/api/route/optimize`;
		console.log(`Calling VeDispatch API at: ${apiUrl}`);
		const stops = await transformRouteStopsForVedispatch(organizationId, route);

		const response = await fetch(apiUrl, {
			method: "POST",
			mode: "cors",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				route: {
					name: routeId,
					value: {
						...route,
						stops,
					},
				},
			}),
		});

		console.log(`API Response status: ${response.status} ${response.statusText}`);

		if (!response.ok) {
			const responseText = await response.text();
			console.error(
				`Error response from VeDispatch API: status=${response.status}, body=${responseText.substring(
					0,
					200
				)}...`
			);
			return null;
		}

		const result = await response.json();
		console.log(`API Response data:`, JSON.stringify(result).substring(0, 200));

		if (!result || !result.mapboxOptimizationId) {
			console.error("Invalid response from optimization API:", result);
			return null;
		}

		if (result.status === "ok") {
			const res = {
				id: result.mapboxOptimizationId,
				state: "PROCESSING",
				description: "Optimization in progress",
				lastChecked: moment().toISOString(),
			};

			await routeOptimizationRef.set(res);
			return result.mapboxOptimizationId;
		} else {
			console.warn(`Optimization did not return success status:`, result.status);
			return null;
		}
	} catch (error) {
		console.error(`Error during optimization process:`, error);
		return null;
	}
};

const getOptimizationFromVedispatch = async (mapboxOptimizationId: string) => {
	const environment = functions.config().environment?.mode;
	const vedispatchUrl = process.env[`${environment}_VEDISPATCH_URL`] as string;

	const response = await fetch(
		`https://${vedispatchUrl}/api/route/optimize?mapboxOptimizationId=${mapboxOptimizationId}`
	);
	const result = await response.json();

	if (result.status === "ok") {
		const stopSequence: { stopId: string; index: number }[] = result.stopsWithIndex;
		return stopSequence;
	} else {
		return null;
	}
};

const fetchRouteDirections = async (organizationId: string, routeId: string, date: string) => {
	const environment = functions.config().environment?.mode;
	const vedispatchUrl = process.env[`${environment}_VEDISPATCH_URL`] as string;
	const routeRef = admin.database().ref(`/organizations/${organizationId}/routes/${date}/${routeId}`);
	const routeSnapshot = await routeRef.once("value");
	const route = routeSnapshot.val() || {};
	const stops = await transformRouteStopsForVedispatch(organizationId, route);

	// Haal de huidige optimization ID op als deze bestaat
	const currentOptimizationId = route.optimization?.id || null;

	const response = await fetch(`https://${vedispatchUrl}/api/route/directions`, {
		headers: {
			"Content-Type": "application/json",
		},
		method: "POST",
		body: JSON.stringify({
			route: {
				name: routeId,
				value: {
					...route,
					stops,
				},
			},
		}),
	});
	if (response.status !== 200) {
		throw new Error("Failed to fetch route directions");
	}
	const newRoute = await response.json();

	// Als het resultaat stops bevat in array-formaat, converteer ze terug naar object-formaat
	if (newRoute.value && Array.isArray(newRoute.value.stops)) {
		// Transformeer de stops van array formaat terug naar object formaat
		newRoute.value.stops = transformVedispatchStopsBackToRoute(newRoute.value.stops);
	}

	// Gebruik de huidige optimization ID of een fallback waarde
	const optimizationId = newRoute.value.mapboxOptimizationId || currentOptimizationId || `directions-${Date.now()}`;

	const optimization = {
		id: optimizationId,
		state: "COMPLETE",
		description: "Optimization completed",
		lastChecked: moment().toISOString(),
	};

	await routeRef.set({
		...newRoute.value,
		optimization,
	});
	return newRoute;
};
