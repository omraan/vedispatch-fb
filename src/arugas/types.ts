export type ArugasData = {
	vehicle: string;
	planned_deliverydate: string;
	clientID: string;
	clientname: string;
	clientStreetName: string;
	clientHouseNumber: string;
	clientAddress: string | null;
	routeNumber: string;
	orderNumber: string;
	clientPhone: string;
	notes: string;
	longitude: string;
	latitude: string;
	deliveryDateTime: string;
	Coordinates_updated: string;
	NEW_Longitude: string;
	NEW_Latitude: string;
	Transactiontype: string;
	Type: string;
	Productcode: string;
	ProductDescription: string;
	Product_quantity: string;
	Product_price: string;
	Total_price: string;
	Customer_email: string;
	Ordertype: string;
	Client_notes: string;
	Cylinder1: string;
	Cylinder2: string;
	Cylinder3: string;
	Cylinder4: string;
	Cylinder5: string;
	Cylinder6: string;
};

// Type definitie voor een route
export interface Route {
	title: string;
	driverId: string;
	vehicleId: string;
	vehicleType: string;
	estimation: {
		timeStart: string;
		geometry?: string;
		timeEnd?: string;
	};
	stops: {
		[key: string]: RouteStop;
	};
	createdBy: string;
	createdAt: number;
	modifiedBy: string;
	modifiedAt: number;
}

export interface RouteStop {
	customerId?: string;
	type: string;
	locationId?: string;
	transitPointId?: string;
	sequence?: number;
	estimation?: {
		timeStart?: string;
		timeArrival?: string;
		timeDeparture?: string;
		duration?: number;
		distance?: number;
		serviceTime?: string;
	};
	status?: string;
	dispatch?: {
		customerId: string;
		locationId: string;
		trackAndTraceCode: string;
		category?: string | null;
		orders: Array<{
			orderNumber: string;
			customFields: Array<{
				fieldId: string;
				fieldName: string;
				value: string;
			}>;
			orderLines: Array<{
				product: {
					code: string;
					description: string;
					price: number;
				};
				quantity: number;
			}>;
			totalPrice: number;
		}>;
		plannedDeliveryDate: string;
		events: Array<{
			title: string;
			description: string;
			userId: string;
			timestamp: Date;
		}>;
		createdAt: number;
		createdBy: string;
		modifiedAt: number;
		modifiedBy: string;
	};
	notes?: string;
	events?: Array<{
		title: string;
		description: string;
		userId: string;
		timestamp: Date;
	}>;
	createdAt?: Date;
	createdBy?: string;
}

export interface LatLng {
	latitude: number;
	longitude: number;
}
