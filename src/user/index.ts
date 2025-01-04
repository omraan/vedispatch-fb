import * as admin from "firebase-admin";
import * as functions from "firebase-functions";
export const fetchLastUserLocation = functions.https.onRequest(async (req, res) => {
	const db = admin.database();

	if (!req.query.date) {
		res.status(400).json({ error: "Date is required" });
		return;
	}
	const userId = req.query.userId;
	if (!userId) {
		res.status(400).json({ error: "User ID is required" });
		return;
	}

	const organizationId = req.query.organizationId;

	if (!organizationId) {
		res.status(400).json({ error: "Organisation ID required" });
		return;
	}

	const authHeader = req.headers.authorization;

	if (!authHeader || !authHeader.startsWith("Bearer ")) {
		res.status(401).json({ error: "Unauthorized" });
		return;
	}

	const token = authHeader.split("Bearer ")[1];

	try {
		const decodedToken = await admin.auth().verifyIdToken(token);

		if (decodedToken) {
			const date = req.query.date as string;

			const ordersRef = db.ref(`/users/${userId}/${date}`).limitToLast(1);

			const ordersSnapshot = await ordersRef.once("value");
			const orders = ordersSnapshot.val() || {};

			res.json(orders);
		} else {
			res.status(401).json({ error: "Unauthorized" });
		}
	} catch (error) {
		console.error("Failed to fetch orders:", error);
		throw new functions.https.HttpsError("internal", "Failed to fetch orders from the database.");
	}
});
