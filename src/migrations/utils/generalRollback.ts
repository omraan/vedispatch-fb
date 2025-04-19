import * as admin from "firebase-admin";
import * as functions from "firebase-functions";
import * as fs from "fs";
import * as path from "path";
import { logMigration } from "./migrationHelpers";

/**
 * Restores a database from a backup file.
 * This is a general-purpose rollback method that can be used for any migration.
 * CAUTION: This will overwrite the entire database or specified paths with the backup data.
 */
export const restoreFromBackup = functions
	.runWith({
		timeoutSeconds: 540, // 9 minutes (max for HTTP functions)
		memory: "2GB",
	})
	.https.onRequest(async (req, res) => {
		const startTime = Date.now();

		try {
			// Parameters
			const backupPath = req.query.backupPath as string;
			const targetPath = (req.query.targetPath as string) || "/";
			const dryRun = req.query.dryRun === "true";
			const environment = functions.config().environment?.mode || "dev";

			// Validation
			if (!backupPath) {
				res.status(400).json({
					error: "Missing backupPath parameter. Please provide the path to your backup file.",
				});
				return;
			}

			// Safety checks for production
			if (environment === "production" && !req.query.confirmProduction) {
				res.status(403).json({
					error: "Refusing to restore backup in production environment. Add confirmProduction=true parameter if you really want to proceed.",
				});
				return;
			}

			console.log(`Starting database restore from ${backupPath} to ${targetPath}. Dry run: ${dryRun}`);

			// Load backup data
			let backupData;
			try {
				// For absolute paths
				if (path.isAbsolute(backupPath)) {
					if (!fs.existsSync(backupPath)) {
						res.status(404).json({ error: `Backup file not found at ${backupPath}` });
						return;
					}
					const rawData = fs.readFileSync(backupPath, "utf8");
					backupData = JSON.parse(rawData);
				}
				// For relative paths (assuming they're relative to the function's directory)
				else {
					const resolvedPath = path.resolve(__dirname, "../../../", backupPath);
					if (!fs.existsSync(resolvedPath)) {
						res.status(404).json({ error: `Backup file not found at ${resolvedPath}` });
						return;
					}
					const rawData = fs.readFileSync(resolvedPath, "utf8");
					backupData = JSON.parse(rawData);
				}
			} catch (error) {
				console.error("Error loading backup:", error);
				res.status(500).json({
					error: "Failed to load backup file",
					details: error instanceof Error ? error.message : String(error),
				});
				return;
			}

			// If targetPath is not root, extract only the relevant portion of the backup
			if (targetPath !== "/") {
				const pathParts = targetPath.split("/").filter(Boolean);
				let currentData = backupData;

				for (const part of pathParts) {
					if (!currentData || typeof currentData !== "object" || !(part in currentData)) {
						res.status(400).json({
							error: `Path ${targetPath} not found in backup data`,
						});
						return;
					}
					currentData = currentData[part];
				}

				backupData = currentData;
			}

			// Summary of what will be restored
			const nodeCount = countNodes(backupData);

			console.log(`Found ${nodeCount} nodes in backup data to restore`);

			// In dry run mode, just return the summary without making changes
			if (dryRun) {
				res.status(200).json({
					message: "Dry run completed. No changes were made.",
					summary: {
						backupPath,
						targetPath,
						nodesCount: nodeCount,
						dryRun,
					},
				});
				return;
			}

			// Actually restore the data
			const dbRef = admin.database().ref(targetPath);
			await dbRef.set(backupData);

			const endTime = Date.now();
			const executionTimeSeconds = (endTime - startTime) / 1000;

			// Log the restore operation
			await logMigration("restoreFromBackup", {
				startTime,
				endTime,
				result: {
					backupPath,
					targetPath,
					nodesCount: nodeCount,
					executionTimeSeconds,
				},
				params: req.query,
			});

			res.status(200).json({
				message: "Backup restoration completed successfully",
				summary: {
					backupPath,
					targetPath,
					nodesCount: nodeCount,
					executionTimeSeconds,
				},
			});
		} catch (error) {
			console.error("Unexpected error during backup restoration:", error);

			res.status(500).json({
				error: "Unexpected error during backup restoration",
				details: error instanceof Error ? error.message : String(error),
			});
		}
	});

/**
 * Counts the total number of nodes in an object (recursively)
 */
function countNodes(obj: any): number {
	if (!obj || typeof obj !== "object") {
		return 1;
	}

	let count = 1; // Count the current node

	for (const key in obj) {
		if (Object.prototype.hasOwnProperty.call(obj, key)) {
			count += countNodes(obj[key]);
		}
	}

	return count;
}
