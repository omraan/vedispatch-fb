# Migration Command-line Interface

Migrations can be executed in two ways:

1. Using our CLI tool (recommended for local development)
2. Using direct HTTP calls or the Firebase CLI (for production)

## Using the CLI Tool

The CLI tool provides a convenient way to execute migrations from your local development environment. It connects directly to the deployed Firebase Functions.

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

## HTTP Endpoint Access

Instead of using the CLI, migration functions can be called directly using curl commands. The migrations run as Firebase Functions and are accessible via HTTP endpoints.

### Execute Customer Migration

```bash
# Dry-run (no actual changes)
curl "https://us-central1-innova-gps-tracking-dev.cloudfunctions.net/importCustomers?dryRun=true"

# For a specific organization
curl "https://us-central1-innova-gps-tracking-dev.cloudfunctions.net/importCustomers?organizationId=your-org-id"

# With custom batch size
curl "https://us-central1-innova-gps-tracking-dev.cloudfunctions.net/importCustomers?batchSize=50"

# To overwrite existing customers (default = false)
curl "https://us-central1-innova-gps-tracking-dev.cloudfunctions.net/importCustomers?skipExisting=false"

# Combination of parameters
curl "https://us-central1-innova-gps-tracking-dev.cloudfunctions.net/importCustomers?organizationId=your-org-id&dryRun=true&batchSize=50"
```

### Validate Customer Migration

```bash
# Basic validation
curl "https://us-central1-innova-gps-tracking-dev.cloudfunctions.net/validateCustomerMigration"

# With detailed report
curl "https://us-central1-innova-gps-tracking-dev.cloudfunctions.net/validateCustomerMigration?detailedReport=true"

# Generate fix scripts
curl "https://us-central1-innova-gps-tracking-dev.cloudfunctions.net/validateCustomerMigration?generateFixScript=true"

# For a specific organization
curl "https://us-central1-innova-gps-tracking-dev.cloudfunctions.net/validateCustomerMigration?organizationId=your-org-id"
```

## Using the Firebase CLI

You can also use the Firebase CLI to call functions directly:

```bash
# Execute customer migration
firebase functions:call importCustomers --data '{"organizationId":"your-org-id", "dryRun":true}'

# Validate customer migration
firebase functions:call validateCustomerMigration --data '{"organizationId":"your-org-id", "detailedReport":true}'
```

## Shell Script for Complex Migrations

For more extensive migrations, a shell script can be more convenient:

```bash
#!/bin/bash
# migrate.sh - Script for executing database migrations

# Configuration
PROJECT="innova-gps-tracking-dev"
REGION="us-central1"
BASE_URL="https://$REGION-$PROJECT.cloudfunctions.net"

# Functions
function run_customer_migration() {
  local org_id=$1
  local dry_run=${2:-true}
  local batch_size=${3:-100}

  echo "Starting migration for organization: $org_id (dry run: $dry_run)"
  curl -s "$BASE_URL/importCustomers?organizationId=$org_id&dryRun=$dry_run&batchSize=$batch_size" | jq .
}

function validate_customer_migration() {
  local org_id=$1
  local detailed=${2:-false}
  local fix_script=${3:-false}

  echo "Starting validation for organization: $org_id"
  curl -s "$BASE_URL/validateCustomerMigration?organizationId=$org_id&detailedReport=$detailed&generateFixScript=$fix_script" | jq .
}

# Command processing
case "$1" in
  customers)
    run_customer_migration "$2" "$3" "$4"
    ;;
  validate-customers)
    validate_customer_migration "$2" "$3" "$4"
    ;;
  *)
    echo "Usage: $0 {customers|validate-customers} [org_id] [options]"
    exit 1
    ;;
esac

exit 0
```

Usage:

```bash
# Make executable
chmod +x migrate.sh

# Dry-run test migration for organization "org123"
./migrate.sh customers org123 true 50

# Execute actual migration
./migrate.sh customers org123 false 50

# Run validation
./migrate.sh validate-customers org123 true true
```
