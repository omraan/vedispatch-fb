import * as admin from "firebase-admin";
// import { Agent, fetch, setGlobalDispatcher } from "undici";
import {
	fetchArugasData,
	scheduledFetchArugasData,
	updateDuplicateLocationCoordinates,
	updateMissingLocations,
} from "./arugas";
import { updateArugasCustomerLocation } from "./arugas/Event";
import { sanitizeArugasCoordinates } from "./arugas/sanitizeCoordinates";
import { cleanUpDuplicateCustomers } from "./helper/CleanUpUnusedCustomers";
import { fetchLastLocationUsers } from "./location";
import { importCustomers } from "./migrations/customers/importCustomers";
import { validateCustomerMigration } from "./migrations/customers/validateCustomerMigration";
import { removeAllOrders } from "./order";
// import { updateOrderEvent } from "./order/Event";
import * as functions from "firebase-functions";
import { fetchLastUserLocation } from "./user";

require("dotenv").config();

// Emulator configuratie
const loadEmulatorConfig = () => {
	if (process.env.FUNCTIONS_EMULATOR === "true") {
		try {
			const fs = require("fs");
			const path = require("path");
			const configPath = path.resolve(__dirname, "../firebase-functions-config.json");

			if (fs.existsSync(configPath)) {
				const configJson = JSON.parse(fs.readFileSync(configPath, "utf8"));
				process.env.FIREBASE_CONFIG = JSON.stringify(configJson);
				console.log("Emulator config loaded:", configJson);
			}
		} catch (error) {
			console.error("Error loading emulator config:", error);
		}
	}
};

loadEmulatorConfig();

const environment = functions.config().environment?.mode;
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
exports.sanitizeArugasCoordinates = sanitizeArugasCoordinates;
exports.importCustomers = importCustomers;
exports.validateCustomerMigration = validateCustomerMigration;
exports.rollbackCustomerMigration =
	require("./migrations/customers/rollbackCustomerMigration").rollbackCustomerMigration;
exports.restoreFromBackup = require("./migrations/utils/generalRollback").restoreFromBackup;

exports.removeAllOrders = removeAllOrders;
exports.fetchLastUserLocation = fetchLastUserLocation;

exports.fetchLastLocationUsers = fetchLastLocationUsers;
exports.cleanUpDuplicateCustomers = cleanUpDuplicateCustomers;
exports.updateMissingLocations = updateMissingLocations;
exports.updateDuplicateLocationCoordinates = updateDuplicateLocationCoordinates;

// Test functie om de config te controleren
export const getConfig = functions.https.onRequest((req, res) => {
	res.json({
		environmentMode: functions.config().environment?.mode,
		fullConfig: functions.config(),
	});
});
