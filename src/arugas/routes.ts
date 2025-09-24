import * as admin from "firebase-admin";
import { ArugasData, Route } from "./types";
import { generateUniqueTrackAndTraceCode } from "./utils";

export const addRoutes = async (
	trimmedData: ArugasData[],
	organizationId: string,
	date: string,
	transitPointId: string,
	locationId: string,
	transactionTypeId: string | null
) => {
	if (!trimmedData || !trimmedData.length) {
		console.log("Geen data om routes voor te optimaliseren");
		return;
	}

	const db = admin.database();
	const routesRef = db.ref(`/organizations/${organizationId}/routes/${date}`);
	const locationsRef = db.ref(`/organizations/${organizationId}/locations`);
	const locationsSnapshot = await locationsRef.once("value");
	let locations = locationsSnapshot.val() || {};

	const customersRef = db.ref(`/organizations/${organizationId}/customers`);
	const customersSnapshot = await customersRef.once("value");
	const customers = customersSnapshot.val() || {};

	// Haal bestaande routes op voor deze dag
	const existingRoutesSnapshot = await routesRef.once("value");
	const existingRoutes = (existingRoutesSnapshot.val() as Record<string, Route>) || {};

	// Referentie naar unscheduled dispatches
	const unscheduledDispatchesRef = db.ref(`/organizations/${organizationId}/unscheduled-dispatches`);

	try {
		const routeGroups = trimmedData.reduce((acc: { [key: string]: ArugasData[] }, item: ArugasData) => {
			if (item && item.vehicle) {
				if (!acc[item.vehicle]) {
					acc[item.vehicle] = [];
				}
				acc[item.vehicle].push(item);
			} else {
				console.log("Waarschuwing: Gevonden item zonder vehicle property", item);
			}
			return acc;
		}, {});

		if (Object.keys(routeGroups).length === 0) {
			console.log("Geen routes gevonden in data, voortijdig beëindigd");
			return;
		}

		const updatesRoutes: { [key: string]: any } = {};

		// First get all vehicle IDs
		const vehiclesRef = admin.database().ref(`/organizations/${organizationId}/vehicles`);
		const vehiclesSnapshot = await vehiclesRef.once("value");
		const existingVehicles = vehiclesSnapshot.val() || {};

		for (const [vehicleKey, ordersInRoute] of Object.entries(routeGroups)) {
			// Find the actual vehicle ID from existing vehicles
			const vehicleId = Object.keys(existingVehicles).find(
				(key) => existingVehicles[key].licensePlate === vehicleKey
			);

			if (!vehicleId) {
				console.log(`Vehicle not found for license plate: ${vehicleKey}`);
				continue;
			}

			// Zoek bestaande route met dit vehicle
			let existingRouteId = null;
			let existingRoute = null;
			for (const [routeId, route] of Object.entries(existingRoutes)) {
				if (route.title === `Route: ${vehicleKey}`) {
					existingRouteId = routeId;
					existingRoute = route;
					break;
				}
			}

			let newRouteId: string;
			let newRoute: Route;

			if (existingRoute) {
				console.log(`Bestaande route gevonden voor vehicle: ${vehicleKey}`);
				newRouteId = existingRouteId!;
				newRoute = existingRoute;
			} else {
				console.log(`Nieuwe route aanmaken voor vehicle: ${vehicleKey}`);
				newRouteId = routesRef.push().key!;
				const routeStopRef = db.ref(`/organizations/${organizationId}/routes/${date}/${newRouteId}/stops`);
				const newStartRouteStopRef = routeStopRef.push();
				const newStartRouteStopId = newStartRouteStopRef.key;

				newRoute = {
					title: `Route: ${vehicleKey}`,
					driverId: "",
					vehicleId,
					vehicleType: "Cylinder",
					estimation: {
						timeStart: "07:00",
					},
					stops: {
						[newStartRouteStopId!]: {
							locationId,
							transitPointId,
							sequence: 0,
							type: "START_POINT",
							estimation: {
								timeStart: "07:00",
							},
							status: "Open",
						},
					},
					createdBy: "System",
					createdAt: Date.now(),
					modifiedBy: "System",
					modifiedAt: Date.now(),
				} as Route;
			}

			const routeStopRef = db.ref(`/organizations/${organizationId}/routes/${date}/${newRouteId}/stops`);

			// Filter eerst alle orders voor deze route
			console.log(`Verwerken van ${ordersInRoute.length} orders voor route ${vehicleKey}`);

			const customerOrdersMap: {
				[clientID: string]: {
					orderLine: ArugasData;
					vehicle: string;
					vehicleId: string;
					customerId: string;
					locationId: string;
					notes: string;
					category: string | null;
				}[];
			} = {};
			let missingCustomerOrders = 0;
			let missingLocationOrders = 0;
			let missingCustomerCodes = new Set<string>();
			let processedOrders = 0;
			let skippedOrders = 0;

			for (const orderLine of ordersInRoute) {
				if (!orderLine || !orderLine.clientID) {
					console.log("Waarschuwing: ongeldige orderLine data gevonden", orderLine);
					continue;
				}

				const clientID = orderLine.clientID.trim();

				// Als dit een bestaande route is, controleer of deze klant al een stop heeft
				if (existingRoute) {
					const existingStop = Object.values(existingRoute.stops).find(
						(stop: any) => stop.customerId && customers[stop.customerId]?.code === clientID
					);
					if (existingStop) {
						// Check if this specific order already exists
						const orderExists = existingStop.dispatch?.orders.some(
							(order: any) => order.orderNumber === orderLine.orderNumber
						);
						if (orderExists) {
							console.log(
								`Order ${orderLine.orderNumber} bestaat al voor klant ${clientID} in route ${vehicleKey}, overslaan`
							);
							continue;
						}

						// If order doesn't exist, add it to the existing stop
						console.log(
							`Order ${orderLine.orderNumber} toevoegen aan bestaande stop voor klant ${clientID} in route ${vehicleKey}`
						);

						const orderLines = [
							{
								product: {
									code: orderLine.Productcode,
									description: orderLine.ProductDescription,
									price: parseFloat(orderLine.Product_price),
								},
								quantity: parseFloat(orderLine.Product_quantity),
							},
						];

						if (parseFloat(orderLine.deposit_amount) > 0) {
							orderLines.push({
								product: {
									code: orderLine.deposit_item,
									description: orderLine.deposit_descr,
									price: parseFloat(orderLine.deposit_amount),
								},
								quantity: 1,
							});
						}

						// Create the new order object
						const newOrder = {
							orderNumber: orderLine.orderNumber,
							customFields: transactionTypeId
								? [
										{
											fieldId: transactionTypeId,
											fieldName: "transaction_type",
											value: orderLine.Transactiontype,
										},
										{
											fieldId: "batch_number",
											fieldName: "batch_number",
											value: orderLine.routeNumber,
										},
										{
											fieldId: "supplied_cylinder_ytd",
											fieldName: "supplied_cylinder_ytd",
											value: orderLine.YTD_CYL,
										},
										{
											fieldId: "route_code",
											fieldName: "route_code",
											value: orderLine.Routecode,
										},
								  ]
								: [],
							orderLines,
							totalPrice: parseFloat(orderLine.Total_price) + parseFloat(orderLine.deposit_amount),
						};

						// Add the new order to the existing stop's dispatch orders
						if (existingStop.dispatch) {
							existingStop.dispatch.orders.push(newOrder);

							// Update the stop's events
							const currentEvents = existingStop.events || [];
							currentEvents.push({
								title: "Order added to existing stop",
								description: `Order ${orderLine.orderNumber} added to existing stop`,
								userId: "System",
								timestamp: new Date(),
							});
							existingStop.events = currentEvents;
						}
					}
				}

				if (!customerOrdersMap[clientID]) {
					customerOrdersMap[clientID] = [];
				}

				// Zoek de klant
				const matchingCustomer = Object.entries(customers).find(([_, customer]: [string, any]) => {
					const customerCode = customer.code?.trim();
					return customerCode === clientID;
				});

				const customerId = matchingCustomer ? matchingCustomer[0] : "";
				if (!customerId) {
					missingCustomerOrders++;
					missingCustomerCodes.add(clientID);
					continue;
				}

				// Controleer of de klant een defaultLocationId heeft
				if (!customers[customerId].defaultLocationId) {
					missingLocationOrders++;
					continue;
				}

				let input = {
					orderLine,
					vehicle: orderLine.vehicle,
					vehicleId,
					customerId,
					locationId: customers[customerId].defaultLocationId,
					notes: orderLine.notes || "",
					category:
						orderLine.Type === "Commercial"
							? "commercial"
							: orderLine.BatchHistory.length > 0
							? "priority"
							: null,
				};

				customerOrdersMap[clientID].push(input);
				processedOrders++;
			}

			console.log(`Samenvatting voor route ${vehicleKey}:`);
			console.log(`- Totaal orders: ${ordersInRoute.length}`);
			console.log(`- Verwerkte orders: ${processedOrders}`);
			console.log(`- Overgeslagen orders: ${skippedOrders}`);
			console.log(`- Orders zonder klant: ${missingCustomerOrders}`);
			console.log(`- Orders zonder locatie: ${missingLocationOrders}`);
			console.log(`- Unieke klanten: ${Object.keys(customerOrdersMap).length}`);
			console.log(`- Niet gevonden klant codes: ${Array.from(missingCustomerCodes).join(", ")}`);

			let sequence = 0;

			for (const clientId in customerOrdersMap) {
				sequence = sequence + 1;
				if (customerOrdersMap.hasOwnProperty(clientId)) {
					const customerOrders: {
						orderLine: ArugasData;
						vehicle: string;
						vehicleId: string;
						customerId: string;
						locationId: string;
						notes: string;
						category: string | null;
					}[] = customerOrdersMap[clientId];

					// Controleer of er orders zijn voor deze klant voor het huidige voertuig
					const ordersForCurrentVehicle = customerOrders.filter((order) => order.vehicle === vehicleKey);

					if (ordersForCurrentVehicle.length === 0) {
						// We slaan deze klant over voor dit voertuig, maar loggen dit niet als error
						// omdat de klant orders kan hebben bij andere voertuigen
						continue;
					}

					// Gebruik alleen orders voor het huidige voertuig
					const relevantOrders = ordersForCurrentVehicle;

					// Controleer of de customer gegevens beschikbaar zijn
					if (!relevantOrders[0].customerId || !relevantOrders[0].locationId) {
						console.log(`Ontbrekende customer of location ID voor klant ${clientId}, overslaan.`);
						continue;
					}

					const trackAndTraceCode = await generateUniqueTrackAndTraceCode();

					const newRouteStopRef = routeStopRef.push();
					const newRouteStopId = newRouteStopRef.key;

					const dispatch = {
						customerId: relevantOrders[0].customerId,
						locationId: relevantOrders[0].locationId,
						trackAndTraceCode,
						category: relevantOrders[0].category,
						orders: relevantOrders
							.map(
								(order: {
									orderLine: ArugasData;
									vehicle: string;
									vehicleId: string;
									customerId: string;
									locationId: string;
									notes: string;
									category: string | null;
								}) => {
									const customFields: any[] = [];
									if (transactionTypeId) {
										customFields.push({
											fieldId: transactionTypeId,
											fieldName: "transaction_type",
											value: order.orderLine.Transactiontype,
										});
									}

									if (order.orderLine.routeNumber) {
										customFields.push({
											fieldId: "batch_number",
											fieldName: "batch_number",
											value: order.orderLine.routeNumber,
										});
									}
									if (order.orderLine.YTD_CYL) {
										customFields.push({
											fieldId: "supplied_cylinder_ytd",
											fieldName: "supplied_cylinder_ytd",
											value: order.orderLine.YTD_CYL,
										});
									}
									if (order.orderLine.Routecode) {
										customFields.push({
											fieldId: "route_code",
											fieldName: "route_code",
											value: order.orderLine.Routecode,
										});
									}

									const orderLines = [
										{
											product: {
												code: order.orderLine.Productcode,
												description: order.orderLine.ProductDescription,
												price: parseFloat(order.orderLine.Product_price),
											},
											quantity: parseFloat(order.orderLine.Product_quantity),
										},
									];
									if (parseFloat(order.orderLine.deposit_amount) > 0) {
										orderLines.push({
											product: {
												code: order.orderLine.deposit_item,
												description: order.orderLine.deposit_descr,
												price: parseFloat(order.orderLine.deposit_amount),
											},
											quantity: 1,
										});
									}

									return {
										orderNumber: order.orderLine.orderNumber,
										customFields,
										orderLines,
										totalPrice:
											parseFloat(order.orderLine.Total_price) +
											parseFloat(order.orderLine.deposit_amount),
									};
								}
							)
							.filter(Boolean),
						plannedDeliveryDate: date,
						events: [
							{
								title: "Dispatch created",
								description: "Dispatch created and added to dispatch",
								userId: "System",
								timestamp: new Date(),
							},
						],
						createdAt: Date.now(),
						createdBy: "System",
						modifiedAt: Date.now(),
						modifiedBy: "System",
					};

					// Controleer of de locatie ongeldige coördinaten heeft (0,0)
					let hasInvalidCoordinates = false;
					if (relevantOrders[0].locationId) {
						const location = locations[relevantOrders[0].locationId];
						if (
							location &&
							(!location.latitude ||
								!location.longitude ||
								parseFloat(location.latitude) === 0 ||
								parseFloat(location.longitude) === 0)
						) {
							console.log(
								`Invalid coordinates (0,0) for customer ${relevantOrders[0].customerId}, adding to unscheduled dispatches.`
							);
							hasInvalidCoordinates = true;

							// Voeg toe aan unscheduled dispatches
							const unscheduledDispatchData = {
								...dispatch,
								events: [
									{
										title: "Dispatch created",
										description:
											"Dispatch created and added to unscheduled dispatches due to invalid coordinates.",
										userId: "System",
										timestamp: new Date(),
									},
								],
								vehicleId,
								// Zorg ervoor dat de vereiste velden aanwezig zijn
								customerId: dispatch.customerId || "unknown",
								locationId: dispatch.locationId || "unknown",
							};

							try {
								await unscheduledDispatchesRef.push(unscheduledDispatchData);
								console.log(
									`Unscheduled dispatch toegevoegd voor klant ${relevantOrders[0].customerId}`
								);
							} catch (error) {
								console.error(`Fout bij toevoegen van unscheduled dispatch:`, error);
							}
							continue; // Skip adding to route
						}
					}

					// We weten nu al dat de orders voor het huidige voertuig zijn, dus geen vehicle check meer nodig
					if (!hasInvalidCoordinates) {
						newRoute.stops[newRouteStopId!] = {
							dispatch,
							type: "DELIVERY",
							customerId: relevantOrders[0].customerId,
							notes: relevantOrders[0].notes,
							status: "Open",
							sequence,
							estimation: {
								serviceTime: "00:05:00",
							},
							events: [
								{
									title: "Route created",
									description: "Route created and added to route",
									userId: "System",
									timestamp: new Date(),
								},
							],
							createdAt: new Date(),
							createdBy: "System",
						};
					}
				}
			}
			const newEndRouteStopRef = routeStopRef.push();
			const newEndRouteStopId = newEndRouteStopRef.key;

			newRoute.stops[newEndRouteStopId!] = {
				type: "END_POINT",
				status: "Open",
				sequence: sequence + 1,
				locationId,
				transitPointId,
				createdAt: new Date(),
				createdBy: "System",
			};

			// At the end of the for loop that iterates through vehicleKey and ordersInRoute
			// After processing all orders, add the route to updatesRoutes
			updatesRoutes[newRouteId] = newRoute;
		}
		await routesRef.update(updatesRoutes);
	} catch (error) {
		console.error(`Error processing routes:`, error);
	}
};
