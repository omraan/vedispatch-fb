import * as admin from "firebase-admin";
import * as functions from "firebase-functions";

// Definieer de ongeldige coördinaatbereiken voor Aruba - coördinaten binnen dit bereik zijn ongeldig
const INVALID_COORDINATES = {
	latitude: {
		min: 12.190664,
		max: 12.468679,
	},
	longitude: {
		min: -70.0153,
		max: -69.98409,
	},
};
/**
 * Controleert of coördinaten in het ongeldige bereik voor Aruba vallen
 * Deze coördinaten liggen in de oceaan en moeten worden gereset naar 0
 */
export const isInvalidCoordinate = (latitude: number, longitude: number): boolean => {
	return (
		latitude >= INVALID_COORDINATES.latitude.min &&
		latitude <= INVALID_COORDINATES.latitude.max &&
		longitude >= INVALID_COORDINATES.longitude.min &&
		longitude <= INVALID_COORDINATES.longitude.max
	);
};

/**
 * Deze functie sanitized coördinaten in de Arugas-database
 * Het reset punten die in de oceaan liggen (binnen de gedefinieerde ongeldige grenzen) naar 0,0
 */
export const sanitizeArugasCoordinates = functions.https.onRequest(async (req, res) => {
	try {
		const environment = functions.config().environment?.mode;
		const organizationId = process.env[`${environment}_ARUGAS_ORG_ID`] as string;

		if (!organizationId) {
			res.status(400).json({ error: "organizationId parameter is vereist" });
			return;
		}

		// Optionele dryRun parameter (standaard true voor veiligheid)
		const dryRun = req.query.dryRun !== "false";

		const db = admin.database();
		const locationsRef = db.ref(`/organizations/${organizationId}/locations`);
		const locationsSnapshot = await locationsRef.once("value");
		const locations = locationsSnapshot.val() || {};

		const updates: { [key: string]: any } = {};
		let sanitizedCount = 0;
		let totalLocations = 0;

		// Doorloop alle locaties en controleer de coördinaten
		for (const locationId in locations) {
			const location = locations[locationId];
			totalLocations++;

			// Controleer of we geldige numerieke coördinaten hebben
			const latitude = parseFloat(location.latitude);
			const longitude = parseFloat(location.longitude);

			if (!isNaN(latitude) && !isNaN(longitude)) {
				// Als coördinaten binnen het ongeldige bereik vallen
				if (isInvalidCoordinate(latitude, longitude)) {
					console.log(
						`Ongeldige coördinaten gevonden voor locatie ${locationId}: [${latitude}, ${longitude}]`
					);

					// Maak een kopie van de huidige events of maak een nieuwe array
					const events = [...(location.events || [])];

					// Voeg een event toe voor deze wijziging
					events.push({
						timestamp: Date.now(),
						description: "Coordinates sanitized - Reset from invalid values",
						changedBy: "System",
						changed: {
							latitude: { old: latitude, new: 0 },
							longitude: { old: longitude, new: 0 },
						},
					});

					// Bereid update voor
					updates[`${locationId}/latitude`] = 0;
					updates[`${locationId}/longitude`] = 0;
					updates[`${locationId}/events`] = events;
					updates[`${locationId}/modifiedAt`] = Date.now();
					updates[`${locationId}/modifiedBy`] = "System";

					sanitizedCount++;
				}
			}
		}

		// Voer updates uit als er wijzigingen zijn
		if (Object.keys(updates).length > 0) {
			if (!dryRun) {
				await locationsRef.update(updates);
				console.log(`${sanitizedCount} locaties geüpdatet met gesaniteerde coördinaten`);
				res.status(200).json({
					message: `${sanitizedCount} van ${totalLocations} locaties geüpdatet met gesaniteerde coördinaten`,
				});
			} else {
				console.log(
					`Dry run: ${sanitizedCount} locaties zouden worden geüpdatet (geen wijzigingen doorgevoerd)`
				);
				res.status(200).json({
					message: `Dry run: ${sanitizedCount} van ${totalLocations} locaties zouden worden geüpdatet`,
					locationsToUpdate: Object.keys(updates).length / 5, // Deel door 5 omdat we 5 velden per locatie updaten
				});
			}
		} else {
			res.status(200).json({
				message: `Geen ongeldige coördinaten gevonden in ${totalLocations} locaties`,
			});
		}
	} catch (error) {
		console.error("Fout bij het sanitizen van coördinaten:", error);
		res.status(500).json({ error: "Interne serverfout bij het verwerken van coördinaten" });
	}
});
