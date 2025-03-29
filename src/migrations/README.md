# Data Migration Tools

This directory contains tools for safely migrating data between old and new structures in Firebase.

## Directory Structure

```
migrations/
├── customers/            # Customer migrations
│   ├── importCustomers.ts
│   └── validateCustomerMigration.ts
└── utils/                # Reusable migration utilities
    └── migrationHelpers.ts
```

## Available Migrations

### Customer Migration (`importCustomers`)

This function migrates customers from the old `/customers` structure to the new `/organizations/${orgId}/customers` structure with associated locations.

**Usage**:

```bash
# For dry-run (no actual changes)
curl "https://us-central1-innova-gps-tracking-dev.cloudfunctions.net/importCustomers?dryRun=true"

# For a specific organization
curl "https://us-central1-innova-gps-tracking-dev.cloudfunctions.net/importCustomers?organizationId=your-org-id"

# With custom batch size
curl "https://us-central1-innova-gps-tracking-dev.cloudfunctions.net/importCustomers?batchSize=50"

# To overwrite existing customers (default = false)
curl "https://us-central1-innova-gps-tracking-dev.cloudfunctions.net/importCustomers?skipExisting=false"
```

### Customer Migration Validation (`validateCustomerMigration`)

This function validates whether customers were correctly migrated by comparing the old and new structures.

**Usage**:

```bash
# Basic validation
curl "https://us-central1-innova-gps-tracking-dev.cloudfunctions.net/validateCustomerMigration"

# With detailed report
curl "https://us-central1-innova-gps-tracking-dev.cloudfunctions.net/validateCustomerMigration?detailedReport=true"

# Generate fix scripts
curl "https://us-central1-innova-gps-tracking-dev.cloudfunctions.net/validateCustomerMigration?generateFixScript=true"
```

## Best Practices for Production Migrations

### 1. Create a Backup

Always create a full backup of your current data first:

```bash
firebase database:get / > database-backup-$(date +%Y%m%d).json
```

### 2. Incremental and Idempotent Approach

-   **Test in Development**: Fully test the migration in your development environment first.
-   **Dry-runs**: Use `dryRun=true` to simulate the impact of the migration without making changes.
-   **Batch Processing**: Process large datasets in smaller batches to prevent timeouts.
-   **Idempotency**: Migrations are designed to be safely executed multiple times without creating duplicate data.

### 3. Migration Validation

Always use `validateCustomerMigration` after a migration to verify that data was correctly transferred.

### 4. Rollback Strategy

Keep the old data structure until the migration is fully validated and accepted. If there are issues:

1. Restore functionality to continue using the old structure
2. Identify and resolve issues in the migration code
3. Re-run the migration with adjusted parameters

### 5. Planning and Communication

-   Execute migrations during quiet periods
-   Communicate possible interruptions to end users
-   Consider a temporary maintenance mode

### 6. Monitoring

-   Check logs for errors
-   Use the built-in migration logging under `/migrations` in the database
-   Monitor the application after migration for 24-48 hours

## Extending the Migration Framework

To add new migrations:

1. Create a new directory under `migrations/` for your specific data type
2. Implement the migration using utilities from `utils/migrationHelpers.ts`
3. Use `detectChanges` from `utils/dataUtils.ts` for intelligent updates
4. Add a validation function that verifies migration results
