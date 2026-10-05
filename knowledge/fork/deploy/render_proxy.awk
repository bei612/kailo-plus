# Only two verified lines in the pinned native API proxy may change.
# Keep all native SSE, native routes, timeouts and unrelated nginx variables.
$0 == "proxy_set_header Host $http_host;" {
    print "proxy_set_header Host " authority ";"
    hosts++
    next
}
$0 == "proxy_set_header X-Forwarded-Proto $scheme;" {
    print "proxy_set_header X-Forwarded-Proto " scheme ";"
    schemes++
    next
}
{ print }
END {
    if (hosts != 1 || schemes != 1) exit 78
}
