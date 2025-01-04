import * as admin from "firebase-admin";
import * as functions from "firebase-functions";
export const fetchLastLocationUsers = functions.https.onRequest(async (req, res) => {
	const db = admin.database();

	if (!req.query.date) {
		res.status(400).json({ error: "Date is required" });
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

			const usersRef = db.ref(`/organizations/${organizationId}/tracking/${date}/users`);
			const usersSnapshot = await usersRef.once("value");
			const users = usersSnapshot.val() || {};

			const latestLocations: { [key: string]: any } = {};

			for (const userId in users) {
				if (users.hasOwnProperty(userId)) {
					const userRef = usersRef.child(userId).limitToLast(1);
					const userSnapshot = await userRef.once("value");
					const userLocation = userSnapshot.val();

					if (userLocation) {
						const lastChildKey = Object.keys(userLocation)[0];
						latestLocations[userId] = userLocation[lastChildKey];
					}
				}
			}

			res.json(latestLocations);
		} else {
			res.status(401).json({ error: "Unauthorized" });
		}
	} catch (error) {
		console.error("Failed to fetch orders:", error);
		throw new functions.https.HttpsError("internal", "Failed to fetch orders from the database.");
	}
});
