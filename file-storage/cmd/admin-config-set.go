/*
 * Copyright (c) 2019-2021. Abstrium SAS <team (at) pydio.com>
 * This file is part of Pydio Cells.
 *
 * Pydio Cells is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * Pydio Cells is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with Pydio Cells.  If not, see <http://www.gnu.org/licenses/>.
 *
 * The latest code can be found at <https://pydio.com>.
 */

package cmd

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"time"

	"github.com/manifoldco/promptui"
	"github.com/spf13/cobra"

	"github.com/pydio/cells/v5/common/config"
)

var configValueFile string

// updateConfigCmd updates a configuration parameter both in the pydio.json file and in the database.
var updateConfigCmd = &cobra.Command{
	Use:   "set",
	Short: "Store a configuration",
	Long: `
DESCRIPTION

  Store a configuration item in both the pydio.json file and in the database.

SYNTAX

  Configuration items are represented by three parameters passed as arguments:
  - serviceName: name of the corresponding service
  - configName: name of the parameter
  - configValue: json-encoded value of the parameter you want to set/change

  With --value-file, pass only serviceName and configName. The JSON value is
  read from that local file and is never included in the command arguments.

  Strings must include JSON double quotes (protected from the shell with single
  quotes). Booleans, numbers, arrays and objects retain their JSON types.

EXAMPLES

  Change the port of micro.web service (rest api)
  $ ` + os.Args[0] + ` admin config set micro.web port 8083

  Json parameter value
  $ ` + os.Args[0] + ` admin config set pydio.grpc.yourservice configName '{"key":"value"}'

  String, boolean and array parameter values
  $ ` + os.Args[0] + ` admin config set pydio.grpc.yourservice configName '"value"'
  $ ` + os.Args[0] + ` admin config set pydio.grpc.yourservice configName true
  $ ` + os.Args[0] + ` admin config set pydio.grpc.yourservice configName '["first","second"]'

`,
	Args: func(cmd *cobra.Command, args []string) error {
		expected := 3
		if configValueFile != "" {
			expected = 2
		}
		if len(args) != expected {
			return errors.New("invalid configuration arguments, please see 'pydio config set --help'")
		}

		// IsValidService ?
		return nil
	},
	RunE: func(cmd *cobra.Command, args []string) error {
		id := args[0]
		path := args[1]
		var value []byte
		if configValueFile != "" {
			var err error
			value, err = os.ReadFile(configValueFile)
			if err != nil {
				return errors.New("configuration file is unavailable")
			}
		} else {
			value = []byte(args[2])
		}
		var data any
		if err := json.Unmarshal(value, &data); err != nil {
			return errors.New("configuration value must be valid JSON")
		}

		if err := config.Set(cmd.Context(), data, "services", id, path); err != nil {
			if configValueFile != "" {
				return errors.New("configuration write failed")
			}
			return err
		}

		if err := config.Save(cmd.Context(), "cli", fmt.Sprintf("Set by path %s/%s", id, path)); err != nil {
			if configValueFile != "" {
				return errors.New("configuration persistence failed")
			}
			return err
		}
		cmd.Println(promptui.IconGood + " Config set")
		return nil
	},
	PostRun: func(cmd *cobra.Command, args []string) {
		cmd.Println("Delaying exit to make sure write operations are committed.")
		<-time.After(1 * time.Second)
	},
}

func init() {
	updateConfigCmd.Flags().StringVar(&configValueFile, "value-file", "", "Read the JSON value from a local file instead of command arguments")
	ConfigCmd.AddCommand(updateConfigCmd)
}
