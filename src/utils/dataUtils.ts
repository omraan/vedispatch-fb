import * as admin from "firebase-admin";

/**
 * Detecteert veranderingen tussen oude en nieuwe data objecten.
 * Geeft een object terug met alleen de velden die gewijzigd zijn.
 *
 * @param oldData Originele data
 * @param newData Nieuwe data
 * @param excludeFields Velden om uit te sluiten van vergelijking (optioneel)
 * @returns Object met alleen de gewijzigde velden, of null als er geen wijzigingen zijn
 */
export function detectChanges(
	oldData: Record<string, any>,
	newData: Record<string, any>,
	excludeFields: string[] = []
): Record<string, any> | null {
	const changes: Record<string, any> = {};
	let hasChanges = false;

	// Loop door alle velden in de nieuwe data
	for (const [key, value] of Object.entries(newData)) {
		// Skip velden die uitgesloten moeten worden
		if (excludeFields.includes(key)) {
			continue;
		}

		// Als het veld niet bestaat in de oude data, of de waarde is anders
		// (check ook voor undefined en null)
		const oldValue = oldData[key];
		if (oldValue === undefined || oldValue === null) {
			if (value !== undefined && value !== null) {
				changes[key] = value;
				hasChanges = true;
			}
		} else if (
			// Voor arrays gebruiken we JSON.stringify om te vergelijken
			Array.isArray(value) && Array.isArray(oldValue)
				? JSON.stringify(value) !== JSON.stringify(oldValue)
				: // Voor objecten (geen arrays) roepen we recursief aan
				typeof value === "object" && value !== null && typeof oldValue === "object" && oldValue !== null
				? (() => {
						const nestedChanges = detectChanges(oldValue, value);
						if (nestedChanges) {
							changes[key] = nestedChanges;
							hasChanges = true;
							return true;
						}
						return false;
				  })()
				: // Voor primitieve waarden doen we een directe vergelijking
				  value !== oldValue
		) {
			changes[key] = value;
			hasChanges = true;
		}
	}

	return hasChanges ? changes : null;
}

/**
 * Combineert twee objecten, met speciale behandeling voor arrays.
 * Bij arrays wordt de nieuwe array teruggegeven, voor andere velden worden
 * de objecten diep samengevoegd.
 *
 * @param original Oorspronkelijke object
 * @param updates Object met updates
 * @returns Gecombineerd object
 */
export function deepMerge(original: Record<string, any>, updates: Record<string, any>): Record<string, any> {
	const result = { ...original };

	for (const [key, value] of Object.entries(updates)) {
		// Als de waarde een array is, vervang deze volledig
		if (Array.isArray(value)) {
			result[key] = [...value];
		}
		// Als de waarde een object is (maar geen array), doe recursieve merge
		else if (
			typeof value === "object" &&
			value !== null &&
			!Array.isArray(value) &&
			typeof result[key] === "object" &&
			result[key] !== null &&
			!Array.isArray(result[key])
		) {
			result[key] = deepMerge(result[key], value);
		}
		// Anders, vervang de waarde
		else {
			result[key] = value;
		}
	}

	return result;
}

/**
 * Maakt een timestamp object voor gebruik in Firestore
 */
export function createTimestamp(): admin.firestore.Timestamp {
	return admin.firestore.Timestamp.now();
}

/**
 * Converteert een JavaScript Date naar een timestamp voor Realtime Database
 */
export function dateToTimestamp(date: Date = new Date()): number {
	return date.getTime();
}

/**
 * Formatteert een timestamp string in het formaat YYYY-MM-DD HH:mm:ss
 */
export function formatTimestamp(timestamp: number): string {
	const date = new Date(timestamp);
	return date.toISOString().replace("T", " ").substring(0, 19);
}

/**
 * Bepaalt of een object een geldige geolocatie heeft
 */
export function hasValidCoordinates(obj: any, latField: string = "latitude", lngField: string = "longitude"): boolean {
	if (!obj || typeof obj !== "object") return false;

	const lat = parseFloat(obj[latField]);
	const lng = parseFloat(obj[lngField]);

	return !isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}
