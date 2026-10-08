package cmd

import (
	"bytes"
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
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

type rejectedConfigValues struct {
	kv.Values
	err error
}

func (v rejectedConfigValues) Set(any) error {
	if v.err != nil {
		return v.err
	}
	return context.Canceled
}

func (v rejectedConfigValues) Val(path ...string) kv.Values {
	return rejectedConfigValues{v.Values.Val(path...), v.err}
}

type rejectedConfigStore struct {
	config.Store
	err error
}

func (s rejectedConfigStore) Context(ctx context.Context) kv.Values {
	return rejectedConfigValues{s.Store.Context(ctx), s.err}
}

type rejectedConfigSaveStore struct{ config.Store }

func (rejectedConfigSaveStore) Save(string, string) error {
	return errors.New("private-fixture-value")
}

func TestConfigSetPropagatesWriteFailure(t *testing.T) {
	ctx := context.Background()
	pool := openurl.MustMemPool[config.Store](ctx, func(context.Context, string) config.Store {
		return rejectedConfigStore{Store: config.NewStore()}
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

func TestConfigSetReadsLocalValueWithoutArgumentsOrErrorDisclosure(t *testing.T) {
	previous := configValueFile
	defer func() { configValueFile = previous }()
	for _, scenario := range []string{"native-object", "oauth-string", "missing-file", "unreadable-file", "malformed-json", "write-failure", "save-failure", "ambiguous-value"} {
		t.Run(scenario, func(t *testing.T) {
			ctx := config.WithStubStore(context.Background())
			if scenario == "write-failure" || scenario == "save-failure" {
				pool := openurl.MustMemPool[config.Store](ctx, func(context.Context, string) config.Store {
					if scenario == "save-failure" {
						return rejectedConfigSaveStore{config.NewStore()}
					}
					return rejectedConfigStore{Store: config.NewStore(), err: errors.New("private-fixture-value")}
				})
				ctx = propagator.With[*openurl.Pool[config.Store]](ctx, config.ContextKey, pool)
			}
			value := `{"tenantId":"controlled-tenant","actors":[{"principalId":"controlled-principal","kind":"HUMAN","userUuid":"existing-user"}],"clientSecretFile":"private-fixture-value"}`
			if scenario == "oauth-string" {
				value = `"private-fixture-value"`
			}
			if scenario == "malformed-json" {
				value = `{"clientSecretFile":"private-fixture-value"`
			}
			configValueFile = filepath.Join(t.TempDir(), "controlled.json")
			if scenario != "missing-file" {
				if err := os.WriteFile(configValueFile, []byte(value), 0600); err != nil {
					t.Fatal(err)
				}
				if scenario == "unreadable-file" {
					if os.Geteuid() == 0 {
						t.Fatal("this check requires the existing non-root SDK identity")
					}
					if err := os.Chmod(configValueFile, 0); err != nil {
						t.Fatal(err)
					}
				}
			}
			cmd := &cobra.Command{}
			cmd.SetContext(ctx)
			var output bytes.Buffer
			cmd.SetOut(&output)
			args := []string{"pydio.rest.n", "platform"}
			if scenario == "ambiguous-value" {
				args = append(args, value)
			}
			err := updateConfigCmd.Args(cmd, args)
			if err == nil {
				err = updateConfigCmd.RunE(cmd, args)
			}
			if scenario == "native-object" || scenario == "oauth-string" {
				if err != nil {
					t.Fatal(err)
				}
				if scenario == "oauth-string" {
					if config.Get(ctx, "services", "pydio.rest.n", "platform").String() != "private-fixture-value" {
						t.Fatal("native OAuth JSON string did not retain its original type")
					}
					if strings.Contains(output.String(), "private-fixture-value") {
						t.Fatal("native OAuth value entered output")
					}
					return
				}
				var actual map[string]any
				if err := config.Get(ctx, "services", "pydio.rest.n", "platform").Scan(&actual); err != nil || actual["tenantId"] != "controlled-tenant" || len(actual["actors"].([]any)) != 1 {
					t.Fatalf("native config consumer did not receive the original object: %v", err)
				}
			} else if err == nil || output.Len() != 0 || (scenario != "save-failure" && config.Get(ctx, "services", "pydio.rest.n", "platform").Get() != nil) {
				t.Fatal("unconfirmed configuration was persisted or reported as success")
			}
			if strings.Contains(output.String(), "private-fixture-value") || (err != nil && strings.Contains(err.Error(), "private-fixture-value")) {
				t.Fatal("file contents leaked into output or error")
			}
		})
	}
}

func TestNativeEntrypointAppliesCurrentActorBeforeListening(t *testing.T) {
	entrypoint, err := filepath.Abs("../tools/docker/images/cells/docker-entrypoint.sh")
	if err != nil {
		t.Fatal(err)
	}
	for _, scenario := range []string{"independent", "delivered", "missing-file", "config-write-failed", "uninstalled"} {
		t.Run(scenario, func(t *testing.T) {
			directory := t.TempDir()
			log := filepath.Join(directory, "calls")
			local := filepath.Join(directory, "native.json")
			if err := os.WriteFile(local, []byte(`{"clientSecretFile":"private-fixture-value"}`), 0600); err != nil {
				t.Fatal(err)
			}
			// This process fixture observes the real entrypoint's command ordering
			// and argv only. Config-store persistence is tested above, not faked here.
			script := `#!/bin/sh
printf '%s\n' "$*" >> "$ENTRYPOINT_CALLS"
if [ "$*" = "admin config check" ]; then
  [ "$ENTRYPOINT_SCENARIO" != uninstalled ]
elif [ "${1:-}" = admin ]; then
  [ "$ENTRYPOINT_SCENARIO" != config-write-failed ]
fi
`
			if err := os.WriteFile(filepath.Join(directory, "cells"), []byte(script), 0700); err != nil {
				t.Fatal(err)
			}
			command := exec.Command("sh", entrypoint, "cells", "start")
			command.Env = []string{"PATH=" + directory + ":" + os.Getenv("PATH"), "ENTRYPOINT_CALLS=" + log,
				"ENTRYPOINT_SCENARIO=" + scenario, "CELLS_BIND=:fixture"}
			if scenario != "independent" {
				if scenario == "missing-file" {
					local += ".missing"
				}
				command.Env = append(command.Env, "CELLS_NATIVE_ACTION_CONFIG_FILE="+local)
			}
			output, runErr := command.CombinedOutput()
			calls, err := os.ReadFile(log)
			if err != nil {
				t.Fatal(err)
			}
			if bytes.Contains(output, []byte("private-fixture-value")) || bytes.Contains(calls, []byte("private-fixture-value")) {
				t.Fatal("native configuration value entered argv or entrypoint output")
			}
			text := string(calls)
			if scenario == "missing-file" || scenario == "config-write-failed" {
				if runErr == nil || strings.Contains(text, "start\n") || strings.Contains(text, "configure\n") {
					t.Fatal("native listener started without confirmed config persistence")
				}
				return
			}
			if runErr != nil {
				t.Fatalf("original entrypoint refused: %v", runErr)
			}
			if scenario == "delivered" {
				expected := "admin config set --value-file " + local + " pydio.rest.n platform\nstart\n"
				if !strings.HasSuffix(text, expected) {
					t.Fatal("the controlled file did not reach config set before listener startup")
				}
			} else if strings.Contains(text, "--value-file") || !strings.HasSuffix(text, map[string]string{"independent": "start\n", "uninstalled": "configure\n"}[scenario]) {
				t.Fatal("independent UI or first-install behavior was changed")
			}
		})
	}
}
