import * as admin from "firebase-admin";
import * as functions from "firebase-functions";

// export const createOrderEvent = functions.database
// 	.ref("/organizations/{organizationId}/orders/{orderId}")
// 	.onCreate((snapshot, context) => {
// 		const { organizationId, orderId } = context.params;
// 		const orderData = snapshot.val();
// 		// Push de nieuwe order als een event
// 		return admin.database().ref(`/organizations/${organizationId}/orders/${orderId}/events/0`).set(orderData);
// 	});

export const updateOrderEvent = functions.database
	.ref("/organizations/{organizationId}/orders/date/{date}/{orderId}")
	.onUpdate(async (change, context) => {
		const { organizationId, date, orderId } = context.params;
		const beforeUpdate = change.before.val();
		const afterUpdate = change.after.val();
		// Bereken de wijzigingen; dit is een eenvoudig voorbeeld en kan aangepast worden
		const changes: { [key: string]: any } = {};
		Object.keys(afterUpdate).forEach((key) => {
			if (key !== "events" && key !== "routeOrderIndex" && afterUpdate[key] !== beforeUpdate[key]) {
				changes[key] = afterUpdate[key];
			}
		});
		if (Object.keys(changes).length === 0) {
			return null;
		}
		const eventsRef = admin
			.database()
			.ref(`/organizations/${organizationId}/orders/date/${date}/${orderId}/events`);
		try {
			const snapshot = await eventsRef.once("value");
			const events = snapshot.val();
			const eventsLength = events ? events.length : 0; // Als events null is, gebruik 0
			// Gebruik set in plaats van push
			return eventsRef.child(`${eventsLength}`).set(Object.assign({ createdBy: afterUpdate.createdBy }, changes));
		} catch (error) {
			console.error("Fout bij het updaten van het event:", error);
			return null;
		}
	});
