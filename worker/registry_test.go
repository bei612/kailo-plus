package main

import (
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"testing"

	"apps/worker/activities"
)

type recordingRegistrar struct{ names []string }

func (r *recordingRegistrar) RegisterActivity(a interface{}) {
	name := runtime.FuncForPC(reflect.ValueOf(a).Pointer()).Name()
	// "apps/worker/activities.(*CoreAPI).ProjectTaskState-fm" -> "(*CoreAPI).ProjectTaskState"
	name = strings.TrimSuffix(name[strings.LastIndex(name, "/")+1:], "-fm")
	r.names = append(r.names, strings.TrimPrefix(name, "activities."))
}

// Every Activity a Workflow schedules is registered, and nothing else is.
func TestRegisteredActivitiesMatchWorkflowReferences(t *testing.T) {
	files, err := filepath.Glob("workflows/*.go")
	if err != nil || len(files) == 0 {
		t.Fatalf("workflow sources: %v", err)
	}
	reference := regexp.MustCompile(`\(\*activities\.([A-Za-z]+)\)\.([A-Za-z]+)`)
	want := map[string]bool{}
	for _, file := range files {
		if strings.HasSuffix(file, "_test.go") {
			continue
		}
		src, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		for _, m := range reference.FindAllStringSubmatch(string(src), -1) {
			want["(*"+m[1]+")."+m[2]] = true
		}
	}
	r := &recordingRegistrar{}
	registerActivities(r, &activities.SpiceDB{}, &activities.CoreAPI{}, &activities.IdentityProvider{})
	got := map[string]bool{}
	for _, name := range r.names {
		if got[name] {
			t.Errorf("registered twice: %s", name)
		}
		got[name] = true
	}
	var missing, extra []string
	for name := range want {
		if !got[name] {
			missing = append(missing, name)
		}
	}
	for name := range got {
		if !want[name] {
			extra = append(extra, name)
		}
	}
	sort.Strings(missing)
	sort.Strings(extra)
	if len(missing) > 0 || len(extra) > 0 {
		t.Fatalf("activity registration drift: missing %v, not scheduled by any workflow %v", missing, extra)
	}
}
