import moment from "moment";
import { LatLng } from "./types";

export const getOptimizedTrip = async (start: LatLng, destinations: LatLng[]) => {
	const coordinates = [start, ...destinations].map((d) => `${d.longitude},${d.latitude}`).join(";");

	const accessKey = process.env["ALL_FIREBASE_MAPBOX_KEY"];
	const url = `https://api.mapbox.com/optimized-trips/v1/mapbox/driving/${coordinates}?source=first&destination=last&roundtrip=false&access_token=${accessKey}`;

	const response: any = await fetch(url);
	if (!response.ok) {
		console.error(response);
		throw new Error(`HTTP error! status: ${response.status}`);
	}
	const routeResponse: any = await response.json();

	const { waypoints, trips } = routeResponse;

	const tripsWithTimes = trips.map((trip: any) => ({
		...trip,
		legs: trip.legs.map((leg: any, index: number) => {
			let departure_time = moment();
			if (index > 0) {
				const prevLeg = trip.legs[index - 1];
				departure_time = moment(prevLeg.arrival_time).add(prevLeg.duration, "seconds");
			}
			const arrival_time = moment(departure_time).add(leg.duration, "seconds");

			return {
				...leg,
				departure_time: departure_time.format("HH:mm"),
				arrival_time: arrival_time.format("HH:mm"),
			};
		}),
	}));
	return { waypoints, trips: tripsWithTimes };
};
