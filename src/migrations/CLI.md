# Migration Command-line Interface

Migrations can be executed in two ways:

1. Using our CLI tool (recommended for local development)
2. Using direct HTTP calls or the Firebase CLI (for production)

## Using the CLI Tool

The CLI tool provides a convenient way to execute migrations from your local development environment. It connects directly to the deployed Firebase Functions.

### Selecting the Firebase Project

The CLI tool automatically uses the currently active Firebase project. To switch between dev, test, or prod environments, use the Firebase CLI to select the project before running migration commands:

```bash
# List available Firebase projects
firebase projects:list

# Switch to development environment
firebase use innova-gps-tracking-dev

# Switch to testing environment
firebase use innova-gps-tracking-test

# Switch to production environment
firebase use innova-gps-tracking-prod

# Check currently active project
firebase use
```

You can also check which project is currently active by using our CLI tool:

```bash
# Shows detailed information about the current Firebase project
npm run migrate -- project-info
```

This will display:

-   Project ID (e.g., innova-gps-tracking-dev)
-   Environment (development, testing, or production)
-   Function Base URL
-   Admin SDK authentication status

### Running Migrations

After selecting the appropriate Firebase project, run migration commands:

```bash
# Build and run the CLI tool
npm run migrate -- customers --dryRun --orgId=your-org-id

# Validate migration with detailed report
npm run migrate -- validate-customers --detailedReport --generateFixScript
```

### Available Commands

#### Customer Migration

```bash
npm run migrate -- customers [options]

Options:
  --dryRun         Perform a simulation without modifying data (default: false)
  --orgId          Specific organization ID to migrate
  --batchSize      Number of customers per batch (default: 100)
  --skipExisting   Skip existing customers (default: true)
```

#### Validate Customer Migration

```bash
npm run migrate -- validate-customers [options]

Options:
  --orgId              Specific organization ID to validate
  --detailedReport     Generate a detailed report (default: false)
  --generateFixScript  Generate a script to fix issues (default: false)
```

#### Roll Back Customer Migration

```bash
npm run migrate -- rollback-customers [options]

Options:
  --dryRun         Perform a simulation without modifying data (default: true)
  --orgId          Specific organization ID to roll back
  --cutoffTime     Unix timestamp - only roll back customers created after this time
```

> **Note:** The rollback operation is designed for development/testing purposes and should be used with caution. Always run with `--dryRun` first to see what would be removed.

#### Restore Database from Backup

```bash
npm run migrate -- restore [options]

Options:
  --backupPath     Path to the backup file (JSON) [required]
  --targetPath     Target path in the database to restore to (default: "/")
  --dryRun         Perform a simulation without modifying data (default: true)
```

> **Warning:** The restore operation will overwrite all data at the specified path. This is a powerful operation that should be used with extreme caution, especially in production environments. Always run with `--dryRun` first.

## HTTP Endpoint Access

Instead of using the CLI, migration functions can be called directly using curl commands. The migrations run as Firebase Functions and are accessible via HTTP endpoints.

When working with multiple environments, make sure to use the correct project URL:

-   Development: `https://us-central1-innova-gps-tracking-dev.cloudfunctions.net/`
-   Testing: `https://us-central1-innova-gps-tracking-test.cloudfunctions.net/`
-   Production: `https://us-central1-innova-gps-tracking-prod.cloudfunctions.net/`

### Execute Customer Migration

```bash
# Replace ${PROJECT} with your target environment (dev, test, or prod)
PROJECT="innova-gps-tracking-dev"

# Dry-run (no actual changes)
curl "https://us-central1-${PROJECT}.cloudfunctions.net/importCustomers?dryRun=true"

# For a specific organization
curl "https://us-central1-${PROJECT}.cloudfunctions.net/importCustomers?organizationId=your-org-id"

# With custom batch size
curl "https://us-central1-${PROJECT}.cloudfunctions.net/importCustomers?batchSize=50"

# To overwrite existing customers (default = false)
curl "https://us-central1-${PROJECT}.cloudfunctions.net/importCustomers?skipExisting=false"

# Combination of parameters
curl "https://us-central1-${PROJECT}.cloudfunctions.net/importCustomers?organizationId=your-org-id&dryRun=true&batchSize=50"
```

### Validate Customer Migration

```bash
# Replace ${PROJECT} with your target environment
PROJECT="innova-gps-tracking-dev"

# Basic validation
curl "https://us-central1-${PROJECT}.cloudfunctions.net/validateCustomerMigration"

# With detailed report
curl "https://us-central1-${PROJECT}.cloudfunctions.net/validateCustomerMigration?detailedReport=true"

# Generate fix scripts
curl "https://us-central1-${PROJECT}.cloudfunctions.net/validateCustomerMigration?generateFixScript=true"

# For a specific organization
curl "https://us-central1-${PROJECT}.cloudfunctions.net/validateCustomerMigration?organizationId=your-org-id"
```

### Roll Back Customer Migration

```bash
# Replace ${PROJECT} with your target environment
PROJECT="innova-gps-tracking-dev"

# Dry-run (default, no actual changes)
curl "https://us-central1-${PROJECT}.cloudfunctions.net/rollbackCustomerMigration?dryRun=true"

# For a specific organization
curl "https://us-central1-${PROJECT}.cloudfunctions.net/rollbackCustomerMigration?organizationId=your-org-id"

# Only roll back customers created after a specific time (timestamp in milliseconds)
curl "https://us-central1-${PROJECT}.cloudfunctions.net/rollbackCustomerMigration?cutoffTime=1648123456789"

# Actually perform the rollback (be careful!)
curl "https://us-central1-${PROJECT}.cloudfunctions.net/rollbackCustomerMigration?dryRun=false&organizationId=your-org-id"
```

### Restore Database from Backup

```bash
# Replace ${PROJECT} with your target environment
PROJECT="innova-gps-tracking-dev"

# Dry-run (default, no actual changes)
curl "https://us-central1-${PROJECT}.cloudfunctions.net/restoreFromBackup?backupPath=/path/to/backup.json&dryRun=true"

# Restore to a specific path
curl "https://us-central1-${PROJECT}.cloudfunctions.net/restoreFromBackup?backupPath=/path/to/backup.json&targetPath=/organizations/your-org-id"

# Actually perform the restore (be extremely careful!)
curl "https://us-central1-${PROJECT}.cloudfunctions.net/restoreFromBackup?backupPath=/path/to/backup.json&dryRun=false"

# Special handling for production (needs confirmation)
curl "https://us-central1-${PROJECT}.cloudfunctions.net/restoreFromBackup?backupPath=/path/to/backup.json&dryRun=false&confirmProduction=true"
```

## Using the Firebase CLI

You can also use the Firebase CLI to call functions directly. Make sure to select the correct project first:

```bash
# Select project
firebase use innova-gps-tracking-dev  # or test/prod

# Execute customer migration
firebase functions:call importCustomers --data '{"organizationId":"your-org-id", "dryRun":true}'

# Validate customer migration
firebase functions:call validateCustomerMigration --data '{"organizationId":"your-org-id", "detailedReport":true}'
```

## Shell Script for Complex Migrations

For more extensive migrations, a shell script with environment selection can be more convenient:

```bash
#!/bin/bash
# migrate.sh - Script for executing database migrations

# Default configuration
ENV=${ENV:-dev}  # Default to dev environment if not specified

# Map environment to project ID
case "$ENV" in
  dev)
    PROJECT="innova-gps-tracking-dev"
    ;;
  test)
    PROJECT="innova-gps-tracking-test"
    ;;
  prod)
    PROJECT="innova-gps-tracking-prod"
    ;;
  *)
    echo "Unknown environment: $ENV"
    echo "Please specify ENV=dev, ENV=test, or ENV=prod"
    exit 1
    ;;
esac

REGION="us-central1"
BASE_URL="https://$REGION-$PROJECT.cloudfunctions.net"

# Functions
function run_customer_migration() {
  local org_id=$1
  local dry_run=${2:-true}
  local batch_size=${3:-100}

  echo "Starting migration for organization: $org_id (dry run: $dry_run) on $PROJECT"
  curl -s "$BASE_URL/importCustomers?organizationId=$org_id&dryRun=$dry_run&batchSize=$batch_size" | jq .
}

function validate_customer_migration() {
  local org_id=$1
  local detailed=${2:-false}
  local fix_script=${3:-false}

  echo "Starting validation for organization: $org_id on $PROJECT"
  curl -s "$BASE_URL/validateCustomerMigration?organizationId=$org_id&detailedReport=$detailed&generateFixScript=$fix_script" | jq .
}

function rollback_customer_migration() {
  local org_id=$1
  local dry_run=${2:-true}
  local cutoff_time=$3

  echo "Rolling back migration for organization: $org_id (dry run: $dry_run) on $PROJECT"
  local url="$BASE_URL/rollbackCustomerMigration?organizationId=$org_id&dryRun=$dry_run"

  if [ -n "$cutoff_time" ]; then
    url="$url&cutoffTime=$cutoff_time"
  fi

  curl -s "$url" | jq .
}

# Command processing
case "$1" in
  customers)
    run_customer_migration "$2" "$3" "$4"
    ;;
  validate-customers)
    validate_customer_migration "$2" "$3" "$4"
    ;;
  rollback-customers)
    rollback_customer_migration "$2" "$3" "$4"
    ;;
  *)
    echo "Usage: $0 {customers|validate-customers|rollback-customers} [org_id] [options]"
    echo ""
    echo "Environment:"
    echo "  ENV=dev|test|prod (currently: $ENV -> $PROJECT)"
    exit 1
    ;;
esac

exit 0
```

Usage:

```bash
# Make executable
chmod +x migrate.sh

# Specify environment (default is dev if not specified)
ENV=dev ./migrate.sh customers org123 true 50
ENV=test ./migrate.sh customers org123 true 50
ENV=prod ./migrate.sh customers org123 true 50  # Be extra cautious with production!

# Dry-run test migration for organization "org123"
./migrate.sh customers org123 true 50

# Execute actual migration
./migrate.sh customers org123 false 50

# Run validation
./migrate.sh validate-customers org123 true true

# Roll back migration (dry run)
./migrate.sh rollback-customers org123 true
```
