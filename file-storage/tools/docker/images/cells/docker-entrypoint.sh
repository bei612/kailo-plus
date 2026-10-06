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
	cells admin config set pydio.web.oauth secret "$(cat "$CELLS_OAUTH_SECRET_FILE")"
	cells admin config set pydio.web.oauth connectors "$CELLS_OAUTH_CONNECTORS"
fi

echo "[DEBUG] About to run command: [$@]"

exec "$@"
