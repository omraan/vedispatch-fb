import * as admin from "firebase-admin";
import * as functions from "firebase-functions";
import moment from "moment";
require("dotenv").config();

export const getArugasData = async (date: string) => {
	const Authorization = "Basic VXNyX0dQUy5BVzphc2YkR2ZlZzQyJEYxMjAx";
	const environment = process.env["ENVIRONMENT"];
	const organizationId = process.env[`${environment}_ARUGAS_ORG_ID`] as string;
	try {
		const response = await fetch(`https://portal.arugas.com/ARGGPS/ArugasService.svc/GetOrder/${date}`, {
			headers: {
				Authorization,
			},
		});

		if (!response.ok) {
			throw new Error(`Server responded with a status of ${response.status}`);
		}
		const { OrderList: data } = await response.json();
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
					lat: item.latitude,
					lng: item.longitude,
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
						vehicleId: item.vehicle,
						expectedDeliveryDate: dateString,
						orderNumber: item.orderNumber,
						notes: item.notes || "",
						status: "Open",
						createdBy: "System",
						createdAt: Number(new Date()),
					};

					const newOrderWithFirstEvent = {
						...newOrder,
						events: [
							{
								name: "Order Created",
								description: "Order created and added to Order",
								...newOrder,
							},
						],
					};

					const newOrderRef = ordersRef.push();
					const newOrderId = newOrderRef.key;
					if (newOrderId) {
						updates[newOrderId] = newOrderWithFirstEvent;
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
