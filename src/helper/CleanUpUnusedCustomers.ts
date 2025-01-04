import * as admin from "firebase-admin";
import * as functions from "firebase-functions";

const getDuplicateCustomerIds = async (organizationId: string) => {
	const db = admin.database();

	const customersRef = db.ref(`/organizations/${organizationId}/customers`);
	const customersSnapshot = await customersRef.once("value");
	const customers = customersSnapshot.val() || {};

	const customerCodeMap: { [code: string]: string[] } = {};

	for (const customerId in customers) {
		if (customers.hasOwnProperty(customerId)) {
			const customer = customers[customerId];
			if (!customerCodeMap[customer.code]) {
				customerCodeMap[customer.code] = [];
			}
			customerCodeMap[customer.code].push(customerId);
		}
	}

	const duplicates = Object.keys(customerCodeMap).filter((code) => customerCodeMap[code].length > 1);
	const duplicateCustomerIds = duplicates.map((code) => ({
		code,
		customerIds: customerCodeMap[code],
	}));

	return duplicateCustomerIds;
};

const updateOrderCustomerIds = async (
	organizationId: string,
	duplicateCustomerIds: { code: string; customerIds: string[] }[]
) => {
	const db = admin.database();

	const ordersRef = db.ref(`/organizations/${organizationId}/orders/date`);
	const ordersSnapshot = await ordersRef.once("value");
	const orders = ordersSnapshot.val() || {};

	for (const { customerIds } of duplicateCustomerIds) {
		const mostRecentCustomerId = customerIds[customerIds.length - 1];

		for (const date in orders) {
			if (orders.hasOwnProperty(date)) {
				const dateOrders = orders[date];
				for (const orderId in dateOrders) {
					if (dateOrders.hasOwnProperty(orderId)) {
						const order = dateOrders[orderId];
						if (customerIds.includes(order.customerId)) {
							await db
								.ref(`/organizations/${organizationId}/orders/date/${date}/${orderId}/customerId`)
								.set(mostRecentCustomerId);
						}
					}
				}
			}
		}
	}
};

const cleanUpUnusedCustomers = async (
	organizationId: string,
	duplicateCustomerIds: { code: string; customerIds: string[] }[]
) => {
	const db = admin.database();

	const customersRef = db.ref(`/organizations/${organizationId}/customers`);

	for (const { customerIds } of duplicateCustomerIds) {
		const mostRecentCustomerId = customerIds[customerIds.length - 1];

		for (const customerId of customerIds) {
			if (customerId !== mostRecentCustomerId) {
				await customersRef.child(customerId).remove();
			}
		}
	}
};

export const cleanUpDuplicateCustomers = functions.https.onRequest(async (req, res) => {
	const organizationId = req.query.organizationId as string;
	if (!organizationId) {
		res.status(400).send("Missing organizationId");
		return;
	}

	try {
		const duplicateCustomerIds = await getDuplicateCustomerIds(organizationId);
		console.log(duplicateCustomerIds.length);
		await updateOrderCustomerIds(organizationId, duplicateCustomerIds);
		await cleanUpUnusedCustomers(organizationId, duplicateCustomerIds);

		res.status(200).send("Duplicate customers cleaned up successfully");
	} catch (error) {
		console.error("Error cleaning up duplicate customers:", error);
		res.status(500).send("Internal Server Error");
	}
});
