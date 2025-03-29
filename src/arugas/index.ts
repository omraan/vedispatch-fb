import polyline from "@mapbox/polyline";
import * as admin from "firebase-admin";
import * as functions from "firebase-functions";
import haversine from "haversine-distance";
import moment from "moment";
require("dotenv").config();

const getDistance = (
	location1: { latitude: number; longitude: number },
	location2: { latitude: number; longitude: number }
) => {
	return haversine(location1, location2);
};
const combineGeometries = (geometry1: string, geometry2: string): string => {
	const coordinates1 = polyline.decode(geometry1);
	const coordinates2 = polyline.decode(geometry2);

	// Combineer de coördinaten
	const combinedCoordinates = [...coordinates1, ...coordinates2];

	// Codeer de gecombineerde coördinaten opnieuw
	const combinedGeometry = polyline.encode(combinedCoordinates);

	return combinedGeometry;
};

type ArugasData = {
	vehicle: string;
	planned_deliverydate: string;
	clientID: string;
	clientname: string;
	clientStreetName: string;
	clientHouseNumber: string;
	clientAddress: string | null;
	routeNumber: string;
	orderNumber: string;
	clientPhone: string;
	notes: string;
	longitude: string;
	latitude: string;
	deliveryDateTime: string;
	Coordinates_updated: string;
	NEW_Longitude: string;
	NEW_Latitude: string;
	Transactiontype: string;
	Type: string;
	Productcode: string;
	ProductDescription: string;
	Product_quantity: string;
	Product_price: string;
	Total_price: string;
	Customer_email: string;
	Ordertype: string;
	Client_notes: string;
	Cylinder1: string;
	Cylinder2: string;
	Cylinder3: string;
	Cylinder4: string;
	Cylinder5: string;
	Cylinder6: string;
};
function detectChanges<T>(oldData: T, newData: T, skipKeys: string[]): Record<string, { old: any; new: any }> {
	const changed: Record<string, { old: any; new: any }> = {};
	for (const key in newData) {
		if (skipKeys.includes(key)) continue; // overslaan van velden die je niet wilt overschrijven
		if (newData[key] !== oldData[key]) {
			changed[key] = { old: oldData[key], new: newData[key] };
		}
	}
	return changed;
}
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

	const transitPointsRef = admin.database().ref(`/organizations/${organizationId}/transitPoints`);
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

export const addOptimizedRoutes = async (
	trimmedData: ArugasData[],
	organizationId: string,
	date: string,
	transitPointId: string,
	locationId: string,
	transactionTypeId: string | null
) => {
	if (!trimmedData || !trimmedData.length) {
		console.log("Geen data om routes voor te optimaliseren");
		return;
	}

	const db = admin.database();
	const routesRef = db.ref(`/organizations/${organizationId}/routes/${date}`);
	// const routesSnapshot = await routesRef.once("value");
	// let routes = routesSnapshot.val() || {};

	const customersRef = db.ref(`/organizations/${organizationId}/customers`);
	const customersSnapshot = await customersRef.once("value");
	let customers = customersSnapshot.val() || {};
	const locationsRef = db.ref(`/organizations/${organizationId}/locations`);
	const locationsSnapshot = await locationsRef.once("value");
	let locations = locationsSnapshot.val() || {};

	const vehicles = trimmedData.reduce((acc: any, item: ArugasData) => {
		if (item && item.vehicle) {
			if (!acc[item.vehicle]) {
				acc[item.vehicle] = {
					licensePlate: item.vehicle,
					...item,
				};
			}
		} else {
			console.log("Waarschuwing: Gevonden item zonder vehicle property", item);
		}
		return acc;
	}, {});

	if (Object.keys(vehicles).length === 0) {
		console.log("Geen voertuigen gevonden in data, voortijdig beëindigd");
		return;
	}

	const updatesRoutes: { [key: string]: any } = {};

	// First get all vehicle IDs
	const vehiclesRef = admin.database().ref(`/organizations/${organizationId}/vehicles`);
	const vehiclesSnapshot = await vehiclesRef.once("value");
	const existingVehicles = vehiclesSnapshot.val() || {};

	for (const vehicleKey in vehicles) {
		// Find the actual vehicle ID from existing vehicles
		const vehicleId = Object.keys(existingVehicles).find(
			(key) => existingVehicles[key].licensePlate === vehicleKey
		);

		if (!vehicleId) {
			console.log(`Vehicle not found for license plate: ${vehicleKey}`);
			continue;
		}

		const newRouteId = routesRef.push().key;

		const routeStopRef = db.ref(`/organizations/${organizationId}/routes/${date}/${newRouteId}/stops`);
		const newStartRouteStopRef = routeStopRef.push();
		const newStartRouteStopId = newStartRouteStopRef.key;
		const newRoute: any = {
			title: "Route: " + vehicleKey,
			driverId: "",
			vehicleId,
			vehicleType: "Cylinder",
			estimation: {
				startTime: "07:00",
			},
			stops: {
				[newStartRouteStopId!]: {
					locationId,
					transitPointId,
					sequence: 0,
					type: "START_POINT",
					estimation: {
						startTime: "07:00",
					},
					status: "Open",
				},
			},
			createdBy: "System",
			createdAt: Date.now(),
			modifiedBy: "System",
			modifiedAt: Date.now(),
		};

		const customerOrdersMap: {
			[clientID: string]: {
				orderLine: ArugasData;
				vehicle: string;
				vehicleId: string;
				customerId: string;
				locationId: string;
				notes: string;
			}[];
		} = {};

		// Process orders for each vehicle
		for (const orderLine of trimmedData) {
			// Controleer of orderLine en orderLine.clientID bestaan
			if (!orderLine || !orderLine.clientID || !orderLine.vehicle) {
				console.log("Waarschuwing: ongeldige orderLine data gevonden", orderLine);
				continue;
			}

			const clientID = orderLine.clientID as string;
			if (!customerOrdersMap[clientID]) {
				customerOrdersMap[clientID] = [];
			}

			const customerId = Object.keys(customers).find((key) => customers[key].code === clientID) || "";
			if (!customerId) continue;

			let input = {
				orderLine,
				vehicle: orderLine.vehicle,
				vehicleId: Object.keys(vehicles).find((key) => vehicles[key].licensePlate === orderLine.vehicle) || "",
				customerId,
				locationId: customers[customerId].defaultLocationId,
				notes: orderLine.notes || "",
			};

			customerOrdersMap[clientID].push(input);
		}

		let sequence = 0;

		for (const clientId in customerOrdersMap) {
			sequence = sequence + 1;
			if (customerOrdersMap.hasOwnProperty(clientId)) {
				const customerOrders: {
					orderLine: ArugasData;
					vehicle: string;
					vehicleId: string;
					customerId: string;
					locationId: string;
					notes: string;
				}[] = customerOrdersMap[clientId];
				const trackAndTraceCode = await generateUniqueTrackAndTraceCode();

				const newRouteStopRef = routeStopRef.push();
				const newRouteStopId = newRouteStopRef.key;

				if (customerOrders[0].vehicle === vehicleKey) {
					newRoute.stops[newRouteStopId!] = {
						dispatch: {
							customerId: customerOrders[0].customerId,
							locationId: customerOrders[0].locationId,
							trackAndTraceCode,
							orders: customerOrders
								.map(
									(order: {
										orderLine: ArugasData;
										vehicle: string;
										vehicleId: string;
										customerId: string;
										locationId: string;
										notes: string;
									}) => {
										const customFields: any[] = [];
										if (transactionTypeId) {
											customFields.push({
												fieldId: transactionTypeId,
												fieldName: "transaction_type",
												value: order.orderLine.Transactiontype,
											});
										}
										return {
											orderNumber: order.orderLine.orderNumber,
											customFields,
											orderLines: [
												{
													product: {
														code: order.orderLine.Productcode,
														description: order.orderLine.ProductDescription,
														price: parseFloat(order.orderLine.Product_price),
													},
													quantity: parseFloat(order.orderLine.Product_quantity),
												},
											],

											totalPrice: parseFloat(order.orderLine.Total_price),
										};
									}
								)
								.filter(Boolean),
							plannedDeliveryDate: date,
							events: [
								{
									title: "Dispatch created",
									description: "Dispatch created and added to dispatch",
									userId: "System",
									timestamp: new Date(),
								},
							],
						},
						type: "DELIVERY",
						customerId: customerOrders[0].customerId,
						notes: customerOrders[0].notes,
						status: "Open",
						sequence,
						estimation: {
							serviceTime: "00:05:00",
						},
						events: [
							{
								title: "Route created",
								description: "Route created and added to route",
								userId: "System",
								timestamp: new Date(),
							},
						],
						createdAt: new Date(),
						createdBy: "System",
					};
				}
			}
		}
		let startLocation = locations[newRoute.stops[newStartRouteStopId!].locationId];

		const stopsOrdered = Object.keys(newRoute.stops)
			.filter((routeStopId: string) => newRoute.stops[routeStopId].type !== "START_POINT")
			.map((routeStopId: string) => {
				const location = locations[newRoute.stops[routeStopId].dispatch.locationId];
				const { latitude, longitude } = location;
				const orderCoords = {
					latitude,
					longitude,
				};
				const distance = getDistance(startLocation, orderCoords);
				return { ...newRoute.stops[routeStopId], distance, ...orderCoords, routeStopId };
			})
			.filter((row) => parseInt(row.latitude) !== 0)
			.sort((a: any, b: any) => a.distance - b.distance);

		let geometry: string = "";
		// Latest Time Arrival is end time of route.
		let timeArrival: string = "";
		// Current time is used to store the departure time for next iteration,
		// so it can be used to calculate the arrival time for the next stop.
		let currentTime = moment("07:00", "HH:mm");
		// Verdeel dispatches in batches van maximaal 12 locaties
		const batches = [];
		for (let i = 0; i < stopsOrdered.length; i += 11) {
			const batch = stopsOrdered.slice(i, i + 11);
			batches.push(batch);
		}
		let batchIndex = 0;
		for (const batch of batches) {
			const { waypoints, trips } = await getOptimizedTrip(
				startLocation,
				batch.map((x) => {
					return { latitude: x.latitude, longitude: x.longitude };
				})
			);

			if (!trips || trips.length === 0) {
				console.log("No trips found for batch", batchIndex);
				continue;
			}
			geometry = combineGeometries(geometry, trips[0].geometry);

			const newDestinations = batch
				.map((destination, indexDestination) => {
					const relatedWaypoint = waypoints.find((waypoint: any, indexWaypoint: number) => {
						// First waypoint is the start location, so we need to skip it.
						return indexWaypoint - 1 === indexDestination;
					});

					const duration = trips[0].legs[relatedWaypoint.waypoint_index - 1].duration;
					const distance = trips[0].legs[relatedWaypoint.waypoint_index - 1].distance;

					timeArrival = currentTime.add(duration, "seconds").format("HH:mm");
					const serviceTime = moment.duration("00:05:00").asSeconds();
					const newTimeDeparture = moment(timeArrival, "HH:mm").add(serviceTime, "seconds");
					currentTime = newTimeDeparture.clone();

					return {
						...destination,
						waypoint_index: relatedWaypoint.waypoint_index,
						estimation: {
							timeArrival,
							timeDeparture: newTimeDeparture.format("HH:mm"),
							duration,
							distance,
						},
					};
				})
				.sort((a, b) => a.waypoint_index - b.waypoint_index);

			// Create a temporary object to store the updated stops
			const updatedStops = { ...newRoute.stops };

			// Update sequences for stops in the current batch
			Object.entries(updatedStops).forEach(([stopId, stop]: any) => {
				const newStop = newDestinations.find((destination) => destination.routeStopId === stopId);
				if (newStop) {
					updatedStops[stopId] = {
						...stop,
						sequence: batchIndex * batch.length + newStop.waypoint_index,
						estimation: {
							...stop.estimation,
							...newStop.estimation,
						},
					};
				}
			});

			newRoute.stops = updatedStops;

			startLocation = {
				latitude: newDestinations[newDestinations.length - 1].latitude,
				longitude: newDestinations[newDestinations.length - 1].longitude,
			};
			batchIndex++;
		}
		updatesRoutes[newRouteId!] = {
			...newRoute,
			estimation: {
				...newRoute.estimation,
				geometry,
				timeArrival,
			},
		};
	}
	await routesRef.update(updatesRoutes);
};

export const checkAndAddVehicles = async (trimmedData: ArugasData[], organizationId: string) => {
	const vehiclesRef = admin.database().ref(`/organizations/${organizationId}/vehicles`);
	const vehiclesSnapshot = await vehiclesRef.once("value");
	let vehicles = vehiclesSnapshot.val() || {};

	try {
		for (const item of trimmedData) {
			// Verplaats de zoekopdracht naar matchedVehicle binnen de loop
			const matchedVehicle = Object.values(vehicles).find(
				(vehicle: any) => vehicle.licensePlate === item.vehicle
			);

			if (!matchedVehicle) {
				// Voertuig bestaat niet, dus voeg het toe met push voor een unieke ID
				const newVehicle = {
					title: item.vehicle,
					licensePlate: item.vehicle, // Je moet de licensePlate bepalen of opvragen
					earliestStartTime: "07:00",
					latestEndTime: "17:00",
					capacity: {
						units: 80,
					},
					type: "Cylinder",
					breaks: [],
					createdBy: "System",
					createdAt: Date.now(),
					modifiedBy: "System",
					modifiedAt: Date.now(),
				};

				const response = await vehiclesRef.push(newVehicle);

				if (response?.key) {
					vehicles = {
						...vehicles,
						[response.key]: newVehicle,
					};
				}
			}
		}
	} catch (error) {
		console.error(`Fout bij het controleren/toevoegen van voertuig: ${error}`);
	}
};
export const checkAndAddCustomers = async (
	trimmedData: ArugasData[],
	organizationId: string,
	lastCylindersId: string | null,
	customCustomerTypeId: string | null
) => {
	const customersRef = admin.database().ref(`/organizations/${organizationId}/customers`);
	const customersSnapshot = await customersRef.once("value");
	let customers = customersSnapshot.val() || {};

	const locationsRef = admin.database().ref(`/organizations/${organizationId}/locations`);
	const locationsSnapshot = await locationsRef.once("value");
	let locations = locationsSnapshot.val() || {};

	const updatesCustomer: { [key: string]: any } = {};
	const updatesLocation: { [key: string]: any } = {};
	const addedCustomers = new Set<string>();

	try {
		for (const item of trimmedData) {
			if (addedCustomers.has(item.clientID)) {
				continue;
			}
			const matchedCustomerId = Object.keys(customers).find((key) => customers[key].code === item.clientID);
			const last_six_cylinders = `${item.Cylinder1};${item.Cylinder2};${item.Cylinder3};${item.Cylinder4};${item.Cylinder5};${item.Cylinder6}`;

			// A) Bestaat de klant nog niet? => nieuwe klant en nieuwe locatie
			if (!matchedCustomerId) {
				const phoneNumbers = item.clientPhone ? item.clientPhone.split(" ").filter(Boolean) : [];
				const newLocationRef = locationsRef.push();
				const newLocationId = newLocationRef.key;

				// Zet location-data
				const newLocation: any = {
					title: "Location 1",
					postalCode: "",
					country: "Aruba",
					notes: "",
					streetName: item.clientStreetName || "",
					streetNumber: item.clientHouseNumber || "",
					latitude: item.latitude,
					longitude: item.longitude,
					city: "",
					type: "CONSUMER",
					isDefault: true,
					serviceTime: "00:05:00",
				};

				newLocation.events = [
					{
						timestamp: Date.now(),
						description: "Location created",
						changedBy: "System",
						changed: {
							...newLocation,
						},
					},
				];

				newLocation.createdBy = "System";
				newLocation.createdAt = Date.now();
				newLocation.modifiedBy = "System";
				newLocation.modifiedAt = Date.now();
				if (newLocationId) {
					updatesLocation[newLocationId] = newLocation;
				}

				// Zet customer-data
				const newCustomerRef = customersRef.push();
				const newCustomerId = newCustomerRef.key;
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
						customFields,
					};
					newCustomer.events = [
						{
							timestamp: Date.now(),
							description: "Customer created",
							changedBy: "System",
							changed: {
								...newCustomer,
							},
						},
					];

					newCustomer.createdBy = "System";
					newCustomer.createdAt = Date.now();
					newCustomer.modifiedBy = "System";
					newCustomer.modifiedAt = Date.now();
					updatesCustomer[newCustomerId] = newCustomer;
				}
			} else {
				// B) Klant bestaat al => locatie & klant gedeeltelijk bijwerken via detectChanges
				const matchedCustomer = customers[matchedCustomerId];
				const locationId = matchedCustomer.defaultLocationId;
				const matchedLocation = locations[locationId] || null;

				// 1. Customer updates via detectChanges
				// Bouw nieuw data object op met de waarden die we willen bijwerken
				const newCustomerData: any = {
					lastName: item.clientname,
					notes: item.Client_notes || "",
				};

				// Houdt last_cylinders bij (speciale logica)
				if (last_six_cylinders) {
					// Maak een kopie van de bestaande customFields (of een lege array)
					const updatedCustomFields = [...(matchedCustomer.customFields || [])];
					const customFieldIndex = updatedCustomFields.findIndex(
						(cf: any) => cf.fieldName === "last_cylinders"
					);

					if (customFieldIndex >= 0) {
						const oldValue = updatedCustomFields[customFieldIndex].value;
						if (oldValue !== last_six_cylinders) {
							updatedCustomFields[customFieldIndex] = {
								...updatedCustomFields[customFieldIndex],
								value: last_six_cylinders,
							};
						}
					} else if (lastCylindersId) {
						updatedCustomFields.push({
							fieldId: lastCylindersId,
							fieldName: "last_cylinders",
							value: last_six_cylinders,
						});
					}

					// Voeg customFields toe aan de nieuwe data voor detectChanges
					newCustomerData.customFields = updatedCustomFields;
				}

				// Detecteer de wijzigingen tussen matchedCustomer en newCustomerData
				const changedFields = detectChanges(matchedCustomer, newCustomerData, []);

				if (Object.keys(changedFields).length > 0) {
					const customerUpdates: any = {};

					// Pas alle wijzigingen toe op customerUpdates
					for (const [key, { new: newValue }] of Object.entries(changedFields)) {
						customerUpdates[key] = newValue;
					}

					// Voeg metadata toe
					customerUpdates.modifiedAt = Date.now();
					customerUpdates.modifiedBy = "System";

					// Voeg een event toe aan de events array
					const currentEvents = matchedCustomer.events || [];
					currentEvents.push({
						timestamp: Date.now(),
						description: "Customer updated",
						changedBy: "System",
						changed: changedFields,
					});
					customerUpdates.events = currentEvents;

					// Zorg dat updates voor deze klant worden toegevoegd
					if (!updatesCustomer[matchedCustomerId]) {
						updatesCustomer[matchedCustomerId] = {};
					}
					Object.assign(updatesCustomer[matchedCustomerId], customerUpdates);
				}

				// 2. Location updates via detectChanges (met overslaan van lat/lng)
				if (matchedLocation) {
					// Bouw nieuwe locatie data op met ALLEEN de velden die we willen bijwerken
					const newLocationData: any = {
						streetName: item.clientStreetName || matchedLocation.streetName,
						streetNumber: item.clientHouseNumber || matchedLocation.streetNumber,
					};

					// We slaan latitude en longitude over bij het bijwerken
					const skipKeys = ["latitude", "longitude"];
					const locationChangedFields = detectChanges(matchedLocation, newLocationData, skipKeys);

					if (Object.keys(locationChangedFields).length > 0) {
						const locationUpdates: any = {};

						// Pas alle wijzigingen toe op locationUpdates
						for (const [key, { new: newValue }] of Object.entries(locationChangedFields)) {
							locationUpdates[key] = newValue;
						}

						// Voeg metadata toe
						locationUpdates.modifiedAt = Date.now();
						locationUpdates.modifiedBy = "System";

						// Voeg een event toe aan de events array
						const currentLocEvents = matchedLocation.events || [];
						currentLocEvents.push({
							timestamp: Date.now(),
							description: "Location updated",
							changedBy: "System",
							changed: locationChangedFields,
						});
						locationUpdates.events = currentLocEvents;

						// Zorg dat updates voor deze locatie worden toegevoegd
						if (!updatesLocation[locationId]) {
							updatesLocation[locationId] = {};
						}
						Object.assign(updatesLocation[locationId], locationUpdates);
					}
				}
			}
			addedCustomers.add(item.clientID);
		}

		await customersRef.update(updatesCustomer);
		await locationsRef.update(updatesLocation);
	} catch (error) {
		console.error(`Fout bij het controleren/updaten van klanten/locaties`, error);
	}
};

const generateUniqueTrackAndTraceCode = async (): Promise<string> => {
	let trackAndTraceCode: string = "";
	let exists = true;
	const db = admin.database();

	while (exists) {
		trackAndTraceCode = `VDPA${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
		const snapshot = await db.ref(`trackAndTraceIndex/${trackAndTraceCode}`).once("value");
		exists = snapshot.exists();
	}

	return trackAndTraceCode;
};

export const fetchArugasData = functions.https.onRequest(async (req, res) => {
	const date = req.query.date as string;
	if (!date) {
		res.status(400).json({ error: "Date is required" });
		return;
	}
	req.setTimeout(500000);
	getArugasData(date)
		.then((result) => {
			res.send("Data fetched and processed");
		})
		.catch((error) => {
			console.error("Error fetching data:", error);
			res.status(500).send("Error fetching data");
		});
});

export const scheduledFetchArugasData = functions.pubsub
	.schedule("every day 18:00")
	.timeZone("UTC")
	.onRun(async (context) => {
		console.log("Running a task every day at 00.00 AM");
		const today = new Date();
		today.setDate(today.getDate() + 1);
		const formattedDate = today.toISOString().split("T")[0];
		await getArugasData(formattedDate);

		const dayOfWeek = moment().day();
		if (dayOfWeek === 5) {
			const monday = new Date();
			monday.setDate(monday.getDate() + 3);
			const formattedMonday = monday.toISOString().split("T")[0];
			await getArugasData(formattedMonday);
		}
		return null;
	});

// const MAPBOX_ACCESS_TOKEN = "sk.eyJ1Ijoib21yYWFuIiwiYSI6ImNtNTZuZXNjdjMwYTcya3A3dGIzbWZxcTYifQ.OKakG61fXWiiWVStGidjhw";

interface LatLng {
	latitude: number;
	longitude: number;
}

const getOptimizedTrip = async (start: LatLng, destinations: LatLng[]) => {
	const coordinates = [start, ...destinations].map((d) => `${d.longitude},${d.latitude}`).join(";");

	const accessKey = process.env["ALL_FIREBASE_MAPBOX_KEY"];
	const url = `https://api.mapbox.com/optimized-trips/v1/mapbox/driving/${coordinates}?source=first&destination=last&roundtrip=false&access_token=${accessKey}`;

	const response: any = await fetch(url);
	if (!response.ok) {
		console.error(response);
		throw new Error(`HTTP error! status: ${response.status}`);
	}
	const routeResponse: any = await response.json();

	const { waypoints, trips } = routeResponse;

	const tripsWithTimes = trips.map((trip: any) => ({
		...trip,
		legs: trip.legs.map((leg: any, index: number) => {
			let departure_time = moment();
			if (index > 0) {
				const prevLeg = trip.legs[index - 1];
				departure_time = moment(prevLeg.arrival_time).add(prevLeg.duration, "seconds");
			}
			const arrival_time = moment(departure_time).add(leg.duration, "seconds");

			return {
				...leg,
				departure_time: departure_time.format("HH:mm"),
				arrival_time: arrival_time.format("HH:mm"),
			};
		}),
	}));
	return { waypoints, trips: tripsWithTimes };
};
