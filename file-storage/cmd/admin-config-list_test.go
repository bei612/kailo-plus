package cmd

import (
	"bytes"
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/olekukonko/tablewriter"
	"github.com/pydio/cells/v5/common/config"
	"github.com/pydio/cells/v5/common/utils/kv"
	"github.com/pydio/cells/v5/common/utils/openurl"
	"github.com/pydio/cells/v5/common/utils/propagator"
	"github.com/spf13/cobra"
)

func TestDisplayMapHandlesMixedDepthAndValueTypes(t *testing.T) {
	var out bytes.Buffer
	table := tablewriter.NewWriter(&out)
	table.SetHeader([]string{"Path", "Value"})

	displayMap(table, map[string]interface{}{
		"bool": true,
		"nested": map[string]interface{}{
			"value": "configured",
		},
		"number": float64(42),
		"slice":  []interface{}{"a", float64(1)},
	}, "root")

	table.Render()
	rendered := out.String()

	for _, expected := range []string{
		"root/bool",
		"true",
		"root/nested/value",
		"configured",
		"root/number",
		"42",
		"root/slice",
		`["a",1]`,
	} {
		if !strings.Contains(rendered, expected) {
			t.Fatalf("expected rendered table to contain %q, got:\n%s", expected, rendered)
		}
	}
}

func TestConfigSetKeepsJSONConnectorValues(t *testing.T) {
	ctx := config.WithStubStore(context.Background())
	cmd := &cobra.Command{}
	cmd.SetContext(ctx)
	var output bytes.Buffer
	cmd.SetOut(&output)
	if err := updateConfigCmd.RunE(cmd, []string{"pydio.web.oauth", "connectors", `[{"id":"fixture","type":"kailo-oidc","config":{"users":[]}}]`}); err != nil {
		t.Fatal(err)
	}
	var connectors []map[string]any
	if err := config.Get(ctx, "services", "pydio.web.oauth", "connectors").Scan(&connectors); err != nil {
		t.Fatal(err)
	}
	if len(connectors) != 1 || connectors[0]["type"] != "kailo-oidc" {
		t.Fatalf("connector value did not remain JSON: %#v", connectors)
	}
	if _, ok := config.Get(ctx, "services", "pydio.web.oauth", "connectors").Get().([]any); !ok {
		t.Fatal("connector was stored as a string rather than an array")
	}
}

func TestConfigSetRejectsMalformedJSONWithoutSuccess(t *testing.T) {
	ctx := config.WithStubStore(context.Background())
	cmd := &cobra.Command{}
	cmd.SetContext(ctx)
	var output bytes.Buffer
	cmd.SetOut(&output)
	if err := updateConfigCmd.RunE(cmd, []string{"pydio.web.oauth", "connectors", `[{"credential":"private-fixture"`}); err == nil {
		t.Fatal("malformed JSON was accepted")
	} else if strings.Contains(err.Error(), "private-fixture") {
		t.Fatal("configuration value leaked into an error")
	}
	if output.Len() != 0 || config.Get(ctx, "services", "pydio.web.oauth", "connectors").Get() != nil {
		t.Fatal("failed configuration write was reported or persisted as success")
	}
}

type rejectedConfigValues struct{ kv.Values }

func (rejectedConfigValues) Set(any) error { return context.Canceled }

func (v rejectedConfigValues) Val(path ...string) kv.Values {
	return rejectedConfigValues{v.Values.Val(path...)}
}

type rejectedConfigStore struct{ config.Store }

func (s rejectedConfigStore) Context(ctx context.Context) kv.Values {
	return rejectedConfigValues{s.Store.Context(ctx)}
}

func TestConfigSetPropagatesWriteFailure(t *testing.T) {
	ctx := context.Background()
	pool := openurl.MustMemPool[config.Store](ctx, func(context.Context, string) config.Store {
		return rejectedConfigStore{config.NewStore()}
	})
	ctx = propagator.With[*openurl.Pool[config.Store]](ctx, config.ContextKey, pool)
	cmd := &cobra.Command{}
	cmd.SetContext(ctx)
	var output bytes.Buffer
	cmd.SetOut(&output)
	if err := updateConfigCmd.RunE(cmd, []string{"pydio.web.oauth", "connectors", `[]`}); !errors.Is(err, context.Canceled) {
		t.Fatalf("write failure was not returned: %v", err)
	}
	if output.Len() != 0 {
		t.Fatal("failed configuration write reported success")
	}
}
