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

export const getArugasData = async (date: string) => {
	const Authorization = "Basic VXNyX0dQUy5BVzphc2YkR2ZlZzQyJEYxMjAx";
	const environment = process.env["ENVIRONMENT"];
	const organizationId = process.env[`${environment}_ARUGAS_ORG_ID`] as string;
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
		const trimmedData = data.map((item: any) => {
			const trimmedItem: { [key: string]: any } = {};
			Object.keys(item).forEach((key) => {
				// Controleer of de waarde een string is voordat je trim toepast
				trimmedItem[key] = typeof item[key] === "string" ? item[key].trim() : item[key];
			});
			return trimmedItem;
		});

		await checkAndAddVehicles(trimmedData, organizationId);
		await checkAndAddCustomers(trimmedData, organizationId);
		await addOrders(trimmedData, organizationId, date);
		await addDispatches(trimmedData, organizationId, date);
		await addRoutes(organizationId, date);

		return trimmedData;
	} catch (error) {
		console.error("Error fetching data:", error);
		throw new Error(`Internal server error.`);
	}
};
export const checkAndAddVehicles = async (trimmedData: any[], organizationId: string) => {
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
					name: item.vehicle,
					licensePlate: item.vehicle, // Je moet de licensePlate bepalen of opvragen
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
const checkAndAddCustomers = async (trimmedData: any, organizationId: string) => {
	const customersRef = admin.database().ref(`/organizations/${organizationId}/customers`);
	const customersSnapshot = await customersRef.once("value");
	let customers = customersSnapshot.val() || {};

	const updates: { [key: string]: any } = {};
	const addedCustomers = new Set<string>();

	try {
		for (const item of trimmedData) {
			if (addedCustomers.has(item.clientID)) {
				continue;
			}

			const matchedCustomer = Object.values(customers).find((customer: any) => customer.code === item.clientID);

			if (!matchedCustomer) {
				const phoneNumbers = item.clientPhone ? item.clientPhone.split(" ").filter(Boolean) : [];
				const newCustomer = {
					code: item.clientID,
					name: item.clientname,
					email: "",
					city: "",
					streetName: item.clientStreetName || "",
					streetNumber: item.clientHouseNumber || "",
					lat: item.latitude === "12.26512100" ? 0 : item.latitude,
					lng: item.longitude === "-70.00457600" ? 0 : item.longitude,
					phoneNumber: phoneNumbers[0] || "",
					phoneNumber2: phoneNumbers[1] || "",
					phoneNumber3: phoneNumbers[2] || "",
				};
				const newCustomerRef = customersRef.push();
				const newCustomerId = newCustomerRef.key;
				if (newCustomerId) {
					updates[newCustomerId] = newCustomer;
				}
			}
			addedCustomers.add(item.clientID);
		}
		await customersRef.update(updates);
	} catch (error) {
		console.error(`Fout bij het controleren/toevoegen van klant`, error);
	}
};

const addOrders = async (trimmedData: any, organizationId: string, dateString: string) => {
	const db = admin.database();
	const customersSnapshot = await db.ref(`/organizations/${organizationId}/customers`).once("value");
	const customers = customersSnapshot.val() || {};

	const ordersRef = db.ref(`/organizations/${organizationId}/orders/date/${dateString}`);

	const ordersSnapshot = await ordersRef.once("value");
	let orders = ordersSnapshot.val() || {};
	const updates: { [key: string]: any } = {};

	for (const item of trimmedData) {
		try {
			const matchedOrder = Object.values(orders).find((order: any) => order.orderNumber === item.orderNumber);

			if (!matchedOrder) {
				// Vind customerId
				let customerId = null;
				if (customers) {
					customerId = Object.keys(customers).find((key) => customers[key].code === item.clientID);
				}

				if (customerId) {
					// Voeg order toe
					const newOrder = {
						customerId,
						orderNumber: item.orderNumber,
						createdBy: "System",
						createdAt: Number(new Date()),
					};

					const newOrderRef = ordersRef.push();
					const newOrderId = newOrderRef.key;
					if (newOrderId) {
						updates[newOrderId] = newOrder;
					}
				} else {
					console.error(
						`Kan order niet toevoegen, ontbrekende klantID of voertuigID voor item: ${item.orderNumber}`
					);
				}
			}
		} catch (error) {
			console.error(`Fout bij het toevoegen van order`, error);
		}
	}

	try {
		await ordersRef.update(updates);
		console.log("All new orders have been pushed successfully.");
	} catch (error) {
		console.error("Error pushing new orders:", error);
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

const addDispatches = async (trimmedData: any, organizationId: string, dateString: string) => {
	const db = admin.database();
	const ordersSnapshot = await db.ref(`/organizations/${organizationId}/orders/date/${dateString}`).once("value");
	const orders = ordersSnapshot.val() || {};

	const vehiclesSnapshot = await db.ref(`/organizations/${organizationId}/vehicles`).once("value");
	const vehicles = vehiclesSnapshot.val() || {};
	const customerOrdersMap: { [customerId: string]: any[] } = {};

	// Groepeer orders per klant
	for (const orderId in orders) {
		if (orders.hasOwnProperty(orderId)) {
			const order = orders[orderId];
			if (!customerOrdersMap[order.customerId]) {
				customerOrdersMap[order.customerId] = [];
			}
			let input: { [key: string]: any } = { order, orderId };
			const { vehicle, notes } = trimmedData.find((item: any) => item.orderNumber === order.orderNumber);
			input.vehicleId = Object.keys(vehicles).find((key) => vehicles[key].licensePlate === vehicle) || "";
			input.notes = notes || "";

			customerOrdersMap[order.customerId].push(input);
		}
	}

	const dispatchesRef = db.ref(`/organizations/${organizationId}/dispatches/date/${dateString}`);
	const tntRef = db.ref(`/trackAndTraceIndex`);
	const updatesDispatches: { [key: string]: any } = {};
	const updatesTnt: { [key: string]: any } = {};

	// Maak dispatches aan per klant
	for (const customerId in customerOrdersMap) {
		if (customerOrdersMap.hasOwnProperty(customerId)) {
			const customerOrders = customerOrdersMap[customerId];
			const trackAndTraceCode = await generateUniqueTrackAndTraceCode();

			const newDispatch = {
				organizationId,
				trackAndTraceCode,
				orderIds: customerOrders.map((order) => order.orderId),
			};
			// for (const dispatch of customerOrders) {
			const newDispatchWithFirstEvent = {
				...newDispatch,
				customerId,
				vehicleId: customerOrders[0].vehicleId,
				notes: customerOrders[0].notes,
				expectedDeliveryDate: dateString,
				status: "Open",
				createdAt: new Date().toISOString(),
				createdBy: "System",
				events: [
					{
						name: "Dispatch Created",
						description: "Dispatch created and added to dispatch",
						createdAt: new Date().toISOString(),
						createdBy: "System",
					},
				],
			};
			const newDispatchRef = dispatchesRef.push();
			const newDispatchId = newDispatchRef.key;
			if (newDispatchId) {
				updatesDispatches[newDispatchId] = newDispatchWithFirstEvent;
			}
			const newTnt = {
				date: dateString,
				dispatchId: newDispatchId,
				organizationId,
			};
			const newTntRef = tntRef.push();
			const newTntId = newTntRef.key;

			if (newTntId) {
				updatesTnt[newTntId] = newTnt;
			}
		}
	}
	try {
		await dispatchesRef.update(updatesDispatches);
		console.log("All new dispatches have been pushed successfully.");
	} catch (error) {
		console.error("Error pushing new dispatches:", error);
	}
	try {
		await tntRef.update(updatesTnt);
		console.log("All new T&T's have been pushed successfully.");
	} catch (error) {
		console.error("Error pushing new T&T's:", error);
	}
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
	return routeResponse;
};

const addRoutes = async (organizationId: string, dateString: string) => {
	const db = admin.database();

	const customersRef = admin.database().ref(`/organizations/${organizationId}/customers`);
	const customersSnapshot = await customersRef.once("value");
	let customers = customersSnapshot.val() || {};

	const dispatchRef = admin.database().ref(`/organizations/${organizationId}/dispatches/date/${dateString}`);
	const dispatchesSnapshot = await dispatchRef.once("value");

	const dispatches = dispatchesSnapshot.val() || {};
	const vehiclesDispatchesMap: { [vehicleId: string]: any[] } = {};

	// Groepeer dispatches per voertuig
	for (const dispatchId in dispatches) {
		if (dispatches.hasOwnProperty(dispatchId)) {
			const dispatch = dispatches[dispatchId];
			const vehicleId = dispatch.vehicleId;
			if (!vehiclesDispatchesMap[vehicleId]) {
				vehiclesDispatchesMap[vehicleId] = [];
			}
			vehiclesDispatchesMap[vehicleId].push({ ...dispatch, dispatchId });
		}
	}

	let startLocation: LatLng = { latitude: 12.503286, longitude: -69.980893 };

	// Maak routes aan per voertuig
	for (const vehicleId in vehiclesDispatchesMap) {
		if (vehiclesDispatchesMap.hasOwnProperty(vehicleId)) {
			const vehicleDispatches = vehiclesDispatchesMap[vehicleId]
				.map((item) => {
					const { lat, lng } = customers[item.customerId];
					const orderCoords = {
						latitude: lat,
						longitude: lng,
					};
					const distance = getDistance(startLocation, orderCoords);
					return { ...item, distance, ...orderCoords };
				})
				.filter((row) => parseInt(row.latitude) !== 0)
				.sort((a: any, b: any) => a.distance - b.distance);

			// Verdeel dispatches in batches van maximaal 12 locaties
			const batches = [];
			for (let i = 0; i < vehicleDispatches.length; i += 11) {
				const batch = vehicleDispatches.slice(i, i + 11);
				batches.push(batch);
			}

			const routeDispatchIds: string[] = [];

			for (const batch of batches) {
				const routeResponse = await getOptimizedTrip(
					startLocation,
					batch.map((x) => {
						return { latitude: x.latitude, longitude: x.longitude };
					})
				);

				if (routeResponse.code !== "Ok") {
					console.error("Error optimizing route:", routeResponse);
					continue;
				}
				const { waypoints } = routeResponse;

				const newDestinations = batch
					.map((destination, indexDestination) => {
						const relatedWaypoint = waypoints.find((waypoint: any, indexWaypoint: number) => {
							// First waypoint is the start location, so we need to skip it.
							return indexWaypoint - 1 === indexDestination;
						});
						return {
							...destination,
							waypoint_index: relatedWaypoint.waypoint_index,
						};
					})
					.sort((a, b) => a.waypoint_index - b.waypoint_index);
				routeDispatchIds.push(...newDestinations.map((x) => x.dispatchId));

				startLocation = {
					latitude: newDestinations[newDestinations.length - 1].latitude,
					longitude: newDestinations[newDestinations.length - 1].longitude,
				};
			}

			const route = {
				vehicleId,
				dispatchIds: routeDispatchIds,
			};

			const newRouteRef = await db.ref(`/organizations/${organizationId}/routes/date/${dateString}`).push(route);
			const newRouteId = newRouteRef.key;

			const updates: { [key: string]: any } = {};

			for (const dispatchId in dispatches) {
				if (dispatches.hasOwnProperty(dispatchId)) {
					const dispatch = dispatches[dispatchId];
					if (vehicleId === dispatch.vehicleId) {
						const { vehicleId, ...rest } = dispatch;
						updates[dispatchId] = {
							...rest,
							routeId: newRouteId,
						};
					}
				}
			}
			dispatchRef.update(updates);
		}
	}
};
