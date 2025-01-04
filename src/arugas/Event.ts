import * as admin from "firebase-admin";
import * as functions from "firebase-functions";
import moment from "moment";

const environment = process.env["ENVIRONMENT"];
const organizationId = process.env[`${environment}_ARUGAS_ORG_ID`];

export const updateArugasCustomerLocation = functions.database
	.ref(`/organizations/${organizationId}/customers/{customerId}`)
	.onUpdate(async (change, context) => {
		const { customerId } = context.params;
		const beforeUpdate = change.before.val();
		const afterUpdate = change.after.val();

		const changes: { [key: string]: any } = {};
		Object.keys(afterUpdate).forEach((key) => {
			if ((key === "lat" || key === "lng") && afterUpdate[key] !== beforeUpdate[key]) {
				changes[key] = afterUpdate[key];
			}
		});
		if (Object.keys(changes).length === 0) {
			return null;
		}

		try {
			const customerRef = admin.database().ref(`/organizations/${organizationId}/customers/${customerId}`);
			const snapshot = await customerRef.once("value");
			const customer = snapshot.val();

			if (
				customer &&
				customer.name &&
				customer.code
				// && customer.name.startsWith("GPS TEST DEBTOR")
			) {
				const ordersRef = admin
					.database()
					.ref(`/organizations/${organizationId}/orders`)
					.orderByChild("customerId")
					.equalTo(customerId)
					.limitToLast(1);

				const ordersSnapshot = await ordersRef.once("value");
				const orderParent = ordersSnapshot.val();

				if (!orderParent || !orderParent[Object.keys(orderParent)[0]].orderNumber) {
					console.error("Onvoldoende order data beschikbaar:", orderParent);
					return null;
				}
				const order = orderParent[Object.keys(orderParent)[0]];
				//https://portal.arugas.com/ARGGPS/ArugasService.svc/UpdateGPSCoordinates/9911111/-80.0286/25.5449/3205801/2022-03-18T23.15.01/DeliveryType/1900-01-01T00.00.00
				const latestEvent = order.events[order.events.length - 1];
				const datetimeNumber = latestEvent.modifiedAt || latestEvent.createdAt;
				const latestEventDate = datetimeNumber ? moment(datetimeNumber).toISOString() : "1900-01-01T00.00.00";

				const Authorization = "Basic VXNyX0dQUy5BVzphc2YkR2ZlZzQyJEYxMjAx";
				const url = `https://portal.arugas.com/ARGGPS/ArugasService.svc/UpdateGPSCoordinates/${customer.code}/${changes.lat}/${changes.lng}/${order.orderNumber}/${latestEventDate}/DeliveryType/1900-01-01T00.00.00`;
				console.log("request URL", url);
				const response = await fetch(url, {
					method: "POST",
					headers: {
						Authorization,
					},
				});
				console.log("Response >>> ", response);
				if (!response.ok) {
					throw new Error(`Server responded with a status of ${response.status}`);
				}
				return response.json();
			}
			console.error("Onvoldoende customer beschikbaar:", customer);
			return null;
		} catch (error) {
			console.error("Fout bij het updaten van het gsp coordinates:", error);
			return null;
		}
	});
