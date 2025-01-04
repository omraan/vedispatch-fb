import * as admin from "firebase-admin";
// import { Agent, fetch, setGlobalDispatcher } from "undici";
import { fetchArugasData, scheduledFetchArugasData } from "./arugas";
import { updateArugasCustomerLocation } from "./arugas/Event";
import { cleanUpDuplicateCustomers } from "./helper/CleanUpUnusedCustomers";
import { fetchLastLocationUsers } from "./location";
import { removeAllOrders } from "./order";
// import { updateOrderEvent } from "./order/Event";
import { fetchLastUserLocation } from "./user";
require("dotenv").config();

const environment = process.env["ENVIRONMENT"];
const privateKey = process.env[`${environment}_FIREBASE_PRIVATE_KEY`];

const serviceAccount: admin.ServiceAccount = {
	projectId: process.env[`${environment}_FIREBASE_PROJECT_ID`],
	privateKey: privateKey!.replace(/\\n/g, "\n"),
	clientEmail: process.env[`${environment}_FIREBASE_CLIENT_EMAIL`],
};

admin.initializeApp({
	credential: admin.credential.cert(serviceAccount),
	databaseURL: process.env[`${environment}_FIREBASE_DATABASE_URL`],
});

// exports.fetchOrdersByDate = fetchOrdersByDate;

// exports.createOrderEvent = createOrderEvent;
// exports.updateOrderEvent = updateOrderEvent;

exports.fetchArugasData = fetchArugasData;
exports.scheduledFetchArugasData = scheduledFetchArugasData;
exports.updateArugasCustomerLocation = updateArugasCustomerLocation;

exports.removeAllOrders = removeAllOrders;
exports.fetchLastUserLocation = fetchLastUserLocation;

exports.fetchLastLocationUsers = fetchLastLocationUsers;
exports.cleanUpDuplicateCustomers = cleanUpDuplicateCustomers;
