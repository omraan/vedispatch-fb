import * as admin from "firebase-admin";
import { ArugasData } from "./types";

export const checkAndAddVehicles = async (trimmedData: ArugasData[], organizationId: string) => {
	const vehiclesRef = admin.database().ref(`/organizations/${organizationId}/vehicles`);
	const vehiclesSnapshot = await vehiclesRef.once("value");
	let vehicles = vehiclesSnapshot.val() || {};

	try {
		for (const item of trimmedData) {
			// Verplaats de zoekopdracht naar matchedVehicle binnen de loop
			const matchedVehicle = Object.values(vehicles).find(
				(vehicle: any) => vehicle.licensePlate === item.vehicle
			);

			if (!matchedVehicle) {
				// Voertuig bestaat niet, dus voeg het toe met push voor een unieke ID
				const newVehicle = {
					title: item.vehicle,
					licensePlate: item.vehicle, // Je moet de licensePlate bepalen of opvragen
					earliestStartTime: "07:00",
					latestEndTime: "17:00",
					capacity: {
						units: 80,
					},
					type: "Cylinder",
					breaks: [],
					createdBy: "System",
					createdAt: Date.now(),
					modifiedBy: "System",
					modifiedAt: Date.now(),
				};

				const response = await vehiclesRef.push(newVehicle);

				if (response?.key) {
					vehicles = {
						...vehicles,
						[response.key]: newVehicle,
					};
				}
			}
		}
	} catch (error) {
		console.error(`Fout bij het controleren/toevoegen van voertuig: ${error}`);
	}
};
