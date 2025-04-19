import polyline from "@mapbox/polyline";
import * as admin from "firebase-admin";
import haversine from "haversine-distance";
import { LatLng } from "./types";

export const getDistance = (location1: LatLng, location2: LatLng) => {
	return haversine(location1, location2);
};

export const combineGeometries = (geometry1: string, geometry2: string): string => {
	const coordinates1 = polyline.decode(geometry1);
	const coordinates2 = polyline.decode(geometry2);

	// Combineer de coördinaten
	const combinedCoordinates = [...coordinates1, ...coordinates2];

	// Codeer de gecombineerde coördinaten opnieuw
	const combinedGeometry = polyline.encode(combinedCoordinates);

	return combinedGeometry;
};

export const generateUniqueTrackAndTraceCode = async (): Promise<string> => {
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

export const replaceInvalidStreetNames = (streetName: string): string => {
	const invalidStreetNames = [
		{
			invalid: "Montaa",
			valid: "Montana",
		},
		{
			invalid: "Pavilla Country Club",
			valid: "Pavilla",
		},
		{
			invalid: "Caya Maguey",
			valid: "Caya Maquey",
		},
		{
			invalid: "Salia",
			valid: "Salina",
		},
		{
			invalid: "Celciusstraat",
			valid: "Celsiusstraat",
		},
		{
			invalid: "Caya Papa Huan Pablo II",
			valid: "Caya Papa Juan Pablo II",
		},
		{
			invalid: "Caya Guadaloupe",
			valid: "Caya Guadeloupe",
		},
		{
			invalid: "Seroe",
			valid: "Sero",
		},
		{
			invalid: "Caya Frere Federicus",
			valid: "Caya Frere Federicus",
		},
		{
			invalid: "Caya Federico Maduro",
			valid: "Cara Federico Maduro",
		},
		{
			invalid: "Baranka",
			valid: "Baranca",
		},
	];

	if (!streetName) return streetName;

	let result = streetName;
	// Convert to lowercase for case-insensitive comparison
	const lowerStreetName = streetName.toLowerCase();

	for (const mapping of invalidStreetNames) {
		const invalidLower = mapping.invalid.toLowerCase();

		// Check for exact match or match with proper word boundaries
		if (
			lowerStreetName === invalidLower || // Exact match
			lowerStreetName.match(new RegExp(`\\b${invalidLower}\\b`, "i")) // Word boundary match
		) {
			// Replace the original case-preserved string with word boundaries
			const regex = new RegExp(`\\b${mapping.invalid}\\b`, "i");
			result = result.replace(regex, mapping.valid);

			// We found a match, no need to check other mappings
			break;
		}
	}

	return result;
};
