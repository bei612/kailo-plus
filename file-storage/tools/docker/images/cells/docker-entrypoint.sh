#!/bin/sh

## First check if the system is already installed:
needInstall=false
cells admin config check > /dev/null 2>&1
if [ $? -ne 0  ] ; then
    needInstall=true
fi

# Exit immediately in case of error. See https://www.gnu.org/software/bash/manual/html_node/The-Set-Builtin.html for more details about the set builtin.
set -e

if [ "$needInstall" = true -a "$1" = "cells" -a "$2" = "start" ]; then
	## Remove the first 2 args (aka: cells start) 
	shift 2
	## And re-add cells configure
	set -- cells configure "$@"
fi

# Solve issue when no bind is defined on configure
if [ "$needInstall" = true -a "$2" = "configure" -a "xxx$CELLS_BIND" = "xxx" ]; then   
	# we have to check in ENV and all flags
	bindFlag=false
	for currArg in "$@"
	do
		case $currArg in --bind*)
			bindFlag=true
		esac
	done

	if [ "$bindFlag" = false ]; then
		set -- "$@" --bind :8080
	fi 
fi

# Convenience shortcuts to avoid having to retype 'cells start' before the flags:
# We check if first arg starts with a dash (typically `-f` or `--some-option`) 
# And prefix arguments with 'cells start' or 'cells configure' command in such case 
if [ "${1#-}" != "$1" ]; then
	if [ "$1" = "-h" -o "$1" = "--help"  ]; then
		set -- cells "$@"	
	elif [ "$needInstall" = true ]; then
		set -- cells configure "$@"
	else
		set -- cells start "$@"
	fi
fi

# Apply the same controlled native configuration before opening any frontend
# listener. The old CELLS_OAUTH_CONNECTORS migration is not invoked upstream.
if [ "$1" = "cells" ] && [ "${2:-}" = "start" ] && [ -n "${CELLS_OAUTH_CONNECTORS:-}" ]; then
	: "${CELLS_OAUTH_SECRET_FILE:?native OAuth secret JSON file required}"
	[ -s "$CELLS_OAUTH_SECRET_FILE" ] || exit 1
	cells admin config set --value-file "$CELLS_OAUTH_SECRET_FILE" pydio.web.oauth secret
	cells admin config set pydio.web.oauth connectors "$CELLS_OAUTH_CONNECTORS"
fi

# The existing native actor consumer reads this same Cells config-store item.
# Apply only an explicitly delivered local file, before opening any listener.
# Values and credentials are not expanded into argv or printed by this script.
if [ "$1" = "cells" ] && [ "${2:-}" = "start" ] && [ -n "${CELLS_NATIVE_ACTION_CONFIG_FILE:-}" ]; then
	[ -r "$CELLS_NATIVE_ACTION_CONFIG_FILE" ] && [ -s "$CELLS_NATIVE_ACTION_CONFIG_FILE" ] || exit 1
	cells admin config set --value-file "$CELLS_NATIVE_ACTION_CONFIG_FILE" pydio.rest.n platform
fi

# Binding datasource of the declarative configuration (deploy/reconcile.py):
# created in the configuration before the server starts, as the install does
# for the default datasources, so that it is served from this start. The
# running server holds the configuration and the vault in memory and rewrites
# both files whole on its next save; it must never be created through the
# configuration of a running server by another process.
if [ "$1" = "cells" ] && [ "${2:-}" = "start" ] && [ -n "${CELLS_BINDING_DATASOURCE:-}" ]; then
	: "${CELLS_BINDING_VERSIONING_POLICY:?binding datasource versioning policy required}"
	cells admin datasource ensure --name "$CELLS_BINDING_DATASOURCE" --versioning-policy "$CELLS_BINDING_VERSIONING_POLICY"
fi

# Datasource access keys (the embedded object service root credential and the
# datasources it serves) come only from the delivered owner-only files. The
# native command reads them itself, keeps the secret in the vault, never prints
# values, and leaves the previous credential for the backend re-encryption of
# this start. Applied before any listener opens; a refusal stops the start.
if [ "$1" = "cells" ] && [ "${2:-}" = "start" ] && { [ -n "${CELLS_DATASOURCE_KEY_FILE:-}" ] || [ -n "${CELLS_DATASOURCE_SECRET_FILE:-}" ]; }; then
	: "${CELLS_DATASOURCE_KEY_FILE:?datasource access key file required}"
	: "${CELLS_DATASOURCE_SECRET_FILE:?datasource secret key file required}"
	cells admin datasource keys --access-key-file "$CELLS_DATASOURCE_KEY_FILE" --secret-key-file "$CELLS_DATASOURCE_SECRET_FILE"
fi

echo "[DEBUG] About to run command: [$@]"

exec "$@"
