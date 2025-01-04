import * as admin from "firebase-admin";
import * as functions from "firebase-functions";
// export const fetchOrdersByDate = functions.https.onRequest(async (req, res) => {
// 	const db = admin.database();

// 	if (!req.query.date) {
// 		res.status(400).json({ error: "Date is required" });
// 		return;
// 	}
// 	const organizationId = req.query.organizationId;

// 	if (!organizationId) {
// 		res.status(400).json({ error: "Organisation ID required" });
// 		return;
// 	}

// 	const authHeader = req.headers.authorization;

// 	if (!authHeader || !authHeader.startsWith("Bearer ")) {
// 		res.status(401).json({ error: "Unauthorized" });
// 		return;
// 	}

// 	const token = authHeader.split("Bearer ")[1];

// 	try {
// 		const decodedToken = await admin.auth().verifyIdToken(token);
// 		if (decodedToken) {
// 			const expectedDeliveryDate = req.query.date as string;

// 			const ordersRef = db.ref(`/organizations/${organizationId}/orders/date/${expectedDeliveryDate}`);

// 			const ordersSnapshot = await ordersRef.once("value");
// 			const orders = ordersSnapshot.val() || {};

// 			res.json(orders);
// 		} else {
// 			res.status(401).json({ error: "Unauthorized" });
// 		}
// 	} catch (error) {
// 		console.error("Failed to fetch orders:", error);
// 		throw new functions.https.HttpsError("internal", "Failed to fetch orders from the database.");
// 	}
// });

export const removeAllOrders = functions.https.onRequest(async (req, res) => {
	const organizationId = req.query.organizationId;

	console.log("organizationId", organizationId);

	await admin.database().ref(`/organizations/${organizationId}/orders`).remove();
	res.json({
		message: "All orders removed",
	});
	// const authHeader = req.headers.authorization;
	// req.setTimeout(500000);

	// if (!authHeader || !authHeader.startsWith("Bearer ")) {
	// 	res.status(401).json({ error: "Unauthorized" });
	// 	return;
	// }

	// const token = authHeader.split("Bearer ")[1];

	// if (!organizationId) {
	// 	res.status(400).json({ error: "Organisation ID required" });
	// 	return;
	// }

	// try {
	// 	const decodedToken = await admin.auth().verifyIdToken(token);
	// 	if (decodedToken) {
	// 		await admin.database().ref(`/organizations/${organizationId}/orders`).remove();
	// 		res.json({
	// 			message: "All orders removed",
	// 		});
	// 		return; // Zorg ervoor dat de functie hier stopt
	// 	} else {
	// 		res.status(401).json({ error: "Unauthorized" });
	// 		return; // Zorg ervoor dat de functie hier stopt
	// 	}
	// } catch (error) {
	// 	console.error(`Fout bij het verwijderen van orders`, error);
	// 	res.status(500).json({ error: "Internal Server Error" }); // Voeg een foutstatus toe voor de catch-block
	// }
});
