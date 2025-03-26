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

export const getArugasData = async (date: string) => {
	const Authorization = "Basic VXNyX0dQUy5BVzphc2YkR2ZlZzQyJEYxMjAx";
	const environment = process.env["ENVIRONMENT"];
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
		if (!acc[item.vehicle]) {
			acc[item.vehicle] = {
				licensePlate: item.vehicle,
				...item,
			};
		}
		return acc;
	}, {});

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
const checkAndAddCustomers = async (
	trimmedData: ArugasData[],
	organizationId: string,
	lastCylindersId: string | null,
	customCustomerTypeId: string | null
) => {
	const customersRef = admin.database().ref(`/organizations/${organizationId}/customers`);
	const customersSnapshot = await customersRef.once("value");
	let customers = customersSnapshot.val() || {};

	const locationsRef = admin.database().ref(`/organizations/${organizationId}/locations`);

	const updatesCustomer: { [key: string]: any } = {};
	const updatesLocation: { [key: string]: any } = {};
	const addedCustomers = new Set<string>();

	try {
		for (const item of trimmedData) {
			if (addedCustomers.has(item.clientID)) {
				continue;
			}

			const matchedCustomer = Object.values(customers).find((customer: any) => customer.code === item.clientID);

			const last_six_cylinders = `${item.Cylinder1};${item.Cylinder2};${item.Cylinder3};${item.Cylinder4};${item.Cylinder5};${item.Cylinder6}`;

			if (!matchedCustomer) {
				const phoneNumbers = item.clientPhone ? item.clientPhone.split(" ").filter(Boolean) : [];
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
					createdBy: "System",
					createdAt: Date.now(),
					modifiedBy: "System",
					modifiedAt: Date.now(),
				};

				const newLocationRef = locationsRef.push();
				const newLocationId = newLocationRef.key;
				if (newLocationId) {
					updatesLocation[newLocationId] = newLocation;
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
					createdBy: "System",
					createdAt: Date.now(),
					modifiedBy: "System",
					modifiedAt: Date.now(),
				};
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
				const newCustomerRef = customersRef.push();
				const newCustomerId = newCustomerRef.key;
				if (newCustomerId) {
					updatesCustomer[newCustomerId] = {
						...newCustomer,
						customFields,
					};
				}
			}
			addedCustomers.add(item.clientID);
		}
		await customersRef.update(updatesCustomer);
		await locationsRef.update(updatesLocation);
	} catch (error) {
		console.error(`Fout bij het controleren/toevoegen van klant`, error);
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

// const addDispatches = async (trimmedData: any, organizationId: string, dateString: string) => {
// 	const db = admin.database();
// 	const ordersSnapshot = await db.ref(`/organizations/${organizationId}/orders/date/${dateString}`).once("value");
// 	const orders = ordersSnapshot.val() || {};

// 	const vehiclesSnapshot = await db.ref(`/organizations/${organizationId}/vehicles`).once("value");
// 	const vehicles = vehiclesSnapshot.val() || {};
// 	const customerOrdersMap: { [customerId: string]: any[] } = {};

// 	// Groepeer orders per klant
// 	for (const orderId in orders) {
// 		if (orders.hasOwnProperty(orderId)) {
// 			const order = orders[orderId];
// 			if (!customerOrdersMap[order.customerId]) {
// 				customerOrdersMap[order.customerId] = [];
// 			}
// 			let input: { [key: string]: any } = { order, orderId };
// 			const { vehicle, notes } = trimmedData.find((item: any) => item.orderNumber === order.orderNumber);
// 			input.vehicleId = Object.keys(vehicles).find((key) => vehicles[key].licensePlate === vehicle) || "";
// 			input.notes = notes || "";

// 			customerOrdersMap[order.customerId].push(input);
// 		}
// 	}

// 	const dispatchesRef = db.ref(`/organizations/${organizationId}/dispatches/date/${dateString}`);
// 	const tntRef = db.ref(`/trackAndTraceIndex`);
// 	const updatesDispatches: { [key: string]: any } = {};
// 	const updatesTnt: { [key: string]: any } = {};

// 	// Maak dispatches aan per klant
// 	for (const customerId in customerOrdersMap) {
// 		if (customerOrdersMap.hasOwnProperty(customerId)) {
// 			const customerOrders = customerOrdersMap[customerId];
// 			const trackAndTraceCode = await generateUniqueTrackAndTraceCode();

// 			let newDispatch = {
// 				trackAndTraceCode,
// 				orderIds: customerOrders.map((order) => order.orderId),
// 				orderNumbers: customerOrders.map((order) => order.orderNumber).filter(Boolean),
// 				customerId,
// 				vehicleId: customerOrders[0].vehicleId,
// 				notes: customerOrders[0].notes,
// 				expectedDeliveryDate: dateString,
// 				status: "Open",
// 				createdAt: new Date().toISOString(),
// 				createdBy: "System",
// 			};

// 			const newDispatchWithFirstEvent = {
// 				...newDispatch,
// 				events: [
// 					{
// 						name: "Dispatch Created",
// 						description: "Dispatch created and added to dispatch",
// 						...newDispatch,
// 					},
// 				],
// 			};
// 			const newDispatchRef = dispatchesRef.push();
// 			const newDispatchId = newDispatchRef.key;
// 			if (newDispatchId) {
// 				updatesDispatches[newDispatchId] = newDispatchWithFirstEvent;
// 			}
// 			const newTnt = {
// 				date: dateString,
// 				dispatchId: newDispatchId,
// 				organizationId,
// 			};
// 			const newTntRef = tntRef.push();
// 			const newTntId = newTntRef.key;

// 			if (newTntId) {
// 				updatesTnt[newTntId] = newTnt;
// 			}
// 		}
// 	}
// 	try {
// 		await dispatchesRef.update(updatesDispatches);
// 		console.log("All new dispatches have been pushed successfully.");
// 	} catch (error) {
// 		console.error("Error pushing new dispatches:", error);
// 	}
// 	try {
// 		await tntRef.update(updatesTnt);
// 		console.log("All new T&T's have been pushed successfully.");
// 	} catch (error) {
// 		console.error("Error pushing new T&T's:", error);
// 	}
// };

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

// const addRoutes = async (organizationId: string, dateString: string) => {
// 	const db = admin.database();

// 	const customersRef = admin.database().ref(`/organizations/${organizationId}/customers`);
// 	const customersSnapshot = await customersRef.once("value");
// 	let customers = customersSnapshot.val() || {};

// 	const dispatchRef = admin.database().ref(`/organizations/${organizationId}/dispatches/date/${dateString}`);
// 	const dispatchesSnapshot = await dispatchRef.once("value");

// 	const dispatches = dispatchesSnapshot.val() || {};
// 	const vehiclesDispatchesMap: { [vehicleId: string]: any[] } = {};

// 	// Groepeer dispatches per voertuig
// 	for (const dispatchId in dispatches) {
// 		if (dispatches.hasOwnProperty(dispatchId)) {
// 			const dispatch = dispatches[dispatchId];
// 			const vehicleId = dispatch.vehicleId;
// 			if (!vehiclesDispatchesMap[vehicleId]) {
// 				vehiclesDispatchesMap[vehicleId] = [];
// 			}
// 			vehiclesDispatchesMap[vehicleId].push({ ...dispatch, dispatchId });
// 		}
// 	}

// 	let startLocation: LatLng = { latitude: 12.503286, longitude: -69.980893 };

// 	// Maak routes aan per voertuig
// 	for (const vehicleId in vehiclesDispatchesMap) {
// 		if (vehiclesDispatchesMap.hasOwnProperty(vehicleId)) {
// 			const vehicleDispatches = vehiclesDispatchesMap[vehicleId]
// 				.map((item) => {
// 					const { lat, lng } = customers[item.customerId];
// 					const orderCoords = {
// 						latitude: lat,
// 						longitude: lng,
// 					};
// 					const distance = getDistance(startLocation, orderCoords);
// 					return { ...item, distance, ...orderCoords };
// 				})
// 				.filter((row) => parseInt(row.latitude) !== 0)
// 				.sort((a: any, b: any) => a.distance - b.distance);

// 			// Verdeel dispatches in batches van maximaal 12 locaties
// 			const batches = [];
// 			for (let i = 0; i < vehicleDispatches.length; i += 11) {
// 				const batch = vehicleDispatches.slice(i, i + 11);
// 				batches.push(batch);
// 			}

// 			const routeDispatchIds: string[] = [];

// 			for (const batch of batches) {
// 				const routeResponse = await getOptimizedTrip(
// 					startLocation,
// 					batch.map((x) => {
// 						return { latitude: x.latitude, longitude: x.longitude };
// 					})
// 				);

// 				if (routeResponse.code !== "Ok") {
// 					console.error("Error optimizing route:", routeResponse);
// 					continue;
// 				}
// 				const { waypoints } = routeResponse;

// 				const newDestinations = batch
// 					.map((destination, indexDestination) => {
// 						const relatedWaypoint = waypoints.find((waypoint: any, indexWaypoint: number) => {
// 							// First waypoint is the start location, so we need to skip it.
// 							return indexWaypoint - 1 === indexDestination;
// 						});
// 						return {
// 							...destination,
// 							waypoint_index: relatedWaypoint.waypoint_index,
// 						};
// 					})
// 					.sort((a, b) => a.waypoint_index - b.waypoint_index);
// 				routeDispatchIds.push(...newDestinations.map((x) => x.dispatchId));

// 				startLocation = {
// 					latitude: newDestinations[newDestinations.length - 1].latitude,
// 					longitude: newDestinations[newDestinations.length - 1].longitude,
// 				};
// 			}

// 			const route = {
// 				vehicleId,
// 				dispatchIds: routeDispatchIds,
// 			};

// 			const newRouteRef = await db.ref(`/organizations/${organizationId}/routes/date/${dateString}`).push(route);
// 			const newRouteId = newRouteRef.key;

// 			const updates: { [key: string]: any } = {};

// 			for (const dispatchId in dispatches) {
// 				if (dispatches.hasOwnProperty(dispatchId)) {
// 					const dispatch = dispatches[dispatchId];
// 					if (vehicleId === dispatch.vehicleId) {
// 						const { vehicleId, ...rest } = dispatch;
// 						updates[dispatchId] = {
// 							...rest,
// 							routeId: newRouteId,
// 						};
// 					}
// 				}
// 			}
// 			dispatchRef.update(updates);
// 		}
// 	}
// };
