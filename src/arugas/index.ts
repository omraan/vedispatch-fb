/**
 * Index file that re-exports all Arugas functionality from their respective modules.
 * This makes the codebase more modular and maintainable.
 */

import * as admin from "firebase-admin";
import * as functions from "firebase-functions";
import moment from "moment";
import { findLocationViaOpenStreetMaps, getArugasData } from "./api";
import { isInvalidCoordinate } from "./sanitizeCoordinates";
import { replaceInvalidStreetNames } from "./utils";

// Export from types.ts
export { ArugasData, LatLng, Route, RouteStop } from "./types";

// Export from utils.ts
export { combineGeometries, generateUniqueTrackAndTraceCode, getDistance } from "./utils";

// Export from vehicles.ts
export { checkAndAddVehicles } from "./vehicles";

// Export from customers.ts
export { checkAndAddCustomers } from "./customers";

// Export from routes.ts
export { addRoutes } from "./routes";

// Export from mapbox.ts
export { getOptimizedTrip } from "./mapbox";

// Export from sanitizeCoordinates.ts
export { isInvalidCoordinate } from "./sanitizeCoordinates";

// Export from api.ts
export { getArugasData } from "./api";

export const fetchArugasData = functions
	.runWith({
		memory: "1GB",
		timeoutSeconds: 540,
	})
	.https.onRequest(async (req, res) => {
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

export const scheduledFetchArugasData = functions
	.runWith({
		memory: "1GB",
		timeoutSeconds: 540,
	})
	.pubsub.schedule("every day 18:00")
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

export const updateMissingLocations = functions
	.runWith({
		memory: "1GB",
		timeoutSeconds: 540,
	})
	.https.onRequest(async (req, res) => {
		try {
			const environment = functions.config().environment?.mode;
			const organizationId = process.env[`${environment}_ARUGAS_ORG_ID`] as string;

			// Get pagination parameters from query string
			const batchSize = parseInt(req.query.batchSize as string) || 50; // Default batch size: 50
			const startIndex = parseInt(req.query.startIndex as string) || 0; // Default start index: 0

			const locationsRef = admin.database().ref(`/organizations/${organizationId}/locations`);
			const locationsSnapshot = await locationsRef.once("value");
			const locations: {
				[key: string]: {
					latitude: string;
					longitude: string;
					streetName: string;
					streetNumber: string;
					city: string;
				};
			} = locationsSnapshot.val() || {};

			// Get invalid locations
			const invalidLocationIds: string[] = [];
			for (const [locationId, location] of Object.entries(locations)) {
				if (
					!location.latitude ||
					!location.longitude ||
					parseFloat(location.latitude) === 0 ||
					parseFloat(location.longitude) === 0 ||
					isInvalidCoordinate(parseFloat(location.latitude), parseFloat(location.longitude))
				) {
					invalidLocationIds.push(locationId);
				}
			}

			const totalInvalidLocations = invalidLocationIds.length;
			console.log(`Found ${totalInvalidLocations} locations with invalid coordinates`);

			if (totalInvalidLocations === 0) {
				res.status(200).json({
					success: true,
					message: "No invalid locations found",
					totalInvalidLocations: 0,
				});
				return;
			}

			// Process only a subset of locations based on pagination
			const endIndex = Math.min(startIndex + batchSize, totalInvalidLocations);
			const currentBatch = invalidLocationIds.slice(startIndex, endIndex);

			console.log(
				`Processing batch from index ${startIndex} to ${endIndex - 1} (${currentBatch.length} locations)`
			);

			// Process in smaller chunks with rate limiting
			const chunkSize = 5; // Process 5 locations in parallel
			const delayBetweenChunks = 1000; // 1 second delay between chunks
			const updatesLocation: { [key: string]: any } = {};
			let updatedCount = 0;
			let failedCount = 0;

			// Process in chunks
			for (let i = 0; i < currentBatch.length; i += chunkSize) {
				const chunk = currentBatch.slice(i, i + chunkSize);

				// Process all locations in this chunk in parallel
				const chunkPromises = chunk.map(async (locationId) => {
					const location = locations[locationId];
					try {
						const newStreetName = replaceInvalidStreetNames(location.streetName);

						const newCoordinates = await findLocationViaOpenStreetMaps({
							streetName: newStreetName,
							streetNumber: location.streetNumber,
							city: location.city,
						});

						// Only update if we got valid coordinates (not 0,0)
						if (newCoordinates.latitude !== "0" && newCoordinates.longitude !== "0") {
							return {
								locationId,
								update: {
									...location,
									streetName: newStreetName,
									latitude: newCoordinates.latitude,
									longitude: newCoordinates.longitude,
									modifiedAt: Date.now(),
									modifiedBy: "System",
								},
								success: true,
							};
						} else {
							console.log(
								`Could not find coordinates for location ${locationId}: ${location.streetName} ${location.streetNumber}, ${location.city}`
							);
							return { locationId, success: false };
						}
					} catch (error) {
						console.error(`Error updating location ${locationId}:`, error);
						return { locationId, success: false };
					}
				});

				// Wait for all promises in this chunk to resolve
				const results = await Promise.all(chunkPromises);

				// Process results
				for (const result of results) {
					if (result.success && result.update) {
						updatesLocation[result.locationId] = result.update;
						updatedCount++;
					} else {
						failedCount++;
					}
				}

				// Rate limiting - add delay between chunks
				if (i + chunkSize < currentBatch.length) {
					await new Promise((resolve) => setTimeout(resolve, delayBetweenChunks));
				}
			}

			// Only update if we have any valid updates
			if (Object.keys(updatesLocation).length > 0) {
				await locationsRef.update(updatesLocation);
				console.log(`Updated ${updatedCount} locations with new coordinates`);
			}

			// Determine if there are more locations to process
			const hasMore = endIndex < totalInvalidLocations;
			const nextStartIndex = hasMore ? endIndex : null;

			res.status(200).json({
				success: true,
				message: `Processed batch ${startIndex}-${
					endIndex - 1
				} of ${totalInvalidLocations} invalid locations. Updated: ${updatedCount}, Failed: ${failedCount}`,
				updatedLocations: updatedCount,
				failedLocations: failedCount,
				totalInvalidLocations,
				processedBatch: {
					start: startIndex,
					end: endIndex - 1,
					size: currentBatch.length,
				},
				hasMore,
				nextStartIndex,
				nextUrl: hasMore ? `/updateMissingLocations?startIndex=${nextStartIndex}&batchSize=${batchSize}` : null,
			});
		} catch (error: any) {
			console.error("Error updating locations:", error);
			res.status(500).json({
				success: false,
				message: "Error updating locations",
				error: error.message,
			});
		}
	});

export const updateDuplicateLocationCoordinates = functions
	.runWith({
		memory: "1GB",
		timeoutSeconds: 540,
	})
	.https.onRequest(async (req, res) => {
		try {
			const environment = functions.config().environment?.mode;
			const organizationId = process.env[`${environment}_ARUGAS_ORG_ID`] as string;

			// Get pagination parameters from query string
			const batchSize = parseInt(req.query.batchSize as string) || 50; // Default batch size: 50
			const startIndex = parseInt(req.query.startIndex as string) || 0; // Default start index: 0
			const offsetInMeters = parseFloat(req.query.offsetInMeters as string) || 5; // Default offset in meters: 5
			const dryRun = req.query.dryRun === "true"; // Default: false (actually make changes)

			const locationsRef = admin.database().ref(`/organizations/${organizationId}/locations`);
			const locationsSnapshot = await locationsRef.once("value");
			const locations: {
				[key: string]: {
					latitude: number | string;
					longitude: number | string;
					streetName: string;
					streetNumber: string;
					city: string;
					modifiedAt?: number;
					modifiedBy?: string;
					events?: any[];
				};
			} = locationsSnapshot.val() || {};

			console.log(`Found ${Object.keys(locations).length} total locations`);

			// Create a map of coordinates to location IDs
			const coordinatesMap: { [key: string]: string[] } = {};
			const locationIds = Object.keys(locations);

			// First pass: build the coordinates map
			for (const locationId of locationIds) {
				const location = locations[locationId];

				// Skip locations with invalid/missing coordinates
				if (
					!location.latitude ||
					!location.longitude ||
					parseFloat(String(location.latitude)) === 0 ||
					parseFloat(String(location.longitude)) === 0 ||
					isInvalidCoordinate(parseFloat(String(location.latitude)), parseFloat(String(location.longitude)))
				) {
					continue;
				}

				const coordKey = `${location.latitude},${location.longitude}`;
				if (!coordinatesMap[coordKey]) {
					coordinatesMap[coordKey] = [];
				}
				coordinatesMap[coordKey].push(locationId);
			}

			// Find coordinates with duplicates
			const duplicateCoordinates = Object.entries(coordinatesMap)
				.filter(([_, ids]) => ids.length > 1)
				.map(([coords, ids]) => ({
					coordinates: coords,
					locationIds: ids,
				}));

			const totalDuplicateCoordinates = duplicateCoordinates.length;
			const totalDuplicateLocations = duplicateCoordinates.reduce(
				(sum, item) => sum + item.locationIds.length - 1, // subtract 1 because we'll keep the first one as is
				0
			);

			console.log(
				`Found ${totalDuplicateCoordinates} unique coordinates with duplicates, affecting ${totalDuplicateLocations} locations`
			);

			if (totalDuplicateLocations === 0) {
				res.status(200).json({
					success: true,
					message: "No duplicate coordinates found",
					totalLocations: Object.keys(locations).length,
				});
				return;
			}

			// Process only a subset of duplicate coordinates based on pagination
			const paginatedDuplicates = duplicateCoordinates.slice(startIndex, startIndex + batchSize);
			const endIndex = Math.min(startIndex + batchSize, totalDuplicateCoordinates);

			console.log(
				`Processing batch from index ${startIndex} to ${endIndex - 1} (${
					paginatedDuplicates.length
				} duplicate coordinate sets)`
			);

			// Helper function to shift coordinates by a specified distance in meters
			// Approximate conversion: 0.00001 degrees ≈ 1.1 meters at the equator
			const shiftCoordinates = (
				lat: number,
				lng: number,
				index: number,
				offsetMeters: number
			): { latitude: number; longitude: number } => {
				// Converting meters to approximate degrees (this is a simplification)
				const metersToDegreesApprox = offsetMeters / 111000; // ~111km per degree at the equator

				// Apply different shifts based on index to avoid creating new duplicates
				// Creates a pattern of shifts in different directions
				switch (index % 8) {
					case 0:
						return { latitude: lat + metersToDegreesApprox, longitude: lng }; // North
					case 1:
						return { latitude: lat, longitude: lng + metersToDegreesApprox }; // East
					case 2:
						return { latitude: lat - metersToDegreesApprox, longitude: lng }; // South
					case 3:
						return { latitude: lat, longitude: lng - metersToDegreesApprox }; // West
					case 4:
						return { latitude: lat + metersToDegreesApprox, longitude: lng + metersToDegreesApprox }; // Northeast
					case 5:
						return { latitude: lat - metersToDegreesApprox, longitude: lng + metersToDegreesApprox }; // Southeast
					case 6:
						return { latitude: lat - metersToDegreesApprox, longitude: lng - metersToDegreesApprox }; // Southwest
					case 7:
						return { latitude: lat + metersToDegreesApprox, longitude: lng - metersToDegreesApprox }; // Northwest
					default:
						return { latitude: lat, longitude: lng };
				}
			};

			// Process duplicate coordinates and prepare updates
			const updates: { [key: string]: any } = {};
			let shiftsApplied = 0;

			for (const duplicateSet of paginatedDuplicates) {
				const [firstLat, firstLng] = duplicateSet.coordinates.split(",").map(parseFloat);
				const locationIds = duplicateSet.locationIds;

				// Skip the first location (keep its coordinates as is)
				for (let i = 1; i < locationIds.length; i++) {
					const locationId = locationIds[i];
					const location = locations[locationId];

					// Calculate the shifted coordinates
					const shiftedCoords = shiftCoordinates(firstLat, firstLng, i, offsetInMeters);

					// Create or update the events array
					const events = [...(location.events || [])];

					// Add event for this change
					events.push({
						timestamp: Date.now(),
						description: "Coordinates shifted to resolve duplicate location issue",
						changedBy: "System",
						changed: {
							latitude: { old: location.latitude, new: shiftedCoords.latitude },
							longitude: { old: location.longitude, new: shiftedCoords.longitude },
						},
					});

					// Prepare update
					updates[`${locationId}/latitude`] = shiftedCoords.latitude;
					updates[`${locationId}/longitude`] = shiftedCoords.longitude;
					updates[`${locationId}/events`] = events;
					updates[`${locationId}/modifiedAt`] = Date.now();
					updates[`${locationId}/modifiedBy`] = "System";

					shiftsApplied++;
				}
			}

			// Execute updates if there are any
			if (Object.keys(updates).length > 0) {
				if (!dryRun) {
					await locationsRef.update(updates);
					console.log(`Updated ${shiftsApplied} locations with shifted coordinates`);
					res.status(200).json({
						success: true,
						message: `Updated ${shiftsApplied} locations with shifted coordinates`,
						totalProcessed: paginatedDuplicates.length,
						hasMore: endIndex < totalDuplicateCoordinates,
						nextStartIndex: endIndex < totalDuplicateCoordinates ? endIndex : null,
						nextUrl:
							endIndex < totalDuplicateCoordinates
								? `/updateDuplicateLocationCoordinates?startIndex=${endIndex}&batchSize=${batchSize}&offsetInMeters=${offsetInMeters}`
								: null,
					});
				} else {
					console.log(`Dry run: ${shiftsApplied} locations would be updated (no changes made)`);
					res.status(200).json({
						success: true,
						message: `Dry run: ${shiftsApplied} locations would be updated`,
						totalProcessed: paginatedDuplicates.length,
						hasMore: endIndex < totalDuplicateCoordinates,
						nextStartIndex: endIndex < totalDuplicateCoordinates ? endIndex : null,
						nextUrl:
							endIndex < totalDuplicateCoordinates
								? `/updateDuplicateLocationCoordinates?startIndex=${endIndex}&batchSize=${batchSize}&offsetInMeters=${offsetInMeters}&dryRun=true`
								: null,
					});
				}
			} else {
				res.status(200).json({
					success: true,
					message: "No updates required for this batch",
					totalProcessed: paginatedDuplicates.length,
				});
			}
		} catch (error: any) {
			console.error("Error updating duplicate location coordinates:", error);
			res.status(500).json({
				success: false,
				message: "Error updating duplicate location coordinates",
				error: error.message,
			});
		}
	});
